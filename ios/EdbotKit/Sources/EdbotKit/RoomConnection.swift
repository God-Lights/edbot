import Foundation

/// WebSocket 한 개를 감싼 얇은 인터페이스. 접속 로직을 진짜 네트워크 없이 테스트하려고 분리했다.
public protocol WebSocketTransport: AnyObject, Sendable {
    func connect(url: URL, headers: [String: String]) async throws
    func send(_ text: String) async throws
    /// 다음 텍스트 메시지를 받는다. 상대가 정상적으로 닫으면 nil.
    func receive() async throws -> String?
    func close()
}

public protocol WebSocketFactory: Sendable {
    func make() -> WebSocketTransport
}

/// 화면 쪽에서 `RoomConnection.events` 로 받아 쓰는 이벤트.
public enum NetEvent: Equatable, Sendable {
    case connected(playerId: String, room: RoomSnapshot, reconnected: Bool)
    case state(RoomSnapshot)
    case error(code: String, message: String)
    case reconnecting(attempt: Int)
    case disconnected(reason: String)
}

public struct ConnectionOptions: Sendable {
    public var maxReconnectAttempts = 8
    public var reconnectBackoff: [TimeInterval] = [0.5, 1, 2, 4, 8]
    public var pingInterval: TimeInterval = 5

    public init() {}
}

