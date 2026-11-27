import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// GL Account로 로그인한 사용자. 이메일은 서버가 내려 주지 않는다.
public struct AuthUser: Codable, Equatable, Sendable {
    /// 사용자 식별자(UUID). 이메일, 아이디, 닉네임은 바뀔 수 있어서 이 값을 쓴다.
    public let id: String
    public let username: String
    public let nickname: String
    public let emailVerified: Bool
}

public struct LoginStart: Codable, Equatable, Sendable {
    public let loginId: String
    /// 브라우저로 열 주소. "로그인하기" 버튼을 눌렀을 때만 연다.
    public let loginUrl: String
    public let expiresInSeconds: Int
}

public enum LoginPoll: Equatable, Sendable {
    case pending
    /// 로그인 요청이 만료되었거나 없다.
    case expired
    /// 승인됨. 게임 세션 토큰은 이 순간에 한 번만 받는다.
    case approved(token: String, user: AuthUser)
}

/// GL Account 로그인(기기 로그인). 브라우저에서 로그인하는 동안 앱이 기다렸다가 토큰을 받는다.
/// 로그인·회원가입 화면은 account.officialgl.com 에서 처리하고 앱에서는 만들지 않는다.
public struct AuthClient: Sendable {
    public let baseURL: URL
    private let http: HTTPTransport

    public init(baseURL: URL, http: HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.http = http
    }

    public func start() async throws -> LoginStart {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/auth/start", method: "POST"))
        guard (200..<300).contains(status) else {
            // 서버가 이유를 알려 주면(GL 연결 서버: 공식 서버에 연결할 수 없음 등) 그 말을 보여 준다
            if let reason = try? JSONDecoder().decode(ServerReason.self, from: data), let message = reason.message, !message.isEmpty {
                throw LoginStartError(message: message, detail: reason.detail)
            }
            throw ApiError.status(status)
        }
        guard let start = try? JSONDecoder().decode(LoginStart.self, from: data), !start.loginId.isEmpty else {
            throw ApiError.badResponse
        }
        return start
    }

    private struct ServerReason: Decodable {
        let message: String?
        let detail: String?
    }

    private struct PollBody: Decodable {
        let token: String?
        let user: AuthUser?
    }

    public func poll(loginId: String) async throws -> LoginPoll {
        let escaped = loginId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? loginId
        let (data, status) = try await http.send(Http.request(baseURL, "/api/auth/poll?id=" + escaped))
        if status == 404 { return .expired }
        if status == 202 { return .pending }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let body = try? JSONDecoder().decode(PollBody.self, from: data),
              let token = body.token, !token.isEmpty, let user = body.user else { throw ApiError.badResponse }
        return .approved(token: token, user: user)
    }

    private struct MeBody: Decodable { let user: AuthUser }

    /// 토큰이 아직 유효한지 확인하고 사용자를 돌려준다. 만료되었으면 nil.
    public func me(token: String) async throws -> AuthUser? {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/auth/me", token: token))
        if status == 401 { return nil }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        return try? JSONDecoder().decode(MeBody.self, from: data).user
    }

    public func logout(token: String) async throws {
        _ = try await http.send(Http.request(baseURL, "/api/auth/logout", method: "POST", token: token))
    }
}

/// 서버가 로그인을 시작하지 못한 이유 (보여 줄 말과, 원인을 찾을 때 쓰는 자세한 내용)
public struct LoginStartError: LocalizedError, Equatable, Sendable {
    public let message: String
    public let detail: String?
    public var errorDescription: String? {
        if let detail, !detail.isEmpty { return "\(message) (\(detail))" }
        return message
    }
}
