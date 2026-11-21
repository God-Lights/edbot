import XCTest
@testable import EdbotKit

/// 서버(server/src/chess)가 실제로 만든 스냅샷 형식으로 검증한다.
final class ChessTests: XCTestCase {
    static let prepJSON = #"{"t":"state","room":{"code":"ADMN","phase":"prep","phaseStartedAt":1000,"phaseEndsAt":12000,"serverTime":1500,"players":[],"game":null,"battle":null,"chess":{"round":1,"maxRounds":8,"deployCap":3,"shopOdds":[75,25,0,0],"me":{"hp":30,"gold":98,"shop":[null,"mossling","mossling","relic","for-the-more"],"bench":[null,null,null,null,null,null],"board":[{"uid":"i1","defId":"relic","star":1,"col":3,"row":0}],"done":false,"rerollCost":2,"nextIncome":8,"synergies":[]},"opponent":{"hp":30,"done":false,"boardCount":1},"combat":null,"lastRound":null,"roundWins":[0,0]},"explore":null,"forge":null,"result":null}}"#
    static let combatJSON = #"{"t":"state","room":{"code":"ADMN","phase":"combat","phaseStartedAt":1000,"phaseEndsAt":12000,"serverTime":1500,"players":[],"game":null,"battle":null,"chess":{"round":1,"maxRounds":8,"deployCap":3,"shopOdds":[75,25,0,0],"me":{"hp":30,"gold":98,"shop":[null,"mossling","mossling","relic","for-the-more"],"bench":[null,null,null,null,null,null],"board":[{"uid":"i1","defId":"relic","star":1,"col":3,"row":0}],"done":false,"rerollCost":2,"nextIncome":8,"synergies":[]},"opponent":{"hp":30,"done":false,"boardCount":1},"combat":{"boards":[[{"defId":"relic","star":1,"col":3,"row":0}],[{"defId":"relic","star":1,"col":3,"row":0}]],"units":[{"defId":"relic","seat":0,"star":1,"maxHp":690,"summon":false},{"defId":"relic","seat":1,"star":1,"maxHp":690,"summon":false}],"frames":[[[3,4,690,0,0,1],[4,3,690,0,0,1]],[[3,4,577,0,0,1],[4,3,577,0,0,1]],[[3,4,464,0,0,1],[4,3,464,0,0,1]]],"events":[[1,"attack",1,0,""],[1,"attack",0,1,""],[2,"attack",0,1,""]],"winner":null,"survivors":[0,0],"damage":[0,0],"beats":7},"lastRound":null,"roundWins":[0,0]},"explore":null,"forge":null,"result":null}}"#

    func testParsesPrepSnapshot() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.prepJSON) else { return XCTFail("state가 아니다") }
        XCTAssertEqual(room.phase, .prep)
        let chess = try XCTUnwrap(room.chess)
        XCTAssertEqual(chess.round, 1)
        XCTAssertEqual(chess.deployCap, 3)
        XCTAssertEqual(chess.shopOdds, [75, 25, 0, 0])
        let me = try XCTUnwrap(chess.me)
        XCTAssertEqual(me.gold, 98)
        XCTAssertEqual(me.shop.count, 5)
        XCTAssertNil(me.shop[0])
        XCTAssertEqual(me.shop[1], "mossling")
        XCTAssertEqual(me.bench.count, 6)
        XCTAssertEqual(me.board.first?.col, 3)
        XCTAssertEqual(me.board.first?.uid, "i1")
        XCTAssertEqual(chess.opponent?.boardCount, 1)
        XCTAssertNil(chess.combat)
    }

    func testParsesCombatAndInterpolates() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.combatJSON) else { return XCTFail("state가 아니다") }
        XCTAssertEqual(room.phase, .combat)
        let combat = try XCTUnwrap(room.chess?.combat)
        XCTAssertEqual(combat.beats, 7)
        XCTAssertEqual(combat.units.count, 2)
        XCTAssertEqual(combat.units[1].seat, 1)
        XCTAssertEqual(combat.events.count, 3)
        XCTAssertEqual(combat.events[0], ChessEvent(beat: 1, kind: "attack", unit: 1, target: 0, text: ""))
        XCTAssertNil(combat.winner)
        let start = try XCTUnwrap(combat.frameUnit(beat: 0, index: 0))
        XCTAssertEqual(start.x, 3); XCTAssertEqual(start.y, 4); XCTAssertEqual(start.hp, 690)
        XCTAssertTrue(start.alive)
        // 박자 사이는 체력을 부드럽게 잇는다
        let mid = try XCTUnwrap(combat.interpolated(position: 0.5, index: 0))
        XCTAssertEqual(mid.hp, (690 + 577) / 2, accuracy: 0.001)
        // 범위 밖 위치와 없는 기물
        XCTAssertEqual(combat.interpolated(position: -3, index: 0)?.hp, 690)
        XCTAssertEqual(combat.interpolated(position: 99, index: 0)?.hp, 464)
        XCTAssertNil(combat.interpolated(position: 1, index: 5))
    }

    func testBuildsChessMessages() {
        XCTAssertEqual(MessageCodec.buy(slot: 2), #"{"t":"buy","slot":2}"#)
        XCTAssertEqual(MessageCodec.sell("i3"), #"{"t":"sell","uid":"i3"}"#)
        XCTAssertEqual(MessageCodec.reroll(), #"{"t":"reroll"}"#)
        XCTAssertEqual(MessageCodec.deploy("i3", col: 4, row: 1), #"{"t":"deploy","uid":"i3","col":4,"row":1}"#)
        XCTAssertEqual(MessageCodec.bench("i3"), #"{"t":"bench","uid":"i3"}"#)
        XCTAssertEqual(MessageCodec.done(), #"{"t":"done"}"#)
        XCTAssertEqual(MessageCodec.surrender(), #"{"t":"surrender"}"#)
    }

    func testParsesCatalog() throws {
        let json = #"{"units":[{"id":"relic","nameKo":"렐릭","piece":"pawn","faction":"고대","cost":1,"role":"탱커","hp":690,"atk":140,"abilityText":"쓰러지면 보호막","passive":true}],"synergies":[{"id":"pawn-1","piece":"pawn","need":2,"tier":1,"nameKo":"폰 2명","text":"폰 전체 공격 +20%"}]}"#
        let catalog = try XCTUnwrap(MessageCodec.parseChessCatalog(Data(json.utf8)))
        XCTAssertEqual(catalog.units.first?.cost, 1)
        XCTAssertEqual(catalog.units.first?.piece, .pawn)
        XCTAssertEqual(catalog.synergies.first?.need, 2)
        XCTAssertNil(MessageCodec.parseChessCatalog(Data("{}".utf8)))
    }
}
