import Foundation

/// GET /api/packs 의 팩 한 개: 이름·종류·설명, 팩이 쓴 설명서, 바꾼 것 요약, 리소스(웹·안드로이드가 적용. iPad 는 아직 목록·설명서만)
public struct PackDetail: Codable, Equatable, Sendable, Identifiable {
    public struct GuideSection: Codable, Equatable, Sendable {
        public let title: String
        public let body: String
    }

    public struct Summary: Codable, Equatable, Sendable {
        public var units: [String] = []
        public var overrides: [String] = []
        public var materials: [String] = []
        public var weapons: [String] = []
        public var rules: [String] = []

        enum CodingKeys: String, CodingKey { case units, overrides, materials, weapons, rules }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            units = try c.decodeIfPresent([String].self, forKey: .units) ?? []
            overrides = try c.decodeIfPresent([String].self, forKey: .overrides) ?? []
            materials = try c.decodeIfPresent([String].self, forKey: .materials) ?? []
            weapons = try c.decodeIfPresent([String].self, forKey: .weapons) ?? []
            rules = try c.decodeIfPresent([String].self, forKey: .rules) ?? []
        }
    }

    public struct Resources: Codable, Equatable, Sendable {
        public var colors: [String: String]? = nil
        public var logo: String? = nil
        public var lobbyBackground: String? = nil
        public var boardBackground: String? = nil
        public var units: [String: String]? = nil
        public var sounds: [String: String]? = nil
        public var music: [String: String]? = nil
    }

    public let id: String
    public let name: String
    public let version: String
    /// plugin | resource | bundle (오래된 서버면 plugin)
    public var kind: String = "plugin"
    public var description: String? = nil
    public var author: String? = nil
    public var guide: [GuideSection]? = nil
    public var summary: Summary? = nil
    public var resources: Resources? = nil

    enum CodingKeys: String, CodingKey { case id, name, version, kind, description, author, guide, summary, resources }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        version = try c.decode(String.self, forKey: .version)
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "plugin"
        description = try c.decodeIfPresent(String.self, forKey: .description)
        author = try c.decodeIfPresent(String.self, forKey: .author)
        guide = try c.decodeIfPresent([GuideSection].self, forKey: .guide)
        summary = try c.decodeIfPresent(Summary.self, forKey: .summary)
        resources = try c.decodeIfPresent(Resources.self, forKey: .resources)
    }

    /// 종류 이름: 종합 / 리소스 / 플러그인
    public var kindName: String {
        switch kind {
        case "bundle": return "종합"
        case "resource": return "리소스"
        default: return "플러그인"
        }
    }

    /// 화면·소리로 바꾸는 것을 짧게 (예: "색 5가지, 로고, 캐릭터 그림 5명")
    public var resourceLine: String? {
        guard let r = resources else { return nil }
        var parts: [String] = []
        if let n = r.colors?.count, n > 0 { parts.append("색 \(n)가지") }
        if r.logo != nil { parts.append("로고") }
        if r.lobbyBackground != nil { parts.append("로비 배경") }
        if r.boardBackground != nil { parts.append("판 배경") }
        if let n = r.units?.count, n > 0 { parts.append("캐릭터 그림 \(n)명") }
        if let n = r.sounds?.count, n > 0 { parts.append("효과음 \(n)개") }
        if let n = r.music?.count, n > 0 { parts.append("음악 \(n)곡") }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// 규칙 값 이름 (가이드의 요약용)
    public static func ruleName(_ key: String) -> String {
        [
            "startHp": "시작 체력", "startGold": "시작 골드", "baseIncome": "라운드 수입", "maxInterest": "최대 이자", "maxRounds": "최대 라운드",
            "maxDeploy": "최대 배치 수", "rerollCost": "새로고침 비용", "prepSeconds": "준비 시간", "firstPrepSeconds": "첫 준비 시간", "poolCopies": "상점 풀 수",
        ][key] ?? key
    }
}

extension ApiClient {
    /// 이 서버의 팩 (엑스퍼트). 팩이 없거나 오래된 서버면 빈 목록.
    public func packs() async throws -> [PackDetail] {
        struct Reply: Decodable { let packs: [PackDetail] }
        let (data, status) = try await http.send(Http.request(baseURL, "/api/packs"))
        if status == 404 { return [] }
        guard (200..<300).contains(status) else { throw ApiError.status(status) }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.packs ?? []
    }
}
