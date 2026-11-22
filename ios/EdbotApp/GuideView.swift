import EdbotKit
import SwiftUI

enum GuideTab: String, CaseIterable, Identifiable {
    case flow, prep, combat, characters, synergy, resources, recipes, controls

    var id: String { rawValue }

    var title: String {
        switch self {
        case .flow: return "게임 흐름"
        case .prep: return "상점과 배치"
        case .combat: return "전투 규칙"
        case .characters: return "캐릭터"
        case .synergy: return "시너지"
        case .resources: return "자원과 무기"
        case .recipes: return "조합 도감"
        case .controls: return "조작"
        }
    }
}

/// 게임 가이드: 체스판 자동 전투의 흐름, 상점·경제, 전투 규칙, 캐릭터, 시너지, 조작을 설명한다.
/// 캐릭터와 시너지는 서버가 알려 주는 데이터(GET /api/chess)를 그대로 보여 주므로 서버가 바뀌어도 가이드가 어긋나지 않는다.
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
        case .prep: PrepGuide()
        case .combat: CombatGuide()
        case .characters: CharacterGuide()
        case .synergy: SynergyGuide()
        case .resources: ResourceGuide()
        case .recipes: RecipeGuide()
        case .controls: ControlsGuide()
        }
    }
}

// MARK: 공통 조각

struct GuideCard<Content: View>: View {
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

func guideLine(_ text: LocalizedStringKey) -> some View {
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
                .frame(width: 84)
                .padding(.vertical, 6)
                .background(Capsule().fill(Theme.panelStrong))
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.headline)
                Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: 탭

private struct FlowGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "한눈에 보기") {
                guideLine("상점에서 캐릭터를 사서 체스판에 놓으면, 기물들이 **체스 규칙**으로 알아서 싸워요.")
                guideLine("상대의 체력(30)을 먼저 0으로 만들면 이겨요. 직접 조작하는 건 **준비 단계**뿐이에요.")
                guideLine("한 판은 최대 8라운드, 약 7분이에요.")
            }
            GuideCard(title: "한 라운드의 순서") {
                StepRow(time: "준비 25초", name: "사고, 놓고, 팔기", text: "상점 5칸에서 캐릭터를 사서 판에 올려요. 첫 라운드는 40초예요. 둘 다 '준비 끝'을 누르면 바로 전투로 가요.")
                StepRow(time: "전투 약 30초", name: "자동 전투", text: "기물들이 알아서 싸워요. 지켜보기만 하면 돼요. 항복은 언제든 가능해요.")
                StepRow(time: "결과 5초", name: "체력 깎기", text: "진 쪽은 '상대의 살아남은 기물 수 × 2 + 라운드 번호'만큼 체력을 잃어요.")
            }
            GuideCard(title: "이기는 방법") {
                guideLine("상대의 체력을 0으로 만들면 즉시 승리해요.")
                guideLine("8라운드가 끝날 때까지 안 끝나면 **체력이 더 많은 쪽**이 이겨요. 같으면 라운드 승수로 정해요.")
                guideLine("항복하면 바로 패배하고, 연결이 30초 넘게 끊겨도 패배해요.")
            }
            GuideCard(title: "연습 대전") {
                guideLine("로비의 **연습 대전**은 봇과 한 판이에요. 상점에 1~2골드의 쉬운 캐릭터 11명만 나와서 배울 게 적어요. 규칙을 익히기에 좋아요.")
                guideLine("연습 대전은 랭킹에 반영되지 않아요.")
            }
            GuideCard(title: "처음이라면") {
                guideLine("1라운드는 가장 마음에 드는 캐릭터 몇 명을 사서 **판에 올리는 것**만 해 보세요.")
                guideLine("같은 캐릭터 3장을 모으면 ★2가 돼서 훨씬 강해져요.")
                guideLine("골드를 10 모을 때마다 다음 라운드에 이자 +1을 받아요. (최대 +3)")
                guideLine("같은 기물(킹, 퀸, 룩...)을 여러 종류 모으면 팀 전체가 보너스를 받는 **시너지**가 켜져요.")
            }
        }
    }
}

