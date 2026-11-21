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
        case ErrorCode.unknownCharacter: return "없는 캐릭터예요."
        case ErrorCode.characterUnavailable: return "이미 밴되었거나 뽑힌 캐릭터예요."
        case ErrorCode.notYourTurn: return "당신 차례가 아니에요."
        case ErrorCode.alreadyDone: return "이미 정했어요. 바꿀 수 없어요."
        case ErrorCode.notYourCharacter: return "내 팀의 캐릭터가 아니에요."
        case ErrorCode.invalidLane: return "올바르지 않은 레인이에요."
        case ErrorCode.unitDead: return "쓰러진 캐릭터예요."
        case ErrorCode.unitDisabled: return "움직일 수 없는 상태예요."
        case ErrorCode.notImplemented: return "아직 쓸 수 없는 궁극기예요."
        case ErrorCode.onCooldown: return "아직 쓸 수 없어요. (재사용 대기)"
        case ErrorCode.notEnoughSteam: return "스팀포스가 부족해요."
        case ErrorCode.noTarget: return "대상이 없어요."
        case ErrorCode.notAKnight: return "나이트만 레인을 옮길 수 있어요."
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

    static func pieceName(_ piece: Piece) -> String {
        switch piece {
        case .king: return "킹"
        case .queen: return "퀸"
        case .rook: return "룩"
        case .bishop: return "비숍"
        case .knight: return "나이트"
        case .pawn: return "폰"
        }
    }

    /// 체스 기물 글자. 캐릭터 카드의 아이콘으로 쓴다.
    static func pieceGlyph(_ piece: Piece) -> String {
        switch piece {
        case .king: return "♚"
        case .queen: return "♛"
        case .rook: return "♜"
        case .bishop: return "♝"
        case .knight: return "♞"
        case .pawn: return "♟"
        }
    }

    static func laneName(_ lane: Lane) -> String {
        switch lane {
        case .queenside: return "퀸사이드"
        case .center: return "센터"
        case .kingside: return "킹사이드"
        }
    }

    static func speed(_ tier: String) -> String {
        switch tier {
        case "slow": return "느림"
        case "normal": return "보통"
        case "fast": return "빠름"
        case "veryFast": return "매우 빠름"
        default: return tier
        }
    }

    static func range(_ tier: String) -> String {
        switch tier {
        case "melee": return "근접"
        case "mid": return "중거리"
        case "long": return "원거리"
        default: return tier
        }
    }

    static func resultReason(_ reason: String) -> String {
        switch reason {
        case "towers": return "본진 타워 파괴"
        case "time": return "시간 종료 (점수)"
        case "deathmatch": return "데스매치 전멸"
        case "deathmatchTime": return "데스매치 시간 종료 (남은 체력)"
        default: return reason
        }
    }

    static func countdown(_ ms: Int64?) -> String {
        guard let ms else { return "-" }
        return "\((ms + 999) / 1000)초" // 올림해서 0초가 되기 전까지 1초로 보인다
    }
}
