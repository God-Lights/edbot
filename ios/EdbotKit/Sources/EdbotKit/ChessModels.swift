import Foundation

// 체스판 자동 전투의 메시지 형식. 서버(server/src/protocol.ts)의 Chess* 형식과 같다.
// 설계: docs/DESIGN-autochess.md

public let chessBoardSize = 8
/// 무한 모드: 밑면에서 이만큼 박자를 보내면 웜홀이 열린다. (서버 sim.ts의 WORMHOLE_BEATS와 같게)
public let chessWormholeBeats = 4
public let chessDeployRows = 4

/// 기물 하나(내 대기석 또는 판 위). uid로 사고팔고 놓는다.
public struct ChessUnitView: Codable, Equatable, Sendable, Identifiable {
    public let uid: String
    public let defId: String
    public let star: Int
    /// 판 위에 있을 때만. col 0~7(왼쪽부터), row 0~3 (0이 가운데에 가장 가까운 앞줄)
    public let col: Int?
    public let row: Int?
    /// 낀 무기 id
    public let weapon: String?

    public var id: String { uid }
}

public struct ChessSelfSnapshot: Codable, Equatable, Sendable {
    public let hp: Int
    public let gold: Int
    /// 상점 5칸의 캐릭터 id. 산 칸은 nil
    public let shop: [String?]
    public let bench: [ChessUnitView?]
    public let board: [ChessUnitView]
    public let done: Bool
    public let rerollCost: Int
    public let nextIncome: Int
    public let synergies: [String]
    /// 자원: 재료 id -> 개수, 무기 id -> 개수(아직 안 낀 것), 재련 중인 무기 2칸(비면 nil), 이번 라운드 시장에서 샀는가
    public let materials: [String: Int]
    public let weapons: [String: Int]
    public let smelters: [String?]
    public let marketBought: Bool
}

/// 광물 시장의 한 칸
public struct ChessMarketItem: Codable, Equatable, Sendable {
    public let material: String
    public let price: Int
}

/// 이번 라운드의 자원 칸. 좌표는 판의 절대 좌표(seat 0이 아래)다.
public struct ChessTileView: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let material: String
}

public struct ChessOpponentSnapshot: Codable, Equatable, Sendable {
    public let hp: Int
    public let done: Bool
    public let boardCount: Int
}

public struct ChessCombatPlacement: Codable, Equatable, Sendable {
    public let defId: String
    public let star: Int
    public let col: Int
    public let row: Int
}

public struct ChessCombatUnit: Codable, Equatable, Sendable {
    public let defId: String
    public let seat: Int
    public let star: Int
    public let maxHp: Double
    public let summon: Bool
    public let weapon: String?
}

/// 전투 중 일어난 일 하나: [박자, 종류, 행동한 기물 번호, 대상 번호(-1 없음), 능력 id]
public struct ChessEvent: Codable, Equatable, Sendable {
    public let beat: Int
    /// attack | ability | death | promote | move
    public let kind: String
    public let unit: Int
    public let target: Int
    public let text: String

    public init(beat: Int, kind: String, unit: Int, target: Int, text: String) {
        self.beat = beat; self.kind = kind; self.unit = unit; self.target = target; self.text = text
    }

    public init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        beat = try c.decode(Int.self)
        kind = try c.decode(String.self)
        unit = try c.decode(Int.self)
        target = try c.decode(Int.self)
        text = try c.decodeIfPresent(String.self) ?? ""
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(beat); try c.encode(kind); try c.encode(unit); try c.encode(target); try c.encode(text)
    }
}

