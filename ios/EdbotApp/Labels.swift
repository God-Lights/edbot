import EdbotKit

/// 화면에 보여 줄 한국어 문구.
enum Labels {
    static func phaseName(_ phase: EdbotKit.Phase) -> String {
        switch phase {
        case .lobby: return "로비"
        case .ban: return "밴"
        case .draft: return "드래프트"
        case .placement: return "배치"
        case .explore: return "탐사"
        case .forge: return "대장간"
        case .battle: return "전투"
        case .deathmatch: return "데스매치"
        case .result: return "결과"
        }
    }

    /// 서버 오류 코드를 사람이 읽을 문장으로 바꾼다.
    static func error(_ code: String) -> String? {
        switch code {
        case ErrorCode.roomFull: return "방이 가득 찼어요."
        case ErrorCode.gameInProgress: return "이미 게임이 진행 중인 방이에요."
        case ErrorCode.roomNotFound: return "방을 찾을 수 없어요. 코드를 확인해 보세요."
        case ErrorCode.notInLobby: return "로비에서만 할 수 있어요."
        case ErrorCode.wrongPhase: return "지금 단계에서는 할 수 없어요."
        case ErrorCode.unauthorized: return "로그인이 필요해요."
        default: return nil
        }
    }

    static func disconnect(_ reason: String) -> String? {
        switch reason {
        case "fatal": return nil // 앞서 받은 오류 문구를 그대로 둔다
        case "gave_up": return "서버에 다시 연결하지 못했어요."
        case "invalid_url": return "서버 주소가 올바르지 않아요."
        default: return nil
        }
    }

    static func countdown(_ ms: Int64?) -> String {
        guard let ms else { return "-" }
        return "\((ms + 999) / 1000)초" // 올림해서 0초가 되기 전까지 1초로 보인다
    }
}
