import Foundation

/// 게임 세션 토큰을 저장하는 곳.
public protocol TokenStore: Sendable {
    func load() -> String?
    func save(_ token: String)
    func clear()
}

public final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private var token: String?
    private let lock = NSLock()

    public init(token: String? = nil) { self.token = token }

    public func load() -> String? { lock.lock(); defer { lock.unlock() }; return token }
    public func save(_ token: String) { lock.lock(); self.token = token; lock.unlock() }
    public func clear() { lock.lock(); token = nil; lock.unlock() }
}

#if canImport(Security)
import Security

/// Keychain에 저장한다. 토큰은 이 기기의 이 앱에서만 읽힌다.
public struct KeychainTokenStore: TokenStore {
    private let service: String
    private let account: String

    /// account: 서버마다 다르게 해서, 서버를 바꿔도 로그인(토큰)이 섞이지 않게 한다.
    public init(service: String = "com.officialgl.commander", account: String = "game-session-token") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func save(_ token: String) {
        clear()
        var query = baseQuery
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(query as CFDictionary, nil)
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
#endif

/// 서버 주소별로 토큰 저장소를 고른다. 운영 서버는 예전 키를 그대로 써서 이미 로그인한 사람이 풀리지 않는다.
public func tokenAccount(forServer url: URL, defaultHost: String = "edgame-api.officialgl.com") -> String {
    let host = (url.host ?? url.absoluteString).lowercased()
    let key = url.port.map { "\(host):\($0)" } ?? host
    return host == defaultHost.lowercased() && url.port == nil ? "game-session-token" : "game-session-token:\(key)"
}
