import XCTest
@testable import EdbotKit

final class PadGridTests: XCTestCase {
    // 대기석 8칸(+자동 배치), 상점 5칸(+새로고침)
    let bench = 8, shop = 5

    func move(_ spot: PadSpot, _ d: PadDirection) -> PadSpot { ChessPadGrid.move(spot, d, benchCount: bench, shopCount: shop) }

    func testRowsTopToBottom() {
        XCTAssertEqual(PadSpot.benchRow, chessDeployRows)
        XCTAssertEqual(PadSpot.shopRow, chessDeployRows + 1)
        XCTAssertEqual(ChessPadGrid.rowLength(0, benchCount: bench, shopCount: shop), chessBoardSize)
        XCTAssertEqual(ChessPadGrid.rowLength(PadSpot.benchRow, benchCount: bench, shopCount: shop), 9)
        XCTAssertEqual(ChessPadGrid.rowLength(PadSpot.shopRow, benchCount: bench, shopCount: shop), 6)
    }

    func testLeftRightStopAtEdges() {
        XCTAssertEqual(move(PadSpot(row: 0, index: 0), .left), PadSpot(row: 0, index: 0))
        XCTAssertEqual(move(PadSpot(row: 0, index: 7), .right), PadSpot(row: 0, index: 7))
        XCTAssertEqual(move(PadSpot(row: PadSpot.benchRow, index: 7), .right), PadSpot(row: PadSpot.benchRow, index: 8)) // 자동 배치
        XCTAssertEqual(move(PadSpot(row: PadSpot.shopRow, index: 5), .right), PadSpot(row: PadSpot.shopRow, index: 5))
    }

    func testUpDownKeepColumnAndFollowScreen() {
        // 판 맨 아래 줄 → 대기석 같은 칸 → 상점의 가장 가까운 카드
        let lastBoard = PadSpot(row: chessDeployRows - 1, index: 3)
        let benchSpot = move(lastBoard, .down)
        XCTAssertEqual(benchSpot, PadSpot(row: PadSpot.benchRow, index: 3))
        let shopSpot = move(benchSpot, .down)
        XCTAssertEqual(shopSpot.row, PadSpot.shopRow)
        XCTAssertEqual(shopSpot.index, 2) // x 0.4375 → 상점 줄 2번(0.4167)이 가장 가깝다
        // 맨 왼쪽 판 칸 아래의 상점 줄은 새로고침
        XCTAssertEqual(move(PadSpot(row: PadSpot.benchRow, index: 0), .down), PadSpot(row: PadSpot.shopRow, index: 0))
        // 상점에서 올라가면 대기석, 판 맨 위에서 위로는 그대로, 상점 아래로는 그대로
        XCTAssertEqual(move(PadSpot(row: PadSpot.shopRow, index: 5), .up).row, PadSpot.benchRow)
        XCTAssertEqual(move(PadSpot(row: 0, index: 4), .up), PadSpot(row: 0, index: 4))
        XCTAssertEqual(move(PadSpot(row: PadSpot.shopRow, index: 1), .down), PadSpot(row: PadSpot.shopRow, index: 1))
    }

    func testClampWhenRowsShrink() {
        XCTAssertEqual(ChessPadGrid.clamp(PadSpot(row: PadSpot.benchRow, index: 9), benchCount: 6, shopCount: shop), PadSpot(row: PadSpot.benchRow, index: 6))
        XCTAssertEqual(ChessPadGrid.clamp(PadSpot(row: 99, index: -3), benchCount: bench, shopCount: shop), PadSpot(row: PadSpot.shopRow, index: 0))
    }
}
