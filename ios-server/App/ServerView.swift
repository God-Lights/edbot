import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit
import WebKit

/// 엔진 웹뷰를 화면에 붙여 둔다. (보이지 않을 만큼 작게. 화면에 붙어 있어야 웹뷰 타이머가 제때 돈다)
struct EngineHostView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct ServerView: View {
    @Environment(ServerModel.self) private var model
    /// 이 기기에서 게임을 연다 (서버 앱 안의 웹 화면). 앱을 바꾸면 iOS 가 서버를 멈추므로, 같은 앱 안에서 한다.
    @State private var playing = false
    private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                settings(model: $model)
                controls
                if model.isRunning { addressList }
                if let plugins = model.pluginsText { Text(plugins).font(.footnote).foregroundStyle(.secondary).panel() }
                hints
                logView
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(alignment: .topLeading) {
            if let view = model.engineView {
                EngineHostView(webView: view).frame(width: 2, height: 2).opacity(0.01).allowsHitTesting(false)
            }
        }
        // 게임 화면은 같은 화면 위에 덮는다 (fullScreenCover 는 아래 화면을 창에서 떼어 엔진 웹뷰의 타이머가 늦어질 수 있다)
        .overlay {
            if playing {
                GamePlayView(url: URL(string: "http://127.0.0.1:\(model.port)/")!) { playing = false }
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: playing)
        .onChange(of: model.isRunning) { _, running in if !running { playing = false } }
    }

    private var header: some View {
        HStack {
            Image(systemName: isPhone ? "iphone.gen3.radiowaves.left.and.right" : "server.rack").font(.title)
            VStack(alignment: .leading) {
                Text("COMMANDER 서버").font(.title2.bold())
                Text(statusText).font(.subheadline).foregroundStyle(statusColor)
            }
            Spacer()
        }
    }

    private var statusText: String {
        switch model.status {
        case .stopped: return "꺼져 있어요"
        case .starting: return "켜는 중..."
        case .running: return "켜져 있어요"
        case let .failed(message): return message
        }
    }

    private var statusColor: Color {
        switch model.status {
        case .running: return .green
        case .failed: return .red
        default: return .secondary
        }
    }

