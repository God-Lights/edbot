import EdbotKit
import Foundation

/// 로비에서 컨트롤러로 고르는 메뉴 (화면의 오른쪽 메뉴 순서)
enum LobbyPadItem: Int, CaseIterable {
    case findMatch, practice, full, mobius, createRoom, ranking, guide
}

/// 컨트롤러 버튼을 지금 화면에 맞는 일로 바꾼다.
///
/// | 버튼 | 로비 | 대기실 | 준비 단계 | 결과 |
/// |---|---|---|---|---|
/// | 십자키·왼쪽 스틱 | 메뉴 고르기 | | 칸 옮기기 | |
/// | Ⓐ | 고른 메뉴 | 준비 | 사기 / 기물 집기·놓기 | 로비로 |
/// | Ⓑ | 게임 찾기 취소 | 나가기 | 집은 기물 내려놓기 | 로비로 |
/// | Ⓧ | | | 팔기 | |
/// | Ⓨ | | | 새로고침 | |
/// | L1 | | | 자동 배치 | |
/// | ☰ | 게임 찾기 | 준비 | 준비 끝 | |
/// | ⧉ | 가이드 | 가이드 | 가이드 | 가이드 |
/// 가이드가 열려 있으면 L1·R1(또는 좌우)로 탭을 바꾸고 Ⓑ로 닫는다. 다른 창은 Ⓑ로 닫는다.
extension AppModel {
    func handlePad(_ command: PadCommand) {
        if command != .menu { padEmptyDoneArmed = false }
        if showGuide { padGuide(command); return }
        if showRanking || showLive || showMyRooms || showPacks || createdGuestRoomCode != nil || showWorkshop || showRecord {
            if command == .back || command == .options {
                showRanking = false
                showLive = false
                showMyRooms = false
                showPacks = false
                showWorkshop = false
                showRecord = false
                createdGuestRoomCode = nil
            }
            return
        }
        guard let room else { padLobby(command); return }
        if command == .options { openGuide(room.phase == .prep ? .controls : .flow); return }
        if isSpectating {
            if command == .back { leave() }
            return
        }
        switch room.phase {
        case .lobby:
            if command == .confirm || command == .menu { setReady(!(me?.ready ?? false)) }
            if command == .back { leave() }
        case .prep:
            padPrep(command, room: room)
        case .result:
            if command == .confirm || command == .back { leave() }
        default:
            break
        }
    }

    /// 지금 화면에서 버튼이 하는 일 (화면 아래 안내 띠). 컨트롤러가 없으면 빈 목록.
    var padHints: [(button: String, text: String)] {
        guard padName != nil else { return [] }
        guard let room else {
            return [("십자키", "메뉴 고르기"), ("Ⓐ", "고르기"), ("☰", "게임 찾기"), ("Ⓑ", "찾기 취소"), ("⧉", "가이드")]
        }
        if isSpectating { return [("Ⓑ", "관전 끝내기"), ("⧉", "가이드")] }
        switch room.phase {
        case .lobby: return [("Ⓐ", (me?.ready ?? false) ? "준비 취소" : "준비"), ("Ⓑ", "나가기"), ("⧉", "가이드")]
        case .prep:
            if room.chess?.me?.done == true { return [("Ⓑ", "내려놓기"), ("⧉", "가이드"), ("", "상대를 기다리는 중")] }
            return [("Ⓐ", selectedUid == nil ? "사기·집기" : "놓기"), ("Ⓑ", "내려놓기"), ("Ⓧ", "팔기"), ("Ⓨ", "새로고침"), ("L1", "자동 배치"), ("☰", "준비 끝"), ("⧉", "가이드")]
        case .result: return [("Ⓐ", "로비로"), ("⧉", "가이드")]
        default: return [("⧉", "가이드")]
        }
    }

    // MARK: 가이드

    private func padGuide(_ command: PadCommand) {
        let tabs = GuideTab.allCases.filter { $0 != .packs || !packs.isEmpty }
        let at = tabs.firstIndex(of: guideTab) ?? 0
        switch command {
        case .back, .options: showGuide = false
        case .prevTab, .left: guideTab = tabs[max(0, at - 1)]
        case .nextTab, .right: guideTab = tabs[min(tabs.count - 1, at + 1)]
        default: break
        }
    }

    // MARK: 로비

    private func padLobby(_ command: PadCommand) {
        let last = LobbyPadItem.allCases.count - 1
        switch command {
        case .up, .left: lobbyPadIndex = max(0, lobbyPadIndex - 1)
        case .down, .right: lobbyPadIndex = min(last, lobbyPadIndex + 1)
        case .confirm: runLobbyItem(LobbyPadItem(rawValue: lobbyPadIndex) ?? .findMatch)
        case .menu: if quickMatch == nil { startQuickMatch() }
        case .back: if quickMatch != nil { cancelQuickMatch() }
        case .options: openGuide()
        default: break
        }
    }

