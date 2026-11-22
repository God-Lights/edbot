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
}
