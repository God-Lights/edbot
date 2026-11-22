import XCTest
@testable import ServerKit

final class HTTPTests: XCTestCase {
    func parse(_ text: String) -> HTTPParseResult { HTTPParser.parse(Data(text.utf8)) }

    func testParsesGetWithQuery() {
        guard case let .request(req, consumed) = parse("GET /api/rooms?mobius=1 HTTP/1.1\r\nHost: a:8787\r\nX-Test:  v \r\n\r\n") else { return XCTFail("요청이 읽혀야 한다") }
        XCTAssertEqual(req.method, "GET")
        XCTAssertEqual(req.path, "/api/rooms")
        XCTAssertEqual(req.target, "/api/rooms?mobius=1")
        XCTAssertEqual(req.header("host"), "a:8787")
        XCTAssertEqual(req.header("X-TEST"), "v")
        XCTAssertTrue(req.body.isEmpty)
        XCTAssertGreaterThan(consumed, 0)
    }

    func testWaitsForBodyAndHeaders() {
        XCTAssertEqual(parse("GET / HTTP/1.1\r\nHost: a"), .needMore)
        XCTAssertEqual(parse("POST /x HTTP/1.1\r\nContent-Length: 5\r\n\r\nabc"), .needMore)
        guard case let .request(req, consumed) = parse("POST /x HTTP/1.1\r\nContent-Length: 5\r\n\r\nabcdeEXTRA") else { return XCTFail() }
        XCTAssertEqual(String(decoding: req.body, as: UTF8.self), "abcde")
        XCTAssertEqual(consumed, "POST /x HTTP/1.1\r\nContent-Length: 5\r\n\r\nabcde".utf8.count)
    }

    func testRejectsBadInput() {
        XCTAssertEqual(parse("nonsense\r\n\r\n"), .failure(status: 400, reason: "요청 줄이 올바르지 않다"))
        guard case let .failure(status, _) = parse("POST /x HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(status, 501)
        guard case let .failure(big, _) = parse("POST /x HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(big, 413)
        guard case let .failure(neg, _) = parse("POST /x HTTP/1.1\r\nContent-Length: -1\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(neg, 400)
        guard case let .failure(long, _) = HTTPParser.parse(Data(repeating: 65, count: 70_000)) else { return XCTFail() }
        XCTAssertEqual(long, 431)
    }

    func testDetectsWebSocketUpgrade() {
        guard case let .request(req, _) = parse("GET /ws/ABCD HTTP/1.1\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: x\r\n\r\n") else { return XCTFail() }
        XCTAssertTrue(req.isWebSocketUpgrade)
        guard case let .request(plain, _) = parse("GET / HTTP/1.1\r\n\r\n") else { return XCTFail() }
        XCTAssertFalse(plain.isWebSocketUpgrade)
    }

    func testSerializeSetsLengthAndDropsHopHeaders() {
        let data = HTTPResponse.serialize(status: 200, headers: [HTTPHeader("Content-Type", "text/plain"), HTTPHeader("Content-Length", "999"), HTTPHeader("Connection", "keep-alive"), HTTPHeader("X-Evil", "a\r\nInjected: 1")], body: Data("hi".utf8))
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("HTTP/1.1 200 OK\r\n"))
        XCTAssertTrue(text.contains("Content-Length: 2\r\n"))
        XCTAssertFalse(text.contains("999"))
        XCTAssertFalse(text.contains("keep-alive"))
        XCTAssertFalse(text.contains("\r\nInjected: 1"))
        XCTAssertTrue(text.hasSuffix("\r\n\r\nhi"))
    }
}
