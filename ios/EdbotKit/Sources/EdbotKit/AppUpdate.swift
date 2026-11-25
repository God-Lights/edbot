import Foundation

/// 새 버전 안내: SideStore 소스(/sidestore.json)에서 이 앱의 최신 버전을 읽어 지금 버전과 비교한다.
public struct AppUpdate: Equatable, Sendable {
    public let version: String
    public let downloadURL: URL?

    public init(version: String, downloadURL: URL?) {
        self.version = version
        self.downloadURL = downloadURL
    }

    /// 공식 서버의 SideStore 소스. 로컬 서버에 붙어 있어도 업데이트는 여기서 확인한다.
    public static let sourceURL = URL(string: "https://edgame-api.officialgl.com/sidestore.json")!

    /// "0.5.10" > "0.5.9" 처럼 숫자로 비교한다. 형식이 이상하면 false.
    public static func isNewer(_ latest: String, than current: String) -> Bool {
        guard let a = parts(latest), let b = parts(current) else { return false }
        for i in 0..<max(a.count, b.count) {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    private static func parts(_ text: String) -> [Int]? {
        let trimmed = text.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "v"))
        let nums = trimmed.split(separator: ".").map { Int($0) }
        guard !nums.isEmpty, nums.allSatisfy({ $0 != nil }) else { return nil }
        return nums.compactMap { $0 }
    }

    /// 소스 JSON 에서 bundleId 앱의 최신 버전. 지금 버전보다 새것이 아니면 nil.
    /// 개발용 빌드(0.0.0)는 안내하지 않는다.
    public static func check(sourceJSON data: Data, bundleId: String, current: String) -> AppUpdate? {
        guard current != "0.0.0", !current.isEmpty else { return nil }
        struct Source: Decodable {
            struct App: Decodable {
                let bundleIdentifier: String
                let version: String?
                let downloadURL: String?
                let versions: [Version]?
            }
            struct Version: Decodable {
                let version: String
                let downloadURL: String?
            }
            let apps: [App]
        }
        guard let source = try? JSONDecoder().decode(Source.self, from: data),
              let app = source.apps.first(where: { $0.bundleIdentifier == bundleId })
        else { return nil }
        // 최신은 versions 의 첫 항목(새것부터), 없으면 앱 최상위의 version
        let latest: (String, String?)? = app.versions?.first.map { ($0.version, $0.downloadURL) } ?? app.version.map { ($0, app.downloadURL) }
        guard let latest, isNewer(latest.0, than: current) else { return nil }
        return AppUpdate(version: latest.0, downloadURL: latest.1.flatMap { URL(string: $0) })
    }

    /// SideStore 로 바로 설치하는 링크 (SideStore 가 없으면 열리지 않는다)
    public var sideStoreInstallURL: URL? {
        guard let downloadURL else { return nil }
        var components = URLComponents(string: "sidestore://install")
        components?.queryItems = [URLQueryItem(name: "url", value: downloadURL.absoluteString)]
        return components?.url
    }
}
