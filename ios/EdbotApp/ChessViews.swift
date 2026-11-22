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

    /// 재료·무기 희귀도 색
    static func rarityColor(_ rarity: String) -> Color {
        switch rarity {
        case "uncommon": return Theme.good
        case "rare": return Theme.mine
        case "legendary": return Color(red: 0.95, green: 0.78, blue: 0.30)
        default: return Color(white: 0.72)
        }
    }

    static func starText(_ star: Int) -> String { star >= 2 ? "★★" : "★" }

    /// 팔 때 돌려받는 골드: ★1은 산 값, ★2는 3장 값
    static func sellValue(cost: Int, star: Int) -> Int { cost * (star >= 2 ? 3 : 1) }
}

/// 끌어다 놓는 것: 기물, 무기, 재료. 문자열(종류:id)로 주고받는다.
private enum DragItem {
    case unit(String)
    case weapon(String)
    case material(String)

    init?(_ text: String) {
        if text.hasPrefix("unit:") { self = .unit(String(text.dropFirst(5))) }
        else if text.hasPrefix("weapon:") { self = .weapon(String(text.dropFirst(7))) }
        else if text.hasPrefix("material:") { self = .material(String(text.dropFirst(9))) }
        else { return nil }
    }
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
    /// 무기를 끼고 있다
    var armed: Bool = false
    /// 낀 무기 id (바뀌면 방패 표시가 통통 튄다)
    var weaponId: String? = nil

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
                if armed {
                    Image(systemName: "bolt.shield.fill")
                        .font(.system(size: max(9, side * 0.2)))
                        .foregroundStyle(Theme.warn)
                        .symbolEffect(.bounce, value: weaponId)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                        .padding(3)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            // ★2는 금색으로 은은하게 빛난다
            .shadow(color: star >= 2 ? Color(red: 0.95, green: 0.78, blue: 0.30).opacity(0.6) : .clear, radius: star >= 2 ? 6 : 0)
        }
    }
}

/// 체력 알약: 이름과 체력 막대.
private struct HpPill: View {
    let name: String
    let hp: Int
    let color: Color
    var width: CGFloat = 170

    var body: some View {
        let ratio: Double = min(1, max(0, Double(hp) / Double(chessStartHp)))
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(name).font(.caption.bold()).lineLimit(1)
                Spacer()
                Text("\(Image(systemName: "heart.fill")) \(max(0, hp))").font(.caption.monospacedDigit().bold())
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.12))
                    Capsule().fill(color).frame(width: geo.size.width * ratio)
                }
            }
            .frame(height: 6)
        }
        .frame(width: width)
    }
}