/// 한 기물의 한 박자 모습. 서버는 [x, y, hp, energy, shield, flags] 배열로 보낸다.
/// flags: 1=생존, 2=승급, 4=밑면(유령), 8 이상=웜홀 게이지 g(flags >> 3). 무한 모드에서만 4 이상이 쓰인다.
public struct ChessFrameUnit: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let hp: Double
    public let energy: Double
    public let shield: Double
    public let alive: Bool
    public let promoted: Bool
    /// 밑면에 있다(유령)
    public let ghost: Bool
    /// 웜홀 게이지: 밑면에서 보낸 박자 수
    public let gauge: Int
    /// 이음매를 넘는 박자에서 사라졌다 나타나는 정도(1이 온전한 모습)
    public let fade: Double

    init?(_ values: [Double]) {
        guard values.count >= 6 else { return nil }
        x = values[0]; y = values[1]; hp = values[2]; energy = values[3]; shield = values[4]
        let flags = Int(values[5])
        alive = flags & 1 != 0
        promoted = flags & 2 != 0
        ghost = flags & 4 != 0
        gauge = flags >> 3
        fade = 1
    }

    init(x: Double, y: Double, hp: Double, energy: Double, shield: Double, alive: Bool, promoted: Bool, ghost: Bool, gauge: Int, fade: Double) {
        self.x = x; self.y = y; self.hp = hp; self.energy = energy; self.shield = shield
        self.alive = alive; self.promoted = promoted; self.ghost = ghost; self.gauge = gauge; self.fade = fade
    }

    func with(fade: Double) -> ChessFrameUnit {
        ChessFrameUnit(x: x, y: y, hp: hp, energy: energy, shield: shield, alive: alive, promoted: promoted, ghost: ghost, gauge: gauge, fade: fade)
    }
}

public struct ChessCombatSnapshot: Codable, Equatable, Sendable {
    public let boards: [[ChessCombatPlacement]]
    public let units: [ChessCombatUnit]
    /// frames[k][i]: k번째 박자가 끝난 때의 기물 i. 아직 없는 소환수는 배열이 짧다.
    public let frames: [[[Double]]]
    public let events: [ChessEvent]
    public let winner: Int?
    public let survivors: [Int]
    public let damage: [Int]
    public let beats: Int
    /// 자원 칸과 채굴 기록 [박자, 칸 번호, seat], 무기로 번 골드
    public let tiles: [ChessTileView]
    public let mines: [[Int]]
    public let goldBonus: [Int]
    /// 무한 모드(뫼비우스 규칙)로 싸운 전투. 오래된 서버거나 일반 규칙이면 nil.
    public var mobius: Bool? = nil

    enum CodingKeys: String, CodingKey { case boards, units, frames, events, winner, survivors, damage, beats, tiles, mines, goldBonus, mobius }

    /// 돌발 사망이 시작되는 박자 (서버 sim.ts와 같게)
    public var suddenDeathBeat: Int { mobius == true ? 28 : 20 }

    /// 박자 beat까지(그 박자 포함) 캐진 칸 번호
    public func minedTiles(upTo beat: Int) -> Set<Int> {
        Set(mines.filter { $0.count >= 2 && $0[0] <= beat }.map { $0[1] })
    }

    /// 박자 k(0...beats) 때의 기물 i. 아직 없으면 nil.
    public func frameUnit(beat: Int, index: Int) -> ChessFrameUnit? {
        guard frames.indices.contains(beat), frames[beat].indices.contains(index) else { return nil }
        return ChessFrameUnit(frames[beat][index])
    }

    /// 박자 위치(소수)에서 기물 i의 모습. 두 박자 사이는 위치만 부드럽게 잇는다.
    public func interpolated(position: Double, index: Int) -> ChessFrameUnit? {
        let last = max(0, frames.count - 1)
        let clamped = min(max(position, 0), Double(last))
        let k = min(Int(clamped.rounded(.down)), last)
        guard let a = frameUnit(beat: k, index: index) else {
            // 막 소환된 기물: 다음 박자에 처음 나타난다.
            return nil
        }
        guard k < last, let b = frameUnit(beat: k + 1, index: index), a.alive, b.alive else { return a }
        let t = clamped - Double(k)
        // 이음매를 넘는 박자: 판을 가로질러 미끄러지지 않고, 그 자리에서 사라졌다가 반대편에서 나타난다.
        if a.ghost != b.ghost && (abs(a.x - b.x) > 1.5 || abs(a.y - b.y) > 1.5) {
            return t < 0.5 ? a.with(fade: 1 - 2 * t) : b.with(fade: 2 * t - 1)
        }
        let to = t < 0.5 ? a : b
        return ChessFrameUnit(
            x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, hp: a.hp + (b.hp - a.hp) * t,
            energy: a.energy + (b.energy - a.energy) * t, shield: a.shield + (b.shield - a.shield) * t,
            alive: true, promoted: b.promoted, ghost: to.ghost, gauge: to.gauge, fade: 1)
    }
}

