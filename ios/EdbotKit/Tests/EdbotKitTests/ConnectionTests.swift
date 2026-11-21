import XCTest
@testable import EdbotKit

/// 가짜 소켓. 미리 정한 메시지를 차례로 내보내고, 다 끝나면 닫힌 것으로 본다.
final class FakeSocket: WebSocketTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var script: [String?]
    private(set) var urls: [URL] = []
    private(set) var headers: [[String: String]] = []
    private(set) var sent: [String] = []
    let failConnect: Bool

    init(script: [String?], failConnect: Bool = false) {
        self.script = script
        self.failConnect = failConnect
    }

    func connect(url: URL, headers: [String: String]) async throws {
        lock.lock(); urls.append(url); self.headers.append(headers); lock.unlock()
        if failConnect { throw ApiError.badResponse }
    }
    func send(_ text: String) async throws { lock.lock(); sent.append(text); lock.unlock() }
    func receive() async throws -> String? {
        lock.lock()
        let next = script.isEmpty ? nil : script.removeFirst()
        lock.unlock()
        return next
    }
    func close() {}
}

final class FakeFactory: WebSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private var sockets: [FakeSocket]
    private(set) var made: [FakeSocket] = []

    init(_ sockets: [FakeSocket]) { self.sockets = sockets }

    func make() -> WebSocketTransport {
        lock.lock(); defer { lock.unlock() }
        let socket = sockets.isEmpty ? FakeSocket(script: [], failConnect: true) : sockets.removeFirst()
        made.append(socket)
        return socket
    }
}

private func room(_ phase: String, _ code: String = "ABCD") -> String {
    #"{"code":"\#(code)","phase":"\#(phase)","phaseStartedAt":1,"phaseEndsAt":null,"serverTime":5000,"players":[{"id":"p-1","name":"에드","seat":0,"connected":true,"ready":false}]}"#
}
private func welcome(_ token: String = "tok-1") -> String {
    #"{"t":"welcome","playerId":"p-1","token":"\#(token)","room":\#(room("lobby"))}"#
}
private func state(_ phase: String) -> String { #"{"t":"state","room":\#(room(phase))}"# }

final class ConnectionTests: XCTestCase {
    static var fast: ConnectionOptions {
        var options = ConnectionOptions()
        options.reconnectBackoff = [0.01]
        options.pingInterval = 60
        return options
    }

    /// 이벤트를 count개 모은다. 시간이 오래 걸리면 실패로 본다.
    private func collect(_ connection: RoomConnection, count: Int) async -> [NetEvent] {
        await withTaskGroup(of: [NetEvent].self) { group in
            group.addTask {
                var events: [NetEvent] = []
                for await event in connection.events {
                    events.append(event)
                    if events.count == count { break }
                }
                return events
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                return []
            }
            let first = await group.next() ?? []
            group.cancelAll()
            return first
        }
    }

    func testConnectsAndReportsStateThenDisconnects() async {
        let socket = FakeSocket(script: [welcome(), state("ban"), nil])
        let connection = RoomConnection(factory: FakeFactory([socket]), options: {
            var o = Self.fast; o.maxReconnectAttempts = 0; return o
        }(), nowMs: { 4_000 })
        await connection.start(wsBase: URL(string: "wss://x.test")!, roomCode: " abcd ", name: "에드 1", authToken: "gtok")
        let events = await collect(connection, count: 3)

        guard events.count == 3, case let .connected(playerId, _, reconnected) = events[0] else { return XCTFail("\(events)") }
        XCTAssertEqual(playerId, "p-1")
        XCTAssertFalse(reconnected)
        if case let .state(room) = events[1] { XCTAssertEqual(room.phase, .ban) } else { XCTFail("state가 아니다") }
        XCTAssertEqual(events[2], .disconnected(reason: "gave_up"))

        XCTAssertEqual(socket.urls.first?.absoluteString, "wss://x.test/ws/ABCD?name=%EC%97%90%EB%93%9C%201")
        XCTAssertEqual(socket.headers.first?["Authorization"], "Bearer gtok")
        let remaining = await connection.remainingMs()
        XCTAssertNil(remaining) // phaseEndsAt이 없다
    }

    func testReconnectsWithTokenAndReportsReconnected() async {
        let first = FakeSocket(script: [welcome("tok-1"), nil])
        let second = FakeSocket(script: [welcome("tok-1"), state("draft"), nil])
        let factory = FakeFactory([first, second])
        let connection = RoomConnection(factory: factory, options: {
            var o = Self.fast; o.maxReconnectAttempts = 1; return o
        }())
        await connection.start(wsBase: URL(string: "wss://x.test")!, roomCode: "ABCD", name: "A", authToken: nil)
        let events = await collect(connection, count: 6)
        XCTAssertTrue(events.contains(.reconnecting(attempt: 1)), "\(events)")
        let reconnected = events.contains { if case .connected(_, _, true) = $0 { return true } else { return false } }
        XCTAssertTrue(reconnected, "\(events)")
        XCTAssertTrue(second.urls.first?.absoluteString.contains("&token=tok-1") ?? false)
        XCTAssertNil(first.headers.first?["Authorization"])
    }

    func testFatalErrorStopsReconnecting() async {
        let socket = FakeSocket(script: [#"{"t":"error","code":"room_full","message":"방이 가득 찼다."}"#, nil])
        let factory = FakeFactory([socket])
        let connection = RoomConnection(factory: factory, options: Self.fast)
        await connection.start(wsBase: URL(string: "wss://x.test")!, roomCode: "ABCD", name: "A", authToken: nil)
        let events = await collect(connection, count: 2)
        XCTAssertEqual(events, [.error(code: "room_full", message: "방이 가득 찼다."), .disconnected(reason: "fatal")])
        XCTAssertEqual(factory.made.count, 1)
    }

    func testGivesUpAfterMaxAttempts() async {
        let factory = FakeFactory([])
        let connection = RoomConnection(factory: factory, options: {
            var o = Self.fast; o.maxReconnectAttempts = 2; return o
        }())
        await connection.start(wsBase: URL(string: "wss://x.test")!, roomCode: "ABCD", name: "A", authToken: nil)
        let events = await collect(connection, count: 3)
        XCTAssertEqual(events, [.reconnecting(attempt: 1), .reconnecting(attempt: 2), .disconnected(reason: "gave_up")])
    }

    func testSendReadyNeedsConnection() async {
        let connection = RoomConnection(factory: FakeFactory([]), options: Self.fast)
        let sent = await connection.sendReady(true)
        XCTAssertFalse(sent)
    }
}
