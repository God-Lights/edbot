import XCTest
@testable import EdbotKit

/// 서버(server/src/chess)가 실제로 만든 스냅샷 형식으로 검증한다.
final class ChessTests: XCTestCase {
    static let prepJSON = #"{"t":"state","room":{"code":"ADMF","phase":"prep","phaseStartedAt":1000,"phaseEndsAt":12000,"serverTime":1500,"players":[],"game":null,"battle":null,"chess":{"round":1,"maxRounds":8,"deployCap":3,"shopOdds":[75,25,0,0],"lite":false,"me":{"hp":30,"gold":98,"shop":[null,"mossling","mossling","relic","for-the-more"],"bench":[null,null,null,null,null,null],"board":[{"uid":"i1","defId":"relic","star":1,"weapon":"bit-dagger","col":3,"row":0}],"done":false,"rerollCost":2,"nextIncome":8,"synergies":[],"materials":{"bit":2},"weapons":{"clawstone-axe":1},"smelters":["titanium-shield",null],"marketBought":false},"tiles":[{"x":4,"y":4,"material":"edmium"},{"x":3,"y":3,"material":"edmium"},{"x":0,"y":4,"material":"edcoin"},{"x":7,"y":3,"material":"edcoin"}],"market":[{"material":"edcoin","price":3}],"opponent":{"hp":30,"done":false,"boardCount":1},"combat":null,"lastRound":null,"roundWins":[0,0]},"explore":null,"forge":null,"result":null}}"#
    static let combatJSON = #"{"t":"state","room":{"code":"ADMF","phase":"combat","phaseStartedAt":1000,"phaseEndsAt":12000,"serverTime":1500,"players":[],"game":null,"battle":null,"chess":{"round":1,"maxRounds":8,"deployCap":3,"shopOdds":[75,25,0,0],"lite":false,"me":{"hp":30,"gold":98,"shop":[null,"mossling","mossling","relic","for-the-more"],"bench":[null,null,null,null,null,null],"board":[{"uid":"i1","defId":"relic","star":1,"weapon":"bit-dagger","col":3,"row":0}],"done":false,"rerollCost":2,"nextIncome":8,"synergies":[],"materials":{"bit":2},"weapons":{"clawstone-axe":1},"smelters":["titanium-shield",null],"marketBought":false},"tiles":[{"x":4,"y":4,"material":"edmium"},{"x":3,"y":3,"material":"edmium"},{"x":0,"y":4,"material":"edcoin"},{"x":7,"y":3,"material":"edcoin"}],"market":[{"material":"edcoin","price":3}],"opponent":{"hp":30,"done":false,"boardCount":1},"combat":{"boards":[[{"defId":"relic","star":1,"col":3,"row":0,"weapon":"bit-dagger"}],[{"defId":"relic","star":1,"col":3,"row":0}]],"units":[{"defId":"relic","seat":0,"star":1,"maxHp":690,"summon":false,"weapon":"bit-dagger"},{"defId":"relic","seat":1,"star":1,"maxHp":690,"summon":false,"weapon":null}],"frames":[[[3,4,690,0,0,1],[4,3,690,0,0,1]],[[3,4,577,0,0,1],[4,3,577,0,0,1]],[[3,4,464,0,0,1],[4,3,464,0,0,1]]],"events":[[1,"attack",1,0,""],[1,"attack",0,1,""],[2,"attack",0,1,""]],"winner":null,"survivors":[0,0],"damage":[0,0],"beats":7,"tiles":[{"x":4,"y":4,"material":"edmium"},{"x":3,"y":3,"material":"edmium"},{"x":0,"y":4,"material":"edcoin"},{"x":7,"y":3,"material":"edcoin"}],"mines":[],"goldBonus":[0,0]},"lastRound":null,"roundWins":[0,0]},"explore":null,"forge":null,"result":null}}"#

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

