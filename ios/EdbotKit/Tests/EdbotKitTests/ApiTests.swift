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
