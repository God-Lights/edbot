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

    // 소리: 효과음 끄기, 배경 음악 켜기 (Sfx가 저장한다)
    private(set) var soundMuted = Sfx.shared.muted
    private(set) var musicOn = Sfx.shared.musicOn

    // 게스트 로그인(학번 + 이름)과 게스트 방, 관전
    var guestStudentId = UserDefaults.standard.string(forKey: "guestStudentId") ?? ""
    var guestName = UserDefaults.standard.string(forKey: "guestName") ?? ""
    var guestCodeText = ""
    /// 관전자로 들어와 있다 (플레이어가 아니다)
    private(set) var isSpectating = false
    /// 방금 만든 게스트 방의 코드. 값이 있으면 안내 시트를 연다.
    var createdGuestRoomCode: String?
    private(set) var isCreatingGuestRoom = false
    /// 방을 만들 때 무한 모드로 만들지 (기억한다)
    var createMobius: Bool = UserDefaults.standard.bool(forKey: "createMobius") {
        didSet { UserDefaults.standard.set(createMobius, forKey: "createMobius") }
    }
    private(set) var liveRooms: [LiveRoom] = []
    private(set) var liveError: String?
    private(set) var isLoadingLive = false
    var showLive = false
    private(set) var myRooms: [LiveRoom] = []
    private(set) var myRoomsError: String?
    private(set) var isLoadingMyRooms = false
    var showMyRooms = false

    // 체스판 자동 전투
    private(set) var chessUnits: [ChessUnitInfo] = []
    private(set) var chessSynergies: [ChessSynergyInfo] = []
    private(set) var chessMaterials: [ChessMaterialInfo] = []
    private(set) var chessWeapons: [ChessWeaponInfo] = []
    private(set) var chessFusions: [ChessFusion] = []
    /// 탭으로 조합하는 방식이 켜져 있다 (아이템 둘을 차례로 누른다)
    private(set) var combineMode = false
    /// 조합 방식에서 먼저 누른 아이템
    var combineFirst: ChessItem?
    /// 준비 단계에서 고른 내 기물(대기석 또는 판 위). 칸을 누르면 거기에 놓는다.
    var selectedUid: String?

    private let tokens: TokenStore
    private var connection: RoomConnection?
    private var eventTask: Task<Void, Never>?
    private var loginTask: Task<Void, Never>?

    init(tokens: TokenStore = KeychainTokenStore()) {
        self.tokens = tokens
        Sfx.shared.resumeMusicIfNeeded()
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
        selectedWeaponId = nil
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
    func chessMaterial(_ id: String) -> ChessMaterialInfo? { chessMaterials.first { $0.id == id } }
    /// 기본 무기뿐 아니라 ★2(`id*`)·융합(`a+b`) 무기도 이름과 설명을 돌려준다.
    func chessWeapon(_ id: String) -> ChessWeaponInfo? { ChessCrafting.weaponInfo(id, weapons: chessWeapons) }

    func itemName(_ item: ChessItem) -> String {
        item.kind == .material ? (chessMaterial(item.id)?.nameKo ?? item.id) : (chessWeapon(item.id)?.nameKo ?? item.id)
    }

    func setCombineMode(_ on: Bool) {
        combineMode = on
        combineFirst = nil
    }

    /// 조합 방식에서 아이템을 눌렀다: 처음이면 고르고, 두 번째면 합친다.
    func combineTap(_ item: ChessItem) {
        if let first = combineFirst {
            combineFirst = nil
            chessCombine(first, item)
        } else {
            combineFirst = item
        }
    }

    func chessCombine(_ a: ChessItem, _ b: ChessItem) {
        guard let connection else { return }
        play(.combine)
        Task { await connection.sendCombine(a, b) }
    }

    private func loadChess(from url: URL) {
        guard chessUnits.isEmpty else { return }
        Task {
            if let catalog = try? await ApiClient(baseURL: url).chessCatalog() {
                chessUnits = catalog.units
                chessSynergies = catalog.synergies
                chessMaterials = catalog.materials
                chessWeapons = catalog.weapons
                chessFusions = catalog.fusions ?? []
            }
        }
    }

    // MARK: 체스판 자동 전투 행동

    func chessBuy(slot: Int) {
        guard let connection else { return }
        play(.buy)
        Task { await connection.sendBuy(slot: slot) }
    }

    func chessSell(_ uid: String) {
        guard let connection else { return }
        play(.sell)
        selectedUid = nil
        Task { await connection.sendSell(uid) }
    }

    // 자원 시스템

    func chessBuyMaterial(slot: Int) {
        guard let connection else { return }
        play(.buy)
        Task { await connection.sendMarket(slot: slot) }
    }

    func chessSmelt(_ material: String) {
        guard let connection else { return }
        play(.smelt)
        Task { await connection.sendSmelt(material) }
    }

    func chessEquip(_ weaponId: String, uid: String) {
        guard let connection else { return }
        play(.equip)
        selectedWeaponId = nil
        Task { await connection.sendEquip(weaponId, uid: uid) }
    }

    func chessUnequip(_ uid: String) {
        guard let connection else { return }
        Task { await connection.sendUnequip(uid) }
    }

    func chessReroll() {
        guard let connection else { return }
        play(.click)
        Task { await connection.sendReroll() }
    }

    func chessDeploy(_ uid: String, col: Int, row: Int) {
        guard let connection else { return }
        play(.place)
        selectedUid = nil
        Task { await connection.sendDeploy(uid, col: col, row: row) }
    }

    func chessBench(_ uid: String) {
        guard let connection else { return }
        play(.place)
        selectedUid = nil
        Task { await connection.sendBench(uid) }
    }

    /// 대기석의 기물을 알아서 판에 놓는다. 단단한 역할은 앞줄, 약한 역할은 뒷줄, 가운데 칸부터 채운다.
    func chessAutoPlace(_ me: ChessSelfSnapshot, cap: Int) {
        guard let connection else { return }
        var taken = Set<Int>()
        for unit in me.board {
            if let col = unit.col, let row = unit.row { taken.insert(row * chessBoardSize + col) }
        }
        var free: Int = cap - me.board.count
        let cols: [Int] = [3, 4, 2, 5, 1, 6, 0, 7]
        let bench: [ChessUnitView] = me.bench.compactMap { $0 }.sorted { preferredRow($0) < preferredRow($1) }
        var moves: [(uid: String, col: Int, row: Int)] = []
        for unit in bench {
            if free <= 0 { break }
            let first: Int = preferredRow(unit)
            let rows: [Int] = [first] + (0..<chessDeployRows).filter { $0 != first }
            var placed = false
            for row in rows where !placed {
                for col in cols where !taken.contains(row * chessBoardSize + col) {
                    taken.insert(row * chessBoardSize + col)
                    moves.append((unit.uid, col, row))
                    placed = true
                    break
                }
            }
            if placed { free -= 1 }
        }
        selectedUid = nil
        let finalMoves = moves
        Task {
            for move in finalMoves { await connection.sendDeploy(move.uid, col: move.col, row: move.row) }
        }
    }

    private func preferredRow(_ unit: ChessUnitView) -> Int {
        switch chessUnit(unit.defId)?.role ?? "" {
        case "탱커": return 0
        case "지휘", "암살", "기동": return 1
        case "제어", "딜러": return 2
        default: return 3
        }
    }

    func chessDone() {
        guard let connection else { return }
        play(.ready)
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
                let code = try await ApiClient(baseURL: url, authToken: authToken).createRoom(mobius: createMobius)
                join(code: code)
            } catch ApiError.unauthorized {
                clearLogin()
                message = "로그인이 필요해요. 로그인하기를 눌러 주세요."
            } catch {
                message = "방을 만들 수 없어요: \(error.localizedDescription)"
            }
        }
    }

    /// 게스트 방을 만든다. GL 로그인이 필요하다. 만든 사람은 바로 들어가지 않고, 코드 안내 시트에서 참가나 관전을 고른다.
    func createGuestRoom() {
        guard !isCreatingGuestRoom, let url = serverURL else {
            message = "서버 주소를 확인해 주세요."
            return
        }
        isCreatingGuestRoom = true
        message = nil
        Task {
            defer { isCreatingGuestRoom = false }
            do {
                let code = try await ApiClient(baseURL: url, authToken: authToken).createRoom(guest: true, mobius: createMobius)
                createdGuestRoomCode = code
            } catch ApiError.unauthorized {
                clearLogin()
                message = "게스트 방은 GL 로그인 후에 만들 수 있어요."
            } catch {
                message = "방을 만들 수 없어요: \(error.localizedDescription)"
            }
        }
    }

    /// 학번과 이름으로 게스트 방에 들어간다. (GL 로그인 없이)
    func joinAsGuest(code: String) {
        guard let guest = GuestLogin.make(studentId: guestStudentId, name: guestName) else {
            message = GuestLogin.isValidStudentId(guestStudentId.trimmingCharacters(in: .whitespaces))
                ? "이름을 입력해 주세요."
                : "학번은 숫자 4~10자리예요. (예: 20211)"
            return
        }
        guard code.trimmingCharacters(in: .whitespaces).count == 4 else {
            message = "방 코드는 4자리예요."
            return
        }
        UserDefaults.standard.set(guest.studentId, forKey: "guestStudentId")
        UserDefaults.standard.set(guest.name, forKey: "guestName")
        join(code: code, guest: guest)
    }

    /// 진행 중인 게스트 경기 목록을 불러온다. GL 로그인이 필요하다.
    func refreshLive() async {
        guard !isLoadingLive, let url = serverURL else { return }
        isLoadingLive = true
        defer { isLoadingLive = false }
        do {
            liveRooms = try await ApiClient(baseURL: url, authToken: authToken).liveRooms()
            liveError = nil
        } catch ApiError.unauthorized {
            liveError = "GL 로그인이 필요해요."
        } catch {
            liveError = "목록을 불러오지 못했어요."
        }
    }

    /// 내가 만든 방 목록을 불러온다. GL 로그인이 필요하다.
    func refreshMyRooms() async {
        guard !isLoadingMyRooms, let url = serverURL else { return }
        isLoadingMyRooms = true
        defer { isLoadingMyRooms = false }
        do {
            myRooms = try await ApiClient(baseURL: url, authToken: authToken).myRooms()
            myRoomsError = nil
        } catch ApiError.unauthorized {
            myRoomsError = "GL 로그인이 필요해요."
        } catch {
            myRoomsError = "목록을 불러오지 못했어요."
        }
    }

    /// 방을 닫는다(만든 사람만). 안에 있는 사람이 모두 나가지고 방의 내용이 지워진다.
    func closeRoom(code: String) async {
        guard let url = serverURL else { return }
        do {
            let closed = try await ApiClient(baseURL: url, authToken: authToken).closeRoom(code: code)
            message = closed ? "방 \(code)을(를) 닫았어요." : "이미 없는 방이에요."
        } catch ApiError.status(403) {
            message = "방을 만든 사람만 닫을 수 있어요."
        } catch ApiError.unauthorized {
            message = "GL 로그인이 필요해요."
        } catch {
            message = "방을 닫지 못했어요."
        }
        await refreshMyRooms()
        await refreshLive()
    }

    /// 내가 만든 방을 모두 닫는다.
    func closeAllMyRooms() async {
        guard let url = serverURL else { return }
        let api = ApiClient(baseURL: url, authToken: authToken)
        var closed = 0
        for room in myRooms {
            if (try? await api.closeRoom(code: room.code)) == true { closed += 1 }
        }
        message = "\(closed)개 방을 닫았어요."
        await refreshMyRooms()
        await refreshLive()
    }

    /// 목록에서 고른 경기를 관전한다.
    func watch(code: String) {
        showLive = false
        join(code: code, spectate: true)
    }

    func join(code: String, spectate: Bool = false, guest: GuestLogin? = nil) {
        guard let url = serverURL else {
            message = "서버 주소를 확인해 주세요."
            return
        }
        leave()
        isSpectating = spectate
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
        let name = guest?.name ?? user?.nickname ?? playerName
        // 게스트는 GL 로그인 없이 들어간다. (로그인 토큰을 같이 보내지 않는다)
        let token = guest == nil ? authToken : nil
        Task { await connection.start(wsBase: webSocketBase(url), roomCode: code, name: name, authToken: token, guest: guest, spectate: spectate) }
    }

    func leave() {
        let connection = self.connection
        self.connection = nil
        eventTask?.cancel()
        eventTask = nil
        room = nil
        Sfx.shared.setScene(.prep)
        myPlayerId = nil
        isSpectating = false
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
        play(.ready)
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

    func toggleSound() {
        soundMuted.toggle()
        Sfx.shared.setMuted(soundMuted)
        if !soundMuted { Sfx.shared.play(.click) }
    }

    func toggleMusic() {
        musicOn.toggle()
        Sfx.shared.setMusic(musicOn)
    }

    func play(_ sound: Sfx.Sound) { Sfx.shared.play(sound) }

    /// 직전 화면과 비교해서 알맞은 효과음을 낸다: 라운드 시작, 전투 시작, 판이 가득 참, ★2 합성, 무기 장착, 결과.
    private func playChangeSounds(from previous: RoomSnapshot?, to room: RoomSnapshot) {
        if previous?.phase != room.phase {
            switch room.phase {
            case .prep: play(.roundStart)
            case .combat: play(.combatStart)
            case .result:
                if let winner = room.result?.winner {
                    play(winner == mySeat ? .win : .lose)
                } else {
                    play(.click)
                }
            default: break
            }
            return
        }
        guard room.phase == .prep, let before = previous?.chess?.me, let after = room.chess?.me, previous?.chess?.round == room.chess?.round else { return }
        let oldUnits: [ChessUnitView] = before.board + before.bench.compactMap { $0 }
        let newUnits: [ChessUnitView] = after.board + after.bench.compactMap { $0 }
        let oldIds = Set(oldUnits.map { $0.uid })
        let oldWeapons: [String: String] = Dictionary(uniqueKeysWithValues: oldUnits.compactMap { unit in unit.weapon.map { (unit.uid, $0) } })
        if newUnits.contains(where: { $0.star >= 2 && !oldIds.contains($0.uid) }) {
            play(.merge)
        } else if newUnits.contains(where: { unit in unit.weapon != nil && oldIds.contains(unit.uid) && oldWeapons[unit.uid] != unit.weapon }) {
            play(.equip)
        } else if let cap = room.chess?.deployCap, before.board.count < cap, after.board.count >= cap {
            play(.full)
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
        if previous?.phase != room.phase || previous?.chess?.round != room.chess?.round {
            selectedUid = nil
            selectedWeaponId = nil
            combineFirst = nil
        }
        if let battle = room.battle {
            interpolator.update(battle.units, at: Date.timeIntervalSinceReferenceDate)
        } else if previous?.battle != nil {
            interpolator.reset()
        }
        playChangeSounds(from: previous, to: room)
        Sfx.shared.setScene(Self.musicScene(for: room))
        self.room = room
    }

    /// 지금 상황에 맞는 배경 음악: 로비·준비는 prep, 전투는 combat, 마지막 라운드·체력이 위태로울 때·결과는 finale.
    static func musicScene(for room: RoomSnapshot?) -> Sfx.Track {
        guard let room else { return .prep }
        if room.phase == .result { return .finale }
        if let chess = room.chess, room.phase == .prep || room.phase == .combat {
            let lowest: Int = (chess.hps ?? []).min() ?? 99
            if chess.round >= chess.maxRounds - 1 || lowest <= 8 { return .finale }
        }
        return [Phase.combat, .battle, .deathmatch].contains(room.phase) ? .combat : .prep
    }
}
