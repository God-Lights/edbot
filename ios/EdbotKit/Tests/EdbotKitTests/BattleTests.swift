import XCTest
@testable import EdbotKit

/// 서버가 실제로 보내는 전투 상태 형식 그대로의 예시.
final class BattleTests: XCTestCase {
    static let battleState = """
    {"t":"state","room":{"code":"ABCD","phase":"battle","phaseStartedAt":1,"phaseEndsAt":121000,"serverTime":5,"players":[],"game":null,"explore":null,"forge":null,"result":null,
     "battle":{"mode":"battle","tick":120,"ticksPerSecond":10,"score":[7,1],"kills":[2,1],"steam":6.5,
       "towers":[{"id":"t0:center:0","seat":0,"lane":"center","kind":"guard","pos":35,"hp":900,"maxHp":1000,"alive":true},
                 {"id":"t1:kingside:2","seat":1,"lane":"kingside","kind":"main","pos":90,"hp":0,"maxHp":2400,"alive":false}],
       "units":[{"id":"0:dwargon","characterId":"dwargon","seat":0,"lane":"kingside","pos":12.5,"hp":700,"maxHp":1400,"alive":true,"respawnInTicks":null,"shield":0,"promoted":false,"summon":false,"effects":["slow"],"weapon":"wood-bow","ultReadyTick":100,"laneMoveReadyTick":null},
                {"id":"1:lappus","characterId":"lappus","seat":1,"lane":"kingside","pos":80,"hp":0,"maxHp":750,"alive":false,"respawnInTicks":30,"shield":0,"promoted":false,"summon":false,"effects":[],"weapon":null,"ultReadyTick":null,"laneMoveReadyTick":null}],
       "walls":[],"wells":[{"lane":"center","pos":5,"seat":0}],
       "events":[{"seq":3,"tick":100,"type":"kill","seat":0,"unitId":"0:dwargon","targetId":"1:lappus","text":null}]}}}
    """