/// 방 하나에 대한 연결. 끊기면 저장해 둔 토큰으로 자동으로 다시 접속한다(자리를 되찾는다).
public actor RoomConnection {
    public nonisolated let events: AsyncStream<NetEvent>
    private let continuation: AsyncStream<NetEvent>.Continuation
    private let factory: WebSocketFactory
    private let options: ConnectionOptions
    private let nowMs: @Sendable () -> Int64

    private var runTask: Task<Void, Never>?
    private var transport: WebSocketTransport?
    private var wsBase: URL?
    private var roomCode = ""
    private var name = ""
    private var authToken: String?
    private var token: String?
    private var fatal = false
    private var attempt = 0

    public private(set) var playerId: String?
    public private(set) var room: RoomSnapshot?
    public private(set) var clock = ServerClock()

    public init(factory: WebSocketFactory, options: ConnectionOptions = ConnectionOptions(), nowMs: @escaping @Sendable () -> Int64 = currentTimeMs) {
        var captured: AsyncStream<NetEvent>.Continuation!
        events = AsyncStream { captured = $0 }
        continuation = captured
        self.factory = factory
        self.options = options
        self.nowMs = nowMs
    }

    /// 방에 접속한다. 이미 접속 중이면 먼저 끊는다.
    public func start(wsBase: URL, roomCode: String, name: String, authToken: String?) {
        stop()
        self.wsBase = wsBase
        self.roomCode = roomCode.trimmingCharacters(in: .whitespaces).uppercased()
        self.name = name
        self.authToken = authToken
        token = nil
        playerId = nil
        room = nil
        fatal = false
        attempt = 0
        runTask = Task { [weak self] in await self?.run() }
    }

    public func stop() {
        runTask?.cancel()
        runTask = nil
        transport?.close()
        transport = nil
    }

    /// 서버가 보낸 시각을 기준으로 단계가 끝날 때까지 남은 ms.
    public func remainingMs() -> Int64? {
        clock.remainingMs(until: room?.phaseEndsAt, localNowMs: nowMs())
    }

    @discardableResult
    public func send(_ text: String) async -> Bool {
        guard let transport else { return false }
        do {
            try await transport.send(text)
            return true
        } catch {
            return false
        }
    }

    public func sendBan(_ characterId: String) async -> Bool { await send(MessageCodec.ban(characterId)) }
    public func sendPick(_ characterId: String) async -> Bool { await send(MessageCodec.pick(characterId)) }
    public func sendPlace(_ characterId: String, lane: Lane) async -> Bool {
        await send(MessageCodec.place(characterId, lane: lane))
    }
    public func sendUltimate(_ characterId: String, lane: Lane? = nil) async -> Bool {
        await send(MessageCodec.ultimate(characterId, lane: lane))
    }
    public func sendMoveLane(_ characterId: String, lane: Lane) async -> Bool {
        await send(MessageCodec.move(characterId, lane: lane))
    }
    public func sendExplore(_ action: ExploreAction, tile: Int) async -> Bool {
        await send(MessageCodec.explore(action, tile: tile))
    }
    public func sendForgeBuy(quantity: Int = 1) async -> Bool { await send(MessageCodec.forgeBuy(quantity: quantity)) }
    public func sendForgeSmelt() async -> Bool { await send(MessageCodec.forgeSmelt()) }
    public func sendForgeCraft(_ weaponId: String) async -> Bool { await send(MessageCodec.forgeCraft(weaponId)) }
    public func sendForgeEquip(_ weaponId: String, characterId: String) async -> Bool {
        await send(MessageCodec.forgeEquip(weaponId, characterId: characterId))
    }
    public func sendBuy(slot: Int) async -> Bool { await send(MessageCodec.buy(slot: slot)) }
    public func sendSell(_ uid: String) async -> Bool { await send(MessageCodec.sell(uid)) }
    public func sendReroll() async -> Bool { await send(MessageCodec.reroll()) }
    public func sendDeploy(_ uid: String, col: Int, row: Int) async -> Bool { await send(MessageCodec.deploy(uid, col: col, row: row)) }
    public func sendBench(_ uid: String) async -> Bool { await send(MessageCodec.bench(uid)) }
    public func sendDone() async -> Bool { await send(MessageCodec.done()) }
    public func sendSurrender() async -> Bool { await send(MessageCodec.surrender()) }
    public func sendLock() async -> Bool { await send(MessageCodec.lock()) }

    public func sendReady(_ ready: Bool) async -> Bool {
        await send(MessageCodec.ready(ready))
    }

    // ---- 내부 ----

    private func buildURL() -> URL? {
        guard let wsBase else { return nil }
        var text = wsBase.absoluteString + "/ws/" + roomCode
        let query = "?name=" + (name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name)
        text += query
        if let token { text += "&token=" + (token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token) }
        return URL(string: text)
    }

    private func run() async {
        var endReason = "stopped"
        while !Task.isCancelled {
            if attempt > 0 { continuation.yield(.reconnecting(attempt: attempt)) }
            guard let url = buildURL() else {
                endReason = "invalid_url"
                break
            }
            let socket = factory.make()
            transport = socket
            var headers: [String: String] = [:]
            if let authToken { headers["Authorization"] = "Bearer \(authToken)" }

            do {
                try await socket.connect(url: url, headers: headers)
                let pinger = Task { [options, nowMs] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: UInt64(options.pingInterval * 1_000_000_000))
                        if Task.isCancelled { break }
                        try? await socket.send(MessageCodec.ping(nowMs()))
                    }
                }
                defer { pinger.cancel() }
                while let text = try await socket.receive() {
                    handle(text)
                }
            } catch {
                // 연결 실패나 끊김. 아래에서 다시 시도할지 정한다.
            }
            socket.close()
            transport = nil

            if Task.isCancelled { break }
            if fatal {
                endReason = "fatal"
                break
            }
            attempt += 1
            if attempt > options.maxReconnectAttempts {
                endReason = "gave_up"
                break
            }
            let index = min(attempt - 1, options.reconnectBackoff.count - 1)
            try? await Task.sleep(nanoseconds: UInt64(options.reconnectBackoff[index] * 1_000_000_000))
        }
        continuation.yield(.disconnected(reason: endReason))
    }

    private func handle(_ text: String) {
        guard let message = MessageCodec.parse(text) else { return }
        switch message {
        case let .welcome(playerId, token, room):
            let reconnected = self.token != nil
            self.playerId = playerId
            self.token = token
            self.room = room
            attempt = 0
            clock.observe(serverTime: room.serverTime, localNowMs: nowMs())
            continuation.yield(.connected(playerId: playerId, room: room, reconnected: reconnected))
        case let .state(room):
            self.room = room
            clock.observe(serverTime: room.serverTime, localNowMs: nowMs())
            continuation.yield(.state(room))
        case .pong:
            break
        case let .error(code, message):
            if ErrorCode.isFatal(code) { fatal = true }
            continuation.yield(.error(code: code, message: message))
        }
    }
}
