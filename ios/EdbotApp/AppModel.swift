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

    // 밴·드래프트·배치 화면
    private(set) var roster: [CharacterInfo] = []
    /// 밴이나 뽑기로 고르는 중인 캐릭터. 확정 버튼을 눌러야 서버로 간다.
    var selectedCharacterId: String?
    /// 배치에서 레인을 정하려고 고른 내 캐릭터.
    var selectedPlacementId: String?

    /// 전투 중 유닛 위치를 부드럽게 보이게 하는 보간기. 화면이 매 프레임 읽는다.
    let interpolator = BattleInterpolator()

    // 랭킹
    private(set) var leaderboard: [LeaderboardEntry] = []
    private(set) var myStats: PlayerStats?
    private(set) var myMatches: [MatchSummary] = []
    private(set) var isLoadingRanking = false
    private(set) var rankingError: String?
    var showRanking = false

    // 가이드와 시너지
    private(set) var synergies: [SynergyInfo] = []
    /// 가이드 화면을 열어 두었는가. (방 안에서도 열 수 있고, 열어 둔 동안에도 게임은 계속된다)
    var showGuide = false
    var guideTab: GuideTab = .flow

    // 탐사·대장간
    private(set) var weapons: [WeaponInfo] = []
    /// 전투 중 오른쪽에 탐사·대장간 패널을 열어 두었는가.
    var showWorkshop = false
    /// 탐사에서 칸을 누르면 할 행동.
    var exploreAction: ExploreAction = .gather
    /// 대장간에서 장착하려고 고른 무기.
    var selectedWeaponId: String?

    // 체스판 자동 전투
    private(set) var chessUnits: [ChessUnitInfo] = []
    private(set) var chessSynergies: [ChessSynergyInfo] = []
    /// 준비 단계에서 고른 내 기물(대기석 또는 판 위). 칸을 누르면 거기에 놓는다.
    var selectedUid: String?

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
    var mySeat: Int? { me?.seat }
    var game: GameSnapshot? { room?.game }

    func character(_ id: String) -> CharacterInfo? { roster.first { $0.id == id } }

    /// 단계나 차례가 바뀌면 고르던 것을 비운다.
    private func clearSelections() {
        selectedCharacterId = nil
        selectedPlacementId = nil
        selectedUid = nil
    }

    private func loadRoster(from url: URL) {
        guard roster.isEmpty else { return }
        Task {
            do {
                roster = try await ApiClient(baseURL: url).characters()
            } catch {
                message = "캐릭터 데이터를 불러오지 못했어요: \(error.localizedDescription)"
            }
        }
    }

    func ban(_ id: String) {
        guard let connection else { return }
        Task { await connection.sendBan(id) }
    }

    func pick(_ id: String) {
        guard let connection else { return }
        Task { await connection.sendPick(id) }
    }

    func place(_ id: String, lane: Lane) {
        guard let connection else { return }
        Task { await connection.sendPlace(id, lane: lane) }
    }

    /// 궁극기를 쓴다 (스팀포스 5, 40초 재사용). 안키오는 갈 레인을 같이 보낸다.
    func useUltimate(_ unit: UnitSnapshot, lane: Lane? = nil) {
        guard let connection else { return }
        let id = unit.characterId
        Task { await connection.sendUltimate(id, lane: lane) }
    }

    /// 나이트가 다른 레인으로 옮겨 간다.
    func moveLane(_ unit: UnitSnapshot, to lane: Lane) {
        guard let connection else { return }
        let id = unit.characterId
        Task { await connection.sendMoveLane(id, lane: lane) }
    }

    /// 테스트 대전: 봇과 한 판. (서버의 방 코드 ADMN)
    func joinTestMatch() {
        join(code: "ADMN")
    }

    // MARK: 탐사·대장간

    /// 랭킹 화면을 열고 최신 순위와 내 전적을 불러온다. 로그인하지 않았으면 순위만 가져온다.
    func openRanking() {
        showRanking = true
        refreshRanking()
    }

    func refreshRanking() {
        guard !isLoadingRanking, let url = serverURL else { return }
        isLoadingRanking = true
        rankingError = nil
        let token = authToken
        Task {
            defer { isLoadingRanking = false }
            do {
                let api = ApiClient(baseURL: url, authToken: token)
                leaderboard = try await api.leaderboard(limit: 20)
                if token != nil {
                    do {
                        myStats = try await api.myStats()
                        myMatches = try await api.myMatches(limit: 10)
                    } catch ApiError.unauthorized {
                        clearLogin() // 로그인이 만료되었다
                        myStats = nil
                        myMatches = []
                    }
                } else {
                    myStats = nil
                    myMatches = []
                }
            } catch ApiError.status(503) {
                rankingError = "랭킹 서버가 아직 준비되지 않았어요. 잠시 뒤에 다시 시도해 주세요."
            } catch {
                rankingError = "랭킹을 불러오지 못했어요: \(error.localizedDescription)"
            }
        }
    }

    func chessUnit(_ id: String) -> ChessUnitInfo? { chessUnits.first { $0.id == id } }
    func chessSynergy(_ id: String) -> ChessSynergyInfo? { chessSynergies.first { $0.id == id } }

    private func loadChess(from url: URL) {
        guard chessUnits.isEmpty else { return }
        Task {
            if let catalog = try? await ApiClient(baseURL: url).chessCatalog() {
                chessUnits = catalog.units
                chessSynergies = catalog.synergies
            }
        }
    }

    // MARK: 체스판 자동 전투 행동

    func chessBuy(slot: Int) {
        guard let connection else { return }
        Task { await connection.sendBuy(slot: slot) }
    }

    func chessSell(_ uid: String) {
        guard let connection else { return }
        selectedUid = nil
        Task { await connection.sendSell(uid) }
    }

    func chessReroll() {
        guard let connection else { return }
        Task { await connection.sendReroll() }
    }

    func chessDeploy(_ uid: String, col: Int, row: Int) {
        guard let connection else { return }
        selectedUid = nil
        Task { await connection.sendDeploy(uid, col: col, row: row) }
    }

    func chessBench(_ uid: String) {
        guard let connection else { return }
        selectedUid = nil
        Task { await connection.sendBench(uid) }
    }

    func chessDone() {
        guard let connection else { return }
        selectedUid = nil
        Task { await connection.sendDone() }
    }

    /// 항복한다. 준비·전투 어느 때든 되고 상대가 바로 이긴다.
    func surrender() {
        guard let connection else { return }
        Task { await connection.sendSurrender() }
    }

    func synergy(_ id: String) -> SynergyInfo? { synergies.first { $0.id == id } }

    /// 가이드를 열 때 서버 데이터(캐릭터, 시너지, 무기)가 아직 없으면 불러온다. 방에 들어가기 전에도 볼 수 있다.
    func openGuide(_ tab: GuideTab = .flow) {
        guideTab = tab
        showGuide = true
        guard let url = serverURL else { return }
        loadRoster(from: url)
        loadWeapons(from: url)
        loadSynergies(from: url)
        loadChess(from: url)
    }

    private func loadSynergies(from url: URL) {
        guard synergies.isEmpty else { return }
        Task {
            if let list = try? await ApiClient(baseURL: url).synergies() { synergies = list }
        }
    }

    func weapon(_ id: String) -> WeaponInfo? { weapons.first { $0.id == id } }

    func explore(tile: Int) {
        guard let connection else { return }
        let action = exploreAction
        Task { await connection.sendExplore(action, tile: tile) }
    }

    func buyOre(quantity: Int = 1) {
        guard let connection else { return }
        Task { await connection.sendForgeBuy(quantity: quantity) }
    }

    func smelt() {
        guard let connection else { return }
        Task { await connection.sendForgeSmelt() }
    }

    func craft(_ weaponId: String) {
        guard let connection else { return }
        Task { await connection.sendForgeCraft(weaponId) }
    }

    func equip(characterId: String) {
        guard let connection, let weaponId = selectedWeaponId else { return }
        Task { await connection.sendForgeEquip(weaponId, characterId: characterId) }
    }

    private func loadWeapons(from url: URL) {
        guard weapons.isEmpty else { return }
        Task {
            if let list = try? await ApiClient(baseURL: url).weapons() { weapons = list }
        }
    }

    func lockPlacement() {
        guard let connection else { return }
        Task { await connection.sendLock() }
    }

    /// 서버 시각 target까지 남은 시간(ms).
    func remainingMs(until target: Int64?, now: Date = Date()) -> Int64? {
        clock.remainingMs(until: target, localNowMs: Int64(now.timeIntervalSince1970 * 1000))
    }
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
        loadRoster(from: url)
        loadWeapons(from: url)
        loadSynergies(from: url)
        loadChess(from: url)
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
        clearSelections()
        interpolator.reset()
        showWorkshop = false
        selectedWeaponId = nil
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
        let previous = self.room
        if previous?.phase != room.phase || previous?.game?.turnSeat != room.game?.turnSeat
            || previous?.game?.pickCount != room.game?.pickCount {
            selectedCharacterId = nil
        }
        if previous?.phase != room.phase { selectedPlacementId = nil }
        if previous?.phase != room.phase || previous?.chess?.round != room.chess?.round { selectedUid = nil }
        if let battle = room.battle {
            interpolator.update(battle.units, at: Date.timeIntervalSinceReferenceDate)
        } else if previous?.battle != nil {
            interpolator.reset()
        }
        self.room = room
    }
}
