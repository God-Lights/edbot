import EdbotKit
import SwiftUI

enum GuideTab: String, CaseIterable, Identifiable {
    case flow, scoring, map, characters, synergy, workshop, controls

    var id: String { rawValue }

    var title: String {
        switch self {
        case .flow: return "게임 흐름"
        case .scoring: return "승리와 점수"
        case .map: return "지도와 타워"
        case .characters: return "캐릭터"
        case .synergy: return "시너지"
        case .workshop: return "탐사·대장간"
        case .controls: return "조작"
        }
    }
}

/// 게임 가이드: 처음 하는 사람이 규칙을 이해하도록 단계, 점수, 지도, 캐릭터, 시너지, 탐사·대장간, 조작을 설명한다.
/// 캐릭터, 시너지, 무기는 서버가 알려 주는 데이터를 그대로 보여 주므로 서버가 바뀌어도 가이드가 어긋나지 않는다.
struct GuideView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        ZStack {
            AppBackground()
            VStack(spacing: 14) {
                HStack {
                    Text("게임 가이드").font(.title.bold())
                    Spacer()
                    Button("닫기") { model.showGuide = false }.buttonStyle(SecondaryButtonStyle())
                }
                tabBar
                ScrollView {
                    content
                        .frame(maxWidth: 900, alignment: .leading)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 24)
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(GuideTab.allCases) { tab in
                    Button { model.guideTab = tab } label: {
                        Text(tab.title)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .background(Capsule().fill(model.guideTab == tab ? Theme.accent.opacity(0.9) : Theme.panelStrong))
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch model.guideTab {
        case .flow: FlowGuide()
        case .scoring: ScoringGuide()
        case .map: MapGuide()
        case .characters: CharacterGuide()
        case .synergy: SynergyGuide()
        case .workshop: WorkshopGuide()
        case .controls: ControlsGuide()
        }
    }
}

// MARK: 공통 조각

private struct GuideCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).foregroundStyle(Theme.silver)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}

private func line(_ text: LocalizedStringKey) -> some View {
    HStack(alignment: .top, spacing: 8) {
        Text("•").foregroundStyle(Theme.accent)
        Text(text).fixedSize(horizontal: false, vertical: true)
    }
    .font(.callout)
}

private struct StepRow: View {
    let time: String
    let name: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(time)
                .font(.subheadline.bold().monospacedDigit())
                .frame(width: 70)
                .padding(.vertical, 6)
                .background(Capsule().fill(Theme.panelStrong))
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.headline)
                Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: 1. 게임 흐름

private struct FlowGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "한눈에 보기") {
                Text("COMMANDER는 둘이서 하는 실시간 전략 대전이에요. 캐릭터 12명 중 5명을 뽑아 세 갈래 길(레인)로 보내면, 캐릭터들이 알아서 싸우며 상대 본진의 타워를 부숴요. 직접 정하는 건 **누구를 뽑을지, 어느 길로 보낼지, 궁극기를 언제 쓸지**예요.")
                    .font(.callout)
            }
            GuideCard(title: "한 판의 순서 (약 4분)") {
                StepRow(time: "10초", name: "밴", text: "서로 모르게 캐릭터 1명씩 금지해요. 상대가 무엇을 밴했는지는 단계가 끝나야 보여요.")
                StepRow(time: "40초", name: "드래프트", text: "번갈아 5명씩 뽑아요(내 차례 4초). 선공이 먼저 1명, 그다음 후공이 2명, 이런 식으로 이어지는 스네이크 순서예요. 시간이 지나면 서버가 대신 뽑아 줘요.")
                StepRow(time: "20초", name: "배치", text: "내 캐릭터 5명을 세 레인 중 어디로 보낼지 정해요. 상대의 배치는 전투가 시작될 때까지 보이지 않아요. 정하지 않으면 기물별 기본 레인으로 가요.")
                StepRow(time: "20초", name: "탐사", text: "지도에서 재료를 모아요. 이후에도 계속할 수 있어요.")
                StepRow(time: "20초", name: "대장간", text: "재료로 무기를 만들어 캐릭터에게 끼워요. 이후에도 계속할 수 있어요.")
                StepRow(time: "2분", name: "전투", text: "자동으로 싸워요. 궁극기를 쓰고, 탐사와 대장간을 함께 다루며 점수를 모아요.")
                StepRow(time: "1분", name: "데스매치", text: "전투가 동점일 때만 이어지는 연장전이에요.")
                StepRow(time: "10초", name: "결과", text: "승패와 레이팅 변화를 보고 로비로 돌아가요.")
            }
            GuideCard(title: "처음이라면") {
                line("로비의 **테스트 대전**으로 봇과 한 판 해 보세요. 연습용이라 전적에 기록되지 않아요.")
                line("뽑는 중에도 지금까지 뽑은 캐릭터가 만드는 **시너지**가 화면에 나와요. 시너지 탭을 읽어 두면 좋아요.")
            }
        }
    }
}

