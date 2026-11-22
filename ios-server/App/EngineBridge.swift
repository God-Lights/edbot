import Foundation
import ServerKit
import WebKit

struct EngineResult {
    let status: Int
    let headers: [HTTPHeader]
    let body: Data
    /// WebSocket으로 올려야 하면 엔진이 정한 연결 번호
    let ws: Int?
}

struct BootInfo {
    let woken: Int
    /// 엑스퍼트일 때 적용된 팩 / 거절된 팩 (엔진이 돌려준 JSON 그대로)
    let pluginsJSON: String?
}

private struct FetchReply: Decodable {
    let status: Int
    let headers: [[String]]
    let body: String
    let ws: Int?
}

/// 웹뷰가 메시지 처리기를 강하게 붙들어서 생기는 순환을 끊는다.
@MainActor
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// 숨은 웹뷰 안에서 서버 엔진(engine.js)을 돌린다. 요청을 넘기고, 엔진이 알려 주는 일(파일 저장, 소켓 보내기)을 받는다.
@MainActor
final class EngineBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    private var loadContinuation: CheckedContinuation<Void, Error>?

    var onFileOps: (([FileOp]) -> Void)?
    /// (연결 번호, 보낼 내용, 바이너리인가)
    var onSocketSend: ((Int, Data, Bool) -> Void)?
    var onSocketClose: ((Int, UInt16, String) -> Void)?
    var onLog: ((String, String) -> Void)?

    override init() {
        let controller = WKUserContentController()
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        super.init()
        controller.add(WeakHandler(self), name: "host")
        webView.navigationDelegate = self
    }

    // ---- 시작 ----

    func boot(engineSource: String, files: [String: String], name: String, edition: String, version: String) async throws -> BootInfo {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            loadContinuation = cont
            // localhost 는 보안 컨텍스트라서 crypto 같은 기능이 막히지 않는다.
            webView.loadHTMLString("<!doctype html><meta charset=\"utf-8\"><body></body>", baseURL: URL(string: "http://localhost/"))
        }
        _ = try await webView.evaluateJavaScript(engineSource + "\n;0")
        let script = """
        window.__engine = CommanderEngine.start({
          host: { post: function (m) { window.webkit.messageHandlers.host.postMessage(m); } },
          files: files, name: name, edition: edition, version: version
        });
        return JSON.stringify({ woken: window.__engine.woken, plugins: window.__engine.plugins });
        """
        let raw = try await webView.callAsyncJavaScript(
            script,
            arguments: ["files": files, "name": name, "edition": edition, "version": version],
            in: nil,
            contentWorld: .page
        )
        var woken = 0
        var plugins: String?
        if let text = raw as? String, let data = text.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            woken = obj["woken"] as? Int ?? 0
            if let p = obj["plugins"], !(p is NSNull), let d = try? JSONSerialization.data(withJSONObject: p) { plugins = String(data: d, encoding: .utf8) }
        }
        return BootInfo(woken: woken, pluginsJSON: plugins)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadContinuation?.resume()
        loadContinuation = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadContinuation?.resume(throwing: error)
        loadContinuation = nil
    }

    // ---- 요청 ----

    func fetch(_ request: HTTPRequest) async -> EngineResult {
        let host = request.header("host") ?? "localhost"
        let req: [String: Any] = [
            "method": request.method,
            "url": "http://\(host)\(request.target)",
            "headers": request.headers.map { [$0.name, $0.value] },
            "body": request.body.isEmpty ? NSNull() : request.body.base64EncodedString(),
        ]
        do {
            let raw = try await webView.callAsyncJavaScript(
                "return JSON.stringify(await window.__engine.fetch(req));",
                arguments: ["req": req],
                in: nil,
                contentWorld: .page
            )
            guard let text = raw as? String, let data = text.data(using: .utf8) else { return Self.failure("엔진이 빈 응답을 돌려줬다") }
            let reply = try JSONDecoder().decode(FetchReply.self, from: data)
            let headers = reply.headers.compactMap { $0.count == 2 ? HTTPHeader($0[0], $0[1]) : nil }
            return EngineResult(status: reply.status, headers: headers, body: Data(base64Encoded: reply.body) ?? Data(), ws: reply.ws)
        } catch {
            return Self.failure("엔진 오류: \(error.localizedDescription)")
        }
    }

    private static func failure(_ message: String) -> EngineResult {
        EngineResult(status: 500, headers: [HTTPHeader("Content-Type", "application/json")], body: Data("{\"error\":\"internal_error\"}".utf8), ws: nil)
    }

    func socketMessage(id: Int, text: String) {
        webView.callAsyncJavaScript("window.__engine.wsMessage(id, data, false);", arguments: ["id": id, "data": text], in: nil, in: .page) { _ in }
    }

    func socketMessage(id: Int, binary: Data) {
        webView.callAsyncJavaScript("window.__engine.wsMessage(id, data, true);", arguments: ["id": id, "data": binary.base64EncodedString()], in: nil, in: .page) { _ in }
    }

    func socketClosed(id: Int, code: UInt16, reason: String) {
        webView.callAsyncJavaScript("window.__engine.wsClose(id, code, reason);", arguments: ["id": id, "code": Int(code), "reason": reason], in: nil, in: .page) { _ in }
    }

    /// 앱이 곧 멈출 때: 엔진이 모아 둔 저장을 지금 하게 한다.
    func flush() {
        webView.callAsyncJavaScript("if (window.__engine) window.__engine.flush();", arguments: [:], in: nil, in: .page) { _ in }
    }

    // ---- 엔진이 알리는 일 ----

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["t"] as? String else { return }
        switch type {
        case "fs":
            let ops = (body["ops"] as? [[String: Any]] ?? []).compactMap { FileOp(json: $0) }
            if !ops.isEmpty { onFileOps?(ops) }
        case "ws-send":
            guard let id = body["id"] as? Int, let data = body["data"] as? String else { return }
            if body["binary"] as? Bool == true {
                onSocketSend?(id, Data(base64Encoded: data) ?? Data(), true)
            } else {
                onSocketSend?(id, Data(data.utf8), false)
            }
        case "ws-close":
            guard let id = body["id"] as? Int else { return }
            onSocketClose?(id, UInt16(truncatingIfNeeded: body["code"] as? Int ?? 1000), body["reason"] as? String ?? "")
        case "log":
            onLog?(body["level"] as? String ?? "log", body["text"] as? String ?? "")
        default:
            break
        }
    }
}
