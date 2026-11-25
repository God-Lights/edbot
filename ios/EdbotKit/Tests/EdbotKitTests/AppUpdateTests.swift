import XCTest
@testable import EdbotKit

final class AppUpdateTests: XCTestCase {
    func testComparesVersionsNumerically() {
        XCTAssertTrue(AppUpdate.isNewer("0.5.10", than: "0.5.9"))
        XCTAssertTrue(AppUpdate.isNewer("1.0", than: "0.9.9"))
        XCTAssertTrue(AppUpdate.isNewer("v0.6.0", than: "0.5.8"))
        XCTAssertFalse(AppUpdate.isNewer("0.5.8", than: "0.5.8"))
        XCTAssertFalse(AppUpdate.isNewer("0.5.8", than: "0.5.8.0"))
        XCTAssertFalse(AppUpdate.isNewer("0.5.7", than: "0.5.8"))
        XCTAssertFalse(AppUpdate.isNewer("beta", than: "0.5.8"))
    }

    private let source = #"""
    {"name":"COMMANDER","apps":[
      {"bundleIdentifier":"com.officialgl.commander","version":"0.5.9","downloadURL":"https://x.test/ios/Commander.ipa",
       "versions":[{"version":"0.5.9","downloadURL":"https://x.test/ios/Commander.ipa"},{"version":"0.5.8","downloadURL":"https://x.test/old.ipa"}]},
      {"bundleIdentifier":"com.officialgl.commander.server","version":"0.1.0","downloadURL":"https://x.test/s.ipa"}
    ]}
    """#

    func testFindsUpdateForThisApp() {
        let data = Data(source.utf8)
        let update = AppUpdate.check(sourceJSON: data, bundleId: "com.officialgl.commander", current: "0.5.8")
        XCTAssertEqual(update?.version, "0.5.9")
        XCTAssertEqual(update?.downloadURL?.absoluteString, "https://x.test/ios/Commander.ipa")
        XCTAssertEqual(update?.sideStoreInstallURL?.absoluteString, "sidestore://install?url=https://x.test/ios/Commander.ipa")
        XCTAssertNil(AppUpdate.check(sourceJSON: data, bundleId: "com.officialgl.commander", current: "0.5.9"))
        // 개발용 빌드, 다른 앱, 깨진 JSON
        XCTAssertNil(AppUpdate.check(sourceJSON: data, bundleId: "com.officialgl.commander", current: "0.0.0"))
        XCTAssertNil(AppUpdate.check(sourceJSON: data, bundleId: "com.example.other", current: "0.1.0"))
        XCTAssertNil(AppUpdate.check(sourceJSON: Data("nope".utf8), bundleId: "com.officialgl.commander", current: "0.1.0"))
        XCTAssertEqual(AppUpdate.check(sourceJSON: data, bundleId: "com.officialgl.commander.server", current: "0.0.9")?.version, "0.1.0")
    }
}
