import Foundation
import Network
import ServerKit

/// 접속 하나. HTTP 요청을 읽어 서버에 넘기고, WebSocket으로 올라가면 프레임을 주고받는다. (모두 메인 큐에서)
@MainActor
final class ClientConnection {
    private let connection: NWConnection
    private weak var server: LocalServer?
    private var buffer = Data()
    private var decoder = WebSocketDecoder()
    private(set) var socketId: Int?
    private var finished = false
    private var handling = false

    init(connection: NWConnection, server: LocalServer) {
        self.connection = connection
        self.server = server
    }

    func start() {
        // 모든 콜백은 메인 큐에서 온다(connection.start(queue: .main)).
        connection.stateUpdateHandler = { [weak self] state in
            MainActor.assumeIsolated {
                switch state {
                case .failed, .cancelled: self?.finish()
                default: break
                }
            }
        }
        connection.start(queue: .main)
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            MainActor.assumeIsolated {
                guard let self, !self.finished else { return }
                if let data, !data.isEmpty { self.didReceive(data) }
                if isComplete || error != nil { self.finish(); return }
                if !self.finished { self.receive() }
            }
        }
    }

    private func didReceive(_ data: Data) {
        if socketId != nil {
            decoder.feed(data)
            drainFrames()
            return
        }
        guard !handling else { return }
        buffer.append(data)
        switch HTTPParser.parse(buffer) {
        case .needMore:
            break
        case let .failure(status, reason):
            send(HTTPResponse.text(status, reason), thenClose: true)
        case let .request(request, consumed):
            // 같은 연결로 이어서 온 바이트(WebSocket 첫 프레임 등)는 보존한다.
            let rest = buffer.dropFirst(consumed)
            buffer = Data()
            handling = true
            server?.handle(request, from: self, leftover: Data(rest))
        }
    }

    /// WebSocket으로 올라섰다: 핸드셰이크 응답을 보내고, 이후 바이트는 프레임으로 읽는다.
    func upgraded(socketId id: Int, handshake: Data, leftover: Data) {
        socketId = id
        handling = false
        send(handshake)
        if !leftover.isEmpty { decoder.feed(leftover); drainFrames() }
    }

    private func drainFrames() {
        guard let id = socketId else { return }
        do {
            while let event = try decoder.next() {
                switch event {
                case let .text(text): server?.socketText(id: id, text: text)
                case let .binary(data): server?.socketBinary(id: id, data: data)
                case let .ping(data): send(WebSocketEncoder.pong(data))
                case .pong: break
                case let .close(code, _):
                    send(WebSocketEncoder.close(code: code == 1005 ? 1000 : code)) { [weak self] in self?.connection.cancel() }
                    return
                }
            }
        } catch {
            send(WebSocketEncoder.close(code: 1002, reason: "프로토콜 오류")) { [weak self] in self?.connection.cancel() }
        }
    }

    func send(_ data: Data, thenClose: Bool = false, completion: (() -> Void)? = nil) {
        connection.send(content: data, completion: .contentProcessed { [weak self] _ in
            MainActor.assumeIsolated {
                completion?()
                if thenClose { self?.connection.cancel() }
            }
        })
    }

    func close() { connection.cancel() }

    private func finish() {
        guard !finished else { return }
        finished = true
        connection.cancel()
        server?.connectionEnded(self)
    }
}

