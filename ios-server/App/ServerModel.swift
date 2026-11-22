import Foundation
import Observation
import ServerKit
import UIKit
import WebKit

@MainActor
@Observable
final class ServerModel {
    enum Status: Equatable {
        case stopped
        case starting
        case running
        case failed(String)
    }

    var name: String
    var port: Int
    /// "vanilla" 또는 "expert"
    var edition: String

    private(set) var status: Status = .stopped
    private(set) var addresses: [String] = []
    private(set) var log: [String] = []
    private(set) var pluginsText: String?
    /// 화면에 붙여 둘 엔진 웹뷰(붙어 있어야 타이머가 제때 돈다)
    private(set) var engineView: WKWebView?

    let dataRoot: URL
    private let store: DataStore
    private var bridge: EngineBridge?
    private var server: LocalServer?

    init() {
        let defaults = UserDefaults.standard
        name = defaults.string(forKey: "server.name") ?? "내 아이폰 서버"
        let savedPort = defaults.integer(forKey: "server.port")
        port = savedPort == 0 ? 8787 : savedPort
        edition = defaults.string(forKey: "server.edition") ?? "vanilla"
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dataRoot = docs.appendingPathComponent("commander-data")
        store = DataStore(root: dataRoot)
    }

    var isRunning: Bool { status == .running }
    var isBusy: Bool { status == .starting }

    func append(_ line: String) {
        log.append(line)
        if log.count > 200 { log.removeFirst(log.count - 200) }
    }

    func start() async {
        guard status != .starting, status != .running else { return }
        status = .starting
        pluginsText = nil
        guard let engineURL = Bundle.main.url(forResource: "engine", withExtension: "js"),
              let engineSource = try? String(contentsOf: engineURL, encoding: .utf8) else {
            status = .failed("엔진 파일(engine.js)이 앱에 들어 있지 않다.")
            return
        }
        guard (1024...65535).contains(port) else { status = .failed("포트는 1024~65535 사이여야 한다."); return }
        let defaults = UserDefaults.standard
        defaults.set(name, forKey: "server.name")
        defaults.set(port, forKey: "server.port")
        defaults.set(edition, forKey: "server.edition")

        let bridge = EngineBridge()
        bridge.onFileOps = { [weak self] ops in
            guard let self else { return }
            for error in self.store.apply(ops) { self.append("[저장 오류] \(error)") }
        }
        bridge.onLog = { [weak self] level, text in self?.append(level == "log" ? text : "[\(level)] \(text)") }
        engineView = bridge.webView
        self.bridge = bridge

        do {
            let info = try await bridge.boot(
                engineSource: engineSource,
                files: store.loadAll(),
                name: name,
                edition: edition,
                version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
            )
            if info.woken > 0 { append("이어서 진행하는 방 \(info.woken)개") }
            pluginsText = info.pluginsJSON.flatMap(Self.describePlugins)
        } catch {
            teardown()
            status = .failed("엔진을 시작하지 못했다: \(error.localizedDescription)")
            return
        }

        let webRoot = Bundle.main.url(forResource: "web", withExtension: nil)
        if webRoot == nil { append("[주의] 웹 화면(web)이 앱에 들어 있지 않다. API만 열린다.") }
        let server = LocalServer(engine: bridge, webRoot: webRoot)
        let ips = NetworkInfo.ipv4Addresses()
        let txt = ["name": name, "ip": ips.joined(separator: ","), "port": String(port), "ed": edition, "proto": "1"]
        self.server = server
        let error: String? = await withCheckedContinuation { cont in
            server.start(port: UInt16(port), advertise: (name: name, txt: txt)) { cont.resume(returning: $0) }
        }
        if let error {
            teardown()
            status = .failed(error)
            return
        }
        addresses = ips.map { "http://\($0):\(port)" }
        status = .running
        UIApplication.shared.isIdleTimerDisabled = true
        append("서버를 켰다 (\(edition == "expert" ? "엑스퍼트" : "바닐라"))")
    }

    func stop() async {
        guard status == .running || status == .starting else { return }
        bridge?.flush()
        // 엔진이 보낸 저장 변경이 전달될 시간을 잠깐 준다.
        try? await Task.sleep(nanoseconds: 400_000_000)
        teardown()
        status = .stopped
        append("서버를 껐다")
    }

    private func teardown() {
        server?.stop()
        server = nil
        bridge = nil
        engineView = nil
        addresses = []
        UIApplication.shared.isIdleTimerDisabled = false
    }

    /// 앱이 백그라운드로 가기 직전: 저장을 서둘러 한다.
    func flushNow() { bridge?.flush() }

    private static func describePlugins(_ json: String) -> String? {
        guard let data = json.data(using: .utf8), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let accepted = (obj["accepted"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
        var lines = ["플러그인 \(accepted.count)개 적용" + (accepted.isEmpty ? "" : " (\(accepted.joined(separator: ", ")))")]
        for r in obj["rejected"] as? [[String: Any]] ?? [] { for e in r["errors"] as? [String] ?? [] { lines.append("거절: \(e)") } }
        for n in obj["notes"] as? [String] ?? [] { lines.append("주의: \(n)") }
        return lines.joined(separator: "\n")
    }
}
