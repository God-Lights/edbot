import EdbotKit
import SwiftUI

/// 드래프트: 스네이크 순서로 번갈아 뽑는다. 내 차례에 시간 안에 뽑지 않으면 서버가 대신 뽑는다.
struct DraftView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let game: GameSnapshot
    let seat: Int

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    private var myTurn: Bool { game.turnSeat == seat }

    var body: some View {
        VStack(spacing: 14) {
            HStack(alignment: .top) {
                PhaseHeader(
                    title: "드래프트",
                    subtitle: myTurn ? "내 차례! 캐릭터를 뽑으세요" : "상대 차례예요...",
                    endsAt: game.turnEndsAt
                )
            }
            orderStrip

            HStack(alignment: .top, spacing: 16) {
                team("내 팀", picks: game.picks[seat], color: Theme.mine, synergies: game.synergies?[safe: seat] ?? [])
                    .frame(width: 210)

                ScrollView {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(model.roster) { info in
                            CharacterCard(info: info, state: cardState(info.id))
                                .onTapGesture {
                                    guard myTurn, !game.isUnavailable(info.id) else { return }
                                    model.selectedCharacterId = info.id
                                }
                        }
                    }
                    .padding(2)
                }
                .overlay(alignment: .bottom) { confirmBar }

                team("상대 팀", picks: game.picks[1 - seat], color: Theme.theirs, synergies: game.synergies?[safe: 1 - seat] ?? [])
                    .frame(width: 210)
            }
        }
    }

    private func cardState(_ id: String) -> CardState {
        if game.picks[seat].contains(id) { return .picked(mine: true) }
        if game.picks[1 - seat].contains(id) { return .picked(mine: false) }
        if game.bans.contains(where: { $0.characterId == id }) { return .banned }
        return model.selectedCharacterId == id ? .selected : .normal
    }

    /// 뽑는 순서 10칸. 지난 차례는 채워지고 지금 차례는 반짝인다.
    private var orderStrip: some View {
        HStack(spacing: 8) {
            ForEach(Array(game.pickOrder.enumerated()), id: \.offset) { index, owner in
                let done = index < game.pickCount
                let current = index == game.pickCount
                let color = owner == seat ? Theme.mine : Theme.theirs
                ZStack {
                    Circle().fill(done ? color : color.opacity(0.15))
                    Circle().strokeBorder(current ? Color.white : color.opacity(0.6), lineWidth: current ? 3 : 1)
                    Text(owner == seat ? "나" : "상대").font(.system(size: 11, weight: .bold)).foregroundStyle(done ? .black : color)
                }
                .frame(width: 40, height: 40)
            }
            Spacer()
            Text(game.firstPicker == seat ? "내가 선공" : "내가 후공").font(.callout).foregroundStyle(.secondary)
        }
    }

    private func team(_ title: String, picks: [String], color: Color, synergies: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(title) (\(picks.count)/5)").font(.headline).foregroundStyle(color)
            ForEach(0..<5, id: \.self) { index in
                if index < picks.count {
                    CharacterChip(info: model.character(picks[index]), highlight: color)
                } else {
                    EmptySlot()
                }
            }
            SynergyChips(ids: synergies, emptyText: "시너지 없음")
            Spacer(minLength: 0)
        }
        .panel(padding: 12)
    }

    @ViewBuilder private var confirmBar: some View {
        if myTurn, let id = model.selectedCharacterId, let info = model.character(id) {
            HStack {
                Text("\(info.nameKo) 을(를) 뽑을까요?").font(.headline)
                Spacer()
                Button("뽑기") { model.pick(id) }.buttonStyle(PrimaryButtonStyle())
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.ultraThinMaterial))
            .padding(.bottom, 4)
        }
    }
}
