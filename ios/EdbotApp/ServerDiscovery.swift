import EdbotKit
import Foundation
import Network
import Observation

/// 같은 와이파이의 COMMANDER 로컬 서버를 찾는다. (Bonjour `_commander._tcp`, 서버가 TXT에 주소를 실어 보낸다)
@MainActor
@Observable
final class ServerDiscovery {
    private(set) var servers: [FoundServer] = []
    private var browser: NWBrowser?

    func start() {
        guard browser == nil else { return }
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: "_commander._tcp", domain: nil), using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            var found: [FoundServer] = []
            for result in results {
                guard case let .bonjour(record) = result.metadata else { continue }
                var txt: [String: String] = [:]
                for key in ["name", "ip", "port", "ed"] {
                    if case let .string(value)? = record.getEntry(for: key) { txt[key] = value }
                }
                var fallback = "서버"
                if case let .service(name, _, _, _) = result.endpoint { fallback = name }
                if let server = FoundServer(txt: txt, fallbackName: fallback) { found.append(server) }
            }
            let sorted = found.sorted { $0.name < $1.name }
            Task { @MainActor [weak self] in self?.servers = sorted }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
        servers = []
    }
}
