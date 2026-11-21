import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import EdbotKit

/// 랭킹(5단계). 예시는 서버가 실제로 보내는 형식이다.
final class RankingTests: XCTestCase {
    let base = URL(string: "https://x.test")!

    func testLeaderboardSendsTokenAndParses() async throws {
        let http = StubHTTP { _ in
            (#"{"entries":[{"rank":1,"nickname":"에드","rating":1020,"games":1,"wins":1,"losses":0,"draws":0,"isMe":true},{"rank":2,"nickname":"민수","rating":980,"games":1,"wins":0,"losses":1,"draws":0,"isMe":false}]}"#, 200)
        }
        let entries = try await ApiClient(baseURL: base, authToken: "tok", http: http).leaderboard(limit: 5)
        XCTAssertEqual(entries.map(\.nickname), ["에드", "민수"])
        XCTAssertTrue(entries[0].isMe)
        XCTAssertFalse(entries[1].isMe)
        XCTAssertEqual(http.last?.url?.query, "limit=5")
        XCTAssertEqual(http.last?.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    }

    func testLeaderboardWorksWithoutLogin() async throws {
        let http = StubHTTP { _ in (#"{"entries":[]}"#, 200) }
        let entries = try await ApiClient(baseURL: base, http: http).leaderboard()
        XCTAssertTrue(entries.isEmpty)
        XCTAssertNil(http.last?.value(forHTTPHeaderField: "Authorization"))
    }

    func testMyStatsAndWinRate() async throws {
        let http = StubHTTP { _ in (#"{"stats":{"nickname":"에드","rating":1020,"rank":1,"games":4,"wins":3,"losses":1,"draws":0}}"#, 200) }
        let stats = try await ApiClient(baseURL: base, authToken: "t", http: http).myStats()
        XCTAssertEqual(stats?.rank, 1)
        XCTAssertEqual(stats?.winRate ?? 0, 0.75, accuracy: 1e-9)
    }

    func testMyStatsIsNilBeforeFirstGame() async throws {
        let http = StubHTTP { _ in (#"{"stats":null}"#, 200) }
        let stats = try await ApiClient(baseURL: base, authToken: "t", http: http).myStats()
        XCTAssertNil(stats)
        XCTAssertEqual(PlayerStats(nickname: "x", rating: 1000, rank: 1, games: 0, wins: 0, losses: 0, draws: 0).winRate, 0)
    }

    func testMyMatches() async throws {
        let json = #"{"matches":[{"endedAt":5,"opponent":"민수","result":"win","reason":"towers","score":[17,3],"kills":[4,2],"picks":["dwargon"],"opponentPicks":["ankio"],"ratingBefore":1000,"ratingAfter":1020}]}"#
        let http = StubHTTP { _ in (json, 200) }
        let matches = try await ApiClient(baseURL: base, authToken: "t", http: http).myMatches(limit: 3)
        XCTAssertEqual(matches.first?.opponent, "민수")
        XCTAssertEqual(matches.first?.result, "win")
        XCTAssertEqual(matches.first?.score, [17, 3])
        XCTAssertEqual(matches.first?.ratingDelta, 20)
        XCTAssertEqual(http.last?.url?.path, "/api/me/matches")
    }

    func testUnauthorizedIsReported() async {
        let http = StubHTTP { _ in (#"{"error":"unauthorized"}"#, 401) }
        let api = ApiClient(baseURL: base, http: http)
        do { _ = try await api.myStats(); XCTFail("던져야 한다") } catch { XCTAssertEqual(error as? ApiError, .unauthorized) }
        do { _ = try await api.myMatches(); XCTFail("던져야 한다") } catch { XCTAssertEqual(error as? ApiError, .unauthorized) }
    }

    func testServerDownAndBadBody() async {
        let down = StubHTTP { _ in ("{}", 503) }
        do { _ = try await ApiClient(baseURL: base, http: down).leaderboard(); XCTFail() } catch { XCTAssertEqual(error as? ApiError, .status(503)) }
        let bad = StubHTTP { _ in ("nope", 200) }
        do { _ = try await ApiClient(baseURL: base, http: bad).leaderboard(); XCTFail() } catch { XCTAssertEqual(error as? ApiError, .badResponse) }
    }
}
