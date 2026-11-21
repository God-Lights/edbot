// swift-tools-version:5.9
import PackageDescription

// UI가 없는 순수 로직(모델, 메시지, 서버 연결, 로그인). SwiftUI에 의존하지 않아서 Linux에서도 `swift test`가 된다.
let package = Package(
    name: "EdbotKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "EdbotKit", targets: ["EdbotKit"])],
    targets: [
        .target(name: "EdbotKit"),
        .testTarget(name: "EdbotKitTests", dependencies: ["EdbotKit"]),
    ]
)
