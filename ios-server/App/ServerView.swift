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
        }
        .background(alignment: .topLeading) {
            if let view = model.engineView {
                EngineHostView(webView: view).frame(width: 2, height: 2).opacity(0.01).allowsHitTesting(false)
            }
        }
    }

    private var header: some View {
        HStack {
            Image(systemName: "server.rack").font(.title)
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
                HStack(alignment: .center, spacing: 14) {
                    if let image = Self.qr(for: "commander://connect?url=\(Self.encode(address))&name=\(Self.encode(model.name))") {
                        Image(uiImage: image).interpolation(.none).resizable().frame(width: 120, height: 120).cornerRadius(8)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(address).font(.body.monospaced()).textSelection(.enabled)
                        Button("복사") { UIPasteboard.general.string = address }.buttonStyle(.bordered)
                    }
                }
            }
        }
        .panel()
    }

    private var hints: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("알아 두세요").font(.headline)
            Text("• 앱을 켜 둔 채로 두세요. 앱을 닫거나 백그라운드로 보내면 iOS가 서버를 멈춰요. (켜져 있는 동안 화면이 꺼지지 않게 해 둬요)")
            Text("• 이 기기에서 같이 하려면 화면 분할(Split View)로 COMMANDER 앱을 옆에 띄우고 주소에 http://localhost:\(model.port) 를 쓰세요.")
            Text("• 전적과 플러그인은 \"파일\" 앱 > 이 앱 > commander-data 에 있어요. 엑스퍼트의 plugins 폴더에 팩(JSON)을 넣고 서버를 다시 켜면 적용돼요.")
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