    func testParsesResources() throws {
        guard case let .state(room)? = MessageCodec.parse(Self.prepJSON) else { return XCTFail("state가 아니다") }
        let chess = try XCTUnwrap(room.chess)
        let me = try XCTUnwrap(chess.me)
        XCTAssertEqual(me.materials["bit"], 2)
        XCTAssertEqual(me.weapons["clawstone-axe"], 1)
        XCTAssertEqual(me.smelters.count, 2)
        XCTAssertEqual(me.smelters[0], "titanium-shield")
        XCTAssertNil(me.smelters[1])
        XCTAssertFalse(me.marketBought)
        XCTAssertEqual(me.board.first?.weapon, "bit-dagger")
        XCTAssertEqual(chess.tiles.count, 4)
        XCTAssertEqual(chess.market.first?.price, 3)
        XCTAssertEqual(chess.lite, false)
        guard case let .state(combatRoom)? = MessageCodec.parse(Self.combatJSON) else { return XCTFail("state가 아니다") }
        let combat = try XCTUnwrap(combatRoom.chess?.combat)
        XCTAssertEqual(combat.units.first?.weapon, "bit-dagger")
        XCTAssertNil(combat.units.last?.weapon)
        XCTAssertEqual(combat.tiles.count, 4)
        XCTAssertEqual(combat.goldBonus.count, 2)
    }

    func testMinedTiles() {
        let combat = ChessCombatSnapshot(boards: [], units: [], frames: [], events: [], winner: nil, survivors: [0, 0], damage: [0, 0], beats: 5, tiles: [], mines: [[0, 1, 0], [3, 2, 1], [3, 2, 0]], goldBonus: [0, 0])
        XCTAssertEqual(combat.minedTiles(upTo: 0), [1])
        XCTAssertEqual(combat.minedTiles(upTo: 3), [1, 2])
    }

