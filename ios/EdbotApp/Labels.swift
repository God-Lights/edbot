import EdbotKit
import Foundation

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
        case .prep: return "준비"
        case .combat: return "전투"
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
        case ErrorCode.invalidTile: return "없는 칸이에요."
        case ErrorCode.noActionGauge: return "행동 게이지가 부족해요."
        case ErrorCode.tileBusy: return "이미 그 칸에서 행동 중이에요."
        case ErrorCode.nothingToGather: return "채집할 게 없는 칸이에요."
        case ErrorCode.alreadyKnown: return "이미 알고 있는 칸이에요."
        case ErrorCode.notEnoughTalent: return "탈런트가 부족해요."
        case ErrorCode.notEnoughMaterials: return "재료가 부족해요."
        case ErrorCode.noFreeSmelter: return "빈 재련대가 없어요. 다음 라운드에 무기가 나와요."
        case ErrorCode.unknownWeapon: return "없는 무기예요."
        case ErrorCode.noWeapon: return "그 무기를 가지고 있지 않아요."
        case ErrorCode.notInZone: return "본진이나 아군 가드 타워 근처에서만 장착할 수 있어요."
        case ErrorCode.alreadyEquipping: return "이미 무기를 끼우는 중이에요."
        case ErrorCode.alreadyEquipped: return "이미 끼고 있는 무기예요."
        case ErrorCode.invalidQuantity: return "살 수 있는 개수가 아니에요."
        case ErrorCode.shopEmpty: return "이미 산 칸이에요."
        case ErrorCode.notEnoughGold: return "골드가 부족해요."
        case ErrorCode.invalidSlot: return "없는 상점 칸이에요."
        case ErrorCode.benchFull: return "대기석이 가득 찼어요. 팔거나 판에 올려 주세요."
        case ErrorCode.unitNotFound: return "그 기물이 없어요."
        case ErrorCode.invalidCell: return "놓을 수 없는 칸이에요."
        case ErrorCode.deployFull: return "판에 올릴 수 있는 기물 수를 넘었어요."
        case ErrorCode.noResources: return "이 판에는 자원 시스템이 없어요."
        case ErrorCode.marketEmpty: return "살 수 없는 재료예요."
        case ErrorCode.marketSold: return "이번 라운드에는 이미 시장에서 샀어요."
        case ErrorCode.noMaterial: return "그 재료가 없어요."
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

    /// 기물 아이콘(Assets의 PieceXxx). 단색이라 foregroundStyle로 색을 입힌다.
    static func pieceImageName(_ piece: Piece) -> String {
        switch piece {
        case .king: return "PieceKing"
        case .queen: return "PieceQueen"
        case .rook: return "PieceRook"
        case .bishop: return "PieceBishop"
        case .knight: return "PieceKnight"
        case .pawn: return "PiecePawn"
        }
    }

    static func rarityName(_ rarity: String) -> String {
        switch rarity {
        case "common": return "흔함"
        case "uncommon": return "보통"
        case "rare": return "희귀"
        case "legendary": return "전설"
        default: return rarity
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
        case "hp": return "상대의 체력을 모두 깎았어요"
        case "rounds": return "8라운드 종료 (남은 체력)"
        case "surrender": return "항복"
        case "forfeit": return "접속이 끊겨 기권패"
        default: return reason
        }
    }

    static func tileName(_ kind: String?) -> String {
        switch kind {
        case "tree": return "나무"
        case "rock": return "바위"
        case "ore": return "광맥"
        case "chest": return "보물상자"
        case "empty": return "빈 땅"
        default: return "안개"
        }
    }

    static func tileGlyph(_ kind: String?) -> String {
        switch kind {
        case "tree": return "🌲"
        case "rock": return "🪨"
        case "ore": return "⛏️"
        case "chest": return "🎁"
        case "empty": return "·"
        default: return "☁️"
        }
    }

    static func actionName(_ action: ExploreAction) -> String {
        switch action {
        case .gather: return "채집"
        case .ambush: return "매복"
        case .scout: return "정찰"
        }
    }

    static func materialName(_ key: String) -> String {
        switch key {
        case "talent": return "탈런트"
        case "branch": return "나뭇가지"
        case "stone": return "돌"
        case "ore": return "광석"
        case "ironIngot": return "철괴"
        case "rare": return "희귀 재료"
        case "blueprints": return "설계도"
        default: return key
        }
    }

    static func weaponKind(_ kind: String) -> String {
        switch kind {
        case "heavy": return "중량"
        case "polearm": return "장병"
        case "ranged": return "원거리"
        default: return kind
        }
    }

    /// 자원 변화를 "나뭇가지 +2" 형태로.
    static func gain(_ gain: ResourceGain?) -> String {
        guard let gain else { return "" }
        let pairs: [(String, Int?)] = [("talent", gain.talent), ("branch", gain.branch), ("stone", gain.stone), ("ore", gain.ore),
                                       ("ironIngot", gain.ironIngot), ("rare", gain.rare), ("blueprints", gain.blueprints)]
        let parts = pairs.compactMap { key, value -> String? in
            guard let value, value != 0 else { return nil }
            return "\(materialName(key)) \(value > 0 ? "+" : "")\(value)"
        }
        return parts.isEmpty ? "" : "(" + parts.joined(separator: ", ") + ")"
    }

    static func exploreEvent(_ event: ExploreEventSnapshot) -> String {
        let tile = "(\(event.tile % 4 + 1),\(event.tile / 4 + 1))"
        switch event.type {
        case "gathered": return "\(tile) 채집 완료 \(gain(event.gain))"
        case "split": return "\(tile) 같은 칸을 채집해서 나눠 가졌어요 \(gain(event.gain))"
        case "stolen": return "\(tile) 상대의 매복에 빼앗겼어요!"
        case "ambushHit": return "\(tile) 매복 성공! \(gain(event.gain))"
        case "ambushClash": return "\(tile) 서로 매복해서 둘 다 사라졌어요"
        case "ambushExpired": return "\(tile) 매복이 아무도 못 잡고 끝났어요"
        case "scouted":
            let detail = event.detail ?? ""
            return "\(tile) 정찰: \(tileName(detail.split(separator: ",").first.map(String.init)))" + (detail.contains("ambush") ? " — 상대 매복 있음!" : "")
        case "trap": return "\(tile) 함정! \(gain(event.gain))"
        case "empty": return "\(tile) 빈 땅이었어요"
        default: return event.type
        }
    }

    static func matchResult(_ result: String) -> String {
        switch result {
        case "win": return "승"
        case "loss": return "패"
        case "draw": return "무"
        default: return result
        }
    }

    /// 레이팅 변화를 "+20" 형태로.
    static func delta(_ value: Int) -> String { value > 0 ? "+\(value)" : "\(value)" }

    /// 서버 시각(ms)을 "11월 21일 14:35" 형태로.
    static func matchDate(_ ms: Int64) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    static func countdown(_ ms: Int64?) -> String {
        guard let ms else { return "-" }
        return "\((ms + 999) / 1000)초" // 올림해서 0초가 되기 전까지 1초로 보인다
    }
}
