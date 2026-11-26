import Foundation

public enum Mime {
    private static let table: [String: String] = [
        "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "webp": "image/webp", "ico": "image/x-icon",
        "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav", "ogg": "audio/ogg",
        "woff": "font/woff", "woff2": "font/woff2", "txt": "text/plain; charset=utf-8", "map": "application/json",
    ]

    public static func type(forPath path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        return table[ext] ?? "application/octet-stream"
    }
}

/// 앱에 담긴 웹 화면(web/ 폴더)에서 파일을 찾는다. 폴더 밖으로 나가는 경로는 거절한다.
public struct StaticFiles: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root.standardizedFileURL }

    /// "/" → index.html. 파일이 없거나 안전하지 않으면 nil.
    public func load(path rawPath: String) -> (data: Data, mime: String)? {
        guard let decoded = rawPath.removingPercentEncoding else { return nil }
        var path = decoded == "/" ? "/index.html" : decoded
        if path.hasSuffix("/") { path += "index.html" }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if parts.isEmpty || parts.contains("..") || parts.contains(where: { $0.contains("\0") || $0.hasPrefix(".") }) { return nil }
        var url = root
        for p in parts { url.appendPathComponent(p) }
        url = url.standardizedFileURL
        guard url.path.hasPrefix(root.path + "/") else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue,
              let data = try? Data(contentsOf: url) else { return nil }
        return (data, Mime.type(forPath: url.path))
    }
}

/// 팩의 그림·소리: /packs/<팩id>/<경로> 를 그 팩 폴더에서 찾는다. 그림·소리 파일만 내준다(문서·스크립트는 내주지 않는다).
public struct PackFiles: Sendable {
    /// 팩 id -> 팩 폴더
    public let dirs: [String: URL]
    public init(dirs: [String: URL]) { self.dirs = dirs }

    private static let media: Set<String> = ["png", "jpg", "jpeg", "webp", "gif", "mp3", "ogg", "m4a", "wav"]

    /// /packs/ 로 시작하지 않으면 nil. 없거나 안전하지 않은 파일도 nil.
    public func load(path: String) -> (data: Data, mime: String)? {
        guard path.hasPrefix("/packs/") else { return nil }
        let rest = String(path.dropFirst("/packs/".count))
        guard let slash = rest.firstIndex(of: "/") else { return nil }
        let id = String(rest[..<slash])
        let sub = String(rest[rest.index(after: slash)...])
        guard let dir = dirs[id], Self.media.contains((sub as NSString).pathExtension.lowercased()) else { return nil }
        return StaticFiles(root: dir).load(path: "/" + sub)
    }
}
