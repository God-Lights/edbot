import EdbotKit
import SwiftUI

// 체스판 자동 전투 화면: 준비(상점·배치)와 전투(재생). 설계: docs/DESIGN-autochess.md

private let chessStartHp = 30

enum ChessStyle {
    /// 가격별 테두리 색
    static func costColor(_ cost: Int) -> Color {
        switch cost {
        case 1: return Color(white: 0.72)
        case 2: return Theme.good
        case 3: return Theme.mine
        default: return Color(red: 0.95, green: 0.78, blue: 0.30)
        }
    }

    static func starText(_ star: Int) -> String { star >= 2 ? "★★" : "★" }

    /// 팔 때 돌려받는 골드: ★1은 산 값, ★2는 3장 값
    static func sellValue(cost: Int, star: Int) -> Int { cost * (star >= 2 ? 3 : 1) }
}

private extension View {
    /// 첫 판 안내에서 지금 눌러야 할 곳을 노란 테두리로 알려 준다.
    func coachHighlight(_ on: Bool) -> some View {
        overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Theme.warn, lineWidth: on ? 3 : 0)
                .allowsHitTesting(false)
        )
    }
}

/// 기물 하나: 기물 글자, 이름, 별. tint가 있으면 그 색 테두리(전투에서 팀 색).
struct ChessToken: View {
    @Environment(AppModel.self) private var model
    let defId: String
    let star: Int
    var selected: Bool = false
    var tint: Color? = nil

    var body: some View {
        let info = model.chessUnit(defId)
        let piece: Piece = info?.piece ?? .pawn
        let border: Color = selected ? Color.white : (tint ?? ChessStyle.costColor(info?.cost ?? 1))
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: side * 0.2, style: .continuous)
                    .fill(Theme.color(for: piece).opacity(0.28))
                RoundedRectangle(cornerRadius: side * 0.2, style: .continuous)
                    .strokeBorder(border, lineWidth: selected ? 3 : 2)
                VStack(spacing: 0) {
                    Image(Labels.pieceImageName(piece))
                        .resizable()
                        .scaledToFit()
                        .frame(width: side * 0.5, height: side * 0.5)
                        .foregroundStyle(Theme.color(for: piece))
                    Text(info?.nameKo ?? defId)
                        .font(.system(size: max(8, side * 0.16), weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                }
                Text(ChessStyle.starText(star))
                    .font(.system(size: max(8, side * 0.15)))
                    .foregroundStyle(Color(red: 0.95, green: 0.78, blue: 0.30))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(3)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// 체력 알약: 이름과 체력 막대.
private struct HpPill: View {
    let name: String
    let hp: Int
    let color: Color

    var body: some View {
        let ratio: Double = min(1, max(0, Double(hp) / Double(chessStartHp)))
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name).font(.caption.bold()).lineLimit(1)
                Spacer()
                Text("♥ \(max(0, hp))").font(.caption.monospacedDigit().bold())
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.12))
                    Capsule().fill(color).frame(width: geo.size.width * ratio)
                }
            }
            .frame(height: 6)
        }
        .frame(width: 170)
    }
}

