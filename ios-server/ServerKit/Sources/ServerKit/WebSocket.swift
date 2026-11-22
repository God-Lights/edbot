import CryptoKit
import Foundation

public enum WebSocketHandshake {
    private static let guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    /// Sec-WebSocket-Accept 값 (RFC 6455)
    public static func acceptKey(for clientKey: String) -> String {
        let digest = Insecure.SHA1.hash(data: Data((clientKey + guid).utf8))
        return Data(digest).base64EncodedString()
    }

    /// 101 응답. 키가 없으면 nil.
    public static func response(for request: HTTPRequest) -> Data? {
        guard let key = request.header("sec-websocket-key"), !key.isEmpty else { return nil }
        let text = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(acceptKey(for: key))\r\n\r\n"
        return Data(text.utf8)
    }
}

public enum WebSocketEvent: Equatable {
    case text(String)
    case binary(Data)
    case ping(Data)
    case pong(Data)
    case close(code: UInt16, reason: String)
}

public enum WebSocketError: Error, Equatable {
    case protocolViolation(String)
    case tooLarge
}

/// 클라이언트가 보낸 바이트를 모아서 메시지로 만든다. (프레임 나뉨, 마스크, 조각 메시지 처리)
public struct WebSocketDecoder {
    public static let maxMessageBytes = 16 * 1024 * 1024
    private var buffer: [UInt8] = []
    private var fragments: [UInt8] = []
    private var fragmentOpcode: UInt8?

    public init() {}

    public mutating func feed(_ data: Data) { buffer.append(contentsOf: data) }

    /// 완성된 메시지 하나. 더 받아야 하면 nil. 규칙 위반이면 throw.
    public mutating func next() throws -> WebSocketEvent? {
        while true {
            guard buffer.count >= 2 else { return nil }
            let b0 = buffer[0], b1 = buffer[1]
            let fin = b0 & 0x80 != 0
            if b0 & 0x70 != 0 { throw WebSocketError.protocolViolation("예약 비트") }
            let opcode = b0 & 0x0F
            let masked = b1 & 0x80 != 0
            if !masked { throw WebSocketError.protocolViolation("클라이언트 프레임은 마스크되어야 한다") }
            var length = Int(b1 & 0x7F)
            var offset = 2
            if length == 126 {
                guard buffer.count >= 4 else { return nil }
                length = Int(buffer[2]) << 8 | Int(buffer[3])
                offset = 4
            } else if length == 127 {
                guard buffer.count >= 10 else { return nil }
                var big: UInt64 = 0
                for i in 0..<8 { big = big << 8 | UInt64(buffer[2 + i]) }
                if big > UInt64(Self.maxMessageBytes) { throw WebSocketError.tooLarge }
                length = Int(big)
                offset = 10
            }
            if length > Self.maxMessageBytes { throw WebSocketError.tooLarge }
            guard buffer.count >= offset + 4 + length else { return nil }
            let mask = Array(buffer[offset..<(offset + 4)])
            var payload = Array(buffer[(offset + 4)..<(offset + 4 + length)])
            for i in 0..<payload.count { payload[i] ^= mask[i % 4] }
            buffer.removeSubrange(0..<(offset + 4 + length))

            if opcode >= 8 { // 제어 프레임
                if !fin || length > 125 { throw WebSocketError.protocolViolation("제어 프레임 규칙 위반") }
                switch opcode {
                case 8:
                    let code: UInt16 = payload.count >= 2 ? UInt16(payload[0]) << 8 | UInt16(payload[1]) : 1005
                    let reason = payload.count > 2 ? String(decoding: payload[2...], as: UTF8.self) : ""
                    return .close(code: code, reason: reason)
                case 9: return .ping(Data(payload))
                case 10: return .pong(Data(payload))
                default: throw WebSocketError.protocolViolation("알 수 없는 opcode")
                }
            }

            if opcode == 0 { // 이어지는 조각
                guard fragmentOpcode != nil else { throw WebSocketError.protocolViolation("시작 없는 조각") }
                fragments.append(contentsOf: payload)
            } else if opcode == 1 || opcode == 2 {
                guard fragmentOpcode == nil else { throw WebSocketError.protocolViolation("조각 중에 새 메시지") }
                fragmentOpcode = opcode
                fragments = payload
            } else {
                throw WebSocketError.protocolViolation("알 수 없는 opcode")
            }
            if fragments.count > Self.maxMessageBytes { throw WebSocketError.tooLarge }
            if fin {
                let type = fragmentOpcode!
                let message = fragments
                fragments = []
                fragmentOpcode = nil
                return type == 1 ? .text(String(decoding: message, as: UTF8.self)) : .binary(Data(message))
            }
        }
    }
}

public enum WebSocketEncoder {
    /// 서버 → 클라이언트 프레임(마스크 없음, 조각 없음)
    public static func frame(opcode: UInt8, payload: Data) -> Data {
        var out = Data([0x80 | opcode])
        let n = payload.count
        if n < 126 {
            out.append(UInt8(n))
        } else if n <= 0xFFFF {
            out.append(126)
            out.append(UInt8(n >> 8)); out.append(UInt8(n & 0xFF))
        } else {
            out.append(127)
            for shift in stride(from: 56, through: 0, by: -8) { out.append(UInt8((UInt64(n) >> UInt64(shift)) & 0xFF)) }
        }
        out.append(payload)
        return out
    }

    public static func text(_ string: String) -> Data { frame(opcode: 1, payload: Data(string.utf8)) }
    public static func binary(_ data: Data) -> Data { frame(opcode: 2, payload: data) }
    public static func pong(_ data: Data) -> Data { frame(opcode: 10, payload: data) }

    public static func close(code: UInt16 = 1000, reason: String = "") -> Data {
        var payload = Data([UInt8(code >> 8), UInt8(code & 0xFF)])
        payload.append(Data(reason.utf8.prefix(120)))
        return frame(opcode: 8, payload: payload)
    }
}
