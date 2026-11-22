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
    /// guest가 true면 게스트 방(학번 + 이름으로 들어올 수 있고 전적이 남지 않는 방)을 만든다.
    /// mobius가 true면 무한 모드(앞면·밑면, 이음매, 웜홀이 있는 뫼비우스 규칙) 방을 만든다.
    public func createRoom(guest: Bool = false, mobius: Bool = false) async throws -> String {
        let query: String = [guest ? "guest=1" : nil, mobius ? "mobius=1" : nil].compactMap { $0 }.joined(separator: "&")
        let (data, status) = try await http.send(Http.request(baseURL, query.isEmpty ? "/api/rooms" : "/api/rooms?\(query)", method: "POST", token: authToken))
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

    /// 레이팅 순위 상위 limit명. 로그인했다면 내 줄에 isMe가 붙는다.
    public func leaderboard(limit: Int = 20) async throws -> [LeaderboardEntry] {
        struct Body: Decodable { let entries: [LeaderboardEntry] }
        let (data, status) = try await http.send(Http.request(baseURL, "/api/leaderboard?limit=\(limit)", token: authToken))
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw ApiError.badResponse }
        return body.entries
    }

    /// 내 레이팅과 순위. 아직 한 판도 안 했으면 nil. 로그인이 필요하다.
    public func myStats() async throws -> PlayerStats? {
        struct Body: Decodable { let stats: PlayerStats? }
        let (data, status) = try await http.send(Http.request(baseURL, "/api/me/stats", token: authToken))
        if status == 401 { throw ApiError.unauthorized }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw ApiError.badResponse }
        return body.stats
    }

    /// 내 최근 판. 로그인이 필요하다.
    public func myMatches(limit: Int = 10) async throws -> [MatchSummary] {
        struct Body: Decodable { let matches: [MatchSummary] }
        let (data, status) = try await http.send(Http.request(baseURL, "/api/me/matches?limit=\(limit)", token: authToken))
        if status == 401 { throw ApiError.unauthorized }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw ApiError.badResponse }
        return body.matches
    }

    /// 진행 중인 게스트 경기 목록 (관전할 곳 고르기). GL 로그인이 필요하다.
    public func liveRooms() async throws -> [LiveRoom] {
        struct Body: Decodable { let rooms: [LiveRoom] }
        let (data, status) = try await http.send(Http.request(baseURL, "/api/live", token: authToken))
        if status == 401 { throw ApiError.unauthorized }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw ApiError.badResponse }
        return body.rooms
    }

    /// 내가 만든 방(게스트 방과 일반 방) 목록. GL 로그인이 필요하다.
    public func myRooms() async throws -> [LiveRoom] {
        struct Body: Decodable { let rooms: [LiveRoom] }
        let (data, status) = try await http.send(Http.request(baseURL, "/api/my-rooms", token: authToken))
        if status == 401 { throw ApiError.unauthorized }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let body = try? JSONDecoder().decode(Body.self, from: data) else { throw ApiError.badResponse }
        return body.rooms
    }

    /// 방을 닫는다(만든 사람만). 안에 있는 사람이 모두 나가지고 방의 내용이 지워진다.
    /// 이미 없는 방이면 false, 닫았으면 true. 권한이 없으면 forbidden을 던진다.
    @discardableResult
    public func closeRoom(code: String) async throws -> Bool {
        let escaped = code.trimmingCharacters(in: .whitespaces).uppercased().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? code
        let (_, status) = try await http.send(Http.request(baseURL, "/api/rooms/\(escaped)/close", method: "POST", token: authToken))
        if status == 401 { throw ApiError.unauthorized }
        if status == 403 { throw ApiError.status(403) }
        if status == 404 { return false }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        return true
    }

    /// 체스판 자동 전투의 캐릭터 20명과 기물 시너지를 가져온다.
    public func chessCatalog() async throws -> ChessCatalog {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/chess"))
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let catalog = MessageCodec.parseChessCatalog(data) else { throw ApiError.badResponse }
        return catalog
    }

    /// 캐릭터 시너지 목록을 가져온다.
    public func synergies() async throws -> [SynergyInfo] {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/synergies"))
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let list = MessageCodec.parseSynergies(data) else { throw ApiError.badResponse }
        return list
    }

    /// 무기 목록과 레시피를 가져온다.
    public func weapons() async throws -> [WeaponInfo] {
        let (data, status) = try await http.send(Http.request(baseURL, "/api/weapons"))
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        guard let list = MessageCodec.parseWeapons(data) else { throw ApiError.badResponse }
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