    private func runLobbyItem(_ item: LobbyPadItem) {
        switch item {
        case .findMatch: if quickMatch == nil { startQuickMatch() } else { cancelQuickMatch() }
        case .practice: joinTestMatch()
        case .full: join(code: "ADMF")
        case .mobius: join(code: "ADMX")
        case .createRoom: createRoomAndJoin()
        case .ranking: openRanking()
        case .guide: openGuide()
        }
    }

    // MARK: 준비 단계

    private func clampPadSpot(me: ChessSelfSnapshot) {
        let spot = ChessPadGrid.clamp(padSpot, benchCount: me.bench.count, shopCount: me.shop.count)
        if spot != padSpot { padSpot = spot }
    }

    private func movePadSpot(_ command: PadCommand, me: ChessSelfSnapshot) {
        let direction: PadDirection
        switch command {
        case .up: direction = .up
        case .down: direction = .down
        case .left: direction = .left
        case .right: direction = .right
        default: return
        }
        let spot = ChessPadGrid.move(padSpot, direction, benchCount: me.bench.count, shopCount: me.shop.count)
        guard spot != padSpot else { return }
        padSpot = spot
        play(.click)
    }

    /// 컨트롤러가 가리키는 칸의 기물
    private func padUnit(me: ChessSelfSnapshot) -> ChessUnitView? {
        if padSpot.row < chessDeployRows { return me.board.first { $0.col == padSpot.index && $0.row == padSpot.row } }
        if padSpot.row == PadSpot.benchRow, padSpot.index < me.bench.count { return me.bench[padSpot.index] }
        return nil
    }

    private func padPrep(_ command: PadCommand, room: RoomSnapshot) {
        guard let chess = room.chess, let me = chess.me else { return }
        clampPadSpot(me: me)
        switch command {
        case .up, .down, .left, .right:
            movePadSpot(command, me: me)
        case .back:
            selectedUid = nil
            selectedWeaponId = nil
            combineFirst = nil
        case _ where me.done:
            break // 준비 끝을 눌렀으면 이번 라운드는 바꿀 수 없다
        case .confirm:
            padActivate(me: me, chess: chess)
        case .action:
            // 팔기: 집은 기물, 없으면 가리키는 칸의 기물
            if let uid = selectedUid ?? padUnit(me: me)?.uid { chessSell(uid) }
        case .secondary:
            if me.gold >= me.rerollCost { chessReroll() }
        case .prevTab:
            if me.bench.contains(where: { $0 != nil }), me.board.count < chess.deployCap { chessAutoPlace(me, cap: chess.deployCap) }
        case .menu:
            if me.board.isEmpty && !padEmptyDoneArmed {
                padEmptyDoneArmed = true
                flash("판에 기물이 없어요. 이대로 싸우면 이 라운드는 져요. ☰을 한 번 더 누르면 준비 끝.")
            } else {
                padEmptyDoneArmed = false
                chessDone()
            }
        default:
            break
        }
    }

    /// Ⓐ: 화면을 누른 것과 같다 (상점 카드 = 사기, 기물 = 집기, 집은 채로 칸 = 놓기·자리 바꾸기)
    private func padActivate(me: ChessSelfSnapshot, chess: ChessSnapshot) {
        let spot = padSpot
        if spot.row == PadSpot.shopRow {
            if spot.index == 0 {
                if me.gold >= me.rerollCost { chessReroll() }
            } else if spot.index - 1 < me.shop.count, me.shop[spot.index - 1] != nil {
                chessBuy(slot: spot.index - 1)
            }
            return
        }
        if spot.row == PadSpot.benchRow && spot.index == me.bench.count {
            chessAutoPlace(me, cap: chess.deployCap)
            return
        }
        let unit = padUnit(me: me)
        if let weaponId = selectedWeaponId {
            if let unit { chessEquip(weaponId, uid: unit.uid) }
            return
        }
        if spot.row < chessDeployRows {
            if let selected = selectedUid {
                if unit?.uid == selected { selectedUid = nil } else { chessDeploy(selected, col: spot.index, row: spot.row) }
            } else if let unit {
                selectedUid = unit.uid
                play(.click)
            }
            return
        }
        // 대기석
        guard let selected = selectedUid else {
            if let unit { selectedUid = unit.uid; play(.click) }
            return
        }
        if let unit {
            selectedUid = unit.uid == selected ? nil : unit.uid
        } else if me.board.contains(where: { $0.uid == selected }) {
            chessBench(selected)
        }
    }
}
