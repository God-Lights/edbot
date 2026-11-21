import EdbotKit
import SwiftUI

/// 밴 단계: 캐릭터 1명을 금지한다. 한 번 정하면 바꿀 수 없고, 상대가 무엇을 밴했는지는 단계가 끝나야 보인다.
struct BanView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let game: GameSnapshot
    let seat: Int

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        let mine = game.bans[seat]
        let theirs = game.bans[1 - seat]

        VStack(spacing: 16) {
            PhaseHeader(title: "밴", subtitle: mine.locked ? "상대가 고르는 중이에요" : "금지할 캐릭터 1명을 고르세요. 한 번 정하면 바꿀 수 없어요.", endsAt: room.phaseEndsAt)

            HStack(alignment: .top, spacing: 16) {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(model.roster) { info in
                            let chosen = mine.characterId == info.id
                            CharacterCard(info: info, state: chosen ? .banned : (model.selectedCharacterId == info.id ? .selected : .normal))
                                .onTapGesture {
                                    guard !mine.locked else { return }
                                    model.selectedCharacterId = info.id
                                }
                        }
                    }
                    .padding(2)
                }

                VStack(alignment: .leading, spacing: 14) {
                    status("내 밴", mine)
                    status("상대 밴", theirs)
                    Spacer()
                    if mine.locked {
                        Label("밴을 정했어요", systemImage: "checkmark.seal.fill").foregroundStyle(Theme.good)
                    } else if let id = model.selectedCharacterId, let info = model.character(id) {
                        Text("\(info.nameKo) 을(를) 밴할까요?").font(.callout)
                        Button("밴하기") { model.ban(id) }.buttonStyle(PrimaryButtonStyle())
                    } else {
                        Text("캐릭터를 눌러서 고르세요").font(.callout).foregroundStyle(.secondary)
                    }
                }
                .panel()
                .frame(width: 300)
            }
        }
    }

    @ViewBuilder private func status(_ title: String, _ ban: BanSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            if let id = ban.characterId {
                CharacterChip(info: model.character(id), highlight: Color.red.opacity(0.6))
            } else if ban.locked {
                EmptySlot(label: "정했어요 (공개 전)")
            } else {
                EmptySlot(label: "고르는 중...")
            }
        }
    }
}
