import EdbotKit
import SwiftUI

/// 전투와 데스매치 화면: 위쪽에 점수·스팀포스·남은 시간, 가운데에 레인 3개, 아래에 내 캐릭터와 궁극기.
struct BattleView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let battle: BattleSnapshot
    let seat: Int

    var body: some View {
        VStack(spacing: 10) {
            header
            LaneCanvas(battle: battle, seat: seat)
                .frame(maxHeight: .infinity)
                .panel(padding: 6)
            eventFeed
            controls
        }
    }

    // MARK: 위쪽 줄

    private var header: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(battle.isDeathmatch ? "데스매치" : "전투").font(.headline).foregroundStyle(Theme.silver)
                Text(battle.isDeathmatch ? "한 팀이 전멸하면 끝나요" : "본진 타워 3개를 먼저 부수면 승리").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            scoreBoard
            Spacer()
            steamMeter
            TimelineView(.periodic(from: .now, by: 0.5)) { context in
                let remaining = model.remainingMs(now: context.date)
                Text(Labels.countdown(remaining))
                    .font(.system(size: 28, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundStyle((remaining ?? 99_000) <= 10_000 ? Theme.warn : Theme.silver)
                    .frame(minWidth: 70)
            }
        }
        .panel(padding: 10)
    }

    private var scoreBoard: some View {
        HStack(spacing: 14) {
            Text("\(battle.score[safe: seat] ?? 0)").font(.system(size: 36, weight: .heavy, design: .rounded)).foregroundStyle(Theme.mine)
            VStack(spacing: 0) {
                Text("점수").font(.caption2).foregroundStyle(.secondary)
                Text("처치 \(battle.kills[safe: seat] ?? 0) : \(battle.kills[safe: 1 - seat] ?? 0)").font(.caption2).foregroundStyle(.secondary)
            }
            Text("\(battle.score[safe: 1 - seat] ?? 0)").font(.system(size: 36, weight: .heavy, design: .rounded)).foregroundStyle(Theme.theirs)
        }
    }

    /// 스팀포스 0~10 막대. 5칸에 표시선이 있어서 궁극기 비용(5)이 보인다.
    private var steamMeter: some View {
        let steam = battle.steam ?? 0
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("스팀포스").font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.1f", steam)).font(.caption.monospacedDigit().bold())
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.12))
                    Capsule()
                        .fill(LinearGradient(colors: [Theme.navy, steam >= BattleSnapshot.ultimateCost ? Theme.accent : Theme.purple.opacity(0.6)], startPoint: .leading, endPoint: .trailing))
                        .frame(width: geo.size.width * CGFloat(min(10, steam) / 10))
                    Rectangle().fill(Color.white.opacity(0.6)).frame(width: 2).offset(x: geo.size.width * 0.5 - 1)
                }
            }
            .frame(width: 180, height: 12)
        }
    }

    // MARK: 이벤트

    private var eventFeed: some View {
        let recent = Array(battle.events.suffix(3))
        return VStack(alignment: .leading, spacing: 2) {
            ForEach(recent) { event in
                Text("· " + describe(event)).font(.caption).foregroundStyle(Theme.silver.opacity(0.85))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        .padding(.horizontal, 6)
    }

    private func describe(_ event: BattleEvent) -> String {
        let who = event.unitId.flatMap { name(ofUnit: $0) } ?? ""
        let target = event.targetId.flatMap { name(ofUnit: $0) } ?? (event.targetId ?? "")
        let mine = event.seat == seat
        switch event.type {
        case "kill": return "\(mine ? "우리" : "상대") \(who) 이(가) \(target) 처치"
        case "towerDestroyed": return "\(mine ? "우리가" : "상대가") 타워를 부쉈어요"
        case "ultimate": return "\(mine ? "우리" : "상대") \(who) 궁극기!"
        case "respawn": return "\(who) 부활"
        case "promote": return "\(who) 승급"
        case "end": return "전투 종료"
        default: return event.type
        }
    }

    private func name(ofUnit id: String) -> String? {
        guard let unit = battle.unit(id: id) else { return nil }
        return model.character(unit.characterId)?.nameKo ?? unit.characterId
    }

    // MARK: 내 캐릭터

    private var controls: some View {
        let mine = battle.units.filter { $0.seat == seat && !$0.summon }
        return HStack(spacing: 10) {
            ForEach(mine) { unit in
                UnitControl(unit: unit, battle: battle)
            }
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

/// 내 캐릭터 한 명: 체력, 상태, 궁극기 버튼. 안키오는 레인을 고르고, 나이트는 레인을 옮길 수 있다.
struct UnitControl: View {
    @Environment(AppModel.self) private var model
    let unit: UnitSnapshot
    let battle: BattleSnapshot

    private var info: CharacterInfo? { model.character(unit.characterId) }
    private var ready: Bool { battle.canUseUltimate(unit) }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                if let info { PieceBadge(piece: info.piece, size: 34) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(info?.nameKo ?? unit.characterId).font(.subheadline.bold()).lineLimit(1).minimumScaleFactor(0.7)
                    Text(statusText).font(.caption2).foregroundStyle(unit.alive ? Color.secondary : Theme.warn)
                }
                Spacer(minLength: 0)
            }
            hpBar
            ultimateButton
            if let info, info.piece == .knight, unit.alive { laneMenu }
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.panel))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(ready ? Theme.accent : Color.white.opacity(0.1), lineWidth: ready ? 2 : 1))
        .opacity(unit.alive ? 1 : 0.55)
    }

    private var statusText: String {
        if !unit.alive {
            let secs = Int(ceil(Double(unit.respawnInTicks ?? 0) / Double(max(1, battle.ticksPerSecond))))
            return "쓰러짐 · \(secs)초 뒤 부활"
        }
        return "\(Labels.laneName(unit.lane)) · \(unit.hp)/\(unit.maxHp)"
    }

    private var hpBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.12))
                Capsule()
                    .fill(unit.hp * 4 < unit.maxHp ? Theme.warn : Theme.good)
                    .frame(width: geo.size.width * CGFloat(unit.maxHp > 0 ? Double(unit.hp) / Double(unit.maxHp) : 0))
            }
        }
        .frame(height: 6)
    }

    @ViewBuilder private var ultimateButton: some View {
        let cooldown = unit.ultReadyTick.map { Int(ceil(battle.seconds(until: $0))) } ?? 0
        let label = cooldown > 0 ? "궁극기 \(cooldown)초" : "궁극기"
        if unit.characterId == "ankio" {
            // 적 가드 타워 뒤로 순간이동할 레인을 고른다.
            Menu {
                ForEach(Lane.allCases, id: \.self) { lane in
                    Button(Labels.laneName(lane)) { model.useUltimate(unit, lane: lane) }
                }
            } label: {
                Text(label + " ▾").frame(maxWidth: .infinity, minHeight: 38)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!ready)
        } else {
            Button { model.useUltimate(unit) } label: {
                Text(label).frame(maxWidth: .infinity, minHeight: 38)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!ready)
        }
    }

    private var laneMenu: some View {
        let cooldown = unit.laneMoveReadyTick.map { Int(ceil(battle.seconds(until: $0))) } ?? 0
        return Menu {
            ForEach(Lane.allCases.filter { $0 != unit.lane }, id: \.self) { lane in
                Button("\(Labels.laneName(lane))(으)로") { model.moveLane(unit, to: lane) }
            }
        } label: {
            Text(cooldown > 0 ? "레인 이동 \(cooldown)초" : "레인 이동 ▾").frame(maxWidth: .infinity, minHeight: 34)
        }
        .buttonStyle(SecondaryButtonStyle())
        .disabled(cooldown > 0)
    }
}

