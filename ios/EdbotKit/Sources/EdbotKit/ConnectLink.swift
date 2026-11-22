import Foundation

/// QR이나 링크로 받은 서버 정보: commander://connect?url=<서버 주소>&name=<서버 이름>
public struct ConnectLink: Equatable, Sendable {
    public let serverURL: URL
    public let name: String?

    /// 우리 링크가 아니거나 주소가 http(s)가 아니면 nil.
    public init?(_ link: URL) {
        guard link.scheme?.lowercased() == "commander", link.host?.lowercased() == "connect",
              let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems,
              let raw = items.first(where: { $0.name == "url" })?.value,
              let url = normalizeServerURL(raw), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https"
        else { return nil }
        serverURL = url
        let name = items.first(where: { $0.name == "name" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.name = (name?.isEmpty ?? true) ? nil : name
    }
}

/// 같은 와이파이에서 찾은 서버 한 개 (Bonjour TXT 레코드에서 읽는다)
public struct FoundServer: Equatable, Hashable, Identifiable, Sendable {
    public let name: String
    public let urlText: String
    public let expert: Bool
    public var id: String { urlText }

    /// TXT: name, ip(쉼표로 여러 개), port, ed. 주소를 못 만들면 nil.
    public init?(txt: [String: String], fallbackName: String) {
        guard let port = Int(txt["port"] ?? ""), (1...65535).contains(port),
              let ip = txt["ip"]?.split(separator: ",").first.map(String.init), !ip.isEmpty
        else { return nil }
        let name = txt["name"].flatMap { $0.isEmpty ? nil : $0 } ?? fallbackName
        self.name = name
        self.urlText = "http://\(ip):\(port)"
        self.expert = txt["ed"] == "expert"
    }
}
