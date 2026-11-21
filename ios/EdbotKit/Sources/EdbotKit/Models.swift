import Foundation

// 서버(server/src/protocol.ts)와 주고받는 메시지 형식. 이번 단계는 로비까지 필요한 필드만 두고,
// 뒤 단계(밴·드래프트, 전투, 탐사, 대장간)에서 늘린다. 모르는 필드는 디코더가 무시한다.

/// 한 판이 흐르는 단계. 서버의 Phase와 같은 문자열이다.
public enum Phase: String, Codable, Sendable, Equatable {
    case lobby, ban, draft, placement, explore, forge, battle, deathmatch, result
}

public struct PublicPlayer: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// 0 또는 1. 먼저 들어온 사람이 0.
    public let seat: Int
    public let connected: Bool
    public let ready: Bool
}

/// 세 레인. 킹사이드는 체스에서 킹이 서 있는 쪽이다.
public enum Lane: String, Codable, CaseIterable, Sendable, Equatable {
    case queenside, center, kingside
}

public enum Piece: String, Codable, Sendable, Equatable {
    case king, queen, rook, bishop, knight, pawn
}

/// 캐릭터 한 명의 데이터. 서버의 GET /api/characters 가 돌려준다.
public struct CharacterInfo: Codable, Equatable, Sendable, Identifiable {
    /// 메시지에서 캐릭터를 가리키는 고정 id. 예: "ancient-lord"
    public let id: String
    public let nameKo: String
    public let nameEn: String
    public let piece: Piece
    public let hp: Int
    public let attack: Int
    /// slow | normal | fast | veryFast
    public let speed: String
    /// melee | mid | long
    public let range: String
    /// 패시브, 스킬, 궁극기 설명. 없는 항목은 nil.
    public let passive: String?
    public let skill: String?
    public let ultimate: String?
}

/// 캐릭터 시너지: 뽑은 5명의 구성에 따라 팀 전체가 받는 보너스. 서버의 GET /api/synergies 가 돌려준다.
public struct SynergyInfo: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let nameKo: String
    /// 어떻게 만드는가 (예: "킹 2명")
    public let requirement: String
    /// 무엇을 주는가 (예: "팀 전체가 받는 피해 -5%")
    public let description: String
}

/// 한 사람의 밴 상태.
public struct BanSnapshot: Codable, Equatable, Sendable {
    /// 밴을 정했다. (밴 시간이 끝나면 못 한 사람도 true)
    public let locked: Bool
    /// 밴 단계 중에는 내 것만 보이고 상대 것은 nil, 단계가 끝나면 둘 다 보인다.
    public let characterId: String?
}

/// 밴, 드래프트, 배치의 진행 상황. 모든 배열은 seat 순서([seat 0, seat 1])다.
public struct GameSnapshot: Codable, Equatable, Sendable {
    /// 드래프트에서 먼저 뽑는 seat (선공).
    public let firstPicker: Int
    public let bans: [BanSnapshot]
    /// 뽑는 순서 전체(스네이크, 10개). 앞에서부터 뽑은 수만큼은 이미 지나간 차례다.
    public let pickOrder: [Int]
    public let picks: [[String]]
    /// 드래프트 중 지금 뽑을 차례인 seat. 드래프트가 아니면 nil.
    public let turnSeat: Int?
    /// 이번 차례가 끝나는 서버 시각(ms). 시간이 지나면 서버가 대신 뽑는다.
    public let turnEndsAt: Int64?
    /// seat별 캐릭터 id -> 레인. 상대 것은 전투가 시작되기 전에는 nil.
    public let lanes: [[String: Lane]?]
    public let placementLocked: [Bool]
    /// seat별로 지금까지 뽑은 캐릭터가 채운 시너지 id. 서버가 오래된 버전이면 nil.
    public let synergies: [[String]]?

    public var pickCount: Int { picks.reduce(0) { $0 + $1.count } }

    /// 밴되었거나 이미 뽑힌 캐릭터인가. (내가 아직 볼 수 없는 상대의 밴은 알 수 없어 포함되지 않는다.)
    public func isUnavailable(_ characterId: String) -> Bool {
        bans.contains { $0.characterId == characterId } || picks.contains { $0.contains(characterId) }
    }

    /// 그 레인에 배치되어 있는가. 아직 정해지지 않았거나 볼 수 없으면 nil.
    public func lane(seat: Int, characterId: String) -> Lane? {
        guard lanes.indices.contains(seat), let lanes = lanes[seat] else { return nil }
        return lanes[characterId]
    }
}

