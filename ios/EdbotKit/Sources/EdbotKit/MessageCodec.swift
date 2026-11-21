import Foundation

public enum MessageCodec {
    private struct Raw: Decodable {
        let t: String
        let playerId: String?
        let token: String?
        let room: RoomSnapshot?
        let ts: Int64?
        let serverTime: Int64?
        let code: String?
        let message: String?
    }

    /// 서버가 보낸 JSON을 해석한다. 형식이 틀리거나 모르는 메시지면 nil.
    /// 메시지 하나가 이상하다고 연결 전체가 끊기면 안 되어서 예외 대신 nil을 돌려준다.
    public static func parse(_ json: String) -> ServerMessage? {
        guard let data = json.data(using: .utf8),
              let raw = try? JSONDecoder().decode(Raw.self, from: data) else { return nil }
        switch raw.t {
        case "welcome":
            guard let playerId = raw.playerId, let token = raw.token, let room = raw.room else { return nil }
            return .welcome(playerId: playerId, token: token, room: room)
        case "state":
            guard let room = raw.room else { return nil }
            return .state(room)
        case "pong":
            guard let ts = raw.ts, let serverTime = raw.serverTime else { return nil }
            return .pong(ts: ts, serverTime: serverTime)
        case "error":
            guard let code = raw.code else { return nil }
            return .error(code: code, message: raw.message ?? "")
        default:
            return nil
        }
    }

    // ---- 클라이언트 -> 서버 ----

    public static func ready(_ ready: Bool) -> String {
        "{\"t\":\"ready\",\"ready\":\(ready ? "true" : "false")}"
    }

    /// 밴 단계에서 캐릭터 1명을 금지한다. 한 번 하면 바꿀 수 없다.
    public static func ban(_ characterId: String) -> String { characterMessage("ban", characterId) }

    /// 드래프트에서 내 차례에 캐릭터 1명을 뽑는다.
    public static func pick(_ characterId: String) -> String { characterMessage("pick", characterId) }

    /// 배치 단계에서 내 캐릭터 한 명의 레인을 정한다. 확정하기 전에는 다시 바꿀 수 있다.
    public static func place(_ characterId: String, lane: Lane) -> String {
        "{\"t\":\"place\",\"characterId\":\(quoted(characterId)),\"lane\":\"\(lane.rawValue)\"}"
    }

    /// 배치를 확정한다. 정하지 않은 캐릭터는 기본 레인으로 간다.
    public static func lock() -> String { "{\"t\":\"lock\"}" }

    /// 전투 중 궁극기를 쓴다 (스팀포스 5, 40초 재사용). 안키오처럼 레인을 골라야 하는 캐릭터만 lane을 넘긴다.
    public static func ultimate(_ characterId: String, lane: Lane? = nil) -> String {
        var json = "{\"t\":\"ultimate\",\"characterId\":\(quoted(characterId))"
        if let lane { json += ",\"lane\":\"\(lane.rawValue)\"" }
        return json + "}"
    }

    /// 전투 중 나이트가 다른 레인으로 옮겨 간다.
    public static func move(_ characterId: String, lane: Lane) -> String {
        "{\"t\":\"move\",\"characterId\":\(quoted(characterId)),\"lane\":\"\(lane.rawValue)\"}"
    }

    /// 탐사: 칸(0~15, 4x4, 왼쪽 위부터)에 채집·매복·정찰을 한다. 행동 게이지가 1 든다.
    public static func explore(_ action: ExploreAction, tile: Int) -> String {
        "{\"t\":\"explore\",\"action\":\"\(action.rawValue)\",\"tile\":\(tile)}"
    }

    /// 대장간: 광석 구입
    public static func forgeBuy(quantity: Int = 1) -> String {
        "{\"t\":\"forge\",\"action\":\"buy\",\"quantity\":\(quantity)}"
    }

    /// 대장간: 재련 시작
    public static func forgeSmelt() -> String { "{\"t\":\"forge\",\"action\":\"smelt\"}" }

    /// 대장간: 무기 조합
    public static func forgeCraft(_ weaponId: String) -> String {
        "{\"t\":\"forge\",\"action\":\"craft\",\"weaponId\":\(quoted(weaponId))}"
    }

    /// 대장간: 무기 장착(3초). 본진이나 아군 가드 타워 근처에서만 된다.
    public static func forgeEquip(_ weaponId: String, characterId: String) -> String {
        "{\"t\":\"forge\",\"action\":\"equip\",\"weaponId\":\(quoted(weaponId)),\"characterId\":\(quoted(characterId))}"
    }

    /// GET /api/weapons 의 응답을 해석한다. 형식이 틀리면 nil.
    public static func parseWeapons(_ json: Data) -> [WeaponInfo]? {
        struct Body: Decodable { let weapons: [WeaponInfo] }
        return try? JSONDecoder().decode(Body.self, from: json).weapons
    }

    private static func characterMessage(_ type: String, _ characterId: String) -> String {
        "{\"t\":\"\(type)\",\"characterId\":\(quoted(characterId))}"
    }

    /// JSON 문자열 리터럴로 만든다. (따옴표와 역슬래시를 이스케이프)
    static func quoted(_ text: String) -> String {
        guard let data = try? JSONEncoder().encode(text), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
        return json
    }

    /// GET /api/characters 의 응답을 해석한다. 형식이 틀리면 nil.
    public static func parseCharacters(_ json: Data) -> [CharacterInfo]? {
        struct Body: Decodable { let characters: [CharacterInfo] }
        return try? JSONDecoder().decode(Body.self, from: json).characters
    }

    public static func ping(_ timestampMs: Int64) -> String {
        "{\"t\":\"ping\",\"ts\":\(timestampMs)}"
    }
}