    func testParsesBattle() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.battleState), let battle = room.battle else { return XCTFail("battle이 없다") }
        XCTAssertEqual(room.phase, .battle)
        XCTAssertEqual(battle.tick, 120)
        XCTAssertEqual(battle.score, [7, 1])
        XCTAssertEqual(battle.steam, 6.5)
        XCTAssertEqual(battle.towers.count, 2)
        XCTAssertFalse(battle.towers[0].isMain)
        XCTAssertTrue(battle.towers[1].isMain)
        XCTAssertEqual(battle.units[0].lane, .kingside)
        XCTAssertEqual(battle.units[0].pos, 12.5)
        XCTAssertEqual(battle.units[0].weapon, "wood-bow")
        XCTAssertEqual(battle.units[1].respawnInTicks, 30)
        XCTAssertEqual(battle.events.first?.seq, 3)
        XCTAssertEqual(battle.wells.count, 1)
        XCTAssertNil(room.result)
        XCTAssertFalse(battle.isDeathmatch)
    }

    func testUltimateReadiness() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.battleState), var battle = room.battle else { return XCTFail() }
        let mine = battle.unit(id: "0:dwargon")!
        XCTAssertTrue(battle.canUseUltimate(mine)) // 틱 100 <= 120, 스팀 6.5 >= 5
        XCTAssertFalse(battle.canUseUltimate(battle.unit(id: "1:lappus")!)) // 상대 유닛
        XCTAssertEqual(battle.seconds(until: 135), 1.5)
        XCTAssertEqual(battle.seconds(until: 100), 0)
        battle = try decode(replacing: #""steam":6.5"#, with: #""steam":4.9"#)
        XCTAssertFalse(battle.canUseUltimate(battle.unit(id: "0:dwargon")!))
        battle = try decode(replacing: #""ultReadyTick":100"#, with: #""ultReadyTick":121"#)
        XCTAssertFalse(battle.canUseUltimate(battle.unit(id: "0:dwargon")!))
        battle = try decode(replacing: #""steam":6.5"#, with: #""steam":null"#)
        XCTAssertFalse(battle.canUseUltimate(battle.unit(id: "0:dwargon")!)) // 구경꾼
    }

    private func decode(replacing old: String, with new: String) throws -> BattleSnapshot {
        let json = Self.battleState.replacingOccurrences(of: old, with: new)
        guard case let .state(room)? = MessageCodec.parse(json), let battle = room.battle else {
            throw NSError(domain: "test", code: 1)
        }
        return battle
    }

    func testParsesResultWithRatings() {
        let json = #"{"t":"state","room":{"code":"ABCD","phase":"result","phaseStartedAt":1,"phaseEndsAt":2,"serverTime":3,"players":[],"result":{"ratings":[{"before":1000,"after":1020},null],"winner":0,"reason":"deathmatchTime","score":[3,3],"kills":[1,2]}}}"#
        guard case let .state(room)? = MessageCodec.parse(json), let result = room.result else { return XCTFail() }
        XCTAssertEqual(result.winner, 0)
        XCTAssertEqual(result.reason, "deathmatchTime")
        XCTAssertEqual(result.ratings[0]?.delta, 20)
        XCTAssertNil(result.ratings[1])
        XCTAssertEqual(result.kills, [1, 2])
    }

    func testBuildsBattleCommands() {
        XCTAssertEqual(MessageCodec.ultimate("dwargon"), #"{"t":"ultimate","characterId":"dwargon"}"#)
        XCTAssertEqual(MessageCodec.ultimate("ankio", lane: .kingside), #"{"t":"ultimate","characterId":"ankio","lane":"kingside"}"#)
        XCTAssertEqual(MessageCodec.move("x", lane: .center), #"{"t":"move","characterId":"x","lane":"center"}"#)
    }
}

final class InterpolatorTests: XCTestCase {
    private func unit(_ id: String, pos: Double, lane: Lane = .center) -> UnitSnapshot {
        let json = #"{"id":"\#(id)","characterId":"x","seat":0,"lane":"\#(lane.rawValue)","pos":\#(pos),"hp":1,"maxHp":1,"alive":true,"respawnInTicks":null,"shield":0,"promoted":false,"summon":false,"effects":[],"weapon":null,"ultReadyTick":null,"laneMoveReadyTick":null}"#
        return try! JSONDecoder().decode(UnitSnapshot.self, from: Data(json.utf8))
    }

    func testMovesSmoothlyBetweenSnapshots() {
        let tween = BattleInterpolator(duration: 0.3)
        tween.update([unit("a", pos: 10)], at: 0)
        XCTAssertEqual(tween.position(of: "a", at: 0), 10)
        tween.update([unit("a", pos: 11)], at: 1.0)
        XCTAssertEqual(tween.position(of: "a", at: 1.0)!, 10, accuracy: 1e-9) // 방금 도착한 순간에는 아직 이전 위치
        XCTAssertEqual(tween.position(of: "a", at: 1.15)!, 10.5, accuracy: 1e-9)
        XCTAssertEqual(tween.position(of: "a", at: 1.3)!, 11, accuracy: 1e-9)
        XCTAssertEqual(tween.position(of: "a", at: 5)!, 11, accuracy: 1e-9) // 더 가지 않는다
    }

    func testNewSnapshotStartsFromWhereItIsDrawn() {
        let tween = BattleInterpolator(duration: 0.3)
        tween.update([unit("a", pos: 10)], at: 0)
        tween.update([unit("a", pos: 12)], at: 1.0)
        tween.update([unit("a", pos: 13)], at: 1.15) // 중간(11)에서 이어 간다
        XCTAssertEqual(tween.position(of: "a", at: 1.15)!, 11, accuracy: 1e-9)
        XCTAssertEqual(tween.position(of: "a", at: 1.45)!, 13, accuracy: 1e-9)
    }

    func testBigJumpsAndLaneChangesSnap() {
        let tween = BattleInterpolator(duration: 0.3, snapDistance: 15)
        tween.update([unit("a", pos: 10), unit("b", pos: 50)], at: 0)
        tween.update([unit("a", pos: 80), unit("b", pos: 51, lane: .kingside)], at: 1.0)
        XCTAssertEqual(tween.position(of: "a", at: 1.0), 80) // 부활이나 순간이동
        XCTAssertEqual(tween.position(of: "b", at: 1.0), 51) // 레인을 옮겼다
    }

    func testUnknownAndRemovedUnits() {
        let tween = BattleInterpolator()
        XCTAssertNil(tween.position(of: "a", at: 0))
        tween.update([unit("a", pos: 1)], at: 0)
        tween.update([], at: 1) // 소환수가 사라졌다
        XCTAssertNil(tween.position(of: "a", at: 1))
        tween.update([unit("a", pos: 1)], at: 2)
        tween.reset()
        XCTAssertNil(tween.position(of: "a", at: 2))
    }
}
