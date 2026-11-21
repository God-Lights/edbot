import EdbotKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        ZStack {
            AppBackground()
            if model.isInRoom {
                RoomView()
            } else {
                LobbyView()
            }
        }
        // 가이드는 로비에서도, 방 안에서도 열 수 있다. (방 안에서 열어 둔 동안에도 게임은 계속된다)
        .sheet(isPresented: $model.showGuide) { GuideView() }
        .sheet(isPresented: $model.showRanking) { RankingView() }
    }
}

/// 로비: 로고, 로그인, 방 만들기, 방 입장.
struct LobbyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var model = model
        HStack(spacing: 40) {
            // 왼쪽: 로고
            VStack(spacing: 16) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 420)
                    .shadow(color: Theme.purple.opacity(0.5), radius: 30)
                    .accessibilityLabel("COMMANDER")
                Text("2인 실시간 전략 대전")
                    .font(.title3)
                    .foregroundStyle(Theme.silver.opacity(0.8))
            }
            .frame(maxWidth: .infinity)

            // 오른쪽: 입력
            ScrollView {
                VStack(spacing: 16) {
                    accountCard
                    roomCard
                    serverCard
                    if let message = model.message {
                        Text(message).foregroundStyle(Theme.warn).multilineTextAlignment(.center)
                    }
                }
                .padding(4)
            }
            .frame(maxWidth: 480)
        }
        .padding(32)
        .onChange(of: model.loginURLToOpen) { _, url in
            guard let url else { return }
            openURL(url)
            model.loginURLToOpen = nil
        }
    }

    private var accountCard: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 12) {
            if let user = model.user {
                HStack {
                    VStack(alignment: .leading) {
                        Text("로그인됨").font(.caption).foregroundStyle(.secondary)
                        Text(user.nickname).font(.title3.bold())
                    }
                    Spacer()
                    Button("로그아웃") { model.logout() }.buttonStyle(SecondaryButtonStyle())
                }
            } else if model.isLoggingIn {
                HStack {
                    ProgressView()
                    Text("브라우저에서 로그인하는 중...")
                    Spacer()
                    Button("취소") { model.cancelLogin() }.buttonStyle(SecondaryButtonStyle())
                }
            } else {
                // 자동으로 넘기지 않고, 버튼을 눌렀을 때만 브라우저를 연다.
                Button { model.beginLogin() } label: {
                    Label("로그인하기", systemImage: "person.crop.circle").frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                TextField("이름 (로그인하지 않은 개발 서버용)", text: $model.playerName)
                    .textFieldStyle(.roundedBorder)
            }
        }
        .panel()
    }

    private var roomCard: some View {
        @Bindable var model = model
        return VStack(spacing: 14) {
            Button { model.createRoomAndJoin() } label: {
                Text(model.isCreatingRoom ? "방을 만드는 중..." : "방 만들기").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isCreatingRoom)

            HStack(spacing: 10) {
                Button { model.openRanking() } label: {
                    Label("랭킹", systemImage: "trophy").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { model.openGuide() } label: {
                    Label("게임 가이드", systemImage: "book").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
            }

            Button { model.joinTestMatch() } label: {
                Label("테스트 대전 (봇과 한 판)", systemImage: "cpu").frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())

            HStack {
                Rectangle().fill(Color.white.opacity(0.15)).frame(height: 1)
                Text("또는").font(.caption).foregroundStyle(.secondary)
                Rectangle().fill(Color.white.opacity(0.15)).frame(height: 1)
            }

            HStack(spacing: 10) {
                TextField("방 코드 4자리", text: $model.roomCodeText)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: model.roomCodeText) { _, value in
                        let cleaned = String(value.uppercased().prefix(4))
                        if cleaned != value { model.roomCodeText = cleaned }
                    }
                Button("입장") { model.join(code: model.roomCodeText) }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.roomCodeText.count != 4)
            }
        }
        .panel()
    }

    private var serverCard: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 6) {
            Text("서버").font(.caption).foregroundStyle(.secondary)
            TextField("서버 주소", text: $model.serverText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
        }
        .panel(padding: 12)
    }
}

