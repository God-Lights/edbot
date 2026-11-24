import EdbotKit
import SwiftUI

/// 앱 색과 공통 스타일. 로고의 남색·보라에 롤토체스풍 "헥스텍" 금색 테두리를 더했다. (시안: docs/mockups/tft-prep.html)
enum Theme {
    static let bgTop = Color(red: 0.035, green: 0.051, blue: 0.118)
    static let bgBottom = Color(red: 0.020, green: 0.027, blue: 0.067)
    /// 헥스텍 금색: 패널 테두리, 주요 버튼
    static let gold = Color(red: 0.78, green: 0.67, blue: 0.43)
    static let goldHi = Color(red: 0.94, green: 0.85, blue: 0.63)
    /// 패널 바탕 (짙은 남색)
    static let panelTop = Color(red: 0.09, green: 0.13, blue: 0.25)
    static let panelBottom = Color(red: 0.055, green: 0.08, blue: 0.17)
    /// 판 칸: 내 쪽(남색)과 상대 쪽(보랏빛 남색)
    static let boardLight = Color(red: 0.165, green: 0.215, blue: 0.39)
    static let boardDark = Color(red: 0.106, green: 0.145, blue: 0.275)
    static let boardEnemyLight = Color(red: 0.23, green: 0.17, blue: 0.31)
    static let boardEnemyDark = Color(red: 0.165, green: 0.125, blue: 0.25)
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
            // 가운데(판 쪽)에 푸른 빛, 아래쪽에 옅은 보라 빛
            RadialGradient(colors: [Color(red: 0.11, green: 0.17, blue: 0.33).opacity(0.9), .clear], center: UnitPoint(x: 0.42, y: 0.5), startRadius: 10, endRadius: 650)
            RadialGradient(colors: [Theme.purple.opacity(0.18), .clear], center: .bottom, startRadius: 20, endRadius: 600)
        }
        .ignoresSafeArea()
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    /// 아이폰 가로처럼 세로가 낮은 화면에서는 버튼을 낮춘다.
    @Environment(\.verticalSizeClass) private var vSize

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(minHeight: vSize == .compact ? 36 : 48)
            .padding(.horizontal, vSize == .compact ? 14 : 22)
            // 헥스텍 금색 버튼, 글씨는 짙게
            .foregroundStyle(Color(red: 0.10, green: 0.07, blue: 0.02))
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(LinearGradient(colors: [Theme.goldHi, Theme.gold], startPoint: .top, endPoint: .bottom))
            )
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
            .shadow(color: Theme.gold.opacity(0.35), radius: 6)
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.verticalSizeClass) private var vSize

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.silver)
            .frame(minHeight: vSize == .compact ? 32 : 44)
            .padding(.horizontal, vSize == .compact ? 10 : 16)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.panelTop.opacity(0.9)))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.gold.opacity(0.35), lineWidth: 1))
            .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
    }
}

extension View {
    /// 헥스텍 패널: 짙은 남색 바탕에 가는 금색 테두리.
    func panel(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(LinearGradient(colors: [Theme.panelTop.opacity(0.88), Theme.panelBottom.opacity(0.88)], startPoint: .top, endPoint: .bottom)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.gold.opacity(0.45), lineWidth: 1))
    }
}

extension Array {
    /// 범위를 벗어나면 nil.
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

/// 켜진 시너지를 알약 모양으로 보여 준다. 누르면 가이드의 시너지 탭이 열린다.
struct SynergyChips: View {
    @Environment(AppModel.self) private var model
    let ids: [String]
    var emptyText: String? = nil

    var body: some View {
        if ids.isEmpty {
            if let emptyText { Text(emptyText).font(.caption2).foregroundStyle(.secondary) }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(ids, id: \.self) { id in
                    Button { model.openGuide(.synergy) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "link").font(.caption2)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(model.synergy(id)?.nameKo ?? id).font(.caption.bold())
                                if let description = model.synergy(id)?.description {
                                    Text(description).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }
                        }
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.accent.opacity(0.22)))
                        .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.6), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}


/// 유령 아이콘(SF Symbols에 없어서 직접 그린다). 글자 색(foregroundStyle)을 따라간다. 무한 모드에서 쓴다.
struct GhostShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
        var path = Path()
        path.move(to: p(4, 22))
        path.addLine(to: p(4, 10))
        path.addCurve(to: p(12, 2), control1: p(4, 5.6), control2: p(7.6, 2))
        path.addCurve(to: p(20, 10), control1: p(16.4, 2), control2: p(20, 5.6))
        path.addLine(to: p(20, 22))
        path.addLine(to: p(17, 19))
        path.addLine(to: p(14.5, 21.5))
        path.addLine(to: p(12, 19))
        path.addLine(to: p(9.5, 21.5))
        path.addLine(to: p(7, 19))
        path.closeSubpath()
        return path
    }
}

struct GhostGlyph: View {
    var body: some View {
        GeometryReader { geo in
            let s = min(geo.size.width, geo.size.height)
            ZStack {
                GhostShape().stroke(style: StrokeStyle(lineWidth: max(1.2, s / 12), lineJoin: .round))
                Circle().frame(width: s * 0.11, height: s * 0.11).position(x: s * 9 / 24, y: s * 10 / 24)
                Circle().frame(width: s * 0.11, height: s * 0.11).position(x: s * 15 / 24, y: s * 10 / 24)
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// 자원 칸의 결정: 희귀도 색의 빛나는 마름모 (판과 전투에서 같이 쓴다)
struct CrystalGem: View {
    let color: Color

    var body: some View {
        ZStack {
            Rectangle()
                .fill(LinearGradient(colors: [Color.white.opacity(0.95), color, color.opacity(0.55)], startPoint: .topLeading, endPoint: .bottomTrailing))
                .rotationEffect(.degrees(45))
                .scaleEffect(0.7)
            // 윗면 반사
            Rectangle()
                .fill(Color.white.opacity(0.35))
                .rotationEffect(.degrees(45))
                .scaleEffect(0.28)
                .offset(x: -1, y: -4)
        }
        .shadow(color: color.opacity(0.9), radius: 6)
        .aspectRatio(1, contentMode: .fit)
    }
}