/// 세 레인을 그리는 캔버스. 내 본진이 항상 왼쪽에 오고, 유닛은 새 상태 사이를 보간해서 60fps로 그린다.
struct LaneCanvas: View {
    @Environment(AppModel.self) private var model
    let battle: BattleSnapshot
    let seat: Int

    var body: some View {
        let pieces = Dictionary(uniqueKeysWithValues: model.roster.map { ($0.id, $0.piece) })
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                draw(context, size: size, now: timeline.date.timeIntervalSinceReferenceDate, pieces: pieces)
            }
        }
    }

    private func laneRect(_ index: Int, size: CGSize) -> CGRect {
        let gap: CGFloat = 8
        let height = (size.height - gap * 2) / 3
        return CGRect(x: 0, y: CGFloat(index) * (height + gap), width: size.width, height: height)
    }

    /// 레인 위의 위치(0~100)를 화면 x 좌표로. 내 본진이 왼쪽이 되게 seat 1이면 뒤집는다.
    private func x(_ pos: Double, in rect: CGRect) -> CGFloat {
        let p = seat == 1 ? 100 - pos : pos
        return rect.minX + 28 + CGFloat(p / 100) * (rect.width - 56)
    }

    private func draw(_ context: GraphicsContext, size: CGSize, now: TimeInterval, pieces: [String: Piece]) {
        for (index, lane) in Lane.allCases.enumerated() {
            let rect = laneRect(index, size: size)
            drawLane(context, lane: lane, rect: rect, now: now, pieces: pieces)
        }
    }

    private func drawLane(_ context: GraphicsContext, lane: Lane, rect: CGRect, now: TimeInterval, pieces: [String: Piece]) {
        let midY = rect.midY + 6

        // 레인 바탕과 이름
        context.fill(Path(roundedRect: rect, cornerRadius: 12), with: .color(Color.white.opacity(0.05)))
        context.draw(Text(Labels.laneName(lane) + (lane == .kingside ? "  +7점" : "  +5점")).font(.caption.bold()).foregroundColor(Theme.silver.opacity(0.7)),
                     at: CGPoint(x: rect.minX + 12, y: rect.minY + 12), anchor: .leading)
        context.fill(Path(CGRect(x: rect.minX + 16, y: midY - 1, width: rect.width - 32, height: 2)), with: .color(Color.white.opacity(0.15)))

        // 구역: 샘과 벽
        for well in battle.wells where well.lane == lane {
            let cx = x(well.pos, in: rect)
            context.fill(Path(ellipseIn: CGRect(x: cx - 26, y: midY - 26, width: 52, height: 52)), with: .color(Theme.good.opacity(0.22)))
        }
        for wall in battle.walls where wall.lane == lane {
            let cx = x(wall.pos, in: rect)
            context.fill(Path(roundedRect: CGRect(x: cx - 3, y: midY - 30, width: 6, height: 60), cornerRadius: 2), with: .color(Theme.silver))
        }

        // 타워 (데스매치에는 없다)
        if !battle.isDeathmatch {
            for tower in battle.towers where tower.lane == lane {
                drawTower(context, tower, rect: rect, midY: midY)
            }
        }

        // 유닛: 아군은 선 아래, 적은 선 위에 그려서 겹쳐도 구분된다.
        let units = battle.units.filter { $0.lane == lane && $0.alive }
        for unit in units {
            let pos = model.interpolator.position(of: unit.id, at: now) ?? unit.pos
            drawUnit(context, unit, pos: pos, rect: rect, midY: midY, piece: pieces[unit.characterId])
        }
    }

    private func drawTower(_ context: GraphicsContext, _ tower: TowerSnapshot, rect: CGRect, midY: CGFloat) {
        let cx = x(tower.pos, in: rect)
        let w: CGFloat = tower.isMain ? 34 : 22
        let h: CGFloat = tower.isMain ? 46 : 32
        let box = CGRect(x: cx - w / 2, y: midY - h - 4, width: w, height: h)
        let color: Color = !tower.alive ? Color.gray.opacity(0.35) : (tower.seat == seat ? Theme.mine : Theme.theirs)
        context.fill(Path(roundedRect: box, cornerRadius: 5), with: .color(color.opacity(tower.alive ? 0.85 : 1)))
        if tower.isMain {
            context.draw(Text("♜").font(.system(size: 22)).foregroundColor(.white.opacity(tower.alive ? 0.9 : 0.4)), at: CGPoint(x: box.midX, y: box.midY), anchor: .center)
        }
        if tower.alive {
            let ratio = CGFloat(tower.maxHp > 0 ? Double(tower.hp) / Double(tower.maxHp) : 0)
            context.fill(Path(CGRect(x: box.minX, y: box.minY - 7, width: w, height: 4)), with: .color(Color.white.opacity(0.15)))
            context.fill(Path(CGRect(x: box.minX, y: box.minY - 7, width: w * ratio, height: 4)), with: .color(Theme.good))
        }
    }

    private func drawUnit(_ context: GraphicsContext, _ unit: UnitSnapshot, pos: Double, rect: CGRect, midY: CGFloat, piece: Piece?) {
        let mine = unit.seat == seat
        let cx = x(pos, in: rect)
        let radius: CGFloat = unit.summon ? 9 : 15
        let cy = midY + (mine ? 22 : -4) + (mine ? 0 : 0)
        let color = mine ? Theme.mine : Theme.theirs
        let circle = CGRect(x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: circle), with: .color(color.opacity(0.9)))
        if unit.shield > 0 {
            context.stroke(Path(ellipseIn: circle.insetBy(dx: -3, dy: -3)), with: .color(Theme.silver), lineWidth: 2)
        }
        if let piece, !unit.summon {
            context.draw(Text(Labels.pieceGlyph(piece)).font(.system(size: 19)).foregroundColor(.white), at: CGPoint(x: cx, y: cy), anchor: .center)
        }
        if unit.effects.contains("stun") {
            context.draw(Text("✦").font(.system(size: 14)).foregroundColor(Theme.warn), at: CGPoint(x: cx, y: cy - radius - 8), anchor: .center)
        }
        if unit.weapon != nil {
            context.draw(Text("⚔").font(.system(size: 10)).foregroundColor(.white), at: CGPoint(x: cx + radius, y: cy - radius), anchor: .center)
        }
        let ratio = CGFloat(unit.maxHp > 0 ? Double(unit.hp) / Double(unit.maxHp) : 0)
        let barW = radius * 2
        context.fill(Path(CGRect(x: cx - radius, y: cy + radius + 3, width: barW, height: 3)), with: .color(Color.white.opacity(0.2)))
        context.fill(Path(CGRect(x: cx - radius, y: cy + radius + 3, width: barW * ratio, height: 3)), with: .color(ratio < 0.3 ? Theme.warn : Theme.good))
    }
}