/// 방 안. 단계에 맞는 화면을 보여 주고, 위쪽에 방 코드와 상대를 띄운다.
struct RoomView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let room = model.room {
            VStack(spacing: 12) {
                topBar(room)
                content(room)
                    .frame(maxHeight: .infinity, alignment: .top)
                if model.status == .reconnecting { Text("다시 연결하는 중...").foregroundStyle(Theme.warn) }
                if let message = model.message { Text(message).foregroundStyle(Theme.warn) }
            }
            .padding(20)
        }
    }

    private func topBar(_ room: RoomSnapshot) -> some View {
        HStack(spacing: 14) {
            Image("Logo").resizable().scaledToFit().frame(height: 40)
            Text(room.code).font(.system(size: 20, weight: .heavy, design: .monospaced)).foregroundStyle(Theme.silver)
            Spacer()
            ForEach(room.players) { player in
                HStack(spacing: 6) {
                    Circle().fill(player.connected ? Theme.good : Color.gray).frame(width: 8, height: 8)
                    Text(player.name + (player.id == model.myPlayerId ? " (나)" : "")).font(.subheadline)
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Capsule().fill((player.id == model.myPlayerId ? Theme.mine : Theme.theirs).opacity(0.18)))
            }
            Button { model.openGuide() } label: { Label("가이드", systemImage: "book") }.buttonStyle(SecondaryButtonStyle())
            Button("나가기") { model.leave() }.buttonStyle(SecondaryButtonStyle())
        }
    }

    @ViewBuilder private func content(_ room: RoomSnapshot) -> some View {
        let seat = model.mySeat
        switch room.phase {
        case .lobby:
            LobbyRoomView(room: room)
        case .ban:
            if let game = room.game, let seat { BanView(room: room, game: game, seat: seat) }
        case .draft:
            if let game = room.game, let seat { DraftView(room: room, game: game, seat: seat) }
        case .placement:
            if let game = room.game, let seat { PlacementView(room: room, game: game, seat: seat) }
        case .explore, .forge:
            if let seat { PreBattleView(room: room, seat: seat) }
        case .battle, .deathmatch:
            if let battle = room.battle, let seat {
                // 전투 화면 오른쪽에 탐사·대장간 패널을 열 수 있다. 열어 둔 동안에도 전투는 멈추지 않는다.
                HStack(alignment: .top, spacing: 12) {
                    BattleView(room: room, battle: battle, seat: seat)
                    if model.showWorkshop { WorkshopPanel(room: room, seat: seat) }
                }
            }
        case .prep:
            if let chess = room.chess, let seat { ChessPrepView(room: room, chess: chess, seat: seat) }
        case .combat:
            if let chess = room.chess, let seat { ChessCombatView(room: room, chess: chess, seat: seat) }
        case .result:
            if let seat { ResultView(room: room, seat: seat) }
        }
    }
}

/// 방 로비: 준비 버튼.
struct LobbyRoomView: View {
    @Environment(AppModel.self) private var model
    let room: RoomSnapshot

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 6) {
                Text("방 코드").font(.callout).foregroundStyle(.secondary)
                Text(room.code).font(.system(size: 72, weight: .heavy, design: .monospaced)).foregroundStyle(Theme.silver)
            }
            if room.players.count < 2 {
                Text("상대를 기다리는 중... 방 코드를 알려 주세요.").foregroundStyle(.secondary)
            }
            HStack(spacing: 14) {
                ForEach(room.players) { player in
                    VStack(spacing: 6) {
                        Text(player.name).font(.title3.bold())
                        Text(player.connected ? (player.ready ? "준비 완료" : "준비 중") : "연결 끊김")
                            .foregroundStyle(player.ready ? Theme.good : Color.secondary)
                    }
                    .frame(width: 180)
                    .panel()
                }
            }
            let ready = model.me?.ready ?? false
            Button { model.setReady(!ready) } label: {
                Text(ready ? "준비 취소" : "준비").frame(width: 220)
            }
            .buttonStyle(PrimaryButtonStyle())
            Spacer()
        }
    }
}