    func testBuildsResourceMessages() {
        XCTAssertEqual(MessageCodec.market(slot: 1), #"{"t":"market","slot":1}"#)
        XCTAssertEqual(MessageCodec.smelt("bit"), #"{"t":"smelt","material":"bit"}"#)
        XCTAssertEqual(MessageCodec.equip("bit-dagger", uid: "i3"), #"{"t":"equip","weaponId":"bit-dagger","uid":"i3"}"#)
        XCTAssertEqual(MessageCodec.unequip("i3"), #"{"t":"unequip","uid":"i3"}"#)
        XCTAssertEqual(MessageCodec.gene("i3", to: "lepid"), #"{"t":"gene","uid":"i3","to":"lepid"}"#)
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
        let json = #"{"materials":[{"id":"bit","nameKo":"비트","rarity":"common","weaponId":"bit-dagger","price":3},{"id":"bitcoin","nameKo":"비트코인","rarity":"legendary","weaponId":"bitcoin-greatsword","price":null}],"weapons":[{"id":"bit-dagger","nameKo":"비트 대거","materialId":"bit","rarity":"common","text":"에너지 충전 +35%%"}],"units":[{"id":"relic","nameKo":"렐릭","piece":"pawn","faction":"고대","cost":1,"role":"탱커","hp":690,"atk":140,"abilityText":"쓰러지면 보호막","passive":true}],"synergies":[{"id":"pawn-1","piece":"pawn","need":2,"tier":1,"nameKo":"폰 2명","text":"폰 전체 공격 +20%"}]}"#
        let catalog = try XCTUnwrap(MessageCodec.parseChessCatalog(Data(json.utf8)))
        XCTAssertEqual(catalog.units.first?.cost, 1)
        XCTAssertEqual(catalog.units.first?.piece, .pawn)
        XCTAssertEqual(catalog.synergies.first?.need, 2)
        XCTAssertEqual(catalog.materials.count, 2)
        XCTAssertEqual(catalog.materials.first?.price, 3)
        XCTAssertNil(catalog.materials.last?.price)
        XCTAssertEqual(catalog.weapons.first?.materialId, "bit")
        XCTAssertNil(MessageCodec.parseChessCatalog(Data("{}".utf8)))
    }

    func testGuestLogin() {
        XCTAssertTrue(GuestLogin.isValidStudentId("20211"))
        XCTAssertTrue(GuestLogin.isValidStudentId("1234567890"))
        for bad in ["", "123", "12345678901", "20211a", "2021 1", "２０２１１"] { XCTAssertFalse(GuestLogin.isValidStudentId(bad), bad) }
        XCTAssertEqual(GuestLogin.make(studentId: " 20211 ", name: " 홍길동 "), GuestLogin(studentId: "20211", name: "홍길동"))
        XCTAssertNil(GuestLogin.make(studentId: "20211", name: "  "))
        XCTAssertNil(GuestLogin.make(studentId: "12", name: "홍길동"))
        XCTAssertEqual(GuestLogin.make(studentId: "20211", name: String(repeating: "가", count: 30))?.name.count, 16)
    }

    func testParsesLiveRooms() throws {
        let json = #"{"rooms":[{"code":"9ZCH","host":"발표자","players":[{"name":"홍길동","studentId":"20211","connected":true},{"name":"김철수","studentId":"20212","connected":false}],"phase":"combat","round":3,"maxRounds":8,"hps":[30,22],"updatedAt":1700000000000},{"code":"AAAA","host":"","players":[],"phase":"lobby","round":0,"maxRounds":8,"hps":null,"updatedAt":5}]}"#
        struct Body: Decodable { let rooms: [LiveRoom] }
        let rooms = try JSONDecoder().decode(Body.self, from: Data(json.utf8)).rooms
        XCTAssertEqual(rooms.count, 2)
        XCTAssertEqual(rooms[0].id, "9ZCH")
        XCTAssertEqual(rooms[0].players[0].studentId, "20211")
        XCTAssertFalse(rooms[0].players[1].connected)
        XCTAssertEqual(rooms[0].hps, [30, 22])
        XCTAssertNil(rooms[1].hps)
        XCTAssertTrue(rooms[1].players.isEmpty)
    }

    // MARK: 조합

    private static let weaponsJSON = #"[{"id":"clawstone-axe","nameKo":"클로우스톤 도끼","materialId":"clawstone","rarity":"common","text":"공격 +15%"},{"id":"edmium-blade","nameKo":"에드뮴 블레이드","materialId":"edmium","rarity":"common","text":"공격 속도 +25%"},{"id":"dark-scythe","nameKo":"어둠의 낫","materialId":"dark-essence","rarity":"rare","text":"흡혈 35%"}]"#
    private var weapons: [ChessWeaponInfo] { try! JSONDecoder().decode([ChessWeaponInfo].self, from: Data(Self.weaponsJSON.utf8)) }
    private let fusions: [ChessFusion] = [ChessFusion(a: "bit", b: "clawstone", result: "titanium"), ChessFusion(a: "clawstone", b: "edmium", result: "redocean")]

    func testParsesWeaponIds() {
        let w = weapons
        XCTAssertEqual(ChessCrafting.parseWeapon("clawstone-axe", weapons: w)?.kind, .single)
        XCTAssertEqual(ChessCrafting.parseWeapon("clawstone-axe*", weapons: w)?.power, 1.5)
        XCTAssertEqual(ChessCrafting.parseWeapon("clawstone-axe+edmium-blade", weapons: w)?.parts, ["clawstone-axe", "edmium-blade"])
        for bad in ["nope", "nope*", "clawstone-axe**", "clawstone-axe+clawstone-axe", "edmium-blade+clawstone-axe", "a+b+c", "+", "clawstone-axe+", ""] {
            XCTAssertNil(ChessCrafting.parseWeapon(bad, weapons: w), bad)
        }
    }

    func testWeaponInfoNamesCombinedWeapons() throws {
        let w = weapons
        XCTAssertEqual(ChessCrafting.weaponInfo("clawstone-axe*", weapons: w)?.nameKo, "클로우스톤 도끼 ★2")
        let hybrid = try XCTUnwrap(ChessCrafting.weaponInfo("dark-scythe+edmium-blade", weapons: w) ?? ChessCrafting.weaponInfo("clawstone-axe+dark-scythe", weapons: w))
        XCTAssertEqual(hybrid.rarity, "rare") // 융합 무기는 더 높은 희귀도를 따른다
        XCTAssertTrue(hybrid.text.contains("75%"))
    }

    func testCombineRules() {
        let w = weapons
        let c: (ChessItem, ChessItem) -> ChessItem? = { ChessCrafting.combine($0, $1, weapons: w, fusions: self.fusions) }
        // 재료: 조합표에 있는 쌍만, 순서 무관
        XCTAssertEqual(c(ChessItem(.material, "clawstone"), ChessItem(.material, "bit")), ChessItem(.material, "titanium"))
        XCTAssertEqual(c(ChessItem(.material, "bit"), ChessItem(.material, "clawstone")), ChessItem(.material, "titanium"))
        XCTAssertNil(c(ChessItem(.material, "bit"), ChessItem(.material, "bit")))
        XCTAssertNil(c(ChessItem(.material, "bit"), ChessItem(.material, "edmium")))
        // 무기: 같으면 ★2, 다르면 융합(사전순), ★2·융합은 더 못 합친다
        XCTAssertEqual(c(ChessItem(.weapon, "clawstone-axe"), ChessItem(.weapon, "clawstone-axe")), ChessItem(.weapon, "clawstone-axe*"))
        XCTAssertEqual(c(ChessItem(.weapon, "edmium-blade"), ChessItem(.weapon, "clawstone-axe")), ChessItem(.weapon, "clawstone-axe+edmium-blade"))
        XCTAssertNil(c(ChessItem(.weapon, "clawstone-axe*"), ChessItem(.weapon, "edmium-blade")))
        XCTAssertNil(c(ChessItem(.weapon, "clawstone-axe+edmium-blade"), ChessItem(.weapon, "dark-scythe")))
        // 무기 + 원재료 = ★2
        XCTAssertEqual(c(ChessItem(.weapon, "clawstone-axe"), ChessItem(.material, "clawstone")), ChessItem(.weapon, "clawstone-axe*"))
        XCTAssertEqual(c(ChessItem(.material, "clawstone"), ChessItem(.weapon, "clawstone-axe")), ChessItem(.weapon, "clawstone-axe*"))
        XCTAssertNil(c(ChessItem(.weapon, "clawstone-axe"), ChessItem(.material, "edmium")))
    }

    func testCombineMessageAndCatalogFusions() throws {
        XCTAssertEqual(
            MessageCodec.combine(ChessItem(.material, "bit"), ChessItem(.weapon, "clawstone-axe")),
            #"{"t":"combine","a":{"kind":"material","id":"bit"},"b":{"kind":"weapon","id":"clawstone-axe"}}"#
        )
        XCTAssertTrue(ErrorCode.invalidRecipe == "invalid_recipe")
        let json = #"{"units":[],"synergies":[],"materials":[],"weapons":[],"fusions":[{"a":"bit","b":"clawstone","result":"titanium"}]}"#
        let catalog = try XCTUnwrap(MessageCodec.parseChessCatalog(Data(json.utf8)))
        XCTAssertEqual(catalog.fusions?.first?.result, "titanium")
    }

    func testMobiusFrameFlagsAndSeamCrossing() throws {
        // flags: 1 생존, 4 밑면(유령), 게이지 3 -> 1 | 4 | (3 << 3) = 29
        let combat = ChessCombatSnapshot(
            boards: [], units: [],
            frames: [[[7, 3, 100, 0, 0, 1]], [[0, 4, 100, 0, 0, 29]]],
            events: [], winner: nil, survivors: [0, 0], damage: [0, 0], beats: 1, tiles: [], mines: [], goldBonus: [0, 0], mobius: true
        )
        let before = try XCTUnwrap(combat.frameUnit(beat: 0, index: 0))
        XCTAssertFalse(before.ghost)
        XCTAssertEqual(before.gauge, 0)
        let after = try XCTUnwrap(combat.frameUnit(beat: 1, index: 0))
        XCTAssertTrue(after.ghost)
        XCTAssertEqual(after.gauge, 3)
        // 이음매를 넘는 박자: 판을 가로질러 미끄러지지 않고, 그 자리에서 사라졌다가 반대편에서 나타난다.
        let early = try XCTUnwrap(combat.interpolated(position: 0.25, index: 0))
        XCTAssertEqual(early.x, 7)
        XCTAssertEqual(early.fade, 0.5, accuracy: 0.001)
        XCTAssertFalse(early.ghost)
        let late = try XCTUnwrap(combat.interpolated(position: 0.75, index: 0))
        XCTAssertEqual(late.x, 0)
        XCTAssertEqual(late.fade, 0.5, accuracy: 0.001)
        XCTAssertTrue(late.ghost)
        XCTAssertEqual(combat.suddenDeathBeat, 28)
    }

    func testNormalCombatHasNoGhosts() throws {
        let combat = ChessCombatSnapshot(
            boards: [], units: [], frames: [[[3, 3, 100, 0, 0, 1]], [[4, 3, 90, 0, 0, 1]]],
            events: [], winner: nil, survivors: [0, 0], damage: [0, 0], beats: 1, tiles: [], mines: [], goldBonus: [0, 0]
        )
        let mid = try XCTUnwrap(combat.interpolated(position: 0.5, index: 0))
        XCTAssertFalse(mid.ghost)
        XCTAssertEqual(mid.fade, 1)
        XCTAssertEqual(mid.x, 3.5, accuracy: 0.001)
        XCTAssertEqual(combat.suddenDeathBeat, 20)
    }
}