public struct ChessRoundSummary: Codable, Equatable, Sendable {
    public let round: Int
    public let winner: Int?
    public let damage: [Int]
    public let survivors: [Int]
}

public struct ChessSnapshot: Codable, Equatable, Sendable {
    public let round: Int
    public let maxRounds: Int
    /// 시작 체력(체력 막대의 기준). 오래된 서버면 nil이고 30으로 본다.
    public var startHp: Int? = nil
    public let deployCap: Int
    /// 가격별 등장 확률(%) [1골드, 2골드, 3골드, 4골드]
    public let shopOdds: [Int]
    /// 이번 라운드의 자원 칸과 광물 시장. 자원 시스템이 없는 판(입문 모드)이면 비어 있다.
    public let tiles: [ChessTileView]
    public let market: [ChessMarketItem]
    /// 입문 모드(쉬운 캐릭터만 나온다). 오래된 서버면 nil.
    public let lite: Bool?
    /// seat별 체력(관전자도 볼 수 있는 공개 정보). 오래된 서버면 nil.
    public let hps: [Int]?
    public let me: ChessSelfSnapshot?
    public let opponent: ChessOpponentSnapshot?
    public let combat: ChessCombatSnapshot?
    public let lastRound: ChessRoundSummary?
    public let roundWins: [Int]
}

// MARK: 도감 (GET /api/chess)

public struct ChessUnitInfo: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let nameKo: String
    public let piece: Piece
    public let faction: String
    public let cost: Int
    public let role: String
    public let hp: Int
    public let atk: Int
    public let abilityText: String
    public let passive: Bool
}

public struct ChessSynergyInfo: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let piece: Piece
    public let need: Int
    public let tier: Int
    public let nameKo: String
    public let text: String
}

public struct ChessMaterialInfo: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let nameKo: String
    /// common | uncommon | rare | legendary
    public let rarity: String
    public let weaponId: String
    /// 광물 시장 가격. 전설은 팔지 않아서 nil.
    public let price: Int?
}

public struct ChessWeaponInfo: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let nameKo: String
    public let materialId: String
    public let rarity: String
    public let text: String
}

public struct ChessCatalog: Codable, Equatable, Sendable {
    public let units: [ChessUnitInfo]
    public let synergies: [ChessSynergyInfo]
    public let materials: [ChessMaterialInfo]
    public let weapons: [ChessWeaponInfo]
    /// 재료 조합표. 오래된 서버면 nil.
    public let fusions: [ChessFusion]?
    /// 규칙 묶음 이름(공식이면 "official"). 오래된 서버면 nil.
    public let ruleset: String?
}

// MARK: 게스트 로그인과 관전 목록

/// 게스트 로그인: GL 계정이 없는 사람이 학번과 이름만으로 게스트 방에 들어온다. 전적은 남지 않는다.
public struct GuestLogin: Equatable, Sendable {
    public let studentId: String
    public let name: String

    public init(studentId: String, name: String) {
        self.studentId = studentId
        self.name = name
    }

    /// 학번은 숫자 4~10자리
    public static func isValidStudentId(_ text: String) -> Bool {
        (4...10).contains(text.count) && text.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// 학번과 이름이 올바르면 만든다. 앞뒤 공백은 뗀다.
    public static func make(studentId: String, name: String) -> GuestLogin? {
        let id = studentId.trimmingCharacters(in: .whitespaces)
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isValidStudentId(id), !trimmed.isEmpty else { return nil }
        return GuestLogin(studentId: id, name: String(trimmed.prefix(16)))
    }
}

public struct LiveRoomPlayer: Codable, Equatable, Sendable {
    public let name: String
    public let studentId: String?
    public let connected: Bool
}

/// 진행 중인 게스트 방 한 곳 (관전 목록). GET /api/live
public struct LiveRoom: Codable, Equatable, Sendable, Identifiable {
    public let code: String
    /// 방을 만든 GL 계정의 닉네임
    public let host: String
    public let players: [LiveRoomPlayer]
    /// lobby | prep | combat | result
    public let phase: String
    public let round: Int
    public let maxRounds: Int
    public let hps: [Int]?
    public let updatedAt: Int64
    /// 게스트 방인가 (내 방 목록에서만 의미 있다)
    public let guest: Bool?
    /// 내가 만든 방이다 (지울 수 있다)
    public let mine: Bool?

    public var id: String { code }
}
