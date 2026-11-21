import XCTest
@testable import EdbotKit

/// 서버(server/)가 실제로 보내는 형식 그대로의 예시로 검증한다. 서버 규격이 바뀌면 여기서 먼저 깨진다.
final class CodecTests: XCTestCase {
    static let welcome = """
    {"t":"welcome","playerId":"p-1","token":"tok-1","room":{"code":"ABCD","phase":"lobby","phaseStartedAt":1000,"phaseEndsAt":null,"serverTime":1500,"players":[{"id":"p-1","name":"에드","seat":0,"connected":true,"ready":false}],"game":null,"battle":null,"explore":null,"forge":null,"result":null}}
    """

    func testParsesWelcome() throws {
        guard case let .welcome(playerId, token, room)? = MessageCodec.parse(Self.welcome) else {
            return XCTFail("welcome이 아니다")
        }
        XCTAssertEqual(playerId, "p-1")
        XCTAssertEqual(token, "tok-1")
        XCTAssertEqual(room.code, "ABCD")
        XCTAssertEqual(room.phase, .lobby)
        XCTAssertNil(room.phaseEndsAt)
        XCTAssertEqual(room.serverTime, 1500)
        XCTAssertEqual(room.players.first?.name, "에드")
        XCTAssertEqual(room.player(id: "p-1")?.seat, 0)
        XCTAssertNil(room.player(id: nil))
    }

    func testParsesStateWithAllPhasesAndUnknownFields() {
        for phase in ["lobby", "ban", "draft", "placement", "explore", "forge", "battle", "deathmatch", "result"] {
            let json = #"{"t":"state","room":{"code":"ABCD","phase":"\#(phase)","phaseStartedAt":1,"phaseEndsAt":2,"serverTime":3,"players":[],"future":{"x":1}}}"#
            guard case let .state(room)? = MessageCodec.parse(json) else { return XCTFail(phase) }
            XCTAssertEqual(room.phase.rawValue, phase)
            XCTAssertEqual(room.phaseEndsAt, 2)
        }
    }

    func testParsesPongAndError() {
        XCTAssertEqual(MessageCodec.parse(#"{"t":"pong","ts":5,"serverTime":9}"#), .pong(ts: 5, serverTime: 9))
        XCTAssertEqual(
            MessageCodec.parse(#"{"t":"error","code":"room_full","message":"방이 가득 찼다."}"#),
            .error(code: "room_full", message: "방이 가득 찼다.")
        )
    }

    func testBadMessagesAreIgnoredNotThrown() {
        for bad in ["", "not json", "[]", #"{"t":"nope"}"#, #"{"t":"welcome"}"#, #"{"t":"state"}"#,
                    #"{"t":"state","room":{"code":1}}"#, #"{"t":"pong","ts":"x"}"#, #"{"t":"error"}"#] {
            XCTAssertNil(MessageCodec.parse(bad), bad)
        }
    }

    func testBuildsClientMessages() {
        XCTAssertEqual(MessageCodec.ready(true), #"{"t":"ready","ready":true}"#)
        XCTAssertEqual(MessageCodec.ready(false), #"{"t":"ready","ready":false}"#)
        XCTAssertEqual(MessageCodec.ping(42), #"{"t":"ping","ts":42}"#)
    }

    func testFatalErrors() {
        XCTAssertTrue(ErrorCode.isFatal("room_full"))
        XCTAssertTrue(ErrorCode.isFatal("room_not_found"))
        XCTAssertTrue(ErrorCode.isFatal("unauthorized"))
        XCTAssertFalse(ErrorCode.isFatal("wrong_phase"))
    }
}

final class ClockAndUrlTests: XCTestCase {
    func testRemainingUsesServerOffset() {
        var clock = ServerClock()
        clock.observe(serverTime: 10_000, localNowMs: 4_000) // 서버가 6초 앞선다
        XCTAssertEqual(clock.serverNow(localNowMs: 5_000), 11_000)
        XCTAssertEqual(clock.remainingMs(until: 20_000, localNowMs: 5_000), 9_000)
        XCTAssertEqual(clock.remainingMs(until: 1_000, localNowMs: 5_000), 0)
        XCTAssertNil(clock.remainingMs(until: nil, localNowMs: 5_000))
    }

    func testNormalizeServerURL() {
        XCTAssertEqual(normalizeServerURL("127.0.0.1:8787")?.absoluteString, "https://127.0.0.1:8787")
        XCTAssertEqual(normalizeServerURL(" http://x.test/ ")?.absoluteString, "http://x.test")
        XCTAssertEqual(normalizeServerURL("https://edgame-api.officialgl.com//")?.absoluteString, "https://edgame-api.officialgl.com")
        XCTAssertNil(normalizeServerURL("   "))
    }

    func testWebSocketBase() {
        XCTAssertEqual(webSocketBase(URL(string: "https://a.test")!).absoluteString, "wss://a.test")
        XCTAssertEqual(webSocketBase(URL(string: "http://127.0.0.1:8787")!).absoluteString, "ws://127.0.0.1:8787")
    }
}