/// 결과 단계: 승패, 이유, 점수, 레이팅 변화. 잠시 뒤 로비로 돌아간다.
struct ResultView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let seat: Int

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            if let result = room.result {
                let outcome = outcome(result)
                Text(outcome.title).font(.system(size: 64, weight: .heavy, design: .rounded)).foregroundStyle(outcome.color)
                Text(Labels.resultReason(result.reason)).font(.title3).foregroundStyle(.secondary)
                HStack(spacing: 40) {
                    stat("점수", "\(result.score[safe: seat] ?? 0) : \(result.score[safe: 1 - seat] ?? 0)")
                    stat("처치", "\(result.kills[safe: seat] ?? 0) : \(result.kills[safe: 1 - seat] ?? 0)")
                }
                .panel()
                if seat < result.ratings.count, let rating = result.ratings[seat] {
                    Text("레이팅 \(rating.before) → \(rating.after) (\(rating.delta >= 0 ? "+" : "")\(rating.delta))")
                        .font(.title3.bold())
                        .foregroundStyle(rating.delta >= 0 ? Theme.good : Theme.theirs)
                }
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text("\(Labels.countdown(model.remainingMs(now: context.date))) 뒤 로비로 돌아가요").foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private func outcome(_ result: ResultSnapshot) -> (title: String, color: Color) {
        guard let winner = result.winner else { return ("무승부", Theme.silver) }
        return winner == seat ? ("승리!", Theme.good) : ("패배", Theme.theirs)
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
        }
    }
}
