import XCTest
@testable import ServerKit

final class DataFilesTests: XCTestCase {
    var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("serverkit-\(UUID().uuidString)")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

    func testAppliesOpsInOrderAndLoadsBack() {
        let store = DataStore(root: dir)
        let errors = store.apply([
            .mkdir(path: "data"),
            .write(path: "data/players.json.tmp", text: "{\"players\":[]}"),
            .rename(from: "data/players.json.tmp", to: "data/players.json"),
            .append(path: "data/matches.jsonl", text: "{\"a\":1}\n"),
            .append(path: "data/matches.jsonl", text: "{\"a\":2}\n"),
            .write(path: "objects/Room/AB%3ACD.json", text: "x"),
        ])
        XCTAssertEqual(errors, [])
        let all = store.loadAll()
        XCTAssertEqual(all["data/players.json"], "{\"players\":[]}")
        XCTAssertEqual(all["data/matches.jsonl"], "{\"a\":1}\n{\"a\":2}\n")
        XCTAssertEqual(all["objects/Room/AB%3ACD.json"], "x")
        XCTAssertNil(all["data/players.json.tmp"])
    }

    func testRemoveDeletesFolderContents() {
        let store = DataStore(root: dir)
        store.apply([.write(path: "backups/20250101/a.json", text: "1"), .write(path: "backups/20250102/b.json", text: "2"), .remove(path: "backups/20250101")])
        XCTAssertEqual(Set(store.loadAll().keys), ["backups/20250102/b.json"])
        XCTAssertEqual(store.apply([.remove(path: "없는/경로")]), [])
    }

    func testRefusesPathsOutsideRoot() {
        let store = DataStore(root: dir)
        XCTAssertEqual(store.apply([.write(path: "../evil.txt", text: "x")]).count, 1)
        XCTAssertEqual(store.apply([.write(path: "/etc/evil.txt", text: "x")]).count, 1)
        XCTAssertEqual(store.apply([.rename(from: "a", to: "../b")]).count, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.deletingLastPathComponent().appendingPathComponent("evil.txt").path))
    }

    func testFileOpParsing() {
        XCTAssertEqual(FileOp(json: ["op": "write", "path": "a", "text": "b"]), .write(path: "a", text: "b"))
        XCTAssertEqual(FileOp(json: ["op": "rename", "from": "a", "to": "b"]), .rename(from: "a", to: "b"))
        XCTAssertEqual(FileOp(json: ["op": "rm", "path": "a"]), .remove(path: "a"))
        XCTAssertNil(FileOp(json: ["op": "write", "path": "a"]))
        XCTAssertNil(FileOp(json: ["op": "zzz"]))
    }

    func testStaticFilesServesAndBlocksTraversal() throws {
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("js"), withIntermediateDirectories: true)
        try Data("<html>COMMANDER</html>".utf8).write(to: dir.appendingPathComponent("index.html"))
        try Data("var a;".utf8).write(to: dir.appendingPathComponent("js/main.js"))
        try Data("secret".utf8).write(to: dir.deletingLastPathComponent().appendingPathComponent("secret-\(dir.lastPathComponent).txt"))
        let files = StaticFiles(root: dir)
        XCTAssertEqual(files.load(path: "/")?.mime, "text/html; charset=utf-8")
        XCTAssertEqual(String(decoding: files.load(path: "/js/main.js")!.data, as: UTF8.self), "var a;")
        XCTAssertNil(files.load(path: "/nope.html"))
        XCTAssertNil(files.load(path: "/../secret-\(dir.lastPathComponent).txt"))
        XCTAssertNil(files.load(path: "/js/%2e%2e/%2e%2e/x"))
        XCTAssertNil(files.load(path: "/js"))
        XCTAssertEqual(Mime.type(forPath: "a.svg"), "image/svg+xml")
        XCTAssertEqual(Mime.type(forPath: "a.unknown"), "application/octet-stream")
    }
}