// MARK: 탐사와 대장간 (4단계)

/// 탐사 지도의 칸 하나.
public struct ExploreTileSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let index: Int
    /// 정체를 아는가. 안개 칸은 정찰하거나 채집하기 전에는 모른다.
    public let known: Bool
    /// tree | rock | ore | chest | empty. 모르면 nil.
    public let kind: String?
    public let depleted: Bool
    public let respawnInTicks: Int?
    /// 내가 이 칸을 채집하는 중이면 끝날 때까지 남은 틱.
    public let myGatherInTicks: Int?
    /// 내가 이 칸에 매복 중이면 끝날 때까지 남은 틱.
    public let myAmbushInTicks: Int?
    /// 정찰해서 상대의 매복을 알아냈다.
    public let enemyAmbush: Bool

    public var id: Int { index }
}

/// 내가 가진 자원.
public struct ExploreResources: Codable, Equatable, Sendable {
    public let talent: Int
    public let branch: Int
    public let stone: Int
    public let ore: Int
    public let ironIngot: Int
    public let rare: Int
    public let blueprints: Int
}

/// 한 번에 얻거나 잃은 자원. 없는 항목은 nil.
public struct ResourceGain: Codable, Equatable, Sendable {
    public let talent: Int?
    public let branch: Int?
    public let stone: Int?
    public let ore: Int?
    public let ironIngot: Int?
    public let rare: Int?
    public let blueprints: Int?
}

public struct ExploreEventSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let seq: Int
    public let tick: Int
    /// gathered, split, stolen, ambushHit, ambushClash, ambushExpired, scouted, trap, empty
    public let type: String
    public let tile: Int
    public let gain: ResourceGain?
    /// 정찰 결과 등 ("tree", "chest,ambush")
    public let detail: String?

    public var id: Int { seq }
}

/// 탐사 상태. 내 자원과 내 행동만 들어 있다.
public struct ExploreSnapshot: Codable, Equatable, Sendable {
    public let tick: Int
    public let ticksPerSecond: Int
    public let gauge: Int
    public let gaugeMax: Int
    /// 다음 게이지가 찰 때까지 남은 틱. 가득 차 있으면 nil.
    public let gaugeNextInTicks: Int?
    public let tiles: [ExploreTileSnapshot]
    public let resources: ExploreResources?
    public let events: [ExploreEventSnapshot]

    public func seconds(_ ticks: Int) -> Double { Double(ticks) / Double(max(1, ticksPerSecond)) }
}

public enum ExploreAction: String, CaseIterable, Sendable {
    case gather, ambush, scout
}

public struct SmelterSnapshot: Codable, Equatable, Sendable {
    public let remainingTicks: Int
}

public struct EquippingSnapshot: Codable, Equatable, Sendable {
    public let weaponId: String
    public let remainingTicks: Int
}

public struct ForgeEventSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let seq: Int
    public let tick: Int
    /// smelted, equipped, equipFailed
    public let type: String
    public let detail: String?

    public var id: Int { seq }
}

/// 대장간 상태. 내 것만 들어 있다.
public struct ForgeSnapshot: Codable, Equatable, Sendable {
    public let steam: Double
    public let steamMax: Double
    /// 재련대 2개. 비어 있으면 nil.
    public let smelters: [SmelterSnapshot?]
    /// 무기 id -> 개수
    public let inventory: [String: Int]
    /// 캐릭터 id -> 끼고 있는 무기 id
    public let equipped: [String: String]
    public let equipping: [String: EquippingSnapshot]
    public let orePrice: Int
    public let ticksPerSecond: Int
    public let events: [ForgeEventSnapshot]

    public func seconds(_ ticks: Int) -> Double { Double(ticks) / Double(max(1, ticksPerSecond)) }
}

