import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// HTTP 요청 하나를 보내는 얇은 인터페이스. 테스트에서 가짜로 바꿔 끼운다.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (data: Data, status: Int)
}

public struct URLSessionTransport: HTTPTransport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> (data: Data, status: Int) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let http = response as? HTTPURLResponse {
                    continuation.resume(returning: (data ?? Data(), http.statusCode))
                } else {
                    continuation.resume(throwing: ApiError.badResponse)
                }
            }
            task.resume()
        }
    }
}

public enum ApiError: Error, Equatable {
    /// 로그인이 필요하거나 만료되었다.
    case unauthorized
    case badResponse
    case status(Int)
    case invalidURL
}

enum Http {
    static func request(_ base: URL, _ path: String, method: String = "GET", token: String? = nil) -> URLRequest {
        var request = URLRequest(url: URL(string: base.absoluteString + path) ?? base)
        request.httpMethod = method
        request.timeoutInterval = 10
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if method == "POST" { request.httpBody = Data() }
        return request
    }
}

/// "127.0.0.1:8787" 처럼 적어도 되도록 주소를 다듬는다. 끝의 '/'는 뺀다.
public func normalizeServerURL(_ text: String) -> URL? {
    var url = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !url.isEmpty else { return nil }
    if !url.contains("://") { url = "https://" + url }
    while url.hasSuffix("/") { url.removeLast() }
    return URL(string: url)
}

/// http(s) 주소를 ws(s) 주소로 바꾼다.
public func webSocketBase(_ server: URL) -> URL {
    let text = server.absoluteString
    if text.hasPrefix("https://") { return URL(string: "wss://" + text.dropFirst(8))! }
    if text.hasPrefix("http://") { return URL(string: "ws://" + text.dropFirst(7))! }
    return server
}
