import EdbotKit
import Foundation
import Observation

enum ConnectionStatus: Equatable {
    case idle, connecting, connected, reconnecting
}

/// 앱 전체의 상태. 화면은 이것만 보고 그리고, 서버와의 통신은 EdbotKit이 맡는다.
@MainActor
@Observable
final class AppModel {
    // 입력
    var serverText = "https://edgame-api.officialgl.com"
    var playerName = "Player"
    var roomCodeText = ""

    // 로그인
    var user: AuthUser?
    private(set) var authToken: String?
    private(set) var isLoggingIn = false
    /// 값이 생기면 화면이 브라우저로 연다. (열고 나면 지운다)
    var loginURLToOpen: URL?

    // 방
    private(set) var room: RoomSnapshot?
    private(set) var myPlayerId: String?
    private(set) var status: ConnectionStatus = .idle
    private(set) var isCreatingRoom = false
    private(set) var clock = ServerClock()
    var message: String?

    private let tokens: TokenStore
    private var connection: RoomConnection?
    private var eventTask: Task<Void, Never>?
    private var loginTask: Task<Void, Never>?

    init(tokens: TokenStore = KeychainTokenStore()) {
        self.tokens = tokens
        authToken = tokens.load()
        if authToken != nil { Task { await restoreLogin() } }
    }

    var serverURL: URL? { normalizeServerURL(serverText) }
    var me: PublicPlayer? { room?.player(id: myPlayerId) }
    var isInRoom: Bool { room != nil }

    /// 단계가 끝날 때까지 남은 시간(ms). 타이머가 없으면 nil.
    func remainingMs(now: Date = Date()) -> Int64? {
        clock.remainingMs(until: room?.phaseEndsAt, localNowMs: Int64(now.timeIntervalSince1970 * 1000))
    }

    // MARK: 로그인

    private func restoreLogin() async {
        guard let token = authToken, let url = serverURL else { return }
        do {
            if let user = try await AuthClient(baseURL: url).me(token: token) {
                self.user = user
            } else {
                clearLogin() // 만료되었다
            }
        } catch {
            // 서버에 닿지 못한 것일 수 있어서 토큰은 지우지 않는다.
        }
    }

    /// "로그인하기" 버튼을 눌렀을 때. 브라우저로 GL Account 로그인 화면을 열고, 끝나면 토큰을 받아 온다.
    func beginLogin() {
        guard !isLoggingIn, let url = serverURL else {
            message = "서버 주소를 확인해 주세요."
            return
        }
        isLoggingIn = true
        message = nil
        loginTask = Task { [weak self] in
            defer { self?.isLoggingIn = false }
            do {
                let auth = AuthClient(baseURL: url)
                let start = try await auth.start()
                guard let loginURL = URL(string: start.loginUrl) else { throw ApiError.badResponse }
                self?.loginURLToOpen = loginURL
                self?.message = "브라우저에서 로그인한 뒤 '로그인 확인'을 눌러 주세요."
                let deadline = Date().addingTimeInterval(TimeInterval(max(30, start.expiresInSeconds)))
                while Date() < deadline, !Task.isCancelled {
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    switch try await auth.poll(loginId: start.loginId) {
                    case .pending:
                        continue
                    case .expired:
                        self?.message = "로그인 시간이 지났어요. 다시 눌러 주세요."
                        return
                    case let .approved(token, user):
                        self?.tokens.save(token)
                        self?.authToken = token
                        self?.user = user
                        self?.message = nil
                        return
                    }
                }
                if !Task.isCancelled { self?.message = "로그인 시간이 지났어요. 다시 눌러 주세요." }
            } catch is CancellationError {
            } catch {
                self?.message = "로그인할 수 없어요: \(error.localizedDescription)"
            }
        }
    }

    func cancelLogin() {
        loginTask?.cancel()
    }

    /// 게임 세션을 끊는다. (GL 계정 로그아웃은 account.officialgl.com 에서)
    func logout() {
        let token = authToken
        clearLogin()
        guard let token, let url = serverURL else { return }
        Task { try? await AuthClient(baseURL: url).logout(token: token) }
    }

    private func clearLogin() {
        tokens.clear()
        authToken = nil
        user = nil
    }

    // MARK: 방

    func createRoomAndJoin() {
        guard !isCreatingRoom, let url = serverURL else {
            message = "서버 주소를 확인해 주세요."
            return
        }
        isCreatingRoom = true
        message = nil
        Task {
            defer { isCreatingRoom = false }
            do {
                let code = try await ApiClient(baseURL: url, authToken: authToken).createRoom()
                join(code: code)
            } catch ApiError.unauthorized {
                clearLogin()
                message = "로그인이 필요해요. 로그인하기를 눌러 주세요."
            } catch {
                message = "방을 만들 수 없어요: \(error.localizedDescription)"
            }
        }
    }

    func join(code: String) {
        guard let url = serverURL else {
            message = "서버 주소를 확인해 주세요."
            return
        }
        leave()
        message = nil
        status = .connecting
        let connection = RoomConnection(factory: URLSessionWebSocketFactory())
        self.connection = connection
        eventTask = Task { [weak self] in
            for await event in connection.events {
                self?.handle(event)
            }
        }
        // 로그인했다면 서버가 GL 닉네임을 이름으로 쓴다.
        let name = user?.nickname ?? playerName
        let token = authToken
        Task { await connection.start(wsBase: webSocketBase(url), roomCode: code, name: name, authToken: token) }
    }

    func leave() {
        let connection = self.connection
        self.connection = nil
        eventTask?.cancel()
        eventTask = nil
        room = nil
        myPlayerId = nil
        status = .idle
        clock = ServerClock()
        if let connection { Task { await connection.stop() } }
    }

    func setReady(_ ready: Bool) {
        guard let connection else { return }
        Task { await connection.sendReady(ready) }
    }

    private func handle(_ event: NetEvent) {
        switch event {
        case let .connected(playerId, room, reconnected):
            myPlayerId = playerId
            observe(room)
            status = .connected
            message = reconnected ? "다시 연결되었어요." : nil
        case let .state(room):
            observe(room)
        case let .error(code, text):
            message = Labels.error(code) ?? text
        case let .reconnecting(attempt):
            status = .reconnecting
            message = "연결이 끊겨서 다시 접속하는 중... (\(attempt))"
        case let .disconnected(reason):
            if reason != "stopped" {
                message = Labels.disconnect(reason) ?? message
            }
            room = nil
            myPlayerId = nil
            status = .idle
            connection = nil
        }
    }

    private func observe(_ room: RoomSnapshot) {
        clock.observe(serverTime: room.serverTime, localNowMs: currentTimeMs())
        self.room = room
    }
}