private struct PrepGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "상점") {
                guideLine("상점은 5칸이고, 칸을 누르면 바로 사요. 산 캐릭터는 **대기석**(6칸)에 들어가요.")
                guideLine("새로고침은 2골드예요. (리치몬드가 판에 있으면 1골드)")
                guideLine("1~2라운드에는 1~2골드 캐릭터 위주로 나오고, 6라운드부터 3~4골드도 나와요. 상점 아래에 지금 등장 확률이 적혀 있어요.")
                guideLine("캐릭터는 **둘이 나눠 쓰는 공용 풀**에서 나와요. 상대가 많이 사 가면 그만큼 구하기 어려워요.")
            }
            GuideCard(title: "골드") {
                guideLine("처음 5골드. 라운드가 시작될 때마다 **기본 5골드 + 이자**를 받아요.")
                guideLine("이자: 가진 골드 10마다 +1, 최대 +3. 아껴서 이자를 받을지, 지금 써서 강해질지 고르는 게 핵심이에요.")
                guideLine("기물을 팔면 산 값을 돌려받아요. ★2는 3장 값이에요.")
            }
            GuideCard(title: "판 위에 놓기") {
                guideLine("기물을 **끌어다 판의 칸에 놓거나**, 기물을 누른 뒤 **판의 칸**을 눌러도 돼요. 이미 기물이 있는 칸이면 서로 자리를 바꿔요.")
                guideLine("**자동 배치** 버튼을 누르면 대기석의 기물이 알아서 놓여요. (단단한 기물은 앞줄, 약한 기물은 뒷줄)")
                guideLine("판에 올릴 수 있는 수는 1라운드 3기, 이후 라운드마다 +1, 최대 7기예요.")
                guideLine("판은 내 쪽 4줄이에요. **위쪽이 앞줄**이라 상대와 가까워요. 단단한 기물은 앞줄에, 약한 기물은 뒷줄에 두세요.")
                guideLine("판 위의 기물을 선택한 채 빈 대기석을 누르면 내려와요.")
            }
            GuideCard(title: "★2 합치기") {
                guideLine("같은 캐릭터 3장을 사면 자동으로 ★2 하나로 합쳐져요. 체력과 공격이 약 1.8배, 능력도 강해져요.")
                guideLine("판 위에 이미 있던 기물이 있으면 ★2는 그 자리에 생겨요.")
                guideLine("대기석이 가득 차도 합쳐지는 캐릭터는 살 수 있어요.")
            }
        }
    }
}

private struct CombatGuide: View {
    private struct Row: Identifiable {
        let id: Piece
        let move: String
        let attack: String
    }

    private let rows: [Row] = [
        Row(id: .king, move: "8방향 1칸", attack: "인접한 8칸"),
        Row(id: .queen, move: "직선·대각선 최대 3칸", attack: "직선·대각선 최대 4칸"),
        Row(id: .rook, move: "직선 최대 3칸", attack: "직선 최대 4칸"),
        Row(id: .bishop, move: "대각선 최대 3칸", attack: "대각선 최대 4칸"),
        Row(id: .knight, move: "L자 점프 (막혀도 넘어요)", attack: "L자 위치"),
        Row(id: .pawn, move: "앞으로 1칸 (항상 전진)", attack: "바로 앞과 앞쪽 대각선"),
    ]

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "기물의 움직임과 공격") {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: 10) {
                        PieceBadge(piece: row.id, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Labels.pieceName(row.id)).font(.subheadline.bold()).foregroundStyle(Theme.color(for: row.id))
                            Text("이동: \(row.move)").font(.callout)
                            Text("공격: \(row.attack)").font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            GuideCard(title: "전투는 이렇게 흘러가요") {
                guideLine("1초가 한 박자예요. 박자마다 모든 기물이 **동시에** 한 번씩 행동해요.")
                guideLine("공격할 수 있는 적이 있으면 공격해요. 체력이 가장 낮은 적을 먼저, 같으면 가까운 적을 쳐요.")
                guideLine("칠 수 있는 적이 없으면 가장 가까운 적 쪽으로 움직여요.")
                guideLine("공격은 '잡기'가 아니라 **피해**예요. 기물마다 체력이 있어요.")
                guideLine("룩·비숍·퀸은 사이에 다른 기물이 있으면 그 너머를 칠 수 없어요.")
            }
            GuideCard(title: "에너지와 능력") {
                guideLine("공격하거나 맞으면 **에너지**가 차요. 가득 차면 캐릭터의 능력이 자동으로 나가요.")
                guideLine("일부 캐릭터는 쓰러질 때나 처치할 때 발동하는 패시브 능력이에요.")
            }
            GuideCard(title: "특별 규칙") {
                guideLine("**폰 승급**: 폰이 상대 쪽 끝줄에 닿으면 그 전투 동안 퀸이 돼요.")
                guideLine("**돌발 사망**: 20초가 지나도 안 끝나면 모든 기물이 점점 커지는 피해를 받아서 반드시 끝나요.")
                guideLine("전투는 서버가 미리 계산하고 화면은 그걸 재생해요. 같은 배치는 언제나 같은 결과예요.")
            }
        }
    }
}

