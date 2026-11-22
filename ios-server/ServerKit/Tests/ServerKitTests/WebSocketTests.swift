import XCTest
@testable import ServerKit

final class WebSocketTests: XCTestCase {
    /// 클라이언트가 보내는 마스크된 프레임을 만든다.
    func clientFrame(opcode: UInt8, payload: [UInt8], fin: Bool = true) -> Data {
        let mask: [UInt8] = [0x37, 0xFA, 0x21, 0x3D]
        var out: [UInt8] = [(fin ? 0x80 : 0) | opcode]
        if payload.count < 126 { out.append(0x80 | UInt8(payload.count)) }
        else if payload.count <= 0xFFFF { out.append(0x80 | 126); out.append(UInt8(payload.count >> 8)); out.append(UInt8(payload.count & 0xFF)) }
        else { out.append(0x80 | 127); for s in stride(from: 56, through: 0, by: -8) { out.append(UInt8((UInt64(payload.count) >> UInt64(s)) & 0xFF)) } }
        out += mask
        for (i, b) in payload.enumerated() { out.append(b ^ mask[i % 4]) }
        return Data(out)
    }

    func testAcceptKeyMatchesRFCExample() {
        XCTAssertEqual(WebSocketHandshake.acceptKey(for: "dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
    }

    func testHandshakeResponse() {
        let req = HTTPRequest(method: "GET", target: "/ws/ABCD", headers: [HTTPHeader("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")])
        let text = String(decoding: WebSocketHandshake.response(for: req)!, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("HTTP/1.1 101"))
        XCTAssertTrue(text.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="))
        XCTAssertNil(WebSocketHandshake.response(for: HTTPRequest(method: "GET", target: "/")))
    }

    func testDecodesTextAcrossChunks() throws {
        var d = WebSocketDecoder()
        let frame = clientFrame(opcode: 1, payload: Array("안녕 hello".utf8))
        d.feed(frame.prefix(5))
        XCTAssertNil(try d.next())
        d.feed(frame.dropFirst(5))
        XCTAssertEqual(try d.next(), .text("안녕 hello"))
        XCTAssertNil(try d.next())
    }

    func testDecodesTwoMessagesInOneRead() throws {
        var d = WebSocketDecoder()
        d.feed(clientFrame(opcode: 1, payload: Array("a".utf8)) + clientFrame(opcode: 2, payload: [1, 2, 3]))
        XCTAssertEqual(try d.next(), .text("a"))
        XCTAssertEqual(try d.next(), .binary(Data([1, 2, 3])))
    }

    func testLongPayloads() throws {
        var d = WebSocketDecoder()
        let medium = [UInt8](repeating: 0x61, count: 300)
        let large = [UInt8](repeating: 0x62, count: 70_000)
        d.feed(clientFrame(opcode: 2, payload: medium))
        d.feed(clientFrame(opcode: 2, payload: large))
        XCTAssertEqual(try d.next(), .binary(Data(medium)))
        XCTAssertEqual(try d.next(), .binary(Data(large)))
    }

    func testFragmentedMessageWithPingBetween() throws {
        var d = WebSocketDecoder()
        d.feed(clientFrame(opcode: 1, payload: Array("he".utf8), fin: false))
        d.feed(clientFrame(opcode: 9, payload: [7]))
        d.feed(clientFrame(opcode: 0, payload: Array("llo".utf8), fin: true))
        XCTAssertEqual(try d.next(), .ping(Data([7])))
        XCTAssertEqual(try d.next(), .text("hello"))
    }

    func testCloseFrame() throws {
        var d = WebSocketDecoder()
        d.feed(clientFrame(opcode: 8, payload: [0x03, 0xE8] + Array("bye".utf8)))
        XCTAssertEqual(try d.next(), .close(code: 1000, reason: "bye"))
    }

    func testRejectsUnmaskedAndOversize() {
        var d = WebSocketDecoder()
        d.feed(Data([0x81, 0x01, 0x61])) // 마스크 없음
        XCTAssertThrowsError(try d.next())
        var big = WebSocketDecoder()
        big.feed(Data([0x82, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF]))
        XCTAssertThrowsError(try big.next()) { XCTAssertEqual($0 as? WebSocketError, .tooLarge) }
    }

    func testEncoderLengths() {
        XCTAssertEqual([UInt8](WebSocketEncoder.text("hi")), [0x81, 2, 0x68, 0x69])
        let mid = [UInt8](WebSocketEncoder.binary(Data(repeating: 0, count: 200)))
        XCTAssertEqual(Array(mid[0..<4]), [0x82, 126, 0, 200])
        let large = [UInt8](WebSocketEncoder.binary(Data(repeating: 0, count: 70_000)))
        XCTAssertEqual(Array(large[0..<10]), [0x82, 127, 0, 0, 0, 0, 0, 1, 0x11, 0x70])
        XCTAssertEqual([UInt8](WebSocketEncoder.close(code: 1000, reason: "x")), [0x88, 3, 0x03, 0xE8, 0x78])
    }
}
