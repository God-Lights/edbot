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
            if let mine = room.game?.synergies?[safe: seat], !mine.isEmpty {
                HStack(spacing: 8) {
                    Text("우리 시너지").font(.caption).foregroundStyle(.secondary)
                    ForEach(mine, id: \.self) { id in
                        Text("🔗 " + (model.synergy(id)?.nameKo ?? id)).font(.caption.bold())
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Capsule().fill(Theme.accent.opacity(0.22)))
                    }
                    Spacer()
                }
            }
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
            // 탐사·대장간 패널을 여닫는다. 열어 둔 동안에도 전투는 멈추지 않는다.
            Button { model.showWorkshop.toggle() } label: {
                Label(model.showWorkshop ? "닫기" : "탐사·대장간", systemImage: model.showWorkshop ? "xmark" : "hammer")
            }
            .buttonStyle(SecondaryButtonStyle())
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

/// 위에서 내려다본 2D 지도(롤 같은 배치). 내 본진은 항상 왼쪽 아래, 적 본진은 오른쪽 위에 온다.
/// 유닛은 서버가 보내는 상태 사이를 보간해서 60fps로 그린다. (좌표 계산은 EdbotKit의 MapGeometry)
struct LaneCanvas: View {
    @Environment(AppModel.self) private var model
    let battle: BattleSnapshot
    let seat: Int