/// 준비와 전투 화면 위쪽: 라운드, 남은 시간, 두 사람의 체력, 항복.
struct ChessHeader: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let chess: ChessSnapshot
    let seat: Int
    @State private var confirmSurrender = false

    var body: some View {
        let mine: String = room.players.first { $0.seat == seat }?.name ?? "나"
        let theirs: String = room.players.first { $0.seat != seat }?.name ?? "상대"
        VStack(spacing: 6) {
            HStack(spacing: 18) {
                HpPill(name: mine, hp: chess.me?.hp ?? 0, color: Theme.mine)
                VStack(spacing: 2) {
                    Text("라운드 \(chess.round) / \(chess.maxRounds)").font(.headline)
                    TimelineView(.periodic(from: .now, by: 0.5)) { context in
                        Text("\(Labels.phaseName(room.phase)) \(Labels.countdown(model.remainingMs(now: context.date)))")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(minWidth: 130)
                HpPill(name: theirs, hp: chess.opponent?.hp ?? 0, color: Theme.theirs)
                Spacer()
                Button { confirmSurrender = true } label: { Label("항복", systemImage: "flag") }
                    .buttonStyle(SecondaryButtonStyle())
            }
            if room.phase == .prep, let last = chess.lastRound {
                Text(lastRoundText(last)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .panel(padding: 10)
        .confirmationDialog("항복할까요?", isPresented: $confirmSurrender, titleVisibility: .visible) {
            Button("항복", role: .destructive) { model.surrender() }
            Button("취소", role: .cancel) {}
        } message: {
            Text("바로 패배해요.")
        }
    }

    private func lastRoundText(_ last: ChessRoundSummary) -> String {
        let outcome: String
        if let winner = last.winner { outcome = winner == seat ? "승리" : "패배" } else { outcome = "무승부" }
        let mine: Int = last.damage[safe: seat] ?? 0
        let theirs: Int = last.damage[safe: 1 - seat] ?? 0
        return "지난 라운드 \(last.round): \(outcome) · 내 체력 -\(mine), 상대 체력 -\(theirs)"
    }
}

// MARK: 준비 단계

struct ChessPrepView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let chess: ChessSnapshot
    let seat: Int
    /// 첫 판 안내를 닫았는가. 한 번 닫으면 다시 안 나온다.
    @AppStorage("chessCoachDismissed") private var coachDismissed = false
    /// 2라운드 팁을 봤는가.
    @AppStorage("chessCoachTipSeen") private var tipSeen = false
    @State private var confirmEmptyDone = false

    var body: some View {
        if let me = chess.me {
            VStack(spacing: 10) {
                ChessHeader(room: room, chess: chess, seat: seat)
                if !coachDismissed && chess.round == 1 {
                    coachCard(me)
                } else if !tipSeen && chess.round == 2 {
                    tipCard
                }
                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 8) {
                        boardLabels(me)
                        boardView(me)
                        benchView(me)
                        Spacer(minLength: 0)
                    }
                    sidePanel(me)
                        .frame(width: 340)
                }
            }
        } else {
            ProgressView()
        }
    }

    /// 지금 해야 할 일. 내가 가진 기물과 골드를 보고 단계를 고른다.
    private func coachStep(_ me: ChessSelfSnapshot) -> (n: Int, text: String) {
        let benchCount: Int = me.bench.compactMap { $0 }.count
        if me.board.isEmpty && benchCount == 0 {
            return (1, "오른쪽 상점에서 마음에 드는 캐릭터를 눌러 사 보세요.")
        }
        if me.board.isEmpty {
            return (2, "산 기물을 판에 놓아요. 끌어다 놓거나, 기물을 누르고 칸을 눌러도 돼요. '자동 배치' 버튼도 있어요.")
        }
        if me.board.count < chess.deployCap && (benchCount > 0 || me.gold >= 1) {
            return (3, "이번 라운드는 \(chess.deployCap)기까지 올릴 수 있어요. 골드가 남으면 더 사서 놓아 보세요.")
        }
        return (4, "준비 끝! '준비 끝'을 누르면 전투가 시작돼요. 전투는 알아서 진행되고, 항복은 언제든 위에서 할 수 있어요.")
    }

    /// 처음 하는 사람을 위한 단계별 안내. 1라운드 준비 단계에만 나온다.
    private func coachCard(_ me: ChessSelfSnapshot) -> some View {
        let step = coachStep(me)
        return HStack(alignment: .center, spacing: 14) {
            HStack(spacing: 5) {
                ForEach(1...4, id: \.self) { n in
                    Circle().fill(n <= step.n ? Theme.warn : Color.white.opacity(0.2)).frame(width: 9, height: 9)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("처음이시네요! \(step.n) / 4").font(.caption.bold()).foregroundStyle(Theme.warn)
                Text(step.text).font(.subheadline)
            }
            Spacer()
            Button("가이드") { model.openGuide(.prep) }.buttonStyle(SecondaryButtonStyle())
            Button("건너뛰기") { coachDismissed = true }.buttonStyle(SecondaryButtonStyle())
        }
        .panel(padding: 10)
    }

    /// 첫 전투가 끝난 뒤 2라운드에서 한 번만 보이는 팁.
    private var tipCard: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("다음 단계 팁").font(.caption.bold()).foregroundStyle(Theme.warn)
                Text("① 골드 10마다 이자 +1 (최대 +3)  ② 같은 캐릭터 3장 = ★2, 훨씬 강해져요  ③ 같은 기물(킹·룩·비숍·폰...)을 2명 이상 올리면 시너지 보너스")
                    .font(.subheadline)
            }
            Spacer()
            Button("가이드") { model.openGuide(.synergy) }.buttonStyle(SecondaryButtonStyle())
            Button("알겠어요") { tipSeen = true }.buttonStyle(SecondaryButtonStyle())
        }
        .panel(padding: 10)
    }

    private func boardLabels(_ me: ChessSelfSnapshot) -> some View {
        HStack {
            Text("판 \(me.board.count) / \(chess.deployCap)").font(.subheadline.bold())
            Text("(위쪽이 앞줄, 상대와 가까워요)").font(.caption).foregroundStyle(.secondary)
            if chess.lite == true { Text("입문 모드").font(.caption2.bold()).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(Theme.good.opacity(0.25))) }
            Spacer()
            if me.bench.contains(where: { $0 != nil }) && me.board.count < chess.deployCap {
                Button { model.chessAutoPlace(me, cap: chess.deployCap) } label: { Label("자동 배치", systemImage: "wand.and.stars") }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(me.done)
            }
            if let opponent = chess.opponent {
                Text("상대 \(opponent.boardCount)기 배치 · \(opponent.done ? "준비 끝" : "준비 중")")
                    .font(.caption)
                    .foregroundStyle(opponent.done ? Theme.good : Color.secondary)
            }
        }
    }

    private func boardView(_ me: ChessSelfSnapshot) -> some View {
        VStack(spacing: 2) {
            ForEach(0..<chessDeployRows, id: \.self) { row in
                HStack(spacing: 2) {
                    ForEach(0..<chessBoardSize, id: \.self) { col in
                        boardCell(me, col: col, row: row)
                    }
                }
            }
        }
        .aspectRatio(2, contentMode: .fit)
        .coachHighlight(showCoach && coachStep(me).n == 2)
    }

    private func boardCell(_ me: ChessSelfSnapshot, col: Int, row: Int) -> some View {
        let unit: ChessUnitView? = me.board.first { $0.col == col && $0.row == row }
        let dark: Bool = (col + row) % 2 == 1
        return ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.white.opacity(dark ? 0.12 : 0.06))
            if let unit {
                ChessToken(defId: unit.defId, star: unit.star, selected: model.selectedUid == unit.uid)
                    .padding(2)
                    .draggable(unit.uid)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Rectangle())
        .onTapGesture { tapCell(me, col: col, row: row, occupant: unit) }
        .dropDestination(for: String.self) { items, _ in
            guard let uid = items.first, !me.done else { return false }
            model.chessDeploy(uid, col: col, row: row)
            return true
        }
    }

    private func tapCell(_ me: ChessSelfSnapshot, col: Int, row: Int, occupant: ChessUnitView?) {
        if let selected = model.selectedUid {
            if occupant?.uid == selected {
                model.selectedUid = nil
            } else {
                model.chessDeploy(selected, col: col, row: row)
            }
        } else if let occupant {
            model.selectedUid = occupant.uid
        }
    }

    private func benchView(_ me: ChessSelfSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("대기석").font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                ForEach(me.bench.indices, id: \.self) { slot in
                    benchSlot(me, slot: slot)
                }
            }
        }
    }

    private func benchSlot(_ me: ChessSelfSnapshot, slot: Int) -> some View {
        let unit: ChessUnitView? = me.bench[slot]
        return ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.08))
            if let unit {
                ChessToken(defId: unit.defId, star: unit.star, selected: model.selectedUid == unit.uid)
                    .padding(2)
                    .draggable(unit.uid)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Rectangle())
        .onTapGesture { tapBench(me, unit: unit) }
        .dropDestination(for: String.self) { items, _ in
            // 판 위의 기물을 대기석으로 끌어 내린다.
            guard let uid = items.first, me.board.contains(where: { $0.uid == uid }), !me.done else { return false }
            model.chessBench(uid)
            return true
        }
    }

    private func tapBench(_ me: ChessSelfSnapshot, unit: ChessUnitView?) {
        guard let selected = model.selectedUid else {
            if let unit { model.selectedUid = unit.uid }
            return
        }
        if let unit {
            model.selectedUid = unit.uid == selected ? nil : unit.uid
        } else if me.board.contains(where: { $0.uid == selected }) {
            model.chessBench(selected) // 판 위의 기물을 빈 대기석으로 내린다
        }
    }

    // MARK: 오른쪽: 골드, 상점, 선택한 기물, 준비 끝

    private func sidePanel(_ me: ChessSelfSnapshot) -> some View {
        ScrollView {
            VStack(spacing: 10) {
                HStack {
                    Text("🪙 \(me.gold)").font(.title2.bold().monospacedDigit())
                    Spacer()
                    Text("다음 라운드 +\(me.nextIncome)").font(.caption).foregroundStyle(.secondary)
                }
                .panel(padding: 10)

                VStack(spacing: 6) {
                    ForEach(me.shop.indices, id: \.self) { slot in
                        shopCard(me, slot: slot)
                    }
                    Button { model.chessReroll() } label: {
                        Label("새로고침 (\(me.rerollCost)골드)", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(me.gold < me.rerollCost || me.done)
                    Text(oddsText).font(.caption2).foregroundStyle(.secondary)
                }
                .coachHighlight(showCoach && coachStep(me).n == 1)

                sellZone(me)

                if let uid = model.selectedUid, let unit = findUnit(me, uid: uid) {
                    selectedPanel(me, unit: unit)
                }

                if !me.synergies.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(me.synergies, id: \.self) { id in
                            if let info = model.chessSynergy(id) {
                                VStack(alignment: .leading, spacing: 0) {
                                    Text("🔗 \(info.nameKo)").font(.caption.bold())
                                    Text(info.text).font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .panel(padding: 8)
                }

                Button {
                    // 판이 비어 있으면 실수일 수 있어서 한 번 물어본다.
                    if me.board.isEmpty { confirmEmptyDone = true } else { model.chessDone() }
                } label: {
                    Text(me.done ? "준비 완료 · 상대를 기다리는 중" : "준비 끝").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(me.done)
                .coachHighlight(showCoach && coachStep(me).n == 4)
                .confirmationDialog("판에 기물이 없어요", isPresented: $confirmEmptyDone, titleVisibility: .visible) {
                    Button("그래도 준비 끝", role: .destructive) { model.chessDone() }
                    Button("더 놓을게요", role: .cancel) {}
                } message: {
                    Text("기물 없이 싸우면 이 라운드는 져요.")
                }
            }
        }
    }

    private var showCoach: Bool { !coachDismissed && chess.round == 1 }

    /// 기물을 여기로 끌어 놓으면 판다.
    private func sellZone(_ me: ChessSelfSnapshot) -> some View {
        Label("여기로 끌어서 팔기", systemImage: "trash")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.white.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            .dropDestination(for: String.self) { items, _ in
                guard let uid = items.first, !me.done else { return false }
                model.chessSell(uid)
                return true
            }
    }

    private var oddsText: String {
        let names: [String] = ["1골드", "2골드", "3골드", "4골드"]
        var parts: [String] = []
        for (index, percent) in chess.shopOdds.enumerated() where percent > 0 {
            parts.append("\(names[safe: index] ?? "?") \(percent)%")
        }
        return "등장 확률: " + parts.joined(separator: " · ")
    }

    private func shopCard(_ me: ChessSelfSnapshot, slot: Int) -> some View {
        let defId: String? = me.shop[slot]
        let info: ChessUnitInfo? = defId.flatMap { model.chessUnit($0) }
        let cost: Int = info?.cost ?? 0
        let affordable: Bool = me.gold >= cost
        return Button {
            if defId != nil { model.chessBuy(slot: slot) }
        } label: {
            HStack(spacing: 8) {
                if let defId {
                    ChessToken(defId: defId, star: 1).frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(info?.nameKo ?? defId).font(.subheadline.bold())
                            if let info { Text(Labels.pieceName(info.piece)).font(.caption2).foregroundStyle(Theme.color(for: info.piece)) }
                        }
                        Text(info?.abilityText ?? "").font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    Text("\(cost)").font(.headline.monospacedDigit())
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(ChessStyle.costColor(cost).opacity(0.3)))
                } else {
                    Text("구매 완료").font(.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
            }
            .padding(6)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panel))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(defId == nil ? Color.clear : ChessStyle.costColor(cost).opacity(0.7), lineWidth: 1.5))
            .opacity(defId == nil || !affordable ? 0.45 : 1)
        }
        .buttonStyle(.plain)
        .disabled(defId == nil || me.done)
    }

    private func findUnit(_ me: ChessSelfSnapshot, uid: String) -> ChessUnitView? {
        if let onBoard = me.board.first(where: { $0.uid == uid }) { return onBoard }
        for case let unit? in me.bench where unit.uid == uid { return unit }
        return nil
    }

    private func selectedPanel(_ me: ChessSelfSnapshot, unit: ChessUnitView) -> some View {
        let info: ChessUnitInfo? = model.chessUnit(unit.defId)
        let onBoard: Bool = me.board.contains { $0.uid == unit.uid }
        let value: Int = ChessStyle.sellValue(cost: info?.cost ?? 1, star: unit.star)
        // ★2는 능력치가 1.8배
        let factor: Double = unit.star >= 2 ? 1.8 : 1
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(info?.nameKo ?? unit.defId) \(ChessStyle.starText(unit.star))").font(.headline)
                if let info { Text("\(Labels.pieceName(info.piece)) · \(info.faction) · \(info.role)").font(.caption).foregroundStyle(.secondary) }
            }
            if let info {
                Text("♥ \(Int((Double(info.hp) * factor).rounded()))   ⚔ \(Int((Double(info.atk) * factor).rounded()))")
                    .font(.subheadline.monospacedDigit())
                Text(info.abilityText).font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                if onBoard {
                    Button("대기석으로") { model.chessBench(unit.uid) }.buttonStyle(SecondaryButtonStyle())
                }
                Button("판매 +\(value)") { model.chessSell(unit.uid) }.buttonStyle(SecondaryButtonStyle())
            }
            Text("칸을 누르면 거기에 놓아요.").font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(padding: 10)
    }
}

