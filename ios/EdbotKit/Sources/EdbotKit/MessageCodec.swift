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

    public static func ping(_ timestampMs: Int64) -> String {
        "{\"t\":\"ping\",\"ts\":\(timestampMs)}"
    }
}
