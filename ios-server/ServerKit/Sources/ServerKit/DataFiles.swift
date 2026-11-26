import Foundation

/// 엔진(웹뷰)이 알려 주는 파일 변경. 엔진의 MemFs와 같은 모양이다. (ios-server/engine/src/memfs.ts)
public enum FileOp: Equatable {
    case write(path: String, text: String)
    case append(path: String, text: String)
    case rename(from: String, to: String)
    case remove(path: String)
    case mkdir(path: String)

    /// 웹뷰가 보낸 객체에서 읽는다. 모양이 틀리면 nil.
    public init?(json: [String: Any]) {
        guard let op = json["op"] as? String else { return nil }
        switch op {
        case "write":
            guard let p = json["path"] as? String, let t = json["text"] as? String else { return nil }
            self = .write(path: p, text: t)
        case "append":
            guard let p = json["path"] as? String, let t = json["text"] as? String else { return nil }
            self = .append(path: p, text: t)
        case "rename":
            guard let a = json["from"] as? String, let b = json["to"] as? String else { return nil }
            self = .rename(from: a, to: b)
        case "rm":
            guard let p = json["path"] as? String else { return nil }
            self = .remove(path: p)
        case "mkdir":
            guard let p = json["path"] as? String else { return nil }
            self = .mkdir(path: p)
        default:
            return nil
        }
    }
}

/// 데이터 폴더(전적, 방, 플러그인). 엔진이 시작할 때 전부 읽어 가고, 바뀐 것은 순서대로 여기에 쓴다.
public final class DataStore {
    public let root: URL
    private let fm = FileManager.default

    public init(root: URL) {
        self.root = root.standardizedFileURL
        try? fm.createDirectory(at: self.root, withIntermediateDirectories: true)
    }

    /// 폴더 밖으로 나가거나 절대 경로면 nil.
    func resolve(_ path: String) -> URL? {
        if path.hasPrefix("/") || path.contains("\0") { return nil }
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if parts.isEmpty || parts.contains("..") { return nil }
        var url = root
        for p in parts { url.appendPathComponent(p) }
        url = url.standardizedFileURL
        return url.path.hasPrefix(root.path + "/") ? url : nil
    }

    /// 모든 파일을 {상대 경로: 글자}로. utf8이 아닌 파일과 임시 파일은 건너뛴다.
    public func loadAll() -> [String: String] {
        var out: [String: String] = [:]
        guard let walker = fm.enumerator(atPath: root.path) else { return out }
        // 팩의 그림·소리 같은 바이너리는 엔진에 넘기지 않는다 (그림·소리는 접속 서버가 /packs/ 로 내준다)
        let binary: Set<String> = ["png", "jpg", "jpeg", "webp", "gif", "mp3", "ogg", "m4a", "wav", "zip"]
        for case let rel as String in walker {
            if rel.hasSuffix(".tmp") || binary.contains((rel as NSString).pathExtension.lowercased()) { continue }
            let url = root.appendingPathComponent(rel)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue else { continue }
            if let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) { out[rel] = text }
        }
        return out
    }

    @discardableResult
    public func apply(_ ops: [FileOp]) -> [String] {
        var errors: [String] = []
        for op in ops {
            do { try apply(op) } catch { errors.append("\(op): \(error.localizedDescription)") }
        }
        return errors
    }

    private func apply(_ op: FileOp) throws {
        switch op {
        case let .write(path, text):
            guard let url = resolve(path) else { throw CocoaError(.fileWriteInvalidFileName) }
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(text.utf8).write(to: url, options: .atomic)
        case let .append(path, text):
            guard let url = resolve(path) else { throw CocoaError(.fileWriteInvalidFileName) }
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: Data(text.utf8))
        case let .rename(from, to):
            guard let a = resolve(from), let b = resolve(to) else { throw CocoaError(.fileWriteInvalidFileName) }
            try fm.createDirectory(at: b.deletingLastPathComponent(), withIntermediateDirectories: true)
            if fm.fileExists(atPath: b.path) { try fm.removeItem(at: b) }
            try fm.moveItem(at: a, to: b)
        case let .remove(path):
            guard let url = resolve(path) else { throw CocoaError(.fileWriteInvalidFileName) }
            if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
        case let .mkdir(path):
            guard let url = resolve(path) else { throw CocoaError(.fileWriteInvalidFileName) }
            try fm.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }
}
