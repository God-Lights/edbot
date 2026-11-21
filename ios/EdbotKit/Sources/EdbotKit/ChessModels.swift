import Foundation

// 체스판 자동 전투의 메시지 형식. 서버(server/src/protocol.ts)의 Chess* 형식과 같다.
// 설계: docs/DESIGN-autochess.md

public let chessBoardSize = 8
public let chessDeployRows = 4

/// 기물 하나(내 대기석 또는 판 위). uid로 사고팔고 놓는다.
public struct ChessUnitView: Codable, Equatable, Sendable, Identifiable {
    public let uid: String
    public let defId: String
    public let star: Int
    /// 판 위에 있을 때만. col 0~7(왼쪽부터), row 0~3 (0이 가운데에 가장 가까운 앞줄)
    public let col: Int?
    public let row: Int?

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

/// 한 기물의 한 박자 모습. 서버는 [x, y, hp, energy, shield, flags(1=생존, 2=승급)] 배열로 보낸다.
public struct ChessFrameUnit: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let hp: Double
    public let energy: Double
    public let shield: Double
    public let alive: Bool
    public let promoted: Bool

    init?(_ values: [Double]) {
        guard values.count >= 6 else { return nil }
        x = values[0]; y = values[1]; hp = values[2]; energy = values[3]; shield = values[4]
        alive = Int(values[5]) & 1 != 0
        promoted = Int(values[5]) & 2 != 0
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

    enum CodingKeys: String, CodingKey { case boards, units, frames, events, winner, survivors, damage, beats }

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
        return ChessFrameUnit([
            a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.hp + (b.hp - a.hp) * t,
            a.energy + (b.energy - a.energy) * t, a.shield + (b.shield - a.shield) * t,
            (a.alive ? 1 : 0) + (b.promoted ? 2 : 0),
        ]) ?? a
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
    public let deployCap: Int
    /// 가격별 등장 확률(%) [1골드, 2골드, 3골드, 4골드]
    public let shopOdds: [Int]
    /// 입문 모드(쉬운 캐릭터만 나온다). 오래된 서버면 nil.
    public let lite: Bool?
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

public struct ChessCatalog: Codable, Equatable, Sendable {
    public let units: [ChessUnitInfo]
    public let synergies: [ChessSynergyInfo]
}