private struct CharacterGuide: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "캐릭터 20명") {
                guideLine("가격이 비쌀수록 체력과 공격이 높고 능력이 강해요. 능력치는 ★1 기준이에요.")
                guideLine("캐릭터마다 기물이 정해져 있어서, 기물에 따라 움직임과 시너지가 달라요.")
            }
            if model.chessUnits.isEmpty {
                ProgressView("불러오는 중...").frame(maxWidth: .infinity).panel()
            } else {
                ForEach(1...4, id: \.self) { cost in
                    GuideCard(title: "\(cost)골드") {
                        ForEach(model.chessUnits.filter { $0.cost == cost }) { info in
                            unitRow(info)
                        }
                    }
                }
            }
        }
    }

    private func unitRow(_ info: ChessUnitInfo) -> some View {
        HStack(alignment: .top, spacing: 12) {
            PieceBadge(piece: info.piece, size: 46)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(info.nameKo).font(.subheadline.bold())
                    Text("\(Labels.pieceName(info.piece)) · \(info.faction) · \(info.role)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("♥ \(info.hp)   ⚔ \(info.atk)").font(.caption.monospacedDigit())
                Text((info.passive ? "패시브: " : "능력: ") + info.abilityText)
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct SynergyGuide: View {
    @Environment(AppModel.self) private var model
    private let pieces: [Piece] = [.king, .queen, .rook, .bishop, .knight, .pawn]

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "시너지란?") {
                guideLine("**판 위에** 같은 기물의 캐릭터가 2명 모이면 팀 전체가 보너스를 받아요. (폰은 2명, 4명)")
                guideLine("3명(폰은 4명)이 모이면 효과가 약 2배예요.")
                guideLine("같은 캐릭터는 몇 장이든 한 명으로 세요. 서로 다른 캐릭터를 모아야 해요.")
            }
            if model.chessSynergies.isEmpty {
                ProgressView("불러오는 중...").frame(maxWidth: .infinity).panel()
            } else {
                ForEach(pieces, id: \.self) { piece in
                    GuideCard(title: Labels.pieceName(piece)) {
                        ForEach(model.chessSynergies.filter { $0.piece == piece }) { info in
                            HStack(alignment: .top, spacing: 8) {
                                Text(info.nameKo).font(.subheadline.bold()).frame(width: 90, alignment: .leading)
                                Text(info.text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// 조합 도감: 조합 규칙과 재료 조합표(서버가 알려 주는 데이터)
private struct RecipeGuide: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "조합이란?") {
                guideLine("재료와 무기를 **서로 합쳐서** 새로운 재료나 무기를 만들어요. 합친 둘은 사라지고, 재련처럼 기다리지 않고 **바로** 결과가 나와요.")
                guideLine("아이템을 **다른 아이템 위로 끌어다 놓으면** 합쳐져요. 끌기 어려우면 **조합** 버튼을 켜고 두 아이템을 차례로 눌러도 돼요.")
            }
            GuideCard(title: "무기 조합") {
                guideLine("**같은 무기 둘 → ★2 무기**: 효과가 1.5배예요. (예: 클로우스톤 도끼 + 클로우스톤 도끼)")
                guideLine("**다른 무기 둘 → 융합 무기**: 두 무기의 효과를 **각각 75%씩** 모두 가져요. (예: 클로우스톤 도끼 + 에드뮴 블레이드)")
                guideLine("**무기 + 그 무기의 원재료 → ★2 무기**: 재료를 재련하지 않고 바로 무기에 보태요.")
                guideLine("★2 무기와 융합 무기는 더 합칠 수 없어요. 기물에는 무기를 하나만 낄 수 있어요.")
            }
            GuideCard(title: "재료 조합") {
                guideLine("**같은 희귀도의 서로 다른 재료 둘 → 한 단계 위 희귀도의 재료**예요. 흔함 → 보통 → 희귀 → 전설. (전설끼리는 합칠 수 없어요)")
                guideLine("시장에서 못 사는 전설 재료도 조합으로 만들 수 있어요. 어떤 재료가 나오는지는 아래 조합표를 보세요.")
            }
            if model.chessFusions.isEmpty {
                ProgressView("불러오는 중...").frame(maxWidth: .infinity).panel()
            } else {
                ForEach(["common", "uncommon", "rare"], id: \.self) { rarity in
                    GuideCard(title: title(rarity)) {
                        ForEach(rows(rarity), id: \.self) { row in
                            Text(row).font(.callout.bold())
                        }
                    }
                }
            }
        }
    }

    private func title(_ rarity: String) -> String {
        switch rarity {
        case "common": return "흔함 + 흔함 → 보통"
        case "uncommon": return "보통 + 보통 → 희귀"
        default: return "희귀 + 희귀 → 전설"
        }
    }

    private func rows(_ rarity: String) -> [String] {
        model.chessFusions
            .filter { model.chessMaterial($0.a)?.rarity == rarity }
            .map { "\(model.chessMaterial($0.a)?.nameKo ?? $0.a) + \(model.chessMaterial($0.b)?.nameKo ?? $0.b) → ◆ \(model.chessMaterial($0.result)?.nameKo ?? $0.result)" }
    }
}

private struct ResourceGuide: View {
    @Environment(AppModel.self) private var model
    private let rarities: [String] = ["common", "uncommon", "rare", "legendary"]

    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "자원 시스템이란?") {
                guideLine("**전체 대전**(그리고 사람끼리의 방)에서만 있어요. 연습 대전에는 없어요.")
                guideLine("재료를 모아 **재련대**에서 **무기**로 만들고, 기물에 끼워서 강하게 만들어요. 무기는 기물 하나에 하나만 낄 수 있어요.")
            }
            GuideCard(title: "재료를 얻는 법") {
                guideLine("**자원 칸(◆)**: 라운드마다 판에 4칸이 나와요. 내 쪽 2칸, 거울로 상대 쪽 2칸이고 재료도 같아요. 기물이 칸 위에 서 있거나 걸어서 도착하면 재료를 얻고 칸은 사라져요. 같은 순간에 둘이 도착하면 둘 다 얻어요.")
                guideLine("**광물 시장**: 라운드마다 1~2종이 나와요. 한 라운드에 한 개만 살 수 있어요. 흔함 3골드, 보통 5골드, 희귀 8골드예요. 전설은 팔지 않아요.")
                guideLine("전투가 끝난 뒤에 캔 재료를 받아요. 에드코인 슬링과 비트코인 대검은 골드도 줘요.")
            }
            GuideCard(title: "재련대와 무기 끼기") {
                guideLine("재료를 누르면 재련대에 들어가요. **재련대는 2칸**이고, 다음 라운드가 시작될 때 같은 이름의 무기로 완성돼요.")
                guideLine("무기를 누른 뒤 기물(대기석이나 판 위)을 누르면 껴요. 번개 방패 표시가 있는 기물이 무기를 낀 기물이에요.")
                guideLine("기물을 팔거나 ★2로 합칠 때 무기는 보관함으로 돌아와요. 선택한 기물 정보에서 **무기 빼기**도 할 수 있어요.")
                guideLine("재료와 무기는 서로 **조합**할 수도 있어요. (조합 도감 탭)")
            }
            if model.chessMaterials.isEmpty {
                ProgressView("불러오는 중...").frame(maxWidth: .infinity).panel()
            } else {
                ForEach(rarities, id: \.self) { rarity in
                    GuideCard(title: "\(Labels.rarityName(rarity)) 재료와 무기") {
                        ForEach(model.chessMaterials.filter { $0.rarity == rarity }) { material in
                            let weapon = model.chessWeapon(material.weaponId)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Image(systemName: "diamond.fill").foregroundStyle(ChessStyle.rarityColor(rarity))
                                    Text("\(material.nameKo) → \(weapon?.nameKo ?? "")").font(.subheadline.bold())
                                    if let price = material.price { Text("시장 \(price)골드").font(.caption).foregroundStyle(.secondary) }
                                }
                                Text(weapon?.text ?? "").font(.callout).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct ControlsGuide: View {
    var body: some View {
        VStack(spacing: 14) {
            GuideCard(title: "준비 단계 조작") {
                guideLine("**상점 칸 누르기**: 캐릭터를 사요. (골드가 부족하면 흐리게 보여요)")
                guideLine("**기물 끌어다 놓기** 또는 **기물 누르기 → 판의 칸 누르기**: 그 칸에 놓아요. 기물이 있는 칸이면 자리를 바꿔요.")
                guideLine("**자동 배치**: 대기석의 기물을 알아서 판에 놓아 줘요.")
                guideLine("기물을 상점 아래 **'여기로 끌어서 팔기'** 칸에 끌어 놓으면 팔아요. 판 위의 기물을 대기석으로 끌어 내릴 수도 있어요.")
                guideLine("기물을 누르면 오른쪽에 능력치와 **판매**, **대기석으로** 버튼이 나와요.")
                guideLine("**준비 끝**: 둘 다 누르면 기다리지 않고 바로 전투가 시작돼요.")
            }
            GuideCard(title: "화면 읽기") {
                guideLine("파란색이 우리 편, 붉은색이 상대예요. 내 쪽은 언제나 판의 아래예요.")
                guideLine("기물 테두리 색은 가격이에요. 회색 1골드, 초록 2골드, 파랑 3골드, 금색 4골드. ★은 별 등급이에요.")
                guideLine("전투 중 기물 아래의 막대는 체력이에요. 흰 선은 보호막이에요.")
                guideLine("전투 중 선은 이번 박자의 공격(흰색)과 능력(보라색)이에요.")
            }
            GuideCard(title: "자원 조작") {
                guideLine("**시장 카드 누르기**: 재료를 사요. **재료 누르기**: 재련대에 넣어요. **무기 누른 뒤 기물 누르기**: 무기를 껴요.")
                guideLine("판 위의 ◆는 이번 라운드 자원 칸이에요. 기물을 올려 두거나 그쪽으로 걸어가게 하면 얻어요.")
            }
            GuideCard(title: "항복") {
                guideLine("화면 위의 **항복** 버튼은 준비 중에도, 전투 중에도 눌러요. 누르면 바로 패배해요.")
            }
            GuideCard(title: "팁") {
                guideLine("앞줄에는 체력이 높은 기물(룩, 폰 탱커)을, 뒷줄에는 회복이나 강화 능력의 기물을 두세요.")
                guideLine("내가 판 캐릭터는 공용 풀로 돌아가서 상대도 살 수 있어요.")
                guideLine("지난 라운드 결과는 준비 화면 위쪽에 한 줄로 나와요.")
            }
        }
    }
}
