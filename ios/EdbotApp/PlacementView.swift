import EdbotKit
import SwiftUI

/// 배치: 내 캐릭터 5명을 세 레인으로 보낸다. 끌어다 놓거나, 캐릭터를 누르고 레인을 누른다.
/// 확정하기 전에는 다시 바꿀 수 있고, 정하지 않은 캐릭터는 기본 레인으로 간다. 상대의 배치는 전투가 시작될 때까지 보이지 않는다.
struct PlacementView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let game: GameSnapshot
    let seat: Int

    private var locked: Bool { game.placementLocked[seat] }
    private var opponentLocked: Bool { game.placementLocked[1 - seat] }

    var body: some View {
        VStack(spacing: 14) {
            PhaseHeader(
                title: "배치",
                subtitle: locked ? "배치를 확정했어요" : "캐릭터를 레인으로 끌어다 놓으세요. 정하지 않으면 기본 레인으로 가요.",
                endsAt: room.phaseEndsAt
            )

            HStack(alignment: .top, spacing: 12) {
                ForEach(Lane.allCases, id: \.self) { lane in
                    laneColumn(lane)
                }
            }

            unplacedTray

            HStack {
                Label(opponentLocked ? "상대가 확정했어요" : "상대가 배치하는 중...", systemImage: opponentLocked ? "checkmark.circle.fill" : "hourglass")
                    .foregroundStyle(opponentLocked ? Theme.good : .secondary)
                Spacer()
                Button(locked ? "확정 완료" : "배치 확정") { model.lockPlacement() }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(locked)
            }
        }
    }

    private func placed(in lane: Lane) -> [String] {
        game.picks[seat].filter { game.lane(seat: seat, characterId: $0) == lane }
    }

    private func laneColumn(_ lane: Lane) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(Labels.laneName(lane)).font(.headline)
                Spacer()
                if lane == .kingside { Text("+7점").font(.caption.bold()).foregroundStyle(Theme.warn) }
            }
            ForEach(placed(in: lane), id: \.self) { id in
                chip(id)
            }
            if placed(in: lane).isEmpty {
                EmptySlot(label: "여기에 놓기")
            }
            Spacer(minLength: 0)
        }
        .panel(padding: 12)
        .frame(maxWidth: .infinity, minHeight: 230, alignment: .top)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(model.selectedPlacementId != nil && !locked ? Theme.accent.opacity(0.8) : Color.clear, style: StrokeStyle(lineWidth: 2, dash: [6]))
        )
        .contentShape(Rectangle())
        .onTapGesture { dropSelection(on: lane) }
        .dropDestination(for: String.self) { items, _ in
            guard !locked, let id = items.first, game.picks[seat].contains(id) else { return false }
            model.place(id, lane: lane)
            return true
        }
    }

    private func dropSelection(on lane: Lane) {
        guard !locked, let id = model.selectedPlacementId else { return }
        model.place(id, lane: lane)
        model.selectedPlacementId = nil
    }

    private func chip(_ id: String) -> some View {
        CharacterChip(info: model.character(id), highlight: Theme.mine, selected: model.selectedPlacementId == id)
            .onTapGesture {
                guard !locked else { return }
                model.selectedPlacementId = model.selectedPlacementId == id ? nil : id
            }
            .draggable(id)
    }

    /// 아직 레인을 정하지 않은 캐릭터. 확정하면 기본 레인으로 간다.
    @ViewBuilder private var unplacedTray: some View {
        let waiting = game.picks[seat].filter { game.lane(seat: seat, characterId: $0) == nil }
        if !waiting.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("아직 정하지 않았어요 (기본 레인으로 가요)").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    ForEach(waiting, id: \.self) { id in
                        chip(id).frame(maxWidth: 200)
                    }
                    Spacer(minLength: 0)
                }
            }
            .panel(padding: 12)
        }
    }
}
