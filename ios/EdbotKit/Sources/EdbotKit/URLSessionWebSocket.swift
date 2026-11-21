#if !os(Linux)
import Foundation

/// URLSessionWebSocketTask를 쓰는 실제 구현. (iPadOS에서 동작)
public final class URLSessionWebSocket: WebSocketTransport, @unchecked Sendable {
    private let session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?

    public init() {}

    public func connect(url: URL, headers: [String: String]) async throws {
        var request = URLRequest(url: url)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        // 연결이 열렸는지는 첫 수신에서 드러난다. 서버는 접속하면 바로 welcome을 보낸다.
    }

    public func send(_ text: String) async throws {
        try await task?.send(.string(text))
    }

    public func receive() async throws -> String? {
        guard let task else { return nil }
        while true {
            let message = try await task.receive()
            switch message {
            case let .string(text): return text
            case .data: continue
            @unknown default: continue
            }
        }
    }

    public func close() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }
}

public struct URLSessionWebSocketFactory: WebSocketFactory {
    public init() {}
    public func make() -> WebSocketTransport { URLSessionWebSocket() }
}
#endif
