import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import EdbotKit

final class StubHTTP: HTTPTransport, @unchecked Sendable {
    private let respond: @Sendable (URLRequest) -> (String, Int)
    private let lock = NSLock()
    private var _last: URLRequest?

    init(_ respond: @escaping @Sendable (URLRequest) -> (String, Int)) { self.respond = respond }

    var last: URLRequest? { lock.lock(); defer { lock.unlock() }; return _last }

    func send(_ request: URLRequest) async throws -> (data: Data, status: Int) {
        lock.lock(); _last = request; lock.unlock()
        let (body, status) = respond(request)
        return (Data(body.utf8), status)
    }
}

final class ApiTests: XCTestCase {
    let base = URL(string: "https://x.test")!

    func testMatchJoinPollAndCancel() async throws {
        let waiting = StubHTTP { _ in (#"{"ticket":"t1","status":"waiting","code":null,"waitedMs":0,"waiting":3}"#, 200) }
        let ticket = try await ApiClient(baseURL: base, http: waiting).matchJoin(name: "에드 봇")
        XCTAssertEqual(ticket.ticket, "t1")
        XCTAssertNil(ticket.code)
        XCTAssertEqual(ticket.waiting, 3)
        XCTAssertEqual(waiting.last?.httpMethod, "POST")
        XCTAssertTrue(waiting.last?.url?.absoluteString.contains("/api/match/join?name=") ?? false)
        let matched = StubHTTP { _ in (#"{"ticket":"t1","status":"matched","code":"ABCD","waitedMs":1500,"waiting":0}"#, 200) }
        let status = try await ApiClient(baseURL: base, http: matched).matchPoll(ticket: "t1")
        XCTAssertEqual(status?.code, "ABCD")
        let gone = StubHTTP { _ in (#"{"error":"ticket_expired"}"#, 404) }
        let none = try await ApiClient(baseURL: base, http: gone).matchPoll(ticket: "t1")
        XCTAssertNil(none)
        let denied = StubHTTP { _ in (#"{"error":"unauthorized"}"#, 401) }
        do {
            _ = try await ApiClient(baseURL: base, http: denied).matchJoin(name: "x")
            XCTFail("401 이면 unauthorized")
        } catch ApiError.unauthorized {}
        let cancel = StubHTTP { _ in (#"{"ok":true}"#, 200) }
        await ApiClient(baseURL: base, http: cancel).matchCancel(ticket: "t1")
        XCTAssertTrue(cancel.last?.url?.absoluteString.hasSuffix("/api/match/cancel?ticket=t1") ?? false)
    }

    func testCreateRoomSendsTokenAndReturnsCode() async throws {
        let http = StubHTTP { _ in (#"{"code":"ABCD"}"#, 201) }
        let code = try await ApiClient(baseURL: base, authToken: "tok", http: http).createRoom()
        XCTAssertEqual(code, "ABCD")
        XCTAssertEqual(http.last?.httpMethod, "POST")
        XCTAssertEqual(http.last?.url?.path, "/api/rooms")
        XCTAssertEqual(http.last?.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    }

    func testCreateGuestRoomUsesGuestQuery() async throws {
        let http = StubHTTP { _ in (#"{"code":"WXYZ"}"#, 201) }
        let code = try await ApiClient(baseURL: base, authToken: "tok", http: http).createRoom(guest: true)
        XCTAssertEqual(code, "WXYZ")
        XCTAssertEqual(http.last?.url?.absoluteString, "https://x.test/api/rooms?guest=1")
    }

    func testLiveRooms() async throws {
        let http = StubHTTP { _ in (#"{"rooms":[{"code":"ABCD","host":"h","players":[],"phase":"prep","round":1,"maxRounds":8,"hps":[30,30],"updatedAt":1}]}"#, 200) }
        let rooms = try await ApiClient(baseURL: base, authToken: "tok", http: http).liveRooms()
        XCTAssertEqual(rooms.first?.code, "ABCD")
        XCTAssertEqual(http.last?.url?.path, "/api/live")
        XCTAssertEqual(http.last?.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
        let denied = StubHTTP { _ in (#"{"error":"unauthorized"}"#, 401) }
        do {
            _ = try await ApiClient(baseURL: base, http: denied).liveRooms()
            XCTFail("던져야 한다")
        } catch {
            XCTAssertEqual(error as? ApiError, .unauthorized)
        }
    }

    func testMyRoomsAndCloseRoom() async throws {
        let list = StubHTTP { _ in (#"{"rooms":[{"code":"ABCD","host":"h","guest":true,"mine":true,"players":[],"phase":"lobby","round":0,"maxRounds":8,"hps":null,"updatedAt":1}]}"#, 200) }
        let rooms = try await ApiClient(baseURL: base, authToken: "tok", http: list).myRooms()
        XCTAssertEqual(rooms.first?.mine, true)
        XCTAssertEqual(rooms.first?.guest, true)
        XCTAssertEqual(list.last?.url?.path, "/api/my-rooms")

        let ok = StubHTTP { _ in (#"{"ok":true}"#, 200) }
        let closed = try await ApiClient(baseURL: base, authToken: "tok", http: ok).closeRoom(code: " abcd ")
        XCTAssertTrue(closed)
        XCTAssertEqual(ok.last?.httpMethod, "POST")
        XCTAssertEqual(ok.last?.url?.path, "/api/rooms/ABCD/close")

        let missing = StubHTTP { _ in (#"{"error":"room_not_found"}"#, 404) }
        let gone = try await ApiClient(baseURL: base, authToken: "tok", http: missing).closeRoom(code: "ABCD")
        XCTAssertFalse(gone)

        let forbidden = StubHTTP { _ in (#"{"error":"forbidden"}"#, 403) }
        do {
            _ = try await ApiClient(baseURL: base, authToken: "tok", http: forbidden).closeRoom(code: "ABCD")
            XCTFail("던져야 한다")
        } catch {
            XCTAssertEqual(error as? ApiError, .status(403))
        }
    }

    func testCreateRoomUnauthorized() async {
        let http = StubHTTP { _ in (#"{"error":"unauthorized"}"#, 401) }
        do {
            _ = try await ApiClient(baseURL: base, http: http).createRoom()
            XCTFail("던져야 한다")
        } catch {
            XCTAssertEqual(error as? ApiError, .unauthorized)
        }
    }

    func testRoomLookup() async throws {
        let ok = StubHTTP { _ in (#"{"code":"ABCD","phase":"lobby","players":1,"joinable":true}"#, 200) }
        let info = try await ApiClient(baseURL: base, http: ok).room(code: " abcd ")
        XCTAssertEqual(info?.joinable, true)
        XCTAssertEqual(ok.last?.url?.path, "/api/rooms/ABCD")
        let missing = StubHTTP { _ in ("{}", 404) }
        let none = try await ApiClient(baseURL: base, http: missing).room(code: "ZZZZ")
        XCTAssertNil(none)
    }

    func testLoginFlow() async throws {
        let start = StubHTTP { _ in (#"{"loginId":"abc","loginUrl":"https://x.test/auth/login?login=abc","expiresInSeconds":600}"#, 200) }
        let started = try await AuthClient(baseURL: base, http: start).start()
        XCTAssertEqual(started.loginId, "abc")
        XCTAssertEqual(start.last?.httpMethod, "POST")

        let pending = StubHTTP { _ in (#"{"status":"pending"}"#, 202) }
        let r1 = try await AuthClient(baseURL: base, http: pending).poll(loginId: "abc")
        XCTAssertEqual(r1, .pending)

        let expired = StubHTTP { _ in (#"{"error":"login_expired"}"#, 404) }
        let r2 = try await AuthClient(baseURL: base, http: expired).poll(loginId: "abc")
        XCTAssertEqual(r2, .expired)

        let approved = StubHTTP { _ in
            (#"{"status":"approved","token":"tok","user":{"id":"u1","username":"ed","nickname":"에드","emailVerified":true}}"#, 200)
        }
        let r3 = try await AuthClient(baseURL: base, http: approved).poll(loginId: "abc")
        guard case let .approved(token, user) = r3 else { return XCTFail("승인이 아니다") }
        XCTAssertEqual(token, "tok")
        XCTAssertEqual(user.nickname, "에드")
        XCTAssertEqual(user.id, "u1")
    }

    func testMeReturnsNilWhenExpired() async throws {
        let http = StubHTTP { _ in (#"{"error":"unauthorized"}"#, 401) }
        let user = try await AuthClient(baseURL: base, http: http).me(token: "tok")
        XCTAssertNil(user)
        XCTAssertEqual(http.last?.value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    }

    func testMemoryTokenStore() {
        let store = MemoryTokenStore()
        XCTAssertNil(store.load())
        store.save("a")
        XCTAssertEqual(store.load(), "a")
        store.clear()
        XCTAssertNil(store.load())
    }

    func testServerInfoDecodesAndReportsCompatibility() async throws {
        let json = #"{"protocol":1,"name":"시연 서버","env":"local","authMode":"open","edition":"expert","version":"0.1.0","ruleset":"official","ranking":true,"guestRooms":false}"#
        let http = StubHTTP { _ in (json, 200) }
        let info = try await ApiClient(baseURL: base, http: http).serverInfo()
        XCTAssertEqual(http.last?.url?.path, "/api/server")
        XCTAssertEqual(info?.name, "시연 서버")
        XCTAssertEqual(info?.env, .local)
        XCTAssertEqual(info?.authMode, .open)
        XCTAssertEqual(info?.edition, "expert")
        XCTAssertEqual(info?.guestRooms, false)
        XCTAssertEqual(info?.isCompatible, true)
        let newer = ServerInfo(protocolVersion: clientProtocolVersion + 1, name: "x", env: .production, authMode: .gl)
        XCTAssertFalse(newer.isCompatible)
    }

    func testServerInfoDecodesPacksAndDefaultsToNone() throws {
        let withPacks = #"{"protocol":1,"name":"x","env":"local","authMode":"open","edition":"expert","ruleset":"custom-ab12cd34","packs":[{"id":"example","name":"예시","version":"1.0.0"},{"id":"night","name":"밤","version":"1","kind":"resource"}]}"#
        let a = try JSONDecoder().decode(ServerInfo.self, from: Data(withPacks.utf8))
        XCTAssertEqual(a.packs, [ServerInfo.Pack(id: "example", name: "예시", version: "1.0.0"), ServerInfo.Pack(id: "night", name: "밤", version: "1", kind: "resource")])
        XCTAssertEqual(a.ruleset, "custom-ab12cd34")
        let old = #"{"protocol":1,"name":"x","env":"production","authMode":"gl"}"#
        let b = try JSONDecoder().decode(ServerInfo.self, from: Data(old.utf8))
        XCTAssertTrue(b.packs.isEmpty)
        XCTAssertEqual(b.ruleset, "official")
    }

    func testPacksDecodeKindsGuideAndResources() async throws {
        let json = ##"{"packs":[{"id":"night-skin","name":"밤하늘","version":"1.0.0","kind":"resource","author":"GL","resources":{"colors":{"gold":"#88aaff","accent":"#5566ff"},"logo":"/packs/night-skin/assets/logo.png","units":{"swordsman":"/packs/night-skin/a.png"}},"summary":{"units":[],"overrides":[],"materials":[],"weapons":[],"rules":[]}},{"id":"starfall","name":"별똥별","version":"0.2.0","kind":"bundle","guide":[{"title":"혜성 기사","body":"새 캐릭터"}],"summary":{"units":["혜성 기사"],"rules":["rerollCost"]}},{"id":"old","name":"옛 팩","version":"1"}]}"##
        let http = StubHTTP { _ in (json, 200) }
        let packs = try await ApiClient(baseURL: base, http: http).packs()
        XCTAssertEqual(http.last?.url?.path, "/api/packs")
        XCTAssertEqual(packs.map(\.kindName), ["리소스", "종합", "플러그인"])
        XCTAssertEqual(packs[0].resourceLine, "색 2가지, 로고, 캐릭터 그림 1명")
        XCTAssertEqual(packs[1].guide?.first?.title, "혜성 기사")
        XCTAssertEqual(packs[1].summary?.units, ["혜성 기사"])
        XCTAssertEqual(packs[1].summary?.weapons, [])
        XCTAssertNil(packs[2].resourceLine)
        XCTAssertEqual(PackDetail.ruleName("rerollCost"), "새로고침 비용")
        let none = try await ApiClient(baseURL: base, http: StubHTTP { _ in ("{}", 404) }).packs()
        XCTAssertTrue(none.isEmpty)
    }

    func testLoginStartShowsServerReason() async {
        let http = StubHTTP { _ in (#"{"error":"link_unreachable","message":"공식 서버에 연결할 수 없어요.","detail":"/api/link/register 요청 실패: Failed to fetch"}"#, 503) }
        do {
            _ = try await AuthClient(baseURL: base, http: http).start()
            XCTFail("오류여야 한다")
        } catch let error as LoginStartError {
            XCTAssertEqual(error.message, "공식 서버에 연결할 수 없어요.")
            XCTAssertEqual(error.localizedDescription, "공식 서버에 연결할 수 없어요. (/api/link/register 요청 실패: Failed to fetch)")
        } catch {
            XCTFail("\(error)")
        }
    }

    func testConnectLinkParsesServerAndName() {
        let link = ConnectLink(URL(string: "commander://connect?url=http%3A%2F%2F192.168.0.5%3A8787&name=%EB%82%B4%20%EC%84%9C%EB%B2%84")!)
        XCTAssertEqual(link?.serverURL.absoluteString, "http://192.168.0.5:8787")
        XCTAssertEqual(link?.name, "내 서버")
        XCTAssertNil(ConnectLink(URL(string: "https://example.com")!))
        XCTAssertNil(ConnectLink(URL(string: "commander://connect?url=ftp%3A%2F%2Fx")!))
        XCTAssertNil(ConnectLink(URL(string: "commander://other?url=http%3A%2F%2Fx")!))
    }

    func testFoundServerFromTxt() {
        let s = FoundServer(txt: ["name": "집", "ip": "10.0.0.2,10.0.0.3", "port": "8787", "ed": "expert"], fallbackName: "x")
        XCTAssertEqual(s?.urlText, "http://10.0.0.2:8787")
        XCTAssertEqual(s?.expert, true)
        XCTAssertNil(FoundServer(txt: ["ip": "10.0.0.2"], fallbackName: "x"))
    }

    func testServerInfoIsNilForOldServers() async throws {
        let http = StubHTTP { _ in (#"{"error":"not_found"}"#, 404) }
        let info = try await ApiClient(baseURL: base, http: http).serverInfo()
        XCTAssertNil(info)
        let garbled = StubHTTP { _ in ("<html>", 200) }
        let none = try await ApiClient(baseURL: base, http: garbled).serverInfo()
        XCTAssertNil(none)
    }

    func testTokenAccountDiffersPerServer() {
        // 운영 서버는 예전 키를 그대로 써서 이미 로그인한 사람이 풀리지 않는다.
        XCTAssertEqual(tokenAccount(forServer: URL(string: "https://edgame-api.officialgl.com")!), "game-session-token")
        XCTAssertEqual(tokenAccount(forServer: URL(string: "https://EDGAME-API.officialgl.com")!), "game-session-token")
        // 다른 서버·다른 포트는 따로
        let local = tokenAccount(forServer: URL(string: "http://192.168.0.5:8787")!)
        let other = tokenAccount(forServer: URL(string: "http://192.168.0.5:9000")!)
        XCTAssertEqual(local, "game-session-token:192.168.0.5:8787")
        XCTAssertNotEqual(local, other)
        XCTAssertNotEqual(local, "game-session-token")
    }
}
