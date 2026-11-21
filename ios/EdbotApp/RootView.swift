import EdbotKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Color(red: 0.07, green: 0.08, blue: 0.11).ignoresSafeArea()
            if model.isInRoom {
                RoomView()
            } else {
                LobbyView()
            }
        }
    }
}

/// 로비: 로그인, 방 만들기, 방 입장.
struct LobbyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(spacing: 20) {
                Text("COMMANDER")
                    .font(.system(size: 44, weight: .heavy, design: .rounded))
                    .padding(.top, 40)

                card {
                    Text("서버").font(.caption).foregroundStyle(.secondary)
                    TextField("서버 주소", text: $model.serverText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textFieldStyle(.roundedBorder)
                }

                card {
                    if let user = model.user {
                        HStack {
                            Text("로그인: **\(user.nickname)**")
                            Spacer()
                            Button("로그아웃") { model.logout() }.buttonStyle(.bordered)
                        }
                    } else if model.isLoggingIn {
                        HStack {
                            ProgressView()
                            Text("브라우저에서 로그인하는 중...")
                            Spacer()
                            Button("취소") { model.cancelLogin() }.buttonStyle(.bordered)
                        }
                    } else {
                        // 자동으로 넘기지 않고, 버튼을 눌렀을 때만 브라우저를 연다.
                        Button { model.beginLogin() } label: {
                            Text("로그인하기").frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                        TextField("이름 (로그인하지 않은 개발 서버용)", text: $model.playerName)
                            .textFieldStyle(.roundedBorder)
                    }
                }

                card {
                    Button { model.createRoomAndJoin() } label: {
                        Text(model.isCreatingRoom ? "방을 만드는 중..." : "방 만들기")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isCreatingRoom)

                    Divider()
                    HStack {
                        TextField("방 코드 4자리", text: $model.roomCodeText)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: model.roomCodeText) { _, value in
                                let cleaned = String(value.uppercased().prefix(4))
                                if cleaned != value { model.roomCodeText = cleaned }
                            }
                        Button("입장") { model.join(code: model.roomCodeText) }
                            .buttonStyle(.bordered)
                            .frame(minHeight: 44)
                            .disabled(model.roomCodeText.count != 4)
                    }
                }

                if let message = model.message {
                    Text(message).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: 520)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .onChange(of: model.loginURLToOpen) { _, url in
            guard let url else { return }
            openURL(url)
            model.loginURLToOpen = nil
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.07)))
    }
}

/// 방 안: 단계, 남은 시간, 플레이어. 로비에서는 준비 버튼. 나머지 단계 화면은 뒤 단계에서 만든다.
struct RoomView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let room = model.room {
            VStack(spacing: 24) {
                HStack {
                    VStack(alignment: .leading) {
                        Text("방 코드").font(.caption).foregroundStyle(.secondary)
                        Text(room.code).font(.system(size: 40, weight: .heavy, design: .monospaced))
                    }
                    Spacer()
                    // 1초마다 남은 시간을 다시 그린다.
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        VStack(alignment: .trailing) {
                            Text(Labels.phaseName(room.phase)).font(.title2.bold())
                            Text("남은 시간 \(Labels.countdown(model.remainingMs(now: context.date)))")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                VStack(spacing: 10) {
                    ForEach(room.players) { player in
                        HStack {
                            Text(player.name + (player.id == model.myPlayerId ? " (나)" : "")).font(.title3)
                            Spacer()
                            Text(player.connected ? (player.ready ? "준비 완료" : "") : "연결 끊김")
                                .foregroundStyle(player.ready ? Color.green : Color.secondary)
                        }
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.07)))
                    }
                }

                if room.phase == .lobby {
                    if room.players.count < 2 {
                        Text("상대를 기다리는 중... 방 코드를 알려 주세요.").foregroundStyle(.secondary)
                    }
                    let ready = model.me?.ready ?? false
                    Button { model.setReady(!ready) } label: {
                        Text(ready ? "준비 취소" : "준비").frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Text("\(Labels.phaseName(room.phase)) 화면은 다음 단계에서 만들어요.")
                        .foregroundStyle(.secondary)
                }

                if model.status == .reconnecting { Text("다시 연결하는 중...").foregroundStyle(.orange) }
                if let message = model.message { Text(message).foregroundStyle(.orange) }

                Spacer()
                Button("나가기", role: .destructive) { model.leave() }.buttonStyle(.bordered)
            }
            .frame(maxWidth: 640)
            .padding(24)
        }
    }
}
