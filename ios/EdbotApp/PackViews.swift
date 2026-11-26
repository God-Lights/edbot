import EdbotKit
import SwiftUI

/// 팩 종류 표시 (종합 / 리소스 / 플러그인)
struct PackKindBadge: View {
    let pack: PackDetail

    private var color: Color {
        switch pack.kind {
        case "bundle": return Theme.gold
        case "resource": return Theme.accent
        default: return Theme.good
        }
    }

    var body: some View {
        Text(pack.kindName)
            .font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.3)))
            .overlay(Capsule().strokeBorder(color.opacity(0.7), lineWidth: 1))
    }
}

/// 팩이 바꾼 것을 줄로 (새 캐릭터, 바뀐 캐릭터, 재료, 무기, 규칙, 화면·소리)
func packSummaryLines(_ pack: PackDetail) -> [String] {
    var lines: [String] = []
    if let s = pack.summary {
        if !s.units.isEmpty { lines.append("새 캐릭터: " + s.units.joined(separator: ", ")) }
        if !s.overrides.isEmpty { lines.append("바뀐 캐릭터: " + s.overrides.joined(separator: ", ")) }
        if !s.materials.isEmpty { lines.append("새 재료: " + s.materials.joined(separator: ", ")) }
        if !s.weapons.isEmpty { lines.append("새 무기: " + s.weapons.joined(separator: ", ")) }
        if !s.rules.isEmpty { lines.append("바뀐 규칙: " + s.rules.map(PackDetail.ruleName).joined(separator: ", ")) }
    }
    if let r = pack.resourceLine { lines.append("화면·소리: " + r) }
    return lines
}

/// 로비의 팩 목록: 이 서버에 들어 있는 팩과 각각 무엇을 바꾸는지
struct PacksView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 14) {
                HStack {
                    Text("이 서버의 팩").font(.title.bold())
                    Spacer()
                    Button("닫기") { model.showPacks = false }.buttonStyle(SecondaryButtonStyle())
                }
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(model.packs) { pack in row(pack) }
                        if model.packs.contains(where: { $0.resources != nil }) {
                            Text("iPad 앱은 아직 팩의 색·그림·소리를 적용하지 않아요. 웹과 안드로이드 앱에서는 바뀐 화면으로 보여요.")
                                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }
                    }
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 24)
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private func row(_ pack: PackDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                PackKindBadge(pack: pack)
                Text(pack.name).font(.headline)
                Text("v\(pack.version)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                if pack.guide?.isEmpty == false {
                    Button("설명서") { model.openPackGuide(pack.id) }.buttonStyle(SecondaryButtonStyle())
                }
            }
            if let author = pack.author { Text("만든 사람: \(author)").font(.caption).foregroundStyle(.secondary) }
            if let d = pack.description { Text(d).font(.callout).fixedSize(horizontal: false, vertical: true) }
            ForEach(packSummaryLines(pack), id: \.self) { line in
                Text(line).font(.caption).foregroundStyle(Theme.silver).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

/// 가이드의 팩 탭: 팩마다 바꾼 것과 팩이 쓴 설명서
struct PackGuide: View {
    @Environment(AppModel.self) private var model

    /// 목록에서 고른 팩을 맨 위로
    private var ordered: [PackDetail] {
        guard let first = model.guidePack else { return model.packs }
        return model.packs.filter { $0.id == first } + model.packs.filter { $0.id != first }
    }

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "이 서버의 팩") {
                guideLine("이 서버는 **팩**으로 캐릭터·규칙(플러그인)이나 화면·소리(리소스)를 바꿨어요. 둘 다 바꾸는 팩은 **종합** 팩이에요.")
                guideLine("아래 내용은 이 서버에서만 적용돼요. 다른 서버에서는 원래 규칙으로 해요.")
            }
            ForEach(ordered) { pack in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        PackKindBadge(pack: pack)
                        Text("\(pack.name) v\(pack.version)").font(.headline).foregroundStyle(Theme.silver)
                    }
                    if let d = pack.description { Text(d).font(.callout).fixedSize(horizontal: false, vertical: true) }
                    ForEach(packSummaryLines(pack), id: \.self) { line in
                        Text("• " + line).font(.callout).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(Array((pack.guide ?? []).enumerated()), id: \.offset) { _, section in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(section.title).font(.subheadline.bold()).foregroundStyle(Theme.goldHi)
                            Text(section.body).font(.callout).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .panel()
            }
        }
    }
}
