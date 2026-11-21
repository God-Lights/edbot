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
    private let account = "game-session-token"

    public init(service: String = "com.officialgl.commander") { self.service = service }

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
