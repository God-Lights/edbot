import EdbotKit
import SwiftUI

// 게스트 방(학번 + 이름으로 참가)과 관전: 방 만든 뒤 안내, 진행 중인 경기 목록, 관전 화면.

/// 게스트 방을 만든 직후의 안내: 코드를 알려 주고, 내가 참가할지 관전할지 고른다.
struct GuestRoomSheet: View {
    @Environment(AppModel.self) private var model
    let code: String

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 18) {
                Text("게스트 방이 만들어졌어요").font(.title2.bold())
                Text("방 코드").font(.callout).foregroundStyle(.secondary)
                Text(code).font(.system(size: 64, weight: .heavy, design: .monospaced)).foregroundStyle(Theme.silver)
                Text("참가자는 로비의 '게스트로 참가'에서 학번, 이름, 이 코드를 입력하면 들어와요. 이 방은 전적에 남지 않아요.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 520)
                HStack(spacing: 14) {
                    Button { start(spectate: false) } label: { Text("내가 플레이어로 참가").frame(minWidth: 200) }
                        .buttonStyle(PrimaryButtonStyle())
                    Button { start(spectate: true) } label: { Label("관전하기", systemImage: "eye").frame(minWidth: 140) }
                        .buttonStyle(SecondaryButtonStyle())
                }
                Button("닫기") { model.createdGuestRoomCode = nil }.buttonStyle(SecondaryButtonStyle())
            }
            .padding(32)
        }
        .preferredColorScheme(.dark)
    }

    private func start(spectate: Bool) {
        model.createdGuestRoomCode = nil
        model.join(code: code, spectate: spectate)
    }
}

