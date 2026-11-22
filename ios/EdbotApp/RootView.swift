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
        .sheet(isPresented: $model.showLive) { LiveView() }
        .sheet(isPresented: $model.showMyRooms) { MyRoomsView() }
        .sheet(isPresented: Binding(get: { model.createdGuestRoomCode != nil }, set: { if !$0 { model.createdGuestRoomCode = nil } })) {
            GuestRoomSheet(code: model.createdGuestRoomCode ?? "")
        }
    }
}

/// 로비: 로고, 로그인, 방 만들기, 방 입장.
struct LobbyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    @Environment(\.verticalSizeClass) private var vSize
    private var compact: Bool { vSize == .compact }

    /// 한 화면에 다 들어오게: 왼쪽 로고, 가운데 계정·게스트·서버, 오른쪽 방 메뉴. (스크롤 없음)
    var body: some View {
        @Bindable var model = model
        HStack(alignment: .center, spacing: compact ? 12 : 28) {
            VStack(spacing: compact ? 6 : 16) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: compact ? 170 : 360)
                    .shadow(color: Theme.purple.opacity(0.5), radius: 30)
                    .accessibilityLabel("COMMANDER")
                Text("2인 실시간 전략 대전")
                    .font(compact ? .caption : .title3)
                    .foregroundStyle(Theme.silver.opacity(0.8))
            }
            .frame(maxWidth: compact ? 190 : .infinity)

            VStack(spacing: compact ? 6 : 12) {
                accountCard
                guestCard
                serverCard
                if let message = model.message {
                    Text(message).font(.caption).foregroundStyle(Theme.warn).multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: 400, maxHeight: .infinity)

            roomCard
                .frame(maxWidth: 400, maxHeight: .infinity)
        }
        .padding(compact ? 10 : 28)
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
        .panel(padding: compact ? 8 : 16)
    }

    /// GL 계정이 없는 사람이 학번과 이름으로 게스트 방에 들어간다.
    private var guestCard: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: compact ? 6 : 10) {
            Label("게스트로 참가", systemImage: "graduationcap.fill").font(compact ? .subheadline.bold() : .headline)
            if !compact {
                Text("GL 계정이 없어도 학번과 이름만으로 게스트 방에 들어갈 수 있어요. (전적은 남지 않아요)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                TextField("학번 (예: 20211)", text: $model.guestStudentId)
                    .keyboardType(.numberPad)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: model.guestStudentId) { _, value in
                        let cleaned = String(value.filter { $0.isASCII && $0.isNumber }.prefix(10))
                        if cleaned != value { model.guestStudentId = cleaned }
                    }
                TextField("이름", text: $model.guestName)
                    .textFieldStyle(.roundedBorder)
            }
            HStack(spacing: 10) {
                TextField("방 코드 4자리", text: $model.guestCodeText)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: model.guestCodeText) { _, value in
                        let cleaned = String(value.uppercased().prefix(4))
                        if cleaned != value { model.guestCodeText = cleaned }
                    }
                Button("참가") { model.joinAsGuest(code: model.guestCodeText) }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.guestCodeText.count != 4)
            }
        }
        .panel(padding: compact ? 8 : 16)
    }

    private var roomCard: some View {
        @Bindable var model = model
        let cols: [GridItem] = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]
        return VStack(spacing: compact ? 6 : 12) {
            Toggle(isOn: $model.createMobius) { Label("무한 모드로 만들기", systemImage: "infinity") }
                .font(.subheadline)
                .tint(Theme.accent)
            Button { model.createRoomAndJoin() } label: {
                Text(model.isCreatingRoom ? "방을 만드는 중..." : "방 만들기").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isCreatingRoom)

            LazyVGrid(columns: cols, spacing: 8) {
                if model.user != nil {
                    Button { model.createGuestRoom() } label: {
                        Label(model.isCreatingGuestRoom ? "만드는 중..." : "게스트 방", systemImage: "graduationcap").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.isCreatingGuestRoom)
                    Button { model.showLive = true } label: {
                        Label("경기 관전", systemImage: "eye").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button { model.showMyRooms = true } label: {
                        Label("내 방 관리", systemImage: "trash").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                Button { model.openRanking() } label: {
                    Label("랭킹", systemImage: "trophy").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { model.openGuide() } label: {
                    Label("가이드", systemImage: "book").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { model.joinTestMatch() } label: {
                    Label("연습 대전", systemImage: "cpu").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { model.join(code: "ADMF") } label: {
                    Label("전체 대전", systemImage: "cpu.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
                Button { model.join(code: "ADMX") } label: {
                    Label("무한 대전", systemImage: "infinity").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButtonStyle())
            }

            HStack(spacing: 10) {
                TextField("방 코드 4자리", text: $model.roomCodeText)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: compact ? 18 : 22, weight: .bold, design: .monospaced))
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
        .panel(padding: compact ? 8 : 16)
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
        .panel(padding: compact ? 8 : 12)
    }
}

/// 방 안. 단계에 맞는 화면을 보여 주고, 위쪽에 방 코드와 상대를 띄운다.
struct RoomView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmClose = false
    @Environment(\.verticalSizeClass) private var vSize

    var body: some View {
        if let room = model.room {
            VStack(spacing: vSize == .compact ? 4 : 12) {
                topBar(room)
                content(room)
                    .frame(maxHeight: .infinity, alignment: .top)
                    // 단계가 바뀔 때(준비 → 전투 → 결과) 부드럽게 바뀐다.
                    .id(room.phase)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
                if model.status == .reconnecting { Text("다시 연결하는 중...").foregroundStyle(Theme.warn) }
                if let message = model.message { Text(message).foregroundStyle(Theme.warn) }
            }
            .padding(vSize == .compact ? 8 : 20)
            .animation(.easeInOut(duration: 0.35), value: room.phase)
            .confirmationDialog("방을 닫을까요?", isPresented: $confirmClose, titleVisibility: .visible) {
                Button("방 닫기", role: .destructive) { Task { await model.closeRoom(code: room.code) } }
                Button("취소", role: .cancel) {}
            } message: {
                Text("안에 있는 사람이 모두 나가지고, 방의 내용이 지워져요.")
            }
        }
    }

    private func topBar(_ room: RoomSnapshot) -> some View {
        HStack(spacing: vSize == .compact ? 8 : 14) {
            Image("Logo").resizable().scaledToFit().frame(height: vSize == .compact ? 26 : 40)
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
            Button { model.toggleSound() } label: {
                Image(systemName: model.soundMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
            }
            .buttonStyle(SecondaryButtonStyle())
            Button { model.toggleMusic() } label: {
                Image(systemName: model.musicOn ? "music.note" : "music.note.list")
            }
            .buttonStyle(SecondaryButtonStyle())
            Button { model.openGuide() } label: { Image(systemName: "book") }.buttonStyle(SecondaryButtonStyle())
            if room.isHost == true {
                Button { confirmClose = true } label: { Image(systemName: "trash") }.buttonStyle(SecondaryButtonStyle())
            }
            Button(model.isSpectating ? "관전 끝내기" : "나가기") { model.leave() }.buttonStyle(SecondaryButtonStyle())
        }
    }

    @ViewBuilder private func content(_ room: RoomSnapshot) -> some View {
        let seat = model.mySeat
        if model.isSpectating {
            SpectatorView(room: room)
        } else { playerContent(room, seat: seat) }
    }

    @ViewBuilder private func playerContent(_ room: RoomSnapshot, seat: Int?) -> some View {
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
    @Environment(\.verticalSizeClass) private var vSize

    var body: some View {
        VStack(spacing: vSize == .compact ? 8 : 24) {
            Spacer()
            VStack(spacing: 6) {
                Text("방 코드").font(.callout).foregroundStyle(.secondary)
                Text(room.code).font(.system(size: vSize == .compact ? 44 : 72, weight: .heavy, design: .monospaced)).foregroundStyle(Theme.silver)
                if room.mobius == true {
                    Label("무한 모드", systemImage: "infinity").font(.caption.bold())
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(Theme.accent.opacity(0.3)))
                }
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
                    .frame(width: vSize == .compact ? 140 : 180)
                    .panel(padding: vSize == .compact ? 8 : 16)
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
