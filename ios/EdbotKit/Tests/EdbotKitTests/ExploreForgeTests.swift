import XCTest
@testable import EdbotKit

/// 탐사와 대장간(4단계). 예시는 서버가 실제로 보내는 형식이다.
final class ExploreForgeTests: XCTestCase {
    static let state = """
    {"t":"state","room":{"code":"ABCD","phase":"explore","phaseStartedAt":1,"phaseEndsAt":2,"serverTime":3,"players":[],"game":null,"battle":null,"result":null,
     "explore":{"tick":50,"ticksPerSecond":10,"gauge":2,"gaugeMax":3,"gaugeNextInTicks":70,
       "tiles":[{"index":0,"known":true,"kind":"tree","depleted":false,"respawnInTicks":null,"myGatherInTicks":20,"myAmbushInTicks":null,"enemyAmbush":false},
                {"index":1,"known":false,"kind":null,"depleted":false,"respawnInTicks":null,"myGatherInTicks":null,"myAmbushInTicks":null,"enemyAmbush":false}],
       "resources":{"talent":15,"branch":3,"stone":3,"ore":0,"ironIngot":0,"rare":0,"blueprints":0},
       "events":[{"seq":1,"tick":40,"type":"gathered","tile":0,"gain":{"branch":2},"detail":null},{"seq":2,"tick":45,"type":"scouted","tile":1,"gain":null,"detail":"chest,ambush"}]},
     "forge":{"steam":7.5,"steamMax":10,"smelters":[{"remainingTicks":80},null],"inventory":{"wood-bow":1},"equipped":{"dwargon":"stone-axe"},
       "equipping":{"lappus":{"weaponId":"wood-bow","remainingTicks":20}},"orePrice":3,"ticksPerSecond":10,"events":[{"seq":1,"tick":5,"type":"smelted","detail":null}]}}}
    """

    func testParsesExplore() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.state), let explore = room.explore else { return XCTFail("explore가 없다") }
        XCTAssertEqual(room.phase, .explore)
        XCTAssertEqual(explore.gauge, 2)
        XCTAssertEqual(explore.seconds(explore.gaugeNextInTicks ?? 0), 7)
        XCTAssertEqual(explore.tiles[0].kind, "tree")
        XCTAssertEqual(explore.tiles[0].myGatherInTicks, 20)
        XCTAssertFalse(explore.tiles[1].known)
        XCTAssertNil(explore.tiles[1].kind)
        XCTAssertEqual(explore.resources?.talent, 15)
        XCTAssertEqual(explore.events[0].gain?.branch, 2)
        XCTAssertNil(explore.events[0].gain?.stone)
        XCTAssertNil(explore.events[1].gain)
        XCTAssertEqual(explore.events[1].detail, "chest,ambush")
    }

    func testParsesForge() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.state), let forge = room.forge else { return XCTFail("forge가 없다") }
        XCTAssertEqual(forge.steam, 7.5)
        XCTAssertEqual(forge.smelters.count, 2)
        XCTAssertEqual(forge.smelters[0]?.remainingTicks, 80)
        XCTAssertNil(forge.smelters[1])
        XCTAssertEqual(forge.inventory["wood-bow"], 1)
        XCTAssertEqual(forge.equipped["dwargon"], "stone-axe")
        XCTAssertEqual(forge.seconds(forge.equipping["lappus"]?.remainingTicks ?? 0), 2)
        XCTAssertEqual(forge.orePrice, 3)
    }

    func testParsesWeaponsWithNumericAndStringTiers() throws {
        let json = #"{"weapons":[{"id":"stone-axe","nameKo":"돌도끼","kind":"heavy","tier":1,"atkBonus":0.12,"recipe":{"branch":1,"stone":2}},{"id":"flame-axe","nameKo":"화염 도끼","kind":"heavy","tier":"special","atkBonus":0.08,"recipe":{"blueprints":1,"ironIngot":1,"stone":1},"effectText":"화상"}]}"#
        let weapons = try XCTUnwrap(MessageCodec.parseWeapons(Data(json.utf8)))
        XCTAssertEqual(weapons[0].tier, "1")
        XCTAssertEqual(weapons[1].tier, "special")
        XCTAssertEqual(weapons[1].effectText, "화상")
        XCTAssertNil(weapons[0].effectText)
        XCTAssertNil(MessageCodec.parseWeapons(Data("nope".utf8)))
    }

    func testCanCraft() throws {
        let axe = try XCTUnwrap(MessageCodec.parseWeapons(Data(#"{"weapons":[{"id":"stone-axe","nameKo":"돌도끼","kind":"heavy","tier":1,"atkBonus":0.12,"recipe":{"branch":1,"stone":2}}]}"#.utf8))?.first)
        let enough = ExploreResources(talent: 0, branch: 1, stone: 2, ore: 0, ironIngot: 0, rare: 0, blueprints: 0)
        let short = ExploreResources(talent: 0, branch: 1, stone: 1, ore: 0, ironIngot: 0, rare: 0, blueprints: 0)
        XCTAssertTrue(axe.canCraft(with: enough))
        XCTAssertFalse(axe.canCraft(with: short))
        XCTAssertFalse(axe.canCraft(with: nil))
        XCTAssertEqual(enough.amount(of: "stone"), 2)
        XCTAssertEqual(enough.amount(of: "nope"), 0)
    }

    func testBuildsMessages() {
        XCTAssertEqual(MessageCodec.explore(.gather, tile: 5), #"{"t":"explore","action":"gather","tile":5}"#)
        XCTAssertEqual(MessageCodec.explore(.scout, tile: 0), #"{"t":"explore","action":"scout","tile":0}"#)
        XCTAssertEqual(MessageCodec.forgeBuy(quantity: 2), #"{"t":"forge","action":"buy","quantity":2}"#)
        XCTAssertEqual(MessageCodec.forgeSmelt(), #"{"t":"forge","action":"smelt"}"#)
        XCTAssertEqual(MessageCodec.forgeCraft("wood-bow"), #"{"t":"forge","action":"craft","weaponId":"wood-bow"}"#)
        XCTAssertEqual(MessageCodec.forgeEquip("a", characterId: "b"), #"{"t":"forge","action":"equip","weaponId":"a","characterId":"b"}"#)
    }
}