/// 무기 한 개의 데이터. 서버의 GET /api/weapons 가 돌려준다.
public struct WeaponInfo: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let nameKo: String
    /// heavy(중량) | polearm(장병) | ranged(원거리)
    public let kind: String
    /// "1", "2" 또는 "special"
    public let tier: String
    public let atkBonus: Double
    /// 재료 이름(branch, stone, ironIngot, rare, blueprints) -> 개수
    public let recipe: [String: Int]
    public let effectText: String?

    private enum CodingKeys: String, CodingKey { case id, nameKo, kind, tier, atkBonus, recipe, effectText }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        nameKo = try c.decode(String.self, forKey: .nameKo)
        kind = try c.decode(String.self, forKey: .kind)
        // 등급은 숫자(1, 2) 또는 문자열("special")로 온다.
        if let number = try? c.decode(Int.self, forKey: .tier) {
            tier = String(number)
        } else {
            tier = try c.decode(String.self, forKey: .tier)
        }
        atkBonus = try c.decode(Double.self, forKey: .atkBonus)
        recipe = try c.decode([String: Int].self, forKey: .recipe)
        effectText = try c.decodeIfPresent(String.self, forKey: .effectText)
    }

    /// 내 재료로 만들 수 있는가.
    public func canCraft(with resources: ExploreResources?) -> Bool {
        guard let resources else { return false }
        return recipe.allSatisfy { key, need in resources.amount(of: key) >= need }
    }
}

extension ExploreResources {
    /// 재료 이름으로 개수를 읽는다. 모르는 이름은 0.
    public func amount(of key: String) -> Int {
        switch key {
        case "talent": return talent
        case "branch": return branch
        case "stone": return stone
        case "ore": return ore
        case "ironIngot": return ironIngot
        case "rare": return rare
        case "blueprints": return blueprints
        default: return 0
        }
    }
}

// MARK: 전투 (3단계)

/// 전투 중인 캐릭터 한 명(소환수 포함).
public struct UnitSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let characterId: String
    public let seat: Int
    public let lane: Lane
    /// 레인 위의 위치 0~100. seat 0의 본진이 0, seat 1의 본진이 100.
    public let pos: Double
    public let hp: Int
    public let maxHp: Int
    public let alive: Bool
    /// 죽어 있다면 되살아날 때까지 남은 틱.
    public let respawnInTicks: Int?
    public let shield: Int
    public let promoted: Bool
    public let summon: Bool
    public let effects: [String]
    /// 끼고 있는 무기. 내 캐릭터는 항상 보이고, 상대는 맞붙어 있을 때만 보인다.
    public let weapon: String?
    /// 궁극기를 다시 쓸 수 있게 되는 틱. 내 캐릭터에게만 들어 있다.
    public let ultReadyTick: Int?
    /// 나이트의 레인 이동을 다시 쓸 수 있게 되는 틱. 내 캐릭터에게만 들어 있다.
    public let laneMoveReadyTick: Int?
}

public struct TowerSnapshot: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let seat: Int
    public let lane: Lane
    /// "guard" 또는 "main"
    public let kind: String
    public let pos: Double
    public let hp: Int
    public let maxHp: Int
    public let alive: Bool

    public var isMain: Bool { kind == "main" }
}

/// 성채의 벽, 생명의 샘 같은 구역.
public struct BattleZone: Codable, Equatable, Sendable {
    public let lane: Lane
    public let pos: Double
    public let seat: Int
}

public struct BattleEvent: Codable, Equatable, Sendable, Identifiable {
    /// 전투 동안 1씩 늘어나는 번호. 이미 본 이벤트를 거르는 데 쓴다.
    public let seq: Int
    public let tick: Int
    /// kill, towerDestroyed, ultimate, skill, respawn, promote, end
    public let type: String
    public let seat: Int?
    public let unitId: String?
    public let targetId: String?
    public let text: String?

    public var id: Int { seq }
}

/// 전투와 데스매치 중의 상태.
public struct BattleSnapshot: Codable, Equatable, Sendable {
    /// "battle" 또는 "deathmatch"
    public let mode: String
    public let tick: Int
    public let ticksPerSecond: Int
    public let score: [Int]
    public let kills: [Int]
    /// 내 스팀포스. 구경꾼이면 nil. 상대 것은 보이지 않는다.
    public let steam: Double?
    public let towers: [TowerSnapshot]
    public let units: [UnitSnapshot]
    public let walls: [BattleZone]
    public let wells: [BattleZone]
    public let events: [BattleEvent]

    public static let ultimateCost = 5.0

    public var isDeathmatch: Bool { mode == "deathmatch" }

    /// 그 틱까지 남은 시간(초). 이미 지났으면 0.
    public func seconds(until tick: Int) -> Double {
        max(0, Double(tick - self.tick) / Double(max(1, ticksPerSecond)))
    }

    /// 이 캐릭터의 궁극기를 지금 쓸 수 있는가. 살아 있고, 재사용 대기가 끝났고, 스팀포스가 충분해야 한다.
    public func canUseUltimate(_ unit: UnitSnapshot) -> Bool {
        guard unit.alive, let ready = unit.ultReadyTick, let steam else { return false }
        return ready <= tick && steam >= Self.ultimateCost
    }