// MARK: 전투 단계

struct ChessCombatView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let chess: ChessSnapshot
    let seat: Int

    var body: some View {
        VStack(spacing: 10) {
            ChessHeader(room: room, chess: chess, seat: seat)
            if let combat = chess.combat {
                HStack(alignment: .top, spacing: 14) {
                    ChessArena(room: room, combat: combat, seat: seat)
                        .aspectRatio(1, contentMode: .fit)
                    sidePanel(combat)
                        .frame(maxWidth: 300)
                }
            } else {
                Spacer()
                ProgressView("전투를 불러오는 중...")
                Spacer()
            }
        }
    }

    private func sidePanel(_ combat: ChessCombatSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            teamList(title: "내 기물", color: Theme.mine, placements: combat.boards[safe: seat] ?? [])
            teamList(title: "상대 기물", color: Theme.theirs, placements: combat.boards[safe: 1 - seat] ?? [])
            if let mine = chess.me, !mine.synergies.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(mine.synergies, id: \.self) { id in
                        Text("🔗 \(model.chessSynergy(id)?.nameKo ?? id)").font(.caption)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func teamList(title: String, color: Color, placements: [ChessCombatPlacement]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.bold()).foregroundStyle(color)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
                ForEach(placements.indices, id: \.self) { index in
                    ChessToken(defId: placements[index].defId, star: placements[index].star, tint: color)
                        .aspectRatio(1, contentMode: .fit)
                }
            }
            if placements.isEmpty { Text("없음").font(.caption).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(padding: 10)
    }
}

