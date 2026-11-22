// swift-tools-version:5.9
import PackageDescription

// iOS 서버 앱의 순수 로직: HTTP 읽기·쓰기, WebSocket 핸드셰이크와 프레임, 데이터 파일 저장, 웹 화면 파일 찾기.
// 네트워크와 웹뷰는 앱 쪽(App/)이 맡고, 여기는 `swift test`로 시험한다.
let package = Package(
    name: "ServerKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ServerKit", targets: ["ServerKit"])],
    targets: [
        .target(name: "ServerKit"),
        .testTarget(name: "ServerKitTests", dependencies: ["ServerKit"]),
    ]
)