    var body: some View {
        let pieces = Dictionary(uniqueKeysWithValues: model.roster.map { ($0.id, $0.piece) })
        let names = Dictionary(uniqueKeysWithValues: model.roster.map { ($0.id, $0.nameKo) })
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let geometry = MapGeometry(width: Double(size.width), height: Double(size.height), seat: seat)
                draw(context, size: size, geometry: geometry, now: timeline.date.timeIntervalSinceReferenceDate, pieces: pieces, names: names)
            }
        }
    }

    private func pt(_ v: Vec2) -> CGPoint { CGPoint(x: v.x, y: v.y) }

    private func polyline(_ points: [Vec2]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: pt(first))
        for point in points.dropFirst() { path.addLine(to: pt(point)) }
        return path
    }

    private func draw(_ context: GraphicsContext, size: CGSize, geometry: MapGeometry, now: TimeInterval, pieces: [String: Piece], names: [String: String]) {
        drawTerrain(context, size: size, geometry: geometry)

        for lane in Lane.allCases {
            if !battle.isDeathmatch {
                // 구역(샘, 벽)과 타워 사거리 고리는 유닛 밑에 깔고
                drawZones(context, lane: lane, geometry: geometry)
            }
        }
        for lane in Lane.allCases where !battle.isDeathmatch {
            for tower in battle.towers where tower.lane == lane {
                drawTower(context, tower, geometry: geometry)
            }
        }
        for (index, unit) in battle.units.filter({ $0.alive }).enumerated() {
            let pos = model.interpolator.position(of: unit.id, at: now) ?? unit.pos
            drawUnit(context, unit, pos: pos, index: index, geometry: geometry, piece: pieces[unit.characterId], name: names[unit.characterId])
        }
    }

    // MARK: 지형

    private func drawTerrain(_ context: GraphicsContext, size: CGSize, geometry: MapGeometry) {
        let rect = CGRect(origin: .zero, size: size)
        context.fill(Path(roundedRect: rect, cornerRadius: 14), with: .color(Color(red: 0.07, green: 0.10, blue: 0.10)))

        // 정글 느낌의 어두운 덩어리 (모서리 사이 빈 공간)
        for (cx, cy, r) in [(0.30, 0.45, 0.13), (0.70, 0.55, 0.13), (0.25, 0.22, 0.08), (0.75, 0.78, 0.08)] as [(Double, Double, Double)] {
            let c = geometry.rotated ? (1 - cx, 1 - cy) : (cx, cy)
            let box = CGRect(x: c.0 * size.width - r * size.width, y: c.1 * size.height - r * size.width, width: r * 2 * size.width, height: r * 2 * size.width)
            context.fill(Path(ellipseIn: box), with: .color(Color(red: 0.09, green: 0.14, blue: 0.11)))
        }

        // 강: 레인 사이를 대각선으로 가로지른다.
        var river = Path()
        river.move(to: CGPoint(x: 0, y: 0))
        river.addLine(to: CGPoint(x: size.width, y: size.height))
        context.stroke(river, with: .color(Color(red: 0.16, green: 0.32, blue: 0.5).opacity(0.28)), style: StrokeStyle(lineWidth: 34, lineCap: .round))

        // 길
        for lane in Lane.allCases {
            let path = polyline(geometry.path(for: lane))
            context.stroke(path, with: .color(Color(red: 0.20, green: 0.19, blue: 0.16)), style: StrokeStyle(lineWidth: 46, lineCap: .round, lineJoin: .round))
            context.stroke(path, with: .color(Color.white.opacity(0.06)), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [8, 10]))
            let label = geometry.point(lane: lane, pos: 50)
            context.draw(Text(Labels.laneName(lane) + (lane == .kingside ? " +7" : " +5")).font(.caption2.bold()).foregroundColor(Theme.silver.opacity(0.55)),
                         at: CGPoint(x: label.x, y: label.y + (lane == .center ? 0 : 0) - 30), anchor: .center)
        }

        // 본진
        for owner in 0...1 {
            let base = geometry.basePoint(seat: owner)
            let color = owner == seat ? Theme.mine : Theme.theirs
            context.fill(Path(ellipseIn: CGRect(x: base.x - 40, y: base.y - 40, width: 80, height: 80)), with: .color(color.opacity(0.18)))
            context.stroke(Path(ellipseIn: CGRect(x: base.x - 40, y: base.y - 40, width: 80, height: 80)), with: .color(color.opacity(0.7)), lineWidth: 3)
            context.draw(Text("✦").font(.system(size: 26)).foregroundColor(color), at: pt(base), anchor: .center)
        }
    }

    // MARK: 구역, 타워

    private func drawZones(_ context: GraphicsContext, lane: Lane, geometry: MapGeometry) {
        let scale = geometry.pixelsPerUnit(lane)
        for well in battle.wells where well.lane == lane {
            let c = geometry.point(lane: lane, pos: well.pos)
            let r = 6 * scale
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(Theme.good.opacity(0.2)))
        }
        for wall in battle.walls where wall.lane == lane {
            let frame = geometry.frame(lane: lane, pos: wall.pos)
            let normal = Vec2(-frame.direction.y, frame.direction.x)
            var path = Path()
            path.move(to: pt(frame.point + normal * 30))
            path.addLine(to: pt(frame.point - normal * 30))
            context.stroke(path, with: .color(Theme.silver), style: StrokeStyle(lineWidth: 6, lineCap: .round))
        }
    }

    private func drawTower(_ context: GraphicsContext, _ tower: TowerSnapshot, geometry: MapGeometry) {
        let c = geometry.point(lane: tower.lane, pos: tower.pos)
        let color: Color = !tower.alive ? Color.gray.opacity(0.4) : (tower.seat == seat ? Theme.mine : Theme.theirs)

        // 사거리 고리: 가드 타워는 아군에게 회복 구간, 적에게 피해 구간이다. (사거리 10)
        if tower.alive && !tower.isMain {
            let r = 10 * geometry.pixelsPerUnit(tower.lane)
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color.opacity(0.07)))
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color.opacity(0.35)), style: StrokeStyle(lineWidth: 1.5, dash: [5, 5]))
        }

        let radius: CGFloat = tower.isMain ? 22 : 15
        let box = CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(roundedRect: box, cornerRadius: tower.isMain ? 7 : 12), with: .color(color.opacity(tower.alive ? 0.9 : 1)))
        context.stroke(Path(roundedRect: box, cornerRadius: tower.isMain ? 7 : 12), with: .color(Color.white.opacity(0.5)), lineWidth: 2)
        context.draw(Text(tower.isMain ? "♜" : "▲").font(.system(size: tower.isMain ? 24 : 14)).foregroundColor(.white.opacity(tower.alive ? 0.95 : 0.4)), at: pt(c), anchor: .center)

        if tower.alive {
            let ratio = CGFloat(tower.maxHp > 0 ? Double(tower.hp) / Double(tower.maxHp) : 0)
            let w = radius * 2.4
            context.fill(Path(CGRect(x: c.x - w / 2, y: c.y - radius - 9, width: w, height: 5)), with: .color(Color.black.opacity(0.5)))
            context.fill(Path(CGRect(x: c.x - w / 2, y: c.y - radius - 9, width: w * ratio, height: 5)), with: .color(Theme.good))
        }
    }

    // MARK: 유닛

    private func drawUnit(_ context: GraphicsContext, _ unit: UnitSnapshot, pos: Double, index: Int, geometry: MapGeometry, piece: Piece?, name: String?) {
        let mine = unit.seat == seat
        // 같은 길 위의 유닛이 한 줄로 겹치지 않게 유닛마다 정해진 만큼 옆으로 흩어 놓는다.
        let seed = unit.id.unicodeScalars.reduce(0) { $0 &+ Int($1.value) } // 실행마다 같은 값(hashValue는 매번 달라진다)
        let sideways = Double((seed % 5) - 2) * 7 + (mine ? 6 : -6)
        let c = pt(geometry.offset(lane: unit.lane, pos: pos, sideways: sideways))
        let radius: CGFloat = unit.summon ? 9 : 16
        let color = mine ? Theme.mine : Theme.theirs

        let circle = CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: circle.offsetBy(dx: 0, dy: 3)), with: .color(Color.black.opacity(0.3))) // 그림자
        context.fill(Path(ellipseIn: circle), with: .color(color.opacity(0.92)))
        context.stroke(Path(ellipseIn: circle), with: .color(Color.white.opacity(0.85)), lineWidth: 2)
        if unit.shield > 0 {
            context.stroke(Path(ellipseIn: circle.insetBy(dx: -4, dy: -4)), with: .color(Theme.silver), lineWidth: 2)
        }
        if let piece, !unit.summon {
            context.draw(Text(Labels.pieceGlyph(piece)).font(.system(size: 20)).foregroundColor(.white), at: c, anchor: .center)
        }
        if unit.effects.contains("stun") {
            context.draw(Text("✦").font(.system(size: 14)).foregroundColor(Theme.warn), at: CGPoint(x: c.x, y: c.y - radius - 14), anchor: .center)
        }
        if unit.weapon != nil {
            context.draw(Text("⚔").font(.system(size: 10)).foregroundColor(.white), at: CGPoint(x: c.x + radius, y: c.y - radius), anchor: .center)
        }

        let ratio = CGFloat(unit.maxHp > 0 ? Double(unit.hp) / Double(unit.maxHp) : 0)
        let w = radius * 2.2
        context.fill(Path(CGRect(x: c.x - w / 2, y: c.y - radius - 8, width: w, height: 4)), with: .color(Color.black.opacity(0.5)))
        context.fill(Path(CGRect(x: c.x - w / 2, y: c.y - radius - 8, width: w * ratio, height: 4)), with: .color(ratio < 0.3 ? Theme.warn : (mine ? Theme.good : Theme.theirs)))

        if let name, !unit.summon {
            context.draw(Text(name).font(.system(size: 10, weight: .semibold)).foregroundColor(.white.opacity(0.85)), at: CGPoint(x: c.x, y: c.y + radius + 9), anchor: .center)
        }
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