    private func settings(model: Bindable<ServerModel>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("설정").font(.headline)
            TextField("서버 이름", text: model.name).textFieldStyle(.roundedBorder).disabled(self.model.isRunning || self.model.isBusy)
            HStack {
                Text("포트")
                TextField("8787", value: model.port, format: .number.grouping(.never))
                    .keyboardType(.numberPad).textFieldStyle(.roundedBorder).frame(width: 100)
                    .disabled(self.model.isRunning || self.model.isBusy)
            }
            Picker("에디션", selection: model.edition) {
                Text("바닐라").tag("vanilla")
                Text("엑스퍼트 (플러그인)").tag("expert")
            }
            .pickerStyle(.segmented)
            .disabled(self.model.isRunning || self.model.isBusy)
        }
        .panel()
    }

    private var controls: some View {
        Button {
            Task { if model.isRunning { await model.stop() } else { await model.start() } }
        } label: {
            Label(model.isRunning ? "서버 끄기" : "서버 켜기", systemImage: model.isRunning ? "stop.fill" : "play.fill")
                .frame(maxWidth: .infinity).padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .tint(model.isRunning ? .red : .accentColor)
        .disabled(model.isBusy)
    }

    private var addressList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("접속 방법").font(.headline)
            Text("같은 와이파이의 기기에서 COMMANDER 앱 서버 목록에 뜨거나, 아래 QR을 카메라로 찍으세요.").font(.footnote).foregroundStyle(.secondary)
            if model.addresses.isEmpty {
                Text("와이파이 주소를 찾지 못했어요. 와이파이에 연결해 주세요.").foregroundStyle(.orange)
            }
            ForEach(model.addresses, id: \.self) { address in
                // 좁은 화면(아이폰 세로)에서는 QR 아래에 주소
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 14) { qrImage(address, size: 120); addressInfo(address) }
                    VStack(alignment: .center, spacing: 10) { qrImage(address, size: 180); addressInfo(address) }.frame(maxWidth: .infinity)
                }
            }
            Button {
                playing = true
            } label: {
                Label("이 기기에서 하기", systemImage: "gamecontroller.fill").frame(maxWidth: .infinity).padding(.vertical, 4)
            }
            .buttonStyle(.bordered)
            Text("서버 앱 안에서 게임 화면을 열어요. 다른 앱으로 넘어가면 서버가 멈추니까, 이 기기에서 같이 할 때는 이 단추로 하세요.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .panel()
    }

    @ViewBuilder private func qrImage(_ address: String, size: CGFloat) -> some View {
        if let image = Self.qr(for: "commander://connect?url=\(Self.encode(address))&name=\(Self.encode(model.name))") {
            Image(uiImage: image).interpolation(.none).resizable().frame(width: size, height: size).cornerRadius(8)
        }
    }

    private func addressInfo(_ address: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(address).font(.body.monospaced()).textSelection(.enabled).lineLimit(1).minimumScaleFactor(0.7)
            Button("복사") { UIPasteboard.general.string = address }.buttonStyle(.bordered)
        }
    }

    private var hints: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("알아 두세요").font(.headline)
            Text("• 이 앱을 화면에 켜 둔 채로 두세요. 다른 앱으로 가거나 홈으로 나가면 iOS가 서버를 멈춰요. (켜져 있는 동안 화면이 꺼지지 않게 해 둬요)")
            if isPhone {
                Text("• 이 아이폰에서 같이 하려면 위의 \"이 기기에서 하기\"를 누르세요. 친구들은 같은 와이파이(또는 이 아이폰의 개인용 핫스팟)에서 QR로 접속해요.")
                Text("• 오래 켜 두면 배터리를 많이 써요. 충전기에 꽂아 두세요.")
            } else {
                Text("• 이 기기에서 같이 하려면 \"이 기기에서 하기\"를 누르거나, 화면 분할(Split View)로 COMMANDER 앱을 옆에 띄우고 주소에 http://localhost:\(model.port) 를 쓰세요.")
            }
            Text("• 전적과 팩은 \"파일\" 앱 > 이 앱 > commander-data 에 있어요. 엑스퍼트의 plugins 폴더에 팩(.json 또는 팩 폴더)을 넣고 서버를 다시 켜면 적용돼요.")
        }
        .font(.footnote).foregroundStyle(.secondary).panel()
    }

    private var logView: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("기록").font(.headline)
            if model.log.isEmpty { Text("아직 없어요").font(.footnote).foregroundStyle(.secondary) }
            ForEach(Array(model.log.suffix(30).enumerated()), id: \.offset) { _, line in
                Text(line).font(.caption.monospaced()).foregroundStyle(.secondary)
            }
        }
        .panel()
    }

    private static func encode(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: ":/?&=+#"))) ?? text
    }

    private static func qr(for text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        let context = CIContext()
        guard let cg = context.createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

private extension View {
    func panel() -> some View {
        padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(.secondarySystemBackground)))
    }
}

/// 서버 앱 안에서 여는 게임 화면 (이 기기에서 하기). 서버가 같은 앱이라 계속 돈다.
struct GamePlayView: View {
    let url: URL
    let close: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            GameWebView(url: url)
            Button(action: close) {
                Label("서버", systemImage: "chevron.left")
                    .font(.caption.bold())
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Capsule().fill(.black.opacity(0.55)))
            }
            .padding(.leading, 8).padding(.top, 2)
            .accessibilityLabel("서버 화면으로")
        }
        .preferredColorScheme(.dark)
    }
}

struct GameWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        /// 이 서버(127.0.0.1)와 GL 로그인(officialgl.com)은 안에서, 나머지 링크는 Safari 로
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { decisionHandler(.cancel); return }
            let host = url.host?.lowercased() ?? ""
            if scheme == "about" || ((scheme == "http" || scheme == "https") && (host == "127.0.0.1" || host == "localhost" || host == "officialgl.com" || host.hasSuffix(".officialgl.com"))) {
                decisionHandler(.allow)
                return
            }
            if scheme == "http" || scheme == "https" { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }

        /// target=_blank 링크는 같은 화면에서
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if action.targetFrame == nil { webView.load(action.request) }
            return nil
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
            if let top = Self.top() { top.present(alert, animated: true) } else { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
            if let top = Self.top() { top.present(alert, animated: true) } else { completionHandler() }
        }

        private static func top() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            var top = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
            while let presented = top?.presentedViewController { top = presented }
            return top
        }
    }
}