// MARK: 2. 승리와 점수

private struct ScoringGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "점수") {
                line("**킹사이드** 레인의 메인 타워를 부수면 **+7점**")
                line("**퀸사이드·센터** 레인의 메인 타워(언더 타워)를 부수면 각각 **+5점**")
                line("상대 캐릭터를 쓰러뜨리면 **+1점** (5번 처치 = 언더 타워 하나)")
                line("가드 타워를 부수는 건 점수가 없어요. 대신 길이 열려요.")
                line("메인 타워로 얻을 수 있는 점수는 팀당 최대 17점(7+5+5)이에요.")
            }
            GuideCard(title: "이기는 방법") {
                line("한 팀의 **메인 타워 3개가 모두 무너지면** 바로 끝나요. 점수가 높은 팀이 이겨요.")
                line("2분이 지났을 때 **점수가 높은 팀**이 이겨요.")
                line("점수가 **같으면 데스매치**(60초)예요. 모두 센터에 모여 싸우고, 한 팀이 전멸하면 끝나요. 끝나지 않으면 남은 체력의 합이 높은 팀이, 그것도 같으면 먼저 처치한 팀이 이겨요.")
            }
            GuideCard(title: "쓰러지면") {
                line("쓰러진 캐릭터는 8초 뒤 본진에서 되살아나요. 폰은 3초 빨라요.")
                line("부서진 타워는 복구되지 않아요.")
            }
        }
    }
}

// MARK: 3. 지도와 타워

private struct MapGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "지도") {
                line("위에서 내려다본 지도예요. **내 본진은 항상 왼쪽 아래**, 적 본진은 오른쪽 위에 있어요.")
                line("길은 세 갈래예요: 위쪽 길(**퀸사이드**), 가운데 대각선(**센터**), 아래쪽 길(**킹사이드**).")
                line("캐릭터는 정해진 레인을 따라 적 쪽으로 걸어가고, 적과 만나면 싸워요. 레인 사이는 오갈 수 없어요. 나이트만 직접 옮겨 갈 수 있어요.")
            }
            GuideCard(title: "타워") {
                line("레인마다 팀당 **가드 타워 2개**와 **메인 타워 1개**가 줄지어 서 있어요. 바깥 가드 → 안쪽 가드 → 메인 순서로 부숴야 해요.")
                line("가드 타워 주변(점선 고리)은 **아군에게 회복 구간**, **적에게 피해 구간이자 장애물**이에요. 가드 타워를 부수기 전에는 그 레인을 지나갈 수 없어요.")
                line("그래서 한 레인에 인원을 모아야 뚫을 수 있어요. 수비하는 쪽은 회복 구간에서 싸우니까 유리해요.")
            }
            GuideCard(title: "타워 스킬") {
                line("가드 타워는 **화염 화살**(가장 가까운 적에게 불화살, 화상)을 쏴요.")
                line("메인 타워는 **대포**를 쏴요. 느리게 날아가서 움직이는 캐릭터는 피하기 쉬워요.")
                line("킹사이드 메인 타워는 체력이 절반 아래로 내려가면 범위 안의 모든 적에게 **일제 사격**을 한 번 해요.")
            }
        }
    }
}