/// 준비와 전투 화면 위쪽: 라운드, 남은 시간, 두 사람의 체력, 항복.
struct ChessHeader: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let chess: ChessSnapshot
    let seat: Int
    @Environment(\.verticalSizeClass) private var vSize
    @State private var confirmSurrender = false

    var body: some View {
        let mine: String = room.players.first { $0.seat == seat }?.name ?? "나"
        let theirs: String = room.players.first { $0.seat != seat }?.name ?? "상대"
        let compact: Bool = vSize == .compact
        VStack(spacing: 6) {
            HStack(spacing: compact ? 10 : 18) {
                HpPill(name: mine, hp: chess.me?.hp ?? 0, color: Theme.mine, width: compact ? 130 : 170)
                VStack(spacing: 2) {
                    (room.mobius == true
                         ? Text("라운드 \(chess.round) / \(chess.maxRounds) \(Image(systemName: "infinity"))")
                         : Text("라운드 \(chess.round) / \(chess.maxRounds)")).font(.headline)
                    TimelineView(.periodic(from: .now, by: 0.5)) { context in
                        Text("\(Labels.phaseName(room.phase)) \(Labels.countdown(model.remainingMs(now: context.date)))")
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(minWidth: compact ? 90 : 130)
                HpPill(name: theirs, hp: chess.opponent?.hp ?? 0, color: Theme.theirs, width: compact ? 130 : 170)
                Spacer()
                Button { confirmSurrender = true } label: { Label("항복", systemImage: "flag") }
                    .buttonStyle(SecondaryButtonStyle())
            }
            if room.phase == .prep, !compact, let last = chess.lastRound {
                Text(lastRoundText(last)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .panel(padding: compact ? 6 : 10)
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
    @State private var lastTick = -1

    @Environment(\.verticalSizeClass) private var vSize
    private var compact: Bool { vSize == .compact }

    /// 한 화면에 다 들어오도록, 화면 크기에서 칸 크기를 정한다. (스크롤 없음)
    var body: some View {
        if let me = chess.me {
            GeometryReader { geo in
                let sideW: CGFloat = min(340, max(230, geo.size.width * 0.3))
                let leftW: CGFloat = geo.size.width - sideW - 10
                let shopH: CGFloat = min(108, max(60, geo.size.height * 0.17))
                let showStrip: Bool = showCoach || (!tipSeen && chess.round == 2)
                let stripH: CGFloat = showStrip ? (compact ? 40 : 58) : 0
                let headH: CGFloat = compact ? 52 : 86
                let gaps: CGFloat = compact ? 30 : 52
                let boardAvail: CGFloat = geo.size.height - headH - stripH - shopH - gaps
                let cell: CGFloat = max(18, min((leftW - 14) / 8, boardAvail / 5.1))
                VStack(spacing: compact ? 4 : 8) {
                    ChessHeader(room: room, chess: chess, seat: seat)
                    if showCoach {
                        coachCard(me)
                    } else if !tipSeen && chess.round == 2 {
                        tipCard
                    }
                    HStack(alignment: .top, spacing: 10) {
                        VStack(spacing: compact ? 3 : 6) {
                            boardView(me, cell: cell)
                                .overlay(alignment: .bottomLeading) { selectedOverlay(me) }
                            benchView(me, cell: cell)
                            shopRow(me, height: shopH)
                        }
                        .frame(width: leftW)
                        sidePanel(me)
                            .frame(width: sideW, height: geo.size.height - headH - stripH - (compact ? 8 : 16))
                    }
                }
            }
            // 준비 시간이 5초 남으면 1초마다 똑딱 소리
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    guard let ms = model.remainingMs() else { continue }
                    let left = Int((ms + 999) / 1000)
                    if left > 0, left <= 5, left != lastTick {
                        lastTick = left
                        model.play(.tick)
                    }
                    if left > 5 { lastTick = -1 }
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
                Text(step.text).font(compact ? .caption : .subheadline).lineLimit(2).minimumScaleFactor(0.8)
            }
            Spacer()
            Button("가이드") { model.openGuide(.prep) }.buttonStyle(SecondaryButtonStyle())
            Button("건너뛰기") { coachDismissed = true }.buttonStyle(SecondaryButtonStyle())
        }
        .panel(padding: compact ? 6 : 10)
    }

    /// 첫 전투가 끝난 뒤 2라운드에서 한 번만 보이는 팁.
    private var tipCard: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("다음 단계 팁").font(.caption.bold()).foregroundStyle(Theme.warn)
                Text("① 골드 10마다 이자 +1 (최대 +3)  ② 같은 캐릭터 3장 = ★2, 훨씬 강해져요  ③ 같은 기물(킹·룩·비숍·폰...)을 2명 이상 올리면 시너지 보너스")
                    .font(compact ? .caption : .subheadline).lineLimit(2).minimumScaleFactor(0.8)
            }
            Spacer()
            Button("가이드") { model.openGuide(.synergy) }.buttonStyle(SecondaryButtonStyle())
            Button("알겠어요") { tipSeen = true }.buttonStyle(SecondaryButtonStyle())
        }
        .panel(padding: compact ? 6 : 10)
    }

    private func boardView(_ me: ChessSelfSnapshot, cell: CGFloat) -> some View {
        VStack(spacing: 2) {
            ForEach(0..<chessDeployRows, id: \.self) { row in
                HStack(spacing: 2) {
                    ForEach(0..<chessBoardSize, id: \.self) { col in
                        boardCell(me, col: col, row: row)
                            .frame(width: cell, height: cell)
                    }
                }
            }
        }
        .overlay {
            // 무한 모드: 판 양쪽 끝의 보랏빛(이어져 있다는 표시)
            if room.mobius == true {
                HStack(spacing: 0) {
                    LinearGradient(colors: [Theme.accent.opacity(0.5), .clear], startPoint: .leading, endPoint: .trailing).frame(width: cell * 0.5)
                    Spacer(minLength: 0)
                    LinearGradient(colors: [Theme.accent.opacity(0.5), .clear], startPoint: .trailing, endPoint: .leading).frame(width: cell * 0.5)
                }
                .allowsHitTesting(false)
            }
        }
        .coachHighlight(showCoach && coachStep(me).n == 2)
    }

    private func boardCell(_ me: ChessSelfSnapshot, col: Int, row: Int) -> some View {
        let unit: ChessUnitView? = me.board.first { $0.col == col && $0.row == row }
        let dark: Bool = (col + row) % 2 == 1
        let tile: ChessTileView? = tileAt(col: col, row: row)
        let tileRarity: String = tile.flatMap { model.chessMaterial($0.material)?.rarity } ?? "common"
        return ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.white.opacity(dark ? 0.12 : 0.06))
            if let tile {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(ChessStyle.rarityColor(tileRarity).opacity(0.18))
                VStack(spacing: 0) {
                    Image(systemName: "diamond.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(ChessStyle.rarityColor(tileRarity))
                    if unit == nil {
                        Text(model.chessMaterial(tile.material)?.nameKo ?? "")
                            .font(.system(size: 8))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: unit == nil ? .center : .bottomTrailing)
                .padding(2)
            }
            if let unit {
                ChessToken(defId: unit.defId, star: unit.star, selected: model.selectedUid == unit.uid, armed: unit.weapon != nil, weaponId: unit.weapon)
                    .padding(2)
                    .draggable("unit:\(unit.uid)")
                    .transition(.scale(scale: 0.3).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.65), value: unit?.uid)
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Rectangle())
        .onTapGesture { tapCell(me, col: col, row: row, occupant: unit) }
        .dropDestination(for: String.self) { items, _ in
            guard let raw = items.first, let item = DragItem(raw), !me.done else { return false }
            switch item {
            case let .unit(uid):
                model.chessDeploy(uid, col: col, row: row)
                return true
            case let .weapon(weaponId):
                // 기물 위에 놓으면 무기를 낀다. (이미 낀 무기가 있으면 서로 바뀐다)
                guard let unit else { return false }
                model.chessEquip(weaponId, uid: unit.uid)
                return true
            case .material:
                return false
            }
        }
    }

    /// 내 판의 칸(col, row)에 있는 자원 칸. 좌표는 서버의 절대 좌표로 바꿔서 찾는다. (seat 1은 판을 돌려서 본다)
    private func tileAt(col: Int, row: Int) -> ChessTileView? {
        let x: Int = seat == 0 ? col : chessBoardSize - 1 - col
        let y: Int = seat == 0 ? chessBoardSize - chessDeployRows + row : chessDeployRows - 1 - row
        return chess.tiles.first { $0.x == x && $0.y == y }
    }

    private func tapCell(_ me: ChessSelfSnapshot, col: Int, row: Int, occupant: ChessUnitView?) {
        if let weaponId = model.selectedWeaponId {
            if let occupant { model.chessEquip(weaponId, uid: occupant.uid) }
            return
        }
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

    private func benchView(_ me: ChessSelfSnapshot, cell: CGFloat) -> some View {
        HStack(spacing: 2) {
            ForEach(me.bench.indices, id: \.self) { slot in
                benchSlot(me, slot: slot)
                    .frame(width: cell, height: cell)
            }
            // 자동 배치: 대기석 옆 칸
            Button { model.chessAutoPlace(me, cap: chess.deployCap) } label: {
                VStack(spacing: 0) {
                    Image(systemName: "wand.and.stars").font(.system(size: max(12, cell * 0.32)))
                    Text("자동").font(.system(size: max(8, cell * 0.17)))
                }
                .foregroundStyle(Theme.silver)
                .frame(width: cell, height: cell)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.white.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
            .buttonStyle(.plain)
            .disabled(me.done || !me.bench.contains(where: { $0 != nil }) || me.board.count >= chess.deployCap)
            .opacity(me.done || !me.bench.contains(where: { $0 != nil }) || me.board.count >= chess.deployCap ? 0.35 : 1)
        }
    }

    private func benchSlot(_ me: ChessSelfSnapshot, slot: Int) -> some View {
        let unit: ChessUnitView? = me.bench[slot]
        return ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(0.08))
            if let unit {
                ChessToken(defId: unit.defId, star: unit.star, selected: model.selectedUid == unit.uid, armed: unit.weapon != nil, weaponId: unit.weapon)
                    .padding(2)
                    .draggable("unit:\(unit.uid)")
                    .transition(.scale(scale: 0.3).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.65), value: unit?.uid)
        .aspectRatio(1, contentMode: .fit)
        .contentShape(Rectangle())
        .onTapGesture { tapBench(me, unit: unit) }
        .dropDestination(for: String.self) { items, _ in
            guard let raw = items.first, let item = DragItem(raw), !me.done else { return false }
            switch item {
            case let .unit(uid):
                // 판 위의 기물을 대기석으로 끌어 내린다.
                guard me.board.contains(where: { $0.uid == uid }) else { return false }
                model.chessBench(uid)
                return true
            case let .weapon(weaponId):
                guard let unit else { return false }
                model.chessEquip(weaponId, uid: unit.uid)
                return true
            case .material:
                return false
            }
        }
    }

    private func tapBench(_ me: ChessSelfSnapshot, unit: ChessUnitView?) {
        if let weaponId = model.selectedWeaponId {
            if let unit { model.chessEquip(weaponId, uid: unit.uid) }
            return
        }
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
        VStack(spacing: compact ? 4 : 8) {
            statPanel(me)

            // 자원 패널은 남는 높이 안에서만 보인다. (스크롤 없음)
            if !chess.market.isEmpty || !chess.tiles.isEmpty || !me.materials.isEmpty || !me.weapons.isEmpty {
                resourcePanel(me)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .clipped()
            } else {
                Spacer(minLength: 0)
            }

            sellZone(me)

            if let opponent = chess.opponent {
                Text("상대 \(opponent.boardCount)기 배치 · \(opponent.done ? "준비 끝" : "준비 중")")
                    .font(.caption2)
                    .foregroundStyle(opponent.done ? Theme.good : Color.secondary)
            }

            Button {
                // 판이 비어 있으면 실수일 수 있어서 한 번 물어본다.
                if me.board.isEmpty { confirmEmptyDone = true } else { model.chessDone() }
            } label: {
                Text(me.done ? "준비 완료 · 기다리는 중" : "준비 끝").frame(maxWidth: .infinity)
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

    /// 왼쪽 아래: 상점을 한 줄로. 카드마다 기물 그림, 이름, 값.
    private func shopRow(_ me: ChessSelfSnapshot, height: CGFloat) -> some View {
        HStack(spacing: 6) {
            ForEach(me.shop.indices, id: \.self) { slot in
                shopCard(me, slot: slot, height: height)
                    .id(me.shop[slot] ?? "sold-\(slot)")
                    .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
            }
            Button { model.chessReroll() } label: {
                VStack(spacing: 2) {
                    Image(systemName: "arrow.clockwise").font(.title3)
                    Text("새로고침").font(.caption2)
                    Text("\(me.rerollCost)골드").font(.caption2.bold())
                }
                .foregroundStyle(Theme.silver)
                .frame(width: max(54, height * 0.9), height: height)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panelStrong))
            }
            .buttonStyle(.plain)
            .disabled(me.gold < me.rerollCost || me.done)
            .opacity(me.gold < me.rerollCost || me.done ? 0.4 : 1)
        }
        .frame(height: height)
        .animation(.easeOut(duration: 0.3), value: me.shop)
        .coachHighlight(showCoach && coachStep(me).n == 1)
    }

    /// 고른 기물의 정보: 판 위에 작게 떠 있다. 바깥을 누르면 닫는다.
    @ViewBuilder
    private func selectedOverlay(_ me: ChessSelfSnapshot) -> some View {
        if let uid = model.selectedUid, let unit = findUnit(me, uid: uid) {
            selectedPanel(me, unit: unit)
                .frame(width: 260)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.85)))
                .padding(6)
        }
    }

    private var showCoach: Bool { !coachDismissed && chess.round == 1 }

    /// 기물을 여기로 끌어 놓으면 판다.
    private func sellZone(_ me: ChessSelfSnapshot) -> some View {
        Label("여기로 끌어서 팔기", systemImage: "trash")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: compact ? 26 : 36)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.white.opacity(0.2), style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            .dropDestination(for: String.self) { items, _ in
                guard let raw = items.first, case let .unit(uid)? = DragItem(raw), !me.done else { return false }
                model.chessSell(uid)
                return true
            }
    }

    // MARK: 자원 (광물 시장, 재련대, 무기)

    private func materialName(_ id: String) -> String { model.chessMaterial(id)?.nameKo ?? id }
    private func weaponName(_ id: String) -> String { model.chessWeapon(id)?.nameKo ?? id }

    private func resourcePanel(_ me: ChessSelfSnapshot) -> some View {
        let materialIds: [String] = me.materials.filter { $0.value > 0 }.map { $0.key }.sorted()
        let weaponIds: [String] = me.weapons.filter { $0.value > 0 }.map { $0.key }.sorted()
        let freeSmelter: Bool = me.smelters.contains { $0 == nil }
        return VStack(alignment: .leading, spacing: compact ? 4 : 8) {
            if !compact { Text("자원").font(.subheadline.bold()) }
            if !chess.tiles.isEmpty && !compact {
                let names: [String] = Array(Set(chess.tiles.map { materialName($0.material) })).sorted()
                Text("이번 라운드 자원 칸(◆): \(names.joined(separator: ", ")). 칸 위에 기물을 놓거나 걸어가면 얻어요.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if !chess.market.isEmpty {
                if !compact { Text("광물 시장 · 한 라운드에 한 개").font(.caption).foregroundStyle(.secondary) }
                ForEach(chess.market.indices, id: \.self) { index in
                    marketRow(me, index: index)
                }
            }
            if !materialIds.isEmpty || !weaponIds.isEmpty {
                combineBar
            }
            if !materialIds.isEmpty {
                if !compact { Text("재료 · 누르면 재련, 재련대로 끌어 놓아도 돼요 (다른 재료 위로 끌면 조합)").font(.caption).foregroundStyle(.secondary) }
                chipFlow {
                    ForEach(materialIds, id: \.self) { id in
                        let rarity: String = model.chessMaterial(id)?.rarity ?? "common"
                        let item = ChessItem(.material, id)
                        let usable: Bool = freeSmelter || model.combineMode
                        let picked: Bool = model.combineFirst == item
                        Button {
                            if model.combineMode { model.combineTap(item) } else { model.chessSmelt(id) }
                        } label: {
                            Text("\(materialName(id)) ×\(me.materials[id] ?? 0)")
                                .font(.caption.bold())
                                .padding(.horizontal, 8).padding(.vertical, 5)
                                .background(Capsule().fill(ChessStyle.rarityColor(rarity).opacity(picked ? 0.55 : 0.25)))
                                .overlay(Capsule().strokeBorder(picked ? Color.white : ChessStyle.rarityColor(rarity).opacity(0.7), lineWidth: picked ? 2 : 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(!usable)
                        .opacity(usable ? 1 : 0.45)
                        .draggable("material:\(id)")
                        .dropDestination(for: String.self) { items, _ in combineDrop(items, onto: item) }
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                }
                .animation(.spring(response: 0.35, dampingFraction: 0.7), value: materialIds)
            }
            HStack(spacing: 6) {
                ForEach(me.smelters.indices, id: \.self) { slot in
                    VStack(spacing: 1) {
                        Text("재련대 \(slot + 1)").font(.system(size: 9)).foregroundStyle(.secondary)
                        Text(me.smelters[slot].map { "\(Image(systemName: "hammer.fill")) \(weaponName($0))" } ?? "비어 있음")
                            .font(.caption2.bold()).lineLimit(1).minimumScaleFactor(0.6)
                    }
                    .frame(maxWidth: .infinity, minHeight: compact ? 28 : 36)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.white.opacity(me.smelters[slot] == nil ? 0.07 : 0.14)))
                    .dropDestination(for: String.self) { items, _ in
                        guard let raw = items.first, case let .material(id)? = DragItem(raw) else { return false }
                        model.chessSmelt(id)
                        return true
                    }
                }
            }
            if !compact, !me.smelters.allSatisfy({ $0 == nil }) {
                Text("재련 중인 무기는 다음 라운드 시작에 완성돼요.").font(.system(size: 9)).foregroundStyle(.secondary)
            }
            if !weaponIds.isEmpty {
                if !compact { Text("무기 · 기물 위로 끌어 놓으면 껴요 (다른 아이템 위로 끌면 조합)").font(.caption).foregroundStyle(.secondary) }
                chipFlow {
                    ForEach(weaponIds, id: \.self) { id in
                        let rarity: String = model.chessWeapon(id)?.rarity ?? "common"
                        let item = ChessItem(.weapon, id)
                        let selected: Bool = model.selectedWeaponId == id || model.combineFirst == item
                        Button {
                            if model.combineMode { model.combineTap(item) } else { model.selectedWeaponId = model.selectedWeaponId == id ? nil : id }
                        } label: {
                            Text("\(weaponName(id)) ×\(me.weapons[id] ?? 0)")
                                .font(.caption.bold())
                                .padding(.horizontal, 8).padding(.vertical, 5)
                                .background(Capsule().fill(ChessStyle.rarityColor(rarity).opacity(selected ? 0.55 : 0.25)))
                                .overlay(Capsule().strokeBorder(selected ? Color.white : ChessStyle.rarityColor(rarity).opacity(0.7), lineWidth: selected ? 2 : 1))
                        }
                        .buttonStyle(.plain)
                        .draggable("weapon:\(id)")
                        .dropDestination(for: String.self) { items, _ in combineDrop(items, onto: item) }
                        .transition(.scale(scale: 0.5).combined(with: .opacity))
                    }
                }
                .animation(.spring(response: 0.35, dampingFraction: 0.7), value: weaponIds)
                if let id = model.selectedWeaponId, let info = model.chessWeapon(id) {
                    Text(info.text).font(.caption2).foregroundStyle(Theme.warn)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(padding: compact ? 6 : 10)
        // 무기를 낀 기물을 이 패널로 끌어다 놓으면 무기를 뺀다.
        .dropDestination(for: String.self) { items, _ in
            guard let raw = items.first, case let .unit(uid)? = DragItem(raw), !me.done else { return false }
            let unit: ChessUnitView? = me.board.first { $0.uid == uid } ?? me.bench.compactMap { $0 }.first { $0.uid == uid }
            guard let unit, unit.weapon != nil else { return false }
            model.chessUnequip(unit.uid)
            return true
        }
    }

    /// 아이템을 다른 아이템 위에 놓으면 합친다.
    private func combineDrop(_ items: [String], onto target: ChessItem) -> Bool {
        guard let raw = items.first, let dropped = DragItem(raw) else { return false }
        let item: ChessItem
        switch dropped {
        case let .material(id): item = ChessItem(.material, id)
        case let .weapon(id): item = ChessItem(.weapon, id)
        case .unit: return false
        }
        model.chessCombine(item, target)
        return true
    }

    /// 조합 도구줄: 탭으로 조합하는 방식 켜기, 조합 도감, 안내 문구
    private var combineBar: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Button { model.setCombineMode(!model.combineMode) } label: {
                    Label(model.combineMode ? "조합 중 (둘을 차례로 누르세요)" : "조합", systemImage: "flask")
                        .font(.caption.bold())
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Capsule().fill(model.combineMode ? Theme.accent.opacity(0.6) : Color.white.opacity(0.12)))
                }
                .buttonStyle(.plain)
                Button { model.openGuide(.recipes) } label: {
                    Label("조합 도감", systemImage: "scroll")
                        .font(.caption.bold())
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Capsule().fill(Color.white.opacity(0.12)))
                }
                .buttonStyle(.plain)
            }
            if !compact || model.combineFirst != nil {
                Text(model.combineFirst.map { "\(model.itemName($0))와(과) 합칠 아이템을 누르세요" }
                     ?? "아이템을 다른 아이템 위로 끌어다 놓으면 합쳐져요 (재료+재료, 무기+무기, 무기+원재료)")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func marketRow(_ me: ChessSelfSnapshot, index: Int) -> some View {
        let item: ChessMarketItem = chess.market[index]
        let info: ChessMaterialInfo? = model.chessMaterial(item.material)
        let rarity: String = info?.rarity ?? "common"
        let affordable: Bool = me.gold >= item.price
        let enabled: Bool = affordable && !me.marketBought
        return Button { model.chessBuyMaterial(slot: index) } label: {
            HStack(spacing: 6) {
                Image(systemName: "diamond.fill").foregroundStyle(ChessStyle.rarityColor(rarity))
                VStack(alignment: .leading, spacing: 0) {
                    Text(info?.nameKo ?? item.material).font(.caption.bold())
                    Text("\(Labels.rarityName(rarity)) → \(info.flatMap { model.chessWeapon($0.weaponId)?.nameKo } ?? "")")
                        .font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                Text(me.marketBought ? "구매함" : "\(item.price)골드").font(.caption.bold().monospacedDigit())
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panel))
            .opacity(enabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    /// 칩을 줄바꿈하며 늘어놓는다.
    private func chipFlow<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 88 : 110), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
            content()
        }
    }

    // MARK: 진행 링(판에 올린 기물 수) + 코인, 시너지

    /// 판에 올린 기물 수 / 올릴 수 있는 수를 둥근 막대로, 가운데에 코인(골드)을 보여 준다. 옆에는 시너지.
    private func statPanel(_ me: ChessSelfSnapshot) -> some View {
        let cap: Int = chess.deployCap
        let ratio: Double = cap > 0 ? min(1, Double(me.board.count) / Double(cap)) : 0
        let ringColor: Color = ratio >= 1 ? Theme.good : Theme.accent
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().stroke(Color.white.opacity(0.12), lineWidth: 9)
                Circle()
                    .trim(from: 0, to: ratio)
                    .stroke(ringColor, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .shadow(color: ringColor.opacity(0.6), radius: 4)
                VStack(spacing: 0) {
                    Image(systemName: "dollarsign.circle.fill").font(.system(size: 14)).foregroundStyle(Color(red: 0.95, green: 0.78, blue: 0.3))
                    Text("\(me.gold)")
                        .font(.system(size: compact ? 18 : 24, weight: .bold, design: .rounded).monospacedDigit())
                        .contentTransition(.numericText())
                }
            }
            .frame(width: compact ? 64 : 92, height: compact ? 64 : 92)
            .animation(.easeOut(duration: 0.5), value: ratio)
            .animation(.spring(response: 0.35, dampingFraction: 0.6), value: me.gold)
            .overlay(alignment: .bottom) {
                Text("판 \(me.board.count)/\(cap)")
                    .font(.system(size: 11, weight: ratio >= 1 ? .bold : .regular))
                    .foregroundStyle(ratio >= 1 ? Theme.good : Color.secondary)
                    .offset(y: 14)
            }
            .padding(.bottom, compact ? 10 : 12)

            VStack(alignment: .leading, spacing: compact ? 2 : 4) {
                Text("시너지 · 다음 라운드 \(Image(systemName: "dollarsign.circle.fill")) +\(me.nextIncome)").font(.caption2).foregroundStyle(.secondary)
                synergyChips(me)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .panel(padding: compact ? 6 : 10)
    }

    /// 판 위의 기물을 기물(킹, 퀸...)별로 센다. 같은 캐릭터는 몇 장이든 한 명이다.
    private func pieceCounts(_ me: ChessSelfSnapshot) -> [Piece: Int] {
        var seen = Set<String>()
        var counts: [Piece: Int] = [:]
        for unit in me.board where seen.insert(unit.defId).inserted {
            if let piece = model.chessUnit(unit.defId)?.piece { counts[piece, default: 0] += 1 }
        }
        return counts
    }

    /// 판 위의 기물로 모은 시너지: 켜진 것은 밝게, 모으는 중인 것은 진행도(예: 1/2)와 함께
    @ViewBuilder
    private func synergyChips(_ me: ChessSelfSnapshot) -> some View {
        let counts: [Piece: Int] = pieceCounts(me)
        let active: [Piece] = [Piece.king, .queen, .rook, .bishop, .knight, .pawn].filter { (counts[$0] ?? 0) > 0 }
        if active.isEmpty {
            Text("같은 기물을 2명 이상 올리면 시너지가 켜져요.").font(.caption2).foregroundStyle(.secondary)
        } else {
            ForEach(active, id: \.self) { piece in
                synergyChip(piece, count: counts[piece] ?? 0)
            }
        }
    }

    private func synergyChip(_ piece: Piece, count: Int) -> some View {
        let thresholds: [Int] = piece == .pawn ? [2, 4] : [2, 3]
        let tier: Int = thresholds.filter { count >= $0 }.count
        let need: Int = tier >= 2 ? thresholds[1] : thresholds[tier]
        let shown: ChessSynergyInfo? = model.chessSynergy("\(piece.rawValue)-\(max(tier, 1))")
        let detail: String = tier > 0 ? (shown?.text ?? "") : "\(need - count)명 더 모으면 " + (shown?.text ?? "")
        let color: Color = Theme.color(for: piece)
        return HStack(spacing: 6) {
            Image(Labels.pieceImageName(piece))
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
                .foregroundStyle(color)
            VStack(alignment: .leading, spacing: 0) {
                Text("\(Labels.pieceName(piece)) \(count)/\(need)").font(.caption.bold())
                if !compact { Text(detail).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1) }
            }
        }
        .padding(.horizontal, 7).padding(.vertical, compact ? 1 : 3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(color.opacity(tier > 0 ? 0.2 : 0.06)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(color.opacity(tier > 0 ? 0.65 : 0), lineWidth: 1))
        .shadow(color: tier >= 2 ? color.opacity(0.6) : .clear, radius: tier >= 2 ? 6 : 0)
        .opacity(tier > 0 ? 1 : 0.65)
        .animation(.easeOut(duration: 0.3), value: tier)
    }

    private var oddsText: String {
        let names: [String] = ["1골드", "2골드", "3골드", "4골드"]
        var parts: [String] = []
        for (index, percent) in chess.shopOdds.enumerated() where percent > 0 {
            parts.append("\(names[safe: index] ?? "?") \(percent)%")
        }
        return "등장 확률: " + parts.joined(separator: " · ")
    }

    private func shopCard(_ me: ChessSelfSnapshot, slot: Int, height: CGFloat) -> some View {
        let defId: String? = me.shop[slot]
        let info: ChessUnitInfo? = defId.flatMap { model.chessUnit($0) }
        let cost: Int = info?.cost ?? 0
        let affordable: Bool = me.gold >= cost
        return Button {
            if defId != nil { model.chessBuy(slot: slot) }
        } label: {
            VStack(spacing: 1) {
                if let defId {
                    ChessToken(defId: defId, star: 1).frame(width: max(30, height - 40), height: max(30, height - 40))
                    Text(info?.nameKo ?? defId).font(.system(size: 12, weight: .bold)).lineLimit(1).minimumScaleFactor(0.6)
                    Text("\(Image(systemName: "dollarsign.circle.fill"))\(cost)").font(.system(size: 11, weight: .bold).monospacedDigit())
                        .padding(.horizontal, 6)
                        .background(Capsule().fill(ChessStyle.costColor(cost).opacity(0.3)))
                } else {
                    Text("구매 완료").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(3)
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
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
                Text("\(Image(systemName: "heart.fill")) \(Int((Double(info.hp) * factor).rounded()))   \(Image(systemName: "flame.fill")) \(Int((Double(info.atk) * factor).rounded()))")
                    .font(.subheadline.monospacedDigit())
                Text(info.abilityText).font(.caption).foregroundStyle(.secondary).lineLimit(compact ? 2 : 4)
            }
            if let weaponId = unit.weapon {
                HStack {
                    Image(systemName: "bolt.shield.fill").foregroundStyle(Theme.warn)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(model.chessWeapon(weaponId)?.nameKo ?? weaponId).font(.caption.bold())
                        Text(model.chessWeapon(weaponId)?.text ?? "").font(.system(size: 10)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("무기 빼기") { model.chessUnequip(unit.uid) }.buttonStyle(SecondaryButtonStyle())
                }
            }
            HStack(spacing: 8) {
                if onBoard {
                    Button("대기석으로") { model.chessBench(unit.uid) }.buttonStyle(SecondaryButtonStyle())
                }
                Button("판매 +\(value)") { model.chessSell(unit.uid) }.buttonStyle(SecondaryButtonStyle())
            }
            if !compact { Text("칸을 누르면 거기에 놓아요.").font(.caption2).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel(padding: compact ? 6 : 10)
    }
}

// MARK: 전투 단계

struct ChessCombatView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let chess: ChessSnapshot
    let seat: Int
    @Environment(\.verticalSizeClass) private var vSize

    var body: some View {
        VStack(spacing: vSize == .compact ? 4 : 10) {
            ChessHeader(room: room, chess: chess, seat: seat)
            if let combat = chess.combat {
                HStack(alignment: .top, spacing: 12) {
                    ChessArena(room: room, combat: combat, seat: seat)
                        .aspectRatio(1, contentMode: .fit)
                    sidePanel(combat)
                        .frame(maxWidth: vSize == .compact ? 220 : 300, maxHeight: .infinity, alignment: .top)
                        .clipped()
                }
            } else {
                Spacer()
                ProgressView("전투를 불러오는 중...")
                Spacer()
            }
        }
    }

    private func sidePanel(_ combat: ChessCombatSnapshot) -> some View {
        VStack(alignment: .leading, spacing: vSize == .compact ? 4 : 10) {
            teamList(title: "내 기물", color: Theme.mine, placements: combat.boards[safe: seat] ?? [])
            teamList(title: "상대 기물", color: Theme.theirs, placements: combat.boards[safe: 1 - seat] ?? [])
            if let mine = chess.me, !mine.synergies.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(mine.synergies, id: \.self) { id in
                        Text("\(Image(systemName: "link")) \(model.chessSynergy(id)?.nameKo ?? id)").font(.caption)
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
                let frontCells: Set<Int> = frontCellSet(position: position)
                ZStack(alignment: .topLeading) {
                    background(cell)
                    seamEdges(cell)
                    tilesLayer(position: position, cell: cell)
                    effects(position: position, cell: cell)
                    ringsLayer(position: position, cell: cell)
                    cloneLinks(position: position, cell: cell)
                    ForEach(combat.units.indices, id: \.self) { index in
                        unitView(index, position: position, cell: cell, frontCells: frontCells)
                    }
                    floatsLayer(position: position, cell: cell)
                    banner(position: position)
                }
                .frame(width: cell * CGFloat(chessBoardSize), height: cell * CGFloat(chessBoardSize))
            }
        }
        .task { await soundLoop() }
    }

    // MARK: 연출 (모두 박자 위치(position)만으로 정해지는 값이라 화면을 다시 그릴 때마다 같은 모습이다)

    /// 박자 j에서 j+1로 넘어가는 동안 기물 i의 체력 변화. 피해는 음수, 변화가 없으면 0.
    private func hpDelta(beat j: Int, index i: Int) -> Double {
        guard j >= 0, j < combat.beats,
              let a = combat.frameUnit(beat: j, index: i),
              let b = combat.frameUnit(beat: j + 1, index: i),
              a.alive else { return 0 }
        return b.hp - a.hp
    }

    /// 피해·회복 숫자: 맞은 기물 위로 떠올랐다가 사라진다.
    private func floatsLayer(position: Double, cell: CGFloat) -> some View {
        let k: Int = Int(position.rounded(.down))
        return ZStack {
            ForEach([k - 1, k], id: \.self) { j in
                ForEach(combat.units.indices, id: \.self) { i in
                    floatText(beat: j, index: i, position: position, cell: cell)
                }
            }
            ForEach(combat.events.indices, id: \.self) { index in
                mineFloat(combat.events[index], position: position, cell: cell)
                seamFloat(combat.events[index], position: position, cell: cell)
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func floatText(beat j: Int, index i: Int, position: Double, cell: CGFloat) -> some View {
        let delta: Double = hpDelta(beat: j, index: i)
        let age: Double = position - Double(j)
        if abs(delta) >= 1, age >= 0, age < 1, let a = combat.frameUnit(beat: j, index: i) {
            let point = display(x: a.x, y: a.y)
            let own: Bool = combat.units[i].seat == seat
            let hurt: Color = own ? Color(red: 1, green: 0.7, blue: 0.66) : Color(red: 1, green: 0.95, blue: 0.66)
            Text(delta < 0 ? "-\(Int((-delta).rounded()))" : "+\(Int(delta.rounded()))")
                .font(.system(size: max(11, cell * 0.26), weight: .heavy, design: .rounded))
                .foregroundStyle(delta < 0 ? hurt : Theme.good)
                .shadow(color: .black, radius: 2)
                .opacity(1 - age)
                .position(x: (point.x + 0.5) * cell, y: (point.y + 0.2 - age * 0.55) * cell)
        }
    }

    /// 재료를 캘 때 칸 위로 "+재료 이름"이 떠오른다.
    @ViewBuilder
    private func mineFloat(_ event: ChessEvent, position: Double, cell: CGFloat) -> some View {
        let age: Double = position - Double(event.beat - 1)
        if event.kind == "mine", age >= 0, age < 1, combat.tiles.indices.contains(event.target) {
            let tile = combat.tiles[event.target]
            let point = display(x: Double(tile.x), y: Double(tile.y))
            Text("+" + (model.chessMaterial(event.text)?.nameKo ?? "재료"))
                .font(.system(size: max(10, cell * 0.22), weight: .heavy))
                .foregroundStyle(Color(red: 0.72, green: 0.88, blue: 1))
                .shadow(color: .black, radius: 2)
                .opacity(1 - age)
                .position(x: (point.x + 0.5) * cell, y: (point.y + 0.2 - age * 0.55) * cell)
        }
    }

    /// 무한 모드의 일: 이음매 이동(유령), 웜홀 상승, 분신 생김, 석화를 그 기물 위에 글자로 띄운다.
    @ViewBuilder
    private func seamFloat(_ event: ChessEvent, position: Double, cell: CGFloat) -> some View {
        let age: Double = position - Double(event.beat - 1)
        let known: Bool = ["ghost", "surface", "clone", "stone"].contains(event.kind)
        if known, age >= 0, age < 1, let unit = combat.frameUnit(beat: event.beat - 1, index: event.unit) ?? combat.frameUnit(beat: event.beat, index: event.unit) {
            let point = display(x: unit.x, y: unit.y)
            let size: CGFloat = max(11, cell * 0.24)
            HStack(spacing: 2) {
                switch event.kind {
                case "ghost": GhostGlyph().frame(width: size, height: size)
                case "surface": Image(systemName: "arrow.up"); Text("웜홀")
                case "stone": Image(systemName: "mountain.2.fill"); Text("석화")
                default: Text("분신!")
                }
            }
                .font(.system(size: size, weight: .heavy))
                .foregroundStyle(event.kind == "surface" ? Color(red: 0.35, green: 0.8, blue: 0.75) : Color(red: 0.9, green: 0.75, blue: 0.95))
                .shadow(color: .black, radius: 2)
                .opacity(1 - age)
                .position(x: (point.x + 0.5) * cell, y: (point.y + 0.1 - age * 0.45) * cell)
        }
    }

    /// 능력이 발동하면 그 기물 둘레에 보라색 고리가 퍼져 나간다. 웜홀로 올라오면 청록색 고리다.
    private func ringsLayer(position: Double, cell: CGFloat) -> some View {
        let k: Int = Int(position.rounded(.down))
        let age: Double = position - Double(k)
        let active: [ChessEvent] = position >= Double(combat.beats)
            ? []
            : combat.events.filter { $0.beat == k + 1 && ($0.kind == "ability" || $0.kind == "surface") }
        return ZStack {
            ForEach(active.indices, id: \.self) { index in
                if let unit = combat.frameUnit(beat: k, index: active[index].unit) {
                    let p = display(x: unit.x, y: unit.y)
                    let size: CGFloat = cell * CGFloat(0.5 + 1.3 * age)
                    Circle()
                        .stroke(active[index].kind == "surface" ? Color(red: 0.35, green: 0.8, blue: 0.75) : Theme.accent, lineWidth: 3)
                        .frame(width: size, height: size)
                        .opacity(max(0, 1 - age / 0.7))
                        .position(x: (p.x + 0.5) * cell, y: (p.y + 0.5) * cell)
                }
            }
        }
        .allowsHitTesting(false)
    }

    /// 공격하는 기물이 대상 쪽으로 몸을 내밀었다가 돌아온다.
    private func lungeOffset(index: Int, position: Double, cell: CGFloat) -> CGSize {
        let k: Int = Int(position.rounded(.down))
        let age: Double = position - Double(k)
        guard age < 0.26, position < Double(combat.beats),
              let event = combat.events.first(where: { $0.beat == k + 1 && $0.kind == "attack" && $0.unit == index && $0.target >= 0 }),
              let a = combat.frameUnit(beat: k, index: index),
              let b = combat.frameUnit(beat: k, index: event.target) else { return .zero }
        let pa = display(x: a.x, y: a.y)
        let pb = display(x: b.x, y: b.y)
        let dx = Double(pb.x - pa.x)
        let dy = Double(pb.y - pa.y)
        let length = max(0.001, (dx * dx + dy * dy).squareRoot())
        let power = sin(Double.pi * age / 0.26) * Double(cell) * 0.22
        return CGSize(width: CGFloat(dx / length * power), height: CGFloat(dy / length * power))
    }

    // MARK: 효과음 (박자가 넘어갈 때마다)

    @MainActor
    private func playBeatSounds(_ j: Int) {
        var hits = 0
        for i in combat.units.indices where hpDelta(beat: j, index: i) <= -1 { hits += 1 }
        if hits > 0 { model.play(.hit) }
        for event in combat.events where event.beat == j + 1 {
            switch event.kind {
            case "ability": model.play(.ability)
            case "death": model.play(.death)
            case "promote": model.play(.promote)
            case "mine": model.play(.mine)
            case "ghost": model.play(.ghost)
            case "surface": model.play(.surface)
            default: break
            }
        }
    }

    @MainActor
    private func soundLoop() async {
        var last: Int = Int(playbackPosition(now: Date()).rounded(.down)) - 1
        var bannerDone = false
        var suddenDone = false
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 60_000_000)
            let position = playbackPosition(now: Date())
            let k = Int(position.rounded(.down))
            if k - last > 3 { last = k - 1 } // 탭이 가려졌다 돌아와서 많이 밀렸으면 건너뛴다
            while last < k, position < Double(combat.beats) {
                last += 1
                playBeatSounds(last)
            }
            if k + 1 >= combat.suddenDeathBeat, position < Double(combat.beats), !suddenDone {
                suddenDone = true
                model.play(.suddenDeath)
            }
            if position >= Double(combat.beats), !bannerDone {
                bannerDone = true
                model.play(combat.winner == nil ? .click : (combat.winner == seat ? .roundWin : .roundLose))
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

    /// 앞면 기물이 서 있는 칸(번호 = y * 8 + x). 같은 칸의 유령을 살짝 비켜 그리려고 모아 둔다.
    private func frontCellSet(position: Double) -> Set<Int> {
        guard combat.mobius == true else { return [] }
        var cells = Set<Int>()
        for index in combat.units.indices {
            if let f = combat.interpolated(position: position, index: index), f.alive, !f.ghost {
                cells.insert(Int(f.y.rounded()) * chessBoardSize + Int(f.x.rounded()))
            }
        }
        return cells
    }

    /// 무한 모드: 판 양쪽 끝의 보랏빛. 왼쪽 끝과 오른쪽 끝이 이어져 있다는 표시다.
    @ViewBuilder
    private func seamEdges(_ cell: CGFloat) -> some View {
        if combat.mobius == true {
            let width: CGFloat = cell * CGFloat(chessBoardSize) * 0.07
            let total: CGFloat = cell * CGFloat(chessBoardSize)
            HStack(spacing: 0) {
                LinearGradient(colors: [Theme.accent.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing).frame(width: width)
                Spacer(minLength: 0)
                LinearGradient(colors: [Theme.accent.opacity(0.55), .clear], startPoint: .trailing, endPoint: .leading).frame(width: width)
            }
            .frame(width: total, height: total)
            .allowsHitTesting(false)
        }
    }

    /// 분신과 본체를 잇는 보랏빛 점선
    private func cloneLinks(position: Double, cell: CGFloat) -> some View {
        let links: [(body: Int, clone: Int)] = combat.events.filter { $0.kind == "clone" }.map { ($0.unit, $0.target) }
        return ZStack {
            ForEach(links.indices, id: \.self) { n in
                if let a = combat.interpolated(position: position, index: links[n].body), a.alive,
                   let b = combat.interpolated(position: position, index: links[n].clone), b.alive {
                    let pa = display(x: a.x, y: a.y)
                    let pb = display(x: b.x, y: b.y)
                    Path { path in
                        path.move(to: CGPoint(x: (pa.x + 0.5) * cell, y: (pa.y + 0.5) * cell))
                        path.addLine(to: CGPoint(x: (pb.x + 0.5) * cell, y: (pb.y + 0.5) * cell))
                    }
                    .stroke(Theme.accent.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                }
            }
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func unitView(_ index: Int, position: Double, cell: CGFloat, frontCells: Set<Int>) -> some View {
        let unit = combat.units[index]
        if let frame = combat.interpolated(position: position, index: index), frame.alive {
            let point = display(x: frame.x, y: frame.y)
            let ratio: Double = unit.maxHp > 0 ? min(1, max(0, frame.hp / unit.maxHp)) : 0
            let side: CGFloat = cell * 0.88
            // 이번 박자에 쓰러지는 기물은 서서히 사라진다.
            let k: Int = Int(position.rounded(.down))
            let dying: Bool = combat.frameUnit(beat: k + 1, index: index)?.alive == false
            let fade: Double = dying ? max(0, 1 - (position - Double(k))) : 1
            // 맞은 직후에는 번쩍이고, 공격할 때는 대상 쪽으로 몸을 내민다.
            let age: Double = position - Double(k)
            let flash: Double = (hpDelta(beat: k, index: index) <= -1 && age < 0.3) ? (1 - age / 0.3) : 0
            // 무한 모드의 유령: 반투명, 점선, 살짝 떠 있다. 같은 칸에 앞면 기물이 있으면 왼쪽 위 뒤로 비켜 선다.
            let ghost: Bool = frame.ghost
            let stacked: Bool = ghost && frontCells.contains(Int(frame.y.rounded()) * chessBoardSize + Int(frame.x.rounded()))
            let bob: CGFloat = ghost && !stacked ? CGFloat(sin(position * 3.2 + Double(index))) * cell * 0.04 : 0
            let open: Bool = ghost && frame.gauge >= chessWormholeBeats
            ZStack(alignment: .bottom) {
                ChessToken(defId: unit.defId, star: unit.star, tint: unit.seat == seat ? Theme.mine : Theme.theirs, armed: unit.weapon != nil, weaponId: unit.weapon)
                    .brightness(flash * 0.6)
                    .opacity(ghost ? 0.5 : 1)
                    .overlay {
                        if ghost {
                            RoundedRectangle(cornerRadius: side * 0.2, style: .continuous)
                                .strokeBorder(Theme.accent.opacity(0.9), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                        }
                    }
                    .shadow(color: ghost ? Theme.accent.opacity(0.7) : .clear, radius: ghost ? 5 : 0)
                    .scaleEffect(stacked ? 0.88 : 1)
                    .offset(x: stacked ? -side * 0.14 : 0, y: stacked ? -side * 0.14 : bob)
                    .offset(lungeOffset(index: index, position: position, cell: cell))
                if ghost {
                    Circle()
                        .trim(from: 0, to: min(1, Double(frame.gauge) / Double(chessWormholeBeats)))
                        .stroke(Color(red: 0.35, green: 0.8, blue: 0.75), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .shadow(color: open ? Color(red: 0.35, green: 0.8, blue: 0.75) : .clear, radius: open ? 5 : 0)
                        .opacity(open ? 0.6 + 0.4 * abs(sin(position * 4)) : 1)
                        .frame(width: side, height: side)
                        .frame(maxHeight: .infinity, alignment: .center)
                    GhostGlyph()
                        .frame(width: max(9, cell * 0.26), height: max(9, cell * 0.26))
                        .foregroundStyle(Color(red: 0.95, green: 0.82, blue: 0.97))
                        .shadow(color: .black, radius: 1)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
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
                .opacity(ghost ? 0.6 : 1)
            }
            .frame(width: side, height: side)
            .scaleEffect(dying ? 0.55 + 0.45 * fade : 1)
            .opacity(fade * frame.fade)
            .position(x: (point.x + 0.5) * cell, y: (point.y + 0.5) * cell)
            .zIndex(ghost ? 1 : 2)
        }
    }

    /// 아직 안 캔 자원 칸을 ◆로 보여 준다. 캐면 사라진다.
    @ViewBuilder
    private func tilesLayer(position: Double, cell: CGFloat) -> some View {
        let mined: Set<Int> = combat.minedTiles(upTo: Int(position.rounded(.down)))
        ForEach(combat.tiles.indices, id: \.self) { index in
            if !mined.contains(index) {
                let tile = combat.tiles[index]
                let point = display(x: Double(tile.x), y: Double(tile.y))
                Image(systemName: "diamond.fill")
                    .font(.system(size: cell * 0.42))
                    .foregroundStyle(ChessStyle.rarityColor(model.chessMaterial(tile.material)?.rarity ?? "common"))
                    .opacity(0.85)
                    .position(x: (point.x + 0.5) * cell, y: (point.y + 0.5) * cell)
            }
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