    public func unit(id: String) -> UnitSnapshot? { units.first { $0.id == id } }
}

/// 한 판으로 바뀐 레이팅.
public struct RatingChange: Codable, Equatable, Sendable {
    public let before: Int
    public let after: Int
    public var delta: Int { after - before }
}

/// 판이 끝난 뒤의 결과.
public struct ResultSnapshot: Codable, Equatable, Sendable {
    /// seat 순서의 레이팅 변화. 로그인하지 않은 판이거나 아직 저장 전이면 nil.
    public let ratings: [RatingChange?]
    /// 이긴 seat. 없으면 nil.
    public let winner: Int?
    /// towers | time | deathmatch | deathmatchTime
    public let reason: String
    public let score: [Int]
    public let kills: [Int]
}

public struct RoomSnapshot: Codable, Equatable, Sendable {
    public let code: String
    public let phase: Phase
    public let phaseStartedAt: Int64
    /// 단계가 끝나는 서버 시각(ms). 로비처럼 타이머가 없으면 nil.
    public let phaseEndsAt: Int64?
    /// 이 스냅샷을 만든 서버 시각(ms). 시계 차이를 보정하는 데 쓴다.
    public let serverTime: Int64
    public let players: [PublicPlayer]
    /// 밴, 드래프트, 배치 상태. 로비에서는 nil.
    public let game: GameSnapshot?
    /// 전투와 데스매치 중에만 있다.
    public let battle: BattleSnapshot?
    /// 탐사 단계부터 판이 끝날 때까지.
    public let explore: ExploreSnapshot?
    /// 대장간. 탐사와 함께 시작해서 판이 끝날 때까지.
    public let forge: ForgeSnapshot?
    /// 결과 단계에서만 있다.
    public let result: ResultSnapshot?

    public func player(id: String?) -> PublicPlayer? {
        guard let id else { return nil }
        return players.first { $0.id == id }
    }
}

public struct RoomInfo: Codable, Equatable, Sendable {
    public let code: String
    public let phase: String
    public let players: Int
    public let joinable: Bool
}

/// 서버가 보내는 메시지.
public enum ServerMessage: Equatable, Sendable {
    case welcome(playerId: String, token: String, room: RoomSnapshot)
    case state(RoomSnapshot)
    case pong(ts: Int64, serverTime: Int64)
    case error(code: String, message: String)
}

/// 서버 오류 코드. 서버의 ErrorCode와 같은 문자열이다.
public enum ErrorCode {
    public static let roomNotFound = "room_not_found"
    public static let roomFull = "room_full"
    public static let gameInProgress = "game_in_progress"
    public static let notInLobby = "not_in_lobby"
    public static let wrongPhase = "wrong_phase"
    public static let unauthorized = "unauthorized"
    public static let unknownCharacter = "unknown_character"
    public static let characterUnavailable = "character_unavailable"
    public static let notYourTurn = "not_your_turn"
    public static let alreadyDone = "already_done"
    public static let notYourCharacter = "not_your_character"
    public static let invalidLane = "invalid_lane"
    public static let unitDead = "unit_dead"
    public static let unitDisabled = "unit_disabled"
    public static let notImplemented = "not_implemented"
    public static let onCooldown = "on_cooldown"
    public static let notEnoughSteam = "not_enough_steam"
    public static let noTarget = "no_target"
    public static let notAKnight = "not_a_knight"
    public static let invalidTile = "invalid_tile"
    public static let noActionGauge = "no_action_gauge"
    public static let tileBusy = "tile_busy"
    public static let nothingToGather = "nothing_to_gather"
    public static let alreadyKnown = "already_known"
    public static let notEnoughTalent = "not_enough_talent"
    public static let notEnoughMaterials = "not_enough_materials"
    public static let noFreeSmelter = "no_free_smelter"
    public static let unknownWeapon = "unknown_weapon"
    public static let noWeapon = "no_weapon"
    public static let notInZone = "not_in_zone"
    public static let alreadyEquipping = "already_equipping"
    public static let alreadyEquipped = "already_equipped"
    public static let invalidQuantity = "invalid_quantity"

    /// 다시 시도해도 소용없는 오류. 이 오류를 받으면 자동 재접속을 멈춘다.
    public static func isFatal(_ code: String) -> Bool {
        [roomNotFound, roomFull, gameInProgress, unauthorized].contains(code)
    }
}