/// 8x8 판에서 서버가 기록한 전투를 재생한다. 내 쪽이 항상 아래에 보인다.
struct ChessArena: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let combat: ChessCombatSnapshot
    let seat: Int

    var body: some View {
        TimelineView(.animation) { context in
            let position: Double = playbackPosition(now: context.date)
            GeometryReader { geo in
                let cell: CGFloat = min(geo.size.width, geo.size.height) / CGFloat(chessBoardSize)
                ZStack(alignment: .topLeading) {
                    background(cell)
                    effects(position: position, cell: cell)
                    ForEach(combat.units.indices, id: \.self) { index in
                        unitView(index, position: position, cell: cell)
                    }
                    banner(position: position)
                }
                .frame(width: cell * CGFloat(chessBoardSize), height: cell * CGFloat(chessBoardSize))
            }
        }
    }

    /// 지금 몇 번째 박자인가(소수). 서버는 전투 단계를 (박자 수 + 3)칸으로 나눠서, 앞 1칸은 준비, 뒤 2칸은 마무리다.
    private func playbackPosition(now: Date) -> Double {
        guard let end = room.phaseEndsAt, let remaining = model.remainingMs(now: now) else { return 0 }
        let duration = Double(end - room.phaseStartedAt)
        let beatMs = duration / Double(combat.beats + 3)
        guard beatMs > 0 else { return 0 }
        let elapsed = duration - Double(remaining)
        return min(max(elapsed / beatMs - 1, 0), Double(combat.beats))
    }

    /// 절대 좌표를 화면 칸 좌표로. seat 1은 판을 돌려서 내 쪽이 아래로 온다.
    private func display(x: Double, y: Double) -> CGPoint {
        let last = Double(chessBoardSize - 1)
        return seat == 0 ? CGPoint(x: x, y: y) : CGPoint(x: last - x, y: last - y)
    }

    private func background(_ cell: CGFloat) -> some View {
        VStack(spacing: 0) {
            ForEach(0..<chessBoardSize, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(0..<chessBoardSize, id: \.self) { col in
                        let dark: Bool = (row + col) % 2 == 1
                        let mineSide: Bool = row >= chessBoardSize - chessDeployRows
                        Rectangle()
                            .fill(Color.white.opacity(dark ? 0.12 : 0.06))
                            .overlay(Rectangle().fill((mineSide ? Theme.mine : Theme.theirs).opacity(0.05)))
                            .frame(width: cell, height: cell)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func unitView(_ index: Int, position: Double, cell: CGFloat) -> some View {
        let unit = combat.units[index]
        if let frame = combat.interpolated(position: position, index: index), frame.alive {
            let point = display(x: frame.x, y: frame.y)
            let ratio: Double = unit.maxHp > 0 ? min(1, max(0, frame.hp / unit.maxHp)) : 0
            let side: CGFloat = cell * 0.88
            // 이번 박자에 쓰러지는 기물은 서서히 사라진다.
            let k: Int = Int(position.rounded(.down))
            let dying: Bool = combat.frameUnit(beat: k + 1, index: index)?.alive == false
            let fade: Double = dying ? max(0, 1 - (position - Double(k))) : 1
            ZStack(alignment: .bottom) {
                ChessToken(defId: unit.defId, star: unit.star, tint: unit.seat == seat ? Theme.mine : Theme.theirs)
                VStack(spacing: 1) {
                    if frame.shield > 0 {
                        Capsule().fill(Color.white.opacity(0.8)).frame(width: side * 0.8, height: 3)
                    }
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.black.opacity(0.5))
                        Capsule().fill(unit.seat == seat ? Theme.mine : Theme.theirs).frame(width: side * 0.8 * ratio)
                    }
                    .frame(width: side * 0.8, height: 5)
                }
                .padding(.bottom, 2)
            }
            .frame(width: side, height: side)
            .opacity(fade)
            .position(x: (point.x + 0.5) * cell, y: (point.y + 0.5) * cell)
        }
    }

    /// 이번 박자에 일어나는 공격과 능력을 선으로 보여 준다.
    private func effects(position: Double, cell: CGFloat) -> some View {
        let beat: Int = Int(position.rounded(.down)) + 1
        let fade: Double = 1 - (position - position.rounded(.down))
        let active: [ChessEvent] = position >= Double(combat.beats)
            ? []
            : combat.events.filter { $0.beat == beat && ($0.kind == "attack" || $0.kind == "ability") && $0.target >= 0 }
        return ZStack {
            ForEach(active.indices, id: \.self) { index in
                let event = active[index]
                if let from = combat.interpolated(position: position, index: event.unit),
                   let to = combat.interpolated(position: position, index: event.target) {
                    let a = display(x: from.x, y: from.y)
                    let b = display(x: to.x, y: to.y)
                    Path { path in
                        path.move(to: CGPoint(x: (a.x + 0.5) * cell, y: (a.y + 0.5) * cell))
                        path.addLine(to: CGPoint(x: (b.x + 0.5) * cell, y: (b.y + 0.5) * cell))
                    }
                    .stroke(event.kind == "ability" ? Theme.accent : Color.white,
                            lineWidth: event.kind == "ability" ? 4 : 2)
                    .opacity(fade * 0.8)
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func bannerStyle() -> (text: String, color: Color) {
        guard let winner = combat.winner else { return ("무승부", Theme.silver) }
        return winner == seat ? ("라운드 승리", Theme.good) : ("라운드 패배", Theme.theirs)
    }

    @ViewBuilder
    private func banner(position: Double) -> some View {
        if position >= Double(combat.beats) {
            let style = bannerStyle()
            Text(style.text)
                .font(.system(size: 40, weight: .heavy, design: .rounded))
                .foregroundStyle(style.color)
                .padding(.horizontal, 24).padding(.vertical, 10)
                .background(Capsule().fill(Color.black.opacity(0.6)))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