// MARK: 4. 캐릭터

private struct CharacterGuide: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "기물과 탐사 특성") {
                Text("캐릭터는 체스 기물 6종으로 나뉘어요. 기물마다 탐사에서 팀에 주는 보너스가 달라요. (같은 기물이 둘이면 보너스도 둘, 그리고 시너지가 켜져요)")
                    .font(.callout).foregroundStyle(.secondary)
                traitRow(.king, "10초마다 탈런트 +1")
                traitRow(.queen, "정찰할 때 안개 칸 1개를 더 확인")
                traitRow(.rook, "돌·광석을 채집할 때 +1")
                traitRow(.bishop, "나뭇가지를 채집할 때 +1")
                traitRow(.knight, "매복으로 빼앗는 양 +1")
                traitRow(.pawn, "없음 (대신 부활 3초 단축, 타워를 부수면 승급)")
            }
            if model.roster.isEmpty {
                Text("캐릭터 데이터를 불러오는 중...").foregroundStyle(.secondary)
            }
            ForEach(model.roster) { info in
                characterCard(info)
            }
        }
    }

    private func traitRow(_ piece: Piece, _ text: String) -> some View {
        HStack(spacing: 10) {
            PieceBadge(piece: piece, size: 30)
            Text(Labels.pieceName(piece)).font(.subheadline.bold()).frame(width: 52, alignment: .leading)
            Text(text).font(.callout)
        }
    }

    private func characterCard(_ info: CharacterInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                PieceBadge(piece: info.piece, size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(info.nameKo).font(.title3.bold())
                    Text("\(Labels.pieceName(info.piece)) · 체력 \(info.hp) · 공격 \(info.attack) · \(Labels.speed(info.speed)) · \(Labels.range(info.range))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            skillLine("패시브", info.passive ?? "없음", color: Theme.good)
            skillLine("스킬", info.skill ?? "자동 스킬이 없어요 (궁극기와 레인 이동 중심)", color: Theme.mine)
            skillLine("궁극기", info.ultimate ?? "-", color: Theme.accent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func skillLine(_ title: String, _ text: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(title).font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 3)
                .background(Capsule().fill(color.opacity(0.3))).frame(width: 60)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: 5. 시너지

private struct SynergyGuide: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "시너지란?") {
                Text("뽑은 5명의 구성이 조건을 채우면 **팀 전체**가 보너스를 받아요. 전투가 시작될 때 정해지고 판이 끝날 때까지 유지돼요. 여러 시너지가 동시에 켜지면 효과가 모두 더해져요. 드래프트 화면의 팀 칸에 지금 켜진 시너지가 나와요.")
                    .font(.callout)
            }
            if model.synergies.isEmpty {
                Text("시너지 데이터를 불러오는 중...").foregroundStyle(.secondary)
            }
            ForEach(model.synergies) { synergy in
                HStack(alignment: .top, spacing: 12) {
                    Text("🔗").font(.title2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(synergy.nameKo).font(.headline)
                        Text("조건: " + synergy.requirement).font(.callout).foregroundStyle(Theme.warn)
                        Text(synergy.description).font(.callout)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .panel()
            }
        }
    }
}

// MARK: 6. 탐사와 대장간

private struct WorkshopGuide: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "탐사: 재료 모으기") {
                line("4×4 지도에서 칸을 눌러 **채집**(3초), **매복**(10초), **정찰**을 해요. 행동마다 행동 게이지 1칸을 쓰고, 게이지는 최대 3칸에 12초마다 1칸씩 차요.")
                line("채집한 칸은 25초 뒤에 다시 자원이 생겨요. 보물상자는 한 번만 열 수 있고, 희귀 재료나 무기 설계도가 나오지만 가끔 함정(탈런트 손실)이에요.")
                line("안개 칸은 **정찰**하면 정체와 상대의 매복이 보여요.")
            }
            GuideCard(title: "칸이 겹칠 때") {
                line("둘이 같은 칸을 동시에 채집하면 **반씩 나눠 가져요.**")
                line("내가 채집하는데 상대가 그 칸에 **매복**해 있었다면, 채집이 끝나는 순간 **매복한 쪽이 자원을 가져가요.**")
                line("둘 다 같은 칸에 매복하면 서로 사라져요.")
            }
            GuideCard(title: "대장간: 무기 만들기") {
                line("**상점**에서 탈런트로 광석을 사고, **재련**(광석 1 + 탈런트 2 + 스팀포스 3, 15초)으로 철괴를 만들어요. 재련대는 2개예요.")
                line("재료를 합쳐 무기를 **조합**하고, 캐릭터에게 **장착**해요(3초, 캐릭터당 1개). 전투 중에는 본진이나 아군 가드 타워 근처에 있는 캐릭터에게만 끼울 수 있어요.")
                line("무기는 공격력을 올려 줘요. 보물상자의 설계도로 특수 무기(화상, 둔화, 흡혈)도 만들 수 있어요.")
                line("**상성:** 중량이 장병을, 장병이 원거리를, 원거리가 중량을 이겨요. 유리하면 피해가 20% 늘고 불리하면 15% 줄어요. 상대 무기는 맞붙기 전까지 보이지 않아요.")
            }
            GuideCard(title: "자원") {
                line("탈런트(화폐): 판 시작 15, 10초마다 +2, 처치하면 +2")
                line("스팀포스: 시간이 지나면 저절로 차요(최대 10, 초당 0.5). 재련과 궁극기가 같이 써서, 한꺼번에 쓰면 정작 궁극기가 필요할 때 비어 있어요.")
                line("나뭇가지 3과 돌 3으로 시작해서 첫 무기는 바로 만들 수 있어요. 모든 자원과 무기는 판이 끝나면 사라져요.")
            }
            if !model.weapons.isEmpty {
                GuideCard(title: "무기 목록") {
                    ForEach(model.weapons) { weapon in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(weapon.nameKo)  (\(Labels.weaponKind(weapon.kind)), 공격 +\(Int((weapon.atkBonus * 100).rounded()))%)").font(.subheadline.bold())
                                Text(weapon.recipe.sorted { $0.key < $1.key }.map { "\(Labels.materialName($0.key)) \($0.value)" }.joined(separator: ", "))
                                    .font(.caption).foregroundStyle(.secondary)
                                if let effect = weapon.effectText { Text("★ " + effect).font(.caption).foregroundStyle(Theme.warn) }
                            }
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
    }
}

// MARK: 7. 조작

private struct ControlsGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "전투 중에 할 수 있는 것") {
                line("**궁극기:** 아래 캐릭터 카드의 버튼을 눌러요. 스팀포스 5가 들고, 한 번 쓰면 40초 뒤에 다시 쓸 수 있어요. 상대의 스팀포스는 보이지 않아요.")
                line("**안키오의 궁극기:** 순간이동할 레인을 골라요. 그 레인의 적 가드 타워 뒤로 가서 타워의 스킬을 3초 막아요.")
                line("**나이트의 레인 이동:** 12초마다 한 번 다른 레인으로 옮겨 갈 수 있어요. 새 레인의 적 타워는 넘지 못해요.")
                line("**탐사·대장간:** 위쪽의 버튼으로 패널을 열어요. 열어 둔 동안에도 전투는 멈추지 않아요.")
            }
            GuideCard(title: "화면 읽기") {
                line("파란색이 우리 편, 붉은색이 상대예요. 동그라미 안의 글자(♚♛♜♝♞♟)는 기물이에요.")
                line("체력 막대가 짧아지면 노란색이 돼요. 쓰러진 캐릭터는 카드에 부활까지 남은 시간이 나와요.")
                line("캐릭터 옆의 ⚔는 무기를 끼고 있다는 표시예요.")
            }
            GuideCard(title: "팁") {
                line("한 레인에 몰아서 싸우는 편이 흩어지는 것보다 타워를 뚫기 쉬워요.")
                line("킹사이드 메인 타워는 7점이라 가장 비싸지만 일제 사격이 있어요.")
                line("시너지와 기물별 탐사 특성을 함께 보고 5명을 고르세요.")
            }
        }
    }
}
