import Foundation

public struct HTTPHeader: Equatable, Sendable {
    public let name: String
    public let value: String
    public init(_ name: String, _ value: String) { self.name = name; self.value = value }
}

public struct HTTPRequest: Equatable, Sendable {
    public var method: String
    /// 경로와 쿼리: "/api/rooms?mobius=1"
    public var target: String
    public var headers: [HTTPHeader]
    public var body: Data

    public init(method: String, target: String, headers: [HTTPHeader] = [], body: Data = Data()) {
        self.method = method; self.target = target; self.headers = headers; self.body = body
    }

    /// 대소문자를 가리지 않고 첫 번째 값
    public func header(_ name: String) -> String? {
        headers.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value
    }

    /// 쿼리를 뺀 경로
    public var path: String {
        if let q = target.firstIndex(of: "?") { return String(target[..<q]) }
        return target
    }

    public var isWebSocketUpgrade: Bool {
        (header("upgrade")?.lowercased() == "websocket")
            && (header("connection")?.lowercased().contains("upgrade") ?? false)
    }
}

public enum HTTPParseResult: Equatable {
    case needMore
    case request(HTTPRequest, consumed: Int)
    case failure(status: Int, reason: String)
}

public enum HTTPParser {
    public static let maxHeaderBytes = 64 * 1024
    public static let maxBodyBytes = 8 * 1024 * 1024

    /// 지금까지 받은 바이트에서 요청 하나를 읽는다. 덜 왔으면 .needMore.
    public static func parse(_ data: Data) -> HTTPParseResult {
        let bytes = [UInt8](data)
        guard let end = findHeaderEnd(bytes) else {
            return bytes.count > maxHeaderBytes ? .failure(status: 431, reason: "헤더가 너무 길다") : .needMore
        }
        if end > maxHeaderBytes { return .failure(status: 431, reason: "헤더가 너무 길다") }
        let head = String(decoding: bytes[0..<end], as: UTF8.self)
        var lines = head.components(separatedBy: "\r\n")
        let requestLine = lines.removeFirst()
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 3, parts[2].hasPrefix("HTTP/1."), parts[1].hasPrefix("/") else {
            return .failure(status: 400, reason: "요청 줄이 올바르지 않다")
        }
        var headers: [HTTPHeader] = []
        for line in lines where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { return .failure(status: 400, reason: "헤더 형식이 올바르지 않다") }
            let name = String(line[..<colon]).trimmingCharacters(in: .whitespaces)
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            headers.append(HTTPHeader(name, value))
        }
        var request = HTTPRequest(method: parts[0].uppercased(), target: parts[1], headers: headers)
        if let te = request.header("transfer-encoding"), te.lowercased().contains("chunked") {
            return .failure(status: 501, reason: "chunked 본문은 지원하지 않는다")
        }
        var length = 0
        if let raw = request.header("content-length") {
            guard let n = Int(raw), n >= 0 else { return .failure(status: 400, reason: "Content-Length가 올바르지 않다") }
            length = n
        }
        if length > maxBodyBytes { return .failure(status: 413, reason: "본문이 너무 크다") }
        let bodyStart = end + 4
        if bytes.count - bodyStart < length { return .needMore }
        request.body = Data(bytes[bodyStart..<(bodyStart + length)])
        return .request(request, consumed: bodyStart + length)
    }

    private static func findHeaderEnd(_ bytes: [UInt8]) -> Int? {
        guard bytes.count >= 4 else { return nil }
        var i = 0
        while i + 3 < bytes.count {
            if bytes[i] == 13, bytes[i + 1] == 10, bytes[i + 2] == 13, bytes[i + 3] == 10 { return i }
            i += 1
        }
        return nil
    }
}

public enum HTTPResponse {
    public static func reason(_ status: Int) -> String {
        switch status {
        case 101: return "Switching Protocols"
        case 200: return "OK"
        case 201: return "Created"
        case 204: return "No Content"
        case 301: return "Moved Permanently"
        case 302: return "Found"
        case 304: return "Not Modified"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 409: return "Conflict"
        case 413: return "Payload Too Large"
        case 426: return "Upgrade Required"
        case 429: return "Too Many Requests"
        case 431: return "Request Header Fields Too Large"
        case 500: return "Internal Server Error"
        case 501: return "Not Implemented"
        default: return "Status"
        }
    }

    /// 응답 한 개를 바이트로. 연결은 응답 뒤에 닫는다(Connection: close). 길이와 연결 관련 헤더는 여기서 정한다.
    public static func serialize(status: Int, headers: [HTTPHeader], body: Data, includeBody: Bool = true) -> Data {
        let drop: Set<String> = ["content-length", "transfer-encoding", "connection", "content-encoding", "keep-alive"]
        var text = "HTTP/1.1 \(status) \(reason(status))\r\n"
        for h in headers where !drop.contains(h.name.lowercased()) {
            // 헤더 값에 줄바꿈이 있으면 응답이 쪼개진다.
            let name = h.name.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
            let value = h.value.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
            text += "\(name): \(value)\r\n"
        }
        text += "Content-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        var out = Data(text.utf8)
        if includeBody { out.append(body) }
        return out
    }

    public static func text(_ status: Int, _ message: String) -> Data {
        serialize(status: status, headers: [HTTPHeader("Content-Type", "text/plain; charset=utf-8")], body: Data(message.utf8))
    }
}
