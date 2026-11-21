import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// 서버의 HTTP API (방 만들기, 방 정보). 방을 만들려면 로그인 토큰이 필요하다.
public struct ApiClient: Sendable {
    public let baseURL: URL
    private let http: HTTPTransport
    private let authToken: String?

    public init(baseURL: URL, authToken: String? = nil, http: HTTPTransport = URLSessionTransport()) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.http = http
    }

    private struct CreatedRoom: Decodable { let code: String }

    /// 새 방을 만들고 4자리 방 코드를 돌려준다.
    public func createRoom() async throws -> String {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/rooms", method: "POST", token: authToken))
        if status == 401 { throw ApiError.unauthorized }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let room = try? JSONDecoder().decode(CreatedRoom.self, from: data), !room.code.isEmpty else {
            throw ApiError.badResponse
        }
        return room.code
    }

    /// 캐릭터 12명의 데이터(이름, 기물, 능력치)를 가져온다.
    public func characters() async throws -> [CharacterInfo] {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/characters"))
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let list = MessageCodec.parseCharacters(data) else { throw ApiError.badResponse }
        return list
    }

    /// 방 정보를 조회한다. 방이 없으면 nil.
    public func room(code: String) async throws -> RoomInfo? {
        let normalized = code.trimmingCharacters(in: .whitespaces).uppercased()
        let escaped = normalized.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? normalized
        let (data, status) = try await http.send(Http.request(baseURL, "/api/rooms/" + escaped, token: authToken))
        if status == 404 { return nil }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        return try? JSONDecoder().decode(RoomInfo.self, from: data)
    }
}
