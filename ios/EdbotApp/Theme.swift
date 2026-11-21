import EdbotKit
import SwiftUI

/// 앱 색과 공통 스타일. 색은 로고(남색, 보라, 갈색, 은색)에서 뽑았다. (design/make_assets.py 의 배경색과 같다)
enum Theme {
    static let bgTop = Color(red: 0.055, green: 0.047, blue: 0.149)
    static let bgBottom = Color(red: 0.031, green: 0.027, blue: 0.078)
    static let navy = Color(red: 0.063, green: 0.063, blue: 0.376)
    static let purple = Color(red: 0.565, green: 0.0, blue: 0.565)
    static let accent = Color(red: 0.69, green: 0.25, blue: 0.745)
    static let silver = Color(red: 0.82, green: 0.82, blue: 0.84)
    static let panel = Color.white.opacity(0.07)
    static let panelStrong = Color.white.opacity(0.12)
    /// 내 편과 상대 편을 구분하는 색.
    static let mine = Color(red: 0.38, green: 0.58, blue: 1.0)
    static let theirs = Color(red: 1.0, green: 0.46, blue: 0.40)
    static let good = Color(red: 0.42, green: 0.85, blue: 0.55)
    static let warn = Color(red: 1.0, green: 0.72, blue: 0.30)

    static func color(for piece: Piece) -> Color {
        switch piece {
        case .king: return Color(red: 0.95, green: 0.78, blue: 0.30)
        case .queen: return Color(red: 0.90, green: 0.38, blue: 0.85)
        case .rook: return Color(red: 0.88, green: 0.50, blue: 0.38)
        case .bishop: return Color(red: 0.35, green: 0.80, blue: 0.75)
        case .knight: return Color(red: 0.45, green: 0.70, blue: 1.0)
        case .pawn: return Color(red: 0.72, green: 0.72, blue: 0.78)
        }
    }
}

/// 화면 전체 배경: 짙은 남색 바탕에 한쪽에서 보라 빛이 번진다.
struct AppBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.bgTop, Theme.bgBottom], startPoint: .top, endPoint: .bottom)
            RadialGradient(colors: [Theme.purple.opacity(0.28), .clear], center: .topTrailing, startRadius: 20, endRadius: 700)
            RadialGradient(colors: [Theme.navy.opacity(0.55), .clear], center: .bottomLeading, startRadius: 20, endRadius: 800)
        }
        .ignoresSafeArea()
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(minHeight: 48)
            .padding(.horizontal, 22)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(LinearGradient(colors: [Theme.navy, Theme.purple], startPoint: .leading, endPoint: .trailing))
            )
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.silver)
            .frame(minHeight: 44)
            .padding(.horizontal, 16)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panelStrong))
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

extension View {
    /// 둥근 반투명 패널.
    func panel(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
    }
}
