import XCTest
@testable import EdbotKit

/// 앱의 시연 화면 데이터(EdbotApp/Resources/Demo)가 지금 모델로 읽히는지. 모델이 바뀌면 capture-demo.ts 로 다시 받는다.
final class DemoFixtureTests: XCTestCase {
    private func demo(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("EdbotApp/Resources/Demo/demo-\(name).json")
        return try Data(contentsOf: url)
    }

    func testDemoFixturesDecode() throws {
        XCTAssertNotNil(MessageCodec.parseChessCatalog(try demo("catalog")))
        for name in ["prep", "combat"] {
            let text = String(decoding: try demo(name), as: UTF8.self)
            guard case let .welcome(_, _, room)? = MessageCodec.parse(text) else { return XCTFail("\(name) 를 읽지 못했다") }
            XCTAssertNotNil(room.chess, name)
        }
    }

    func testEvolutionFieldsDecode() throws {
        let unit = try JSONDecoder().decode(ChessUnitView.self, from: Data(#"{"uid":"i1","defId":"dedokion","star":1,"evo":{"engine":9.4,"core":25}}"#.utf8))
        XCTAssertEqual(unit.evo, ChessEvo(engine: 9.4, core: 25))
        let old = try JSONDecoder().decode(ChessUnitView.self, from: Data(#"{"uid":"i1","defId":"relic","star":1}"#.utf8))
        XCTAssertNil(old.evo)
        let rule = try JSONDecoder().decode(ChessEvolutionRule.self, from: Data(#"{"from":"dedokion","enginePerCombat":9.4,"engineNeed":18.8,"corePerCombat":25,"coreNeed":50,"shardsNeed":2,"shardUnit":80,"branches":[{"code":"e-code-xe","material":"ancient-shard","to":"toka-loga"}]}"#.utf8))
        XCTAssertEqual(rule.branches.first?.to, "toka-loga")
    }
}