/// 진행 중인 게스트 경기 목록. 하나를 고르면 관전한다. 열려 있는 동안 5초마다 새로 불러온다.
struct LiveView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 14) {
                HStack {
                    Text("진행 중인 게스트 경기").font(.title.bold())
                    Spacer()
                    Button { Task { await model.refreshLive() } } label: { Label("새로고침", systemImage: "arrow.clockwise") }
                        .buttonStyle(SecondaryButtonStyle())
                    Button("닫기") { model.showLive = false }.buttonStyle(SecondaryButtonStyle())
                }
                ScrollView {
                    VStack(spacing: 10) { listBody }
                        .frame(maxWidth: 900)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
        .task {
            while !Task.isCancelled {
                await model.refreshLive()
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    @ViewBuilder private var listBody: some View {
        if let error = model.liveError {
            Text(error).foregroundStyle(Theme.warn).frame(maxWidth: .infinity).panel()
        } else if model.liveRooms.isEmpty {
            Text("지금 진행 중인 게스트 경기가 없어요. 게스트 방을 만들거나 참가자가 들어오면 여기에 나타나요.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .panel()
        } else {
            ForEach(model.liveRooms) { room in
                liveRow(room)
            }
        }
    }

    private func phaseText(_ phase: String) -> String {
        switch phase {
        case "lobby": return "대기 중"
        case "prep": return "준비 중"
        case "combat": return "전투 중"
        case "result": return "결과"
        default: return phase
        }
    }

    private func liveRow(_ room: LiveRoom) -> some View {
        let who: String = room.players.isEmpty
            ? "참가자를 기다리는 중"
            : room.players.map { ($0.studentId.map { "\($0) " } ?? "") + $0.name + ($0.connected ? "" : " (끊김)") }.joined(separator: "  vs  ")
        var detail: String = phaseText(room.phase)
        if room.round > 0 { detail += " · 라운드 \(room.round)/\(room.maxRounds)" }
        if let hps = room.hps, hps.count == 2 { detail += " · 체력 \(max(0, hps[0])) : \(max(0, hps[1]))" }
        detail += " · 방 \(room.code)"
        if !room.host.isEmpty { detail += " · 만든 사람 \(room.host)" }
        return HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(who).font(.headline)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if room.mine == true {
                Button { Task { await model.closeRoom(code: room.code) } } label: { Label("삭제", systemImage: "trash") }
                    .buttonStyle(SecondaryButtonStyle())
            }
            Button { model.watch(code: room.code) } label: { Label("관전", systemImage: "eye") }
                .buttonStyle(PrimaryButtonStyle())
        }
        .panel()
    }
}

/// 내가 만든 방(게스트 방과 일반 방) 관리: 하나씩 지우거나 모두 닫는다.
struct MyRoomsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmAll = false

    var body: some View {
        ZStack {
            AppBackground()
            VStack(spacing: 14) {
                HStack {
                    Text("내 방 관리").font(.title.bold())
                    Spacer()
                    if !model.myRooms.isEmpty {
                        Button { confirmAll = true } label: { Label("모두 닫기 (\(model.myRooms.count))", systemImage: "trash") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    Button { Task { await model.refreshMyRooms() } } label: { Label("새로고침", systemImage: "arrow.clockwise") }
                        .buttonStyle(SecondaryButtonStyle())
                    Button("닫기") { model.showMyRooms = false }.buttonStyle(SecondaryButtonStyle())
                }
                Text("방을 닫으면 안에 있는 사람이 모두 나가지고, 방의 내용이 지워져요. 내가 만든 방만 보여요.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let message = model.message { Text(message).font(.callout).foregroundStyle(Theme.warn) }
                ScrollView {
                    VStack(spacing: 10) { listBody }
                        .frame(maxWidth: 900)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
        .task { await model.refreshMyRooms() }
        .confirmationDialog("내가 만든 방을 모두 닫을까요?", isPresented: $confirmAll, titleVisibility: .visible) {
            Button("모두 닫기", role: .destructive) { Task { await model.closeAllMyRooms() } }
            Button("취소", role: .cancel) {}
        } message: {
            Text("안에 있는 사람이 모두 나가져요.")
        }
    }

    @ViewBuilder private var listBody: some View {
        if let error = model.myRoomsError {
            Text(error).foregroundStyle(Theme.warn).frame(maxWidth: .infinity).panel()
        } else if model.myRooms.isEmpty {
            Text("내가 만든 방이 없어요.").foregroundStyle(.secondary).frame(maxWidth: .infinity).panel()
        } else {
            ForEach(model.myRooms) { room in
                row(room)
            }
        }
    }

    private func row(_ room: LiveRoom) -> some View {
        let who: String = room.players.isEmpty
            ? "참가자 없음"
            : room.players.map { ($0.studentId.map { "\($0) " } ?? "") + $0.name + ($0.connected ? "" : " (끊김)") }.joined(separator: "  vs  ")
        var detail: String = Labels.livePhase(room.phase)
        if room.round > 0 { detail += " · 라운드 \(room.round)/\(room.maxRounds)" }
        detail += " · " + who
        return HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("방 \(room.code) · \(room.guest == true ? "게스트 방" : "일반 방")").font(.headline)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await model.closeRoom(code: room.code) } } label: { Label("삭제", systemImage: "trash") }
                .buttonStyle(SecondaryButtonStyle())
        }
        .panel()
    }
}

/// 관전 화면: 전투와 체력만 보인다. (준비 단계의 상점과 배치는 보이지 않는다) 판은 플레이어 1이 아래.
struct SpectatorView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot

    private var names: [String] {
        [0, 1].map { seat in room.players.first { $0.seat == seat }?.name ?? "?" }
    }

    var body: some View {
        VStack(spacing: 12) {
            if let chess = room.chess, room.phase != .lobby { header(chess) }
            content
        }
    }

    private func header(_ chess: ChessSnapshot) -> some View {
        let hps: [Int] = chess.hps ?? [chess.me?.hp ?? 0, chess.opponent?.hp ?? 0]
        return HStack(spacing: 18) {
            hpBox(names[0], hps[safe: 0] ?? 0, Theme.mine)
            VStack(spacing: 2) {
                Text("라운드 \(chess.round) / \(chess.maxRounds)").font(.headline)
                TimelineView(.periodic(from: .now, by: 0.5)) { context in
                    Text("\(Labels.phaseName(room.phase)) \(Labels.countdown(model.remainingMs(now: context.date)))")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
            .frame(minWidth: 130)
            hpBox(names[1], hps[safe: 1] ?? 0, Theme.theirs)
            Spacer()
            Label("관전 중", systemImage: "eye")
                .font(.caption.bold())
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Capsule().fill(Theme.good.opacity(0.25)))
        }
        .panel(padding: 10)
    }

    private func hpBox(_ name: String, _ hp: Int, _ color: Color) -> some View {
        let ratio: Double = min(1, max(0, Double(hp) / 30))
        return VStack(alignment: .leading, spacing: 3) {
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
        .frame(width: 170)
    }

    @ViewBuilder private var content: some View {
        switch room.phase {
        case .combat:
            if let combat = room.chess?.combat {
                HStack(alignment: .top, spacing: 14) {
                    ChessArena(room: room, combat: combat, seat: 0)
                        .aspectRatio(1, contentMode: .fit)
                    VStack(spacing: 10) {
                        team("플레이어 1 · \(names[0])", Theme.mine, combat.boards[safe: 0] ?? [])
                        team("플레이어 2 · \(names[1])", Theme.theirs, combat.boards[safe: 1] ?? [])
                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: 300)
                }
            } else {
                waiting("전투를 불러오는 중...")
            }
        case .prep:
            waiting("플레이어들이 준비하는 중...", detail: "준비 단계의 상점과 배치는 보이지 않아요. 전투가 시작되면 함께 볼 수 있어요.")
        case .result:
            resultBox
        default:
            VStack(spacing: 8) {
                Text(room.code).font(.system(size: 56, weight: .heavy, design: .monospaced)).foregroundStyle(Theme.silver)
                Text("\(names[0]) vs \(names[1]) · 경기가 시작되기를 기다리는 중...").foregroundStyle(.secondary)
            }
            .padding(.top, 60)
        }
    }

    private func waiting(_ title: String, detail: String? = nil) -> some View {
        VStack(spacing: 8) {
            ProgressView()
            Text(title).font(.headline)
            if let detail { Text(detail).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center) }
        }
        .padding(.top, 60)
    }

    private var resultBox: some View {
        VStack(spacing: 14) {
            if let result = room.result {
                let title: String = result.winner.map { "\(names[safe: $0] ?? "?") 승리!" } ?? "무승부"
                Text(title).font(.system(size: 54, weight: .heavy, design: .rounded)).foregroundStyle(Theme.silver)
                Text(Labels.resultReason(result.reason)).font(.title3).foregroundStyle(.secondary)
                HStack(spacing: 40) {
                    stat("남은 체력", "\(result.score[safe: 0] ?? 0) : \(result.score[safe: 1] ?? 0)")
                    stat("라운드 승", "\(result.kills[safe: 0] ?? 0) : \(result.kills[safe: 1] ?? 0)")
                }
                .panel()
            }
        }
        .padding(.top, 40)
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
        }
    }

    private func team(_ title: String, _ color: Color, _ placements: [ChessCombatPlacement]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.bold()).foregroundStyle(color).lineLimit(1)
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
