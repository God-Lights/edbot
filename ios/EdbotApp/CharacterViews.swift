import EdbotKit
import SwiftUI

/// 캐릭터 카드가 지금 어떤 상태인지.
enum CardState: Equatable {
    case normal
    case selected
    /// 밴되었다
    case banned
    /// 뽑혔다 (내 팀이면 true)
    case picked(mine: Bool)
}

/// 기물 글자를 담은 둥근 아이콘.
struct PieceBadge: View {
    let piece: Piece
    var size: CGFloat = 48

    var body: some View {
        ZStack {
            Circle().fill(Theme.color(for: piece).opacity(0.22))
            Circle().strokeBorder(Theme.color(for: piece).opacity(0.7), lineWidth: 1.5)
            Text(Labels.pieceGlyph(piece))
                .font(.system(size: size * 0.62))
                .foregroundStyle(Theme.color(for: piece))
        }
        .frame(width: size, height: size)
    }
}

/// 캐릭터 카드: 이름, 기물, 체력·공격·속도·사거리.
struct CharacterCard: View {
    let info: CharacterInfo
    var state: CardState = .normal

    var body: some View {
        VStack(spacing: 8) {
            PieceBadge(piece: info.piece, size: 52)
            Text(info.nameKo)
                .font(.subheadline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(Labels.pieceName(info.piece))
                .font(.caption2)
                .foregroundStyle(Theme.color(for: info.piece))
            HStack(spacing: 10) {
                stat("♥", "\(info.hp)")
                stat("⚔", "\(info.attack)")
            }
            Text("\(Labels.speed(info.speed)) · \(Labels.range(info.range))")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(background))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(border, lineWidth: state == .selected ? 3 : 1))
        .overlay(alignment: .topTrailing) { badge }
        .opacity(isDimmed ? 0.4 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var isDimmed: Bool {
        switch state {
        case .banned, .picked: return true
        default: return false
        }
    }

    private var background: Color {
        state == .selected ? Theme.accent.opacity(0.22) : Theme.panel
    }

    private var border: Color {
        switch state {
        case .selected: return Theme.accent
        case let .picked(mine): return mine ? Theme.mine : Theme.theirs
        case .banned: return Color.red.opacity(0.6)
        case .normal: return Color.white.opacity(0.1)
        }
    }

    @ViewBuilder private var badge: some View {
        switch state {
        case .banned:
            Text("밴").font(.caption2.bold()).padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill(Color.red.opacity(0.8))).padding(6)
        case let .picked(mine):
            Text(mine ? "내 팀" : "상대").font(.caption2.bold()).padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill((mine ? Theme.mine : Theme.theirs).opacity(0.85))).padding(6)
        default:
            EmptyView()
        }
    }

    private func stat(_ icon: String, _ value: String) -> some View {
        HStack(spacing: 3) {
            Text(icon).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.monospacedDigit().weight(.semibold))
        }
    }
}

/// 작은 캐릭터 칩: 팀 목록과 배치에서 쓴다.
struct CharacterChip: View {
    let info: CharacterInfo?
    var highlight: Color? = nil
    var selected = false

    var body: some View {
        HStack(spacing: 8) {
            if let info {
                PieceBadge(piece: info.piece, size: 34)
                VStack(alignment: .leading, spacing: 0) {
                    Text(info.nameKo).font(.subheadline.weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
                    Text(Labels.pieceName(info.piece)).font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                Text("?").font(.title3).frame(width: 34, height: 34)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .frame(minHeight: 52)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(selected ? Theme.accent.opacity(0.25) : Theme.panelStrong))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(selected ? Theme.accent : (highlight ?? Color.white.opacity(0.1)), lineWidth: selected ? 3 : 1.5)
        )
    }
}

/// 비어 있는 팀 칸.
struct EmptySlot: View {
    var label = "비어 있음"

    var body: some View {
        HStack {
            Text(label).font(.footnote).foregroundStyle(.secondary)
            Spacer()
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 52)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white.opacity(0.15), style: StrokeStyle(lineWidth: 1, dash: [5])))
    }
}

/// 단계 제목 줄: 제목, 안내 문구, 남은 시간.
struct PhaseHeader: View {
    @Environment(AppModel.self) private var model
    let title: String
    let subtitle: String
    /// 이 시각(서버 기준 ms)까지 남은 시간을 보여 준다.
    let endsAt: Int64?

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.title.bold())
                Text(subtitle).font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                let remaining = model.remainingMs(until: endsAt, now: context.date)
                Text(Labels.countdown(remaining))
                    .font(.system(size: 34, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundStyle((remaining ?? 99_000) <= 5_000 ? Theme.warn : Theme.silver)
                    .padding(.horizontal, 18).padding(.vertical, 8)
                    .background(Capsule().fill(Theme.panelStrong))
            }
        }
    }
}
