import EdbotKit
import SwiftUI

/// 자원 한 줄.
struct ResourceBar: View {
    let resources: ExploreResources?

    var body: some View {
        HStack(spacing: 10) {
            item("💰", resources?.talent)
            item("🌿", resources?.branch)
            item("🪨", resources?.stone)
            item("⛏️", resources?.ore)
            item("🔩", resources?.ironIngot)
            item("💎", resources?.rare)
            item("📜", resources?.blueprints)
        }
        .font(.subheadline.monospacedDigit())
    }

    private func item(_ icon: String, _ value: Int?) -> some View {
        HStack(spacing: 3) {
            Text(icon)
            Text("\(value ?? 0)").bold()
        }
    }
}

/// 탐사: 4x4 지도에서 채집·매복·정찰. 행동 게이지를 1 쓴다.
struct ExplorePanel: View {
    @Environment(AppModel.self) private var model
    let explore: ExploreSnapshot

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 4)

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("탐사").font(.title3.bold())
                Spacer()
                gaugePips
            }
            ResourceBar(resources: explore.resources)

            Picker("행동", selection: $model.exploreAction) {
                ForEach(ExploreAction.allCases, id: \.self) { action in
                    Text(Labels.actionName(action)).tag(action)
                }
            }
            .pickerStyle(.segmented)

            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(explore.tiles) { tile in
                    TileButton(tile: tile, explore: explore) { model.explore(tile: tile.index) }
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(explore.events.suffix(4).reversed())) { event in
                    Text("· " + Labels.exploreEvent(event)).font(.caption).foregroundStyle(Theme.silver.opacity(0.85))
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var gaugePips: some View {
        HStack(spacing: 6) {
            Text("행동").font(.caption).foregroundStyle(.secondary)
            ForEach(0..<explore.gaugeMax, id: \.self) { index in
                Circle()
                    .fill(index < explore.gauge ? Theme.accent : Color.white.opacity(0.15))
                    .frame(width: 16, height: 16)
            }
            if let next = explore.gaugeNextInTicks {
                Text("+1까지 \(Int(ceil(explore.seconds(next))))초").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/// 지도의 칸 하나.
struct TileButton: View {
    let tile: ExploreTileSnapshot
    let explore: ExploreSnapshot
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(Labels.tileGlyph(tile.known ? tile.kind : nil)).font(.system(size: 30))
                Text(label).font(.system(size: 11, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
                if let line = statusLine { Text(line).font(.system(size: 10, weight: .bold)).foregroundStyle(lineColor) }
            }
            .frame(maxWidth: .infinity, minHeight: 78)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(background))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(border, lineWidth: tile.enemyAmbush ? 3 : 1.5))
            .opacity(tile.known && tile.depleted && tile.kind != "empty" ? 0.55 : 1)
        }
        .buttonStyle(.plain)
    }

    private var label: String { tile.known ? Labels.tileName(tile.kind) : "안개" }

    private var statusLine: String? {
        if tile.enemyAmbush { return "⚠ 상대 매복" }
        if let ticks = tile.myGatherInTicks { return "채집 \(Int(ceil(explore.seconds(ticks))))초" }
        if let ticks = tile.myAmbushInTicks { return "매복 \(Int(ceil(explore.seconds(ticks))))초" }
        if tile.known, tile.depleted, tile.kind != "empty" {
            return tile.respawnInTicks.map { "재생 \(Int(ceil(explore.seconds($0))))초" } ?? "비었음"
        }
        return nil
    }

    private var lineColor: Color {
        if tile.enemyAmbush { return Theme.warn }
        if tile.myAmbushInTicks != nil { return Theme.theirs }
        return Theme.good
    }

    private var background: Color {
        tile.known ? Theme.panelStrong : Color.white.opacity(0.04)
    }

    private var border: Color {
        if tile.enemyAmbush { return Theme.warn }
        if tile.myGatherInTicks != nil { return Theme.good }
        if tile.myAmbushInTicks != nil { return Theme.theirs }
        return Color.white.opacity(0.12)
    }
}

/// 대장간: 광석 구입, 재련, 무기 조합, 장착.
struct ForgePanel: View {
    @Environment(AppModel.self) private var model
    let forge: ForgeSnapshot
    let explore: ExploreSnapshot
    let game: GameSnapshot
    let seat: Int

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("대장간").font(.title3.bold())
                    Spacer()
                    Text("스팀포스 \(String(format: "%.1f", forge.steam))/\(Int(forge.steamMax))").font(.subheadline.monospacedDigit())
                }

                HStack(spacing: 10) {
                    Button { model.buyOre() } label: { Text("광석 사기 (💰\(forge.orePrice))").frame(maxWidth: .infinity) }
                        .buttonStyle(SecondaryButtonStyle())
                    Button { model.smelt() } label: { Text("재련 (⛏️1 💰2 스팀3)").frame(maxWidth: .infinity) }
                        .buttonStyle(SecondaryButtonStyle())
                }
                smelters

                Text("조합").font(.headline)
                ForEach(model.weapons) { weapon in
                    Button { model.craft(weapon.id) } label: { weaponRow(weapon) }
                        .buttonStyle(.plain)
                        .disabled(!weapon.canCraft(with: explore.resources))
                        .opacity(weapon.canCraft(with: explore.resources) ? 1 : 0.4)
                }

                Text("인벤토리 (무기를 고르고 캐릭터의 '끼우기'를 누르세요)").font(.headline)
                inventory

                Text("장착").font(.headline)
                ForEach(game.picks[safe: seat] ?? [], id: \.self) { id in
                    equipRow(id)
                }
            }
        }
    }

    private var smelters: some View {
        HStack(spacing: 10) {
            ForEach(Array(forge.smelters.enumerated()), id: \.offset) { index, job in
                HStack {
                    Text("재련대 \(index + 1)").font(.caption)
                    Spacer()
                    Text(job.map { "\(Int(ceil(forge.seconds($0.remainingTicks))))초" } ?? "비었음")
                        .font(.caption.bold()).foregroundStyle(job == nil ? Color.secondary : Theme.good)
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panel))
            }
        }
    }

    private func weaponRow(_ weapon: WeaponInfo) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(weapon.nameKo).font(.subheadline.bold())
                Text("\(Labels.weaponKind(weapon.kind)) · 공격 +\(Int((weapon.atkBonus * 100).rounded()))%").font(.caption).foregroundStyle(.secondary)
                Spacer()
            }
            Text(weapon.recipe.sorted { $0.key < $1.key }.map { "\(Labels.materialName($0.key)) \($0.value)" }.joined(separator: ", "))
                .font(.caption2).foregroundStyle(.secondary)
            if let effect = weapon.effectText { Text("★ " + effect).font(.caption2).foregroundStyle(Theme.warn) }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panel))
    }

    @ViewBuilder private var inventory: some View {
        let owned = forge.inventory.filter { $0.value > 0 }.sorted { $0.key < $1.key }
        if owned.isEmpty {
            Text("비었음").font(.caption).foregroundStyle(.secondary)
        } else {
            ForEach(owned, id: \.key) { id, count in
                Button { model.selectedWeaponId = id } label: {
                    HStack {
                        Text(model.selectedWeaponId == id ? "●" : "○")
                        Text((model.weapon(id)?.nameKo ?? id) + " x\(count)").font(.subheadline.bold())
                        Spacer()
                    }
                    .padding(8)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(model.selectedWeaponId == id ? Theme.accent.opacity(0.25) : Theme.panel))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func equipRow(_ id: String) -> some View {
        let info = model.character(id)
        let current = forge.equipped[id].map { model.weapon($0)?.nameKo ?? $0 } ?? "-"
        let pending = forge.equipping[id]
        let canEquip = model.selectedWeaponId.map { (forge.inventory[$0] ?? 0) > 0 } ?? false
        return HStack(spacing: 10) {
            if let info { PieceBadge(piece: info.piece, size: 30) }
            VStack(alignment: .leading, spacing: 0) {
                Text(info?.nameKo ?? id).font(.subheadline.bold())
                Text(pending.map { "\(current) → \(model.weapon($0.weaponId)?.nameKo ?? $0.weaponId) \(Int(ceil(forge.seconds($0.remainingTicks))))초" } ?? current)
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("끼우기") { model.equip(characterId: id) }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(!canEquip)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panel))
    }
}

/// 전투 전(탐사·대장간 단계): 지도와 대장간을 나란히 크게 보여 준다.
struct PreBattleView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let seat: Int

    var body: some View {
        VStack(spacing: 12) {
            PhaseHeader(title: Labels.phaseName(room.phase), subtitle: "재료를 모으고 무기를 만들어 두세요. 전투 중에도 계속할 수 있어요.", endsAt: room.phaseEndsAt)
            if let explore = room.explore, let forge = room.forge, let game = room.game {
                HStack(alignment: .top, spacing: 14) {
                    ExplorePanel(explore: explore).panel().frame(maxWidth: .infinity)
                    ForgePanel(forge: forge, explore: explore, game: game, seat: seat).panel().frame(maxWidth: .infinity)
                }
            } else {
                Spacer()
            }
        }
    }
}

/// 전투 중 오른쪽에 여는 패널: 탐사와 대장간을 전환해서 쓴다. 열어 둔 동안에도 전투는 멈추지 않는다.
struct WorkshopPanel: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot
    let seat: Int
    @State private var tab = 0

    var body: some View {
        VStack(spacing: 10) {
            Picker("", selection: $tab) {
                Text("탐사").tag(0)
                Text("대장간").tag(1)
            }
            .pickerStyle(.segmented)
            if let explore = room.explore, let forge = room.forge, let game = room.game {
                if tab == 0 {
                    ExplorePanel(explore: explore)
                } else {
                    ForgePanel(forge: forge, explore: explore, game: game, seat: seat)
                }
            }
        }
        .panel()
        .frame(width: 430)
    }
}
