import SwiftUI

@main
struct CommanderServerApp: App {
    @State private var model = ServerModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ServerView()
                .environment(model)
                .preferredColorScheme(.dark)
                .onChange(of: phase) { _, newPhase in
                    if newPhase != .active { model.flushNow() }
                }
        }
    }
}
