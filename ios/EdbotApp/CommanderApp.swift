import SwiftUI

@main
struct CommanderApp: App {
    @State private var model = AppModel()
    /// 게임 컨트롤러 (Controller.swift, PadRouting.swift)
    @State private var pad = GamepadInput()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .onOpenURL { url in model.openConnectLink(url) }
                .onAppear {
                    pad.onCommand = { [model] command in model.handlePad(command) }
                    pad.onConnectionChange = { [model] name in model.padName = name }
                    pad.start()
                }
        }
    }
}