/// 접속을 받아서 웹 화면이나 엔진으로 보내는 서버.
@MainActor
final class LocalServer {
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: ClientConnection] = [:]
    private var sockets: [Int: ClientConnection] = [:]
    private let engine: EngineBridge
    private let webFiles: StaticFiles?

    /// 연결 번호가 등록되기 전에 엔진이 보낸 것(WebSocket을 받자마자 보내는 첫 상태 등). 등록되면 순서대로 보낸다.
    private enum Outgoing {
        case frame(Data)
        case close(UInt16, String)
    }
    private var pending: [Int: [Outgoing]] = [:]

    /// 웹 화면과 API를 가르는 경로 머리
    private let apiPrefixes = ["/api", "/ws", "/auth", "/health", "/sidestore"]

    init(engine: EngineBridge, webRoot: URL?) {
        self.engine = engine
        self.webFiles = webRoot.map { StaticFiles(root: $0) }
        engine.onSocketSend = { [weak self] id, data, binary in
            guard let self else { return }
            let frame = binary ? WebSocketEncoder.binary(data) : WebSocketEncoder.text(String(decoding: data, as: UTF8.self))
            if let conn = self.sockets[id] { conn.send(frame) } else { self.pending[id, default: []].append(.frame(frame)) }
        }
        engine.onSocketClose = { [weak self] id, code, reason in
            guard let self else { return }
            if let conn = self.sockets.removeValue(forKey: id) {
                conn.send(WebSocketEncoder.close(code: code, reason: reason)) { conn.close() }
            } else {
                self.pending[id, default: []].append(.close(code, reason))
            }
        }
    }

    /// 포트를 열고 주변에 알린다(Bonjour). 열리면 completion(nil), 못 열면 오류 글.
    func start(port: UInt16, advertise: (name: String, txt: [String: String])?, completion: @escaping (String?) -> Void) {
        do {
            guard let nwPort = NWEndpoint.Port(rawValue: port) else { completion("포트 번호가 올바르지 않다"); return }
            let listener = try NWListener(using: .tcp, on: nwPort)
            if let advertise {
                listener.service = NWListener.Service(name: advertise.name, type: "_commander._tcp", txtRecord: NWTXTRecord(advertise.txt))
            }
            var reported = false
            listener.stateUpdateHandler = { state in
                MainActor.assumeIsolated {
                    switch state {
                    case .ready:
                        if !reported { reported = true; completion(nil) }
                    case let .failed(error):
                        if !reported { reported = true; completion("포트를 열지 못했다: \(error.localizedDescription)") }
                    default: break
                    }
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                MainActor.assumeIsolated {
                    guard let self else { connection.cancel(); return }
                    let client = ClientConnection(connection: connection, server: self)
                    self.clients[ObjectIdentifier(client)] = client
                    client.start()
                }
            }
            listener.start(queue: .main)
            self.listener = listener
        } catch {
            completion("포트를 열지 못했다: \(error.localizedDescription)")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        for client in clients.values { client.close() }
        clients.removeAll()
        sockets.removeAll()
        pending.removeAll()
    }

    // ---- 요청 처리 ----

    func handle(_ request: HTTPRequest, from client: ClientConnection, leftover: Data) {
        // 웹 화면: API가 아닌 GET/HEAD 는 앱에 담긴 파일에서
        if (request.method == "GET" || request.method == "HEAD"), !request.isWebSocketUpgrade,
           !apiPrefixes.contains(where: { request.path.hasPrefix($0) }),
           let file = webFiles?.load(path: request.path) {
            let headers = [HTTPHeader("Content-Type", file.mime), HTTPHeader("Cache-Control", "no-cache")]
            client.send(HTTPResponse.serialize(status: 200, headers: headers, body: file.data, includeBody: request.method == "GET"), thenClose: true)
            return
        }
        Task { @MainActor [self] in
            let result = await engine.fetch(request)
            if let id = result.ws, result.status == 101 {
                guard let handshake = WebSocketHandshake.response(for: request) else {
                    engine.socketClosed(id: id, code: 1002, reason: "핸드셰이크 키 없음")
                    client.send(HTTPResponse.text(400, "Sec-WebSocket-Key 가 없다"), thenClose: true)
                    return
                }
                sockets[id] = client
                client.upgraded(socketId: id, handshake: handshake, leftover: leftover)
                // 핸드셰이크 뒤에, 등록 전에 쌓인 것을 순서대로 보낸다.
                for item in pending.removeValue(forKey: id) ?? [] {
                    switch item {
                    case let .frame(frame): client.send(frame)
                    case let .close(code, reason):
                        sockets.removeValue(forKey: id)
                        client.send(WebSocketEncoder.close(code: code, reason: reason)) { client.close() }
                    }
                }
            } else {
                client.send(HTTPResponse.serialize(status: result.status, headers: result.headers, body: result.body, includeBody: request.method != "HEAD"), thenClose: true)
            }
        }
    }

    func socketText(id: Int, text: String) { engine.socketMessage(id: id, text: text) }
    func socketBinary(id: Int, data: Data) { engine.socketMessage(id: id, binary: data) }

    func connectionEnded(_ client: ClientConnection) {
        clients.removeValue(forKey: ObjectIdentifier(client))
        if let id = client.socketId, sockets.removeValue(forKey: id) != nil {
            engine.socketClosed(id: id, code: 1006, reason: "")
        }
    }
}
