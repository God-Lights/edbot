import GameController
import Observation
import SwiftUI

/// 게임 컨트롤러(엑스박스·플레이스테이션·MFi 등)에서 오는 명령. 화면마다 AppModel.handlePad 가 뜻을 정한다.
enum PadCommand: Equatable {
    case up, down, left, right
    /// Ⓐ (플스 ✕): 고르기·사기·놓기
    case confirm
    /// Ⓑ (플스 ○): 취소·닫기·나가기
    case back
    /// Ⓧ (플스 □): 팔기
    case action
    /// Ⓨ (플스 △): 새로고침
    case secondary
    /// L1 / R1
    case prevTab, nextTab
    /// L2 / R2
    case leftTrigger, rightTrigger
    /// ☰ (메뉴, 플스 Options): 준비 끝·준비
    case menu
    /// ⧉ (보기, 플스 Share/Create): 가이드
    case options
}

/// 연결된 게임 컨트롤러를 지켜보고, 버튼을 PadCommand 로 바꿔 넘긴다.
/// 방향(십자키·왼쪽 스틱)은 누르고 있으면 되풀이된다. (처음 0.35초 뒤부터 0.11초마다)
@MainActor
@Observable
final class GamepadInput {
    /// 연결된 컨트롤러 이름 (없으면 nil)
    private(set) var connectedName: String?
    @ObservationIgnored var onCommand: (@MainActor (PadCommand) -> Void)?
    @ObservationIgnored var onConnectionChange: (@MainActor (String?) -> Void)?

    @ObservationIgnored private var observers: [NSObjectProtocol] = []
    @ObservationIgnored private var heldDirection: PadCommand?
    @ObservationIgnored private var repeatTask: Task<Void, Never>?
    /// 왼쪽 스틱이 지금 가리키는 방향 (가운데로 돌아오면 nil)
    @ObservationIgnored private var stickDirection: PadCommand?

    func start() {
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] note in
            guard let controller = note.object as? GCController else { return }
            MainActor.assumeIsolated { self?.attach(controller) }
        })
        observers.append(center.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshName() }
        })
        for controller in GCController.controllers() { attach(controller) }
    }

    private func attach(_ controller: GCController) {
        guard let pad = controller.extendedGamepad else { refreshName(); return }
        controller.handlerQueue = .main
        func button(_ input: GCControllerButtonInput?, _ command: PadCommand) {
            input?.pressedChangedHandler = { [weak self] _, _, pressed in
                guard pressed else { return }
                MainActor.assumeIsolated { self?.send(command) }
            }
        }
        button(pad.buttonA, .confirm)
        button(pad.buttonB, .back)
        button(pad.buttonX, .action)
        button(pad.buttonY, .secondary)
        button(pad.leftShoulder, .prevTab)
        button(pad.rightShoulder, .nextTab)
        button(pad.leftTrigger, .leftTrigger)
        button(pad.rightTrigger, .rightTrigger)
        button(pad.buttonMenu, .menu)
        button(pad.buttonOptions, .options)
        for (input, command) in [(pad.dpad.up, PadCommand.up), (pad.dpad.down, .down), (pad.dpad.left, .left), (pad.dpad.right, .right)] {
            input.pressedChangedHandler = { [weak self] _, _, pressed in
                MainActor.assumeIsolated { self?.direction(command, pressed: pressed) }
            }
        }
        pad.leftThumbstick.valueChangedHandler = { [weak self] _, x, y in
            MainActor.assumeIsolated { self?.stick(x: x, y: y) }
        }
        refreshName()
    }

    private func refreshName() {
        let name = GCController.controllers().first { $0.extendedGamepad != nil }.map { $0.vendorName ?? "컨트롤러" }
        guard name != connectedName else { return }
        connectedName = name
        if name == nil { stopRepeat() }
        onConnectionChange?(name)
    }

    private func send(_ command: PadCommand) {
        onCommand?(command)
    }

    // MARK: 방향 (되풀이)

    private func direction(_ command: PadCommand, pressed: Bool) {
        if pressed {
            heldDirection = command
            send(command)
            startRepeat(command)
        } else if heldDirection == command {
            stopRepeat()
        }
    }

    /// 스틱은 0.6 넘게 기울이면 그 방향, 0.3 아래로 돌아오면 놓은 것으로 본다. (떨림에 흔들리지 않게)
    private func stick(x: Float, y: Float) {
        let magnitude = max(abs(x), abs(y))
        if magnitude < 0.3 {
            if let held = stickDirection { stickDirection = nil; direction(held, pressed: false) }
            return
        }
        guard magnitude > 0.6 else { return }
        let next: PadCommand = abs(x) > abs(y) ? (x > 0 ? .right : .left) : (y > 0 ? .up : .down)
        guard next != stickDirection else { return }
        if let held = stickDirection { direction(held, pressed: false) }
        stickDirection = next
        direction(next, pressed: true)
    }

    private func startRepeat(_ command: PadCommand) {
        repeatTask?.cancel()
        repeatTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 350_000_000)
            while !Task.isCancelled {
                guard let self, self.heldDirection == command else { return }
                self.send(command)
                try? await Task.sleep(nanoseconds: 110_000_000)
            }
        }
    }

    private func stopRepeat() {
        heldDirection = nil
        repeatTask?.cancel()
        repeatTask = nil
    }
}

/// 컨트롤러로 고른 칸·단추 둘레의 금색 테두리
struct PadFocusRing: ViewModifier {
    let active: Bool
    var cornerRadius: CGFloat = 8

    func body(content: Content) -> some View {
        content.overlay {
            if active {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Theme.goldHi, lineWidth: 3)
                    .shadow(color: Theme.goldHi.opacity(0.8), radius: 6)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.12), value: active)
    }
}

extension View {
    func padFocus(_ active: Bool, cornerRadius: CGFloat = 8) -> some View {
        modifier(PadFocusRing(active: active, cornerRadius: cornerRadius))
    }
}

/// 컨트롤러가 연결되어 있을 때 화면 아래에 보이는 버튼 안내
struct PadHintBar: View {
    let items: [(button: String, text: String)]

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "gamecontroller.fill").foregroundStyle(Theme.goldHi)
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 4) {
                    Text(item.button).font(.caption.bold()).foregroundStyle(Theme.goldHi)
                    Text(item.text).font(.caption).foregroundStyle(Theme.silver)
                }
                .lineLimit(1)
            }
        }
        .minimumScaleFactor(0.7)
        .padding(.horizontal, 12).padding(.vertical, 5)
        .background(Capsule().fill(Color.black.opacity(0.55)))
        .overlay(Capsule().strokeBorder(Theme.gold.opacity(0.35), lineWidth: 1))
        .allowsHitTesting(false)
    }
}
