import XCTest
@testable import EdbotKit

/// 8전 5승제 스냅샷과 봇과 한 판(레이팅 없는 기록)을 읽는다
final class WinsFormatTests: XCTestCase {
    func testDecodesWinsDeathmatchAndRoundResults() throws {
        let json = #"{"round":9,"maxRounds":8,"startHp":5,"winTarget":5,"deathmatch":1,"deathmatchGold":10,"roundResults":[{"round":1,"winner":0},{"round":2,"winner":null},{"round":9,"winner":1,"deathmatch":1}],"deployCap":7,"shopOdds":[20,30,35,15],"tiles":[],"market":[],"lite":false,"hps":[1,1],"me":null,"opponent":null,"combat":null,"lastRound":null,"roundWins":[4,4]}"#
        let chess = try JSONDecoder().decode(ChessSnapshot.self, from: Data(json.utf8))
        XCTAssertEqual(chess.winTarget, 5)
        XCTAssertEqual(chess.deathmatch, 1)
        XCTAssertEqual(chess.deathmatchGold, 10)
        XCTAssertEqual(chess.roundResults, [ChessRoundResult(round: 1, winner: 0), ChessRoundResult(round: 2, winner: nil), ChessRoundResult(round: 9, winner: 1, deathmatch: 1)])
        XCTAssertEqual(chess.roundWins, [4, 4])
    }

    func testOldServersStillDecode() throws {
        let json = #"{"round":3,"maxRounds":8,"startHp":30,"deployCap":5,"shopOdds":[55,35,10,0],"tiles":[],"market":[],"lite":false,"hps":[27,30],"me":null,"opponent":null,"combat":null,"lastRound":null,"roundWins":[0,2]}"#
        let chess = try JSONDecoder().decode(ChessSnapshot.self, from: Data(json.utf8))
        XCTAssertNil(chess.winTarget)
        XCTAssertNil(chess.deathmatch)
        XCTAssertNil(chess.roundResults)
    }

    func testMatchSummaryRatedFlag() throws {
        let bot = #"{"endedAt":1,"opponent":"테스트 봇","result":"loss","reason":"wins","score":[0,5],"kills":[0,5],"picks":[],"opponentPicks":[],"ratingBefore":1000,"ratingAfter":1000,"rated":false}"#
        XCTAssertEqual(try JSONDecoder().decode(MatchSummary.self, from: Data(bot.utf8)).rated, false)
        let old = #"{"endedAt":1,"opponent":"x","result":"win","reason":"hp","score":[20,0],"kills":[3,1],"picks":[],"opponentPicks":[],"ratingBefore":1000,"ratingAfter":1016}"#
        XCTAssertNil(try JSONDecoder().decode(MatchSummary.self, from: Data(old.utf8)).rated)
    }
}
