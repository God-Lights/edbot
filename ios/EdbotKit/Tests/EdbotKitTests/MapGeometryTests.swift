import XCTest
@testable import EdbotKit

final class MapGeometryTests: XCTestCase {
    private func geometry(seat: Int = 0) -> MapGeometry { MapGeometry(width: 1000, height: 500, seat: seat) }

    private func assertEqual(_ a: Vec2, _ b: Vec2, accuracy: Double = 1e-6, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.x, b.x, accuracy: accuracy, file: file, line: line)
        XCTAssertEqual(a.y, b.y, accuracy: accuracy, file: file, line: line)
    }

    func testEveryLaneRunsFromBaseCornerToEnemyCorner() {
        let g = geometry()
        for lane in Lane.allCases {
            let start = g.point(lane: lane, pos: 0)
            let end = g.point(lane: lane, pos: 100)
            XCTAssertLessThan(start.x, 250, "\(lane) 시작은 왼쪽")
            XCTAssertGreaterThan(start.y, 350, "\(lane) 시작은 아래")
            XCTAssertGreaterThan(end.x, 750, "\(lane) 끝은 오른쪽")
            XCTAssertLessThan(end.y, 150, "\(lane) 끝은 위")
        }
    }

    func testCenterLaneIsTheDiagonalAndMidpointIsInTheMiddle() {
        let g = geometry()
        assertEqual(g.point(lane: .center, pos: 50), Vec2(500, 250))
        let direction = g.frame(lane: .center, pos: 10).direction
        XCTAssertGreaterThan(direction.x, 0) // 오른쪽으로
        XCTAssertLessThan(direction.y, 0) // 위로
    }

    func testSideLanesHugTheEdges() {
        let g = geometry()
        // 퀸사이드는 왼쪽 가장자리를 타고 올라가 위쪽 가장자리를 따라간다.
        XCTAssertEqual(g.point(lane: .queenside, pos: 10).x, 100, accuracy: 1e-6)
        XCTAssertEqual(g.point(lane: .queenside, pos: 90).y, 50, accuracy: 1e-6)
        // 킹사이드는 아래쪽 가장자리를 따라가 오른쪽 가장자리를 타고 올라간다.
        XCTAssertEqual(g.point(lane: .kingside, pos: 10).y, 450, accuracy: 1e-6)
        XCTAssertEqual(g.point(lane: .kingside, pos: 90).x, 900, accuracy: 1e-6)
    }

    func testPositionsAreClampedAndMonotonic() {
        let g = geometry()
        assertEqual(g.point(lane: .center, pos: -20), g.point(lane: .center, pos: 0))
        assertEqual(g.point(lane: .center, pos: 150), g.point(lane: .center, pos: 100))
        for lane in Lane.allCases {
            var previous = g.point(lane: lane, pos: 0)
            var travelled = 0.0
            for pos in stride(from: 1.0, through: 100.0, by: 1.0) {
                let next = g.point(lane: lane, pos: pos)
                travelled += (next - previous).length
                previous = next
            }
            XCTAssertEqual(travelled, g.length(of: lane), accuracy: 1e-3, "\(lane): 앞으로만 가고 길이가 맞는다")
        }
    }

    func testSeatOneViewIsRotatedSoMyBaseIsAlwaysBottomLeft() {
        let mine = geometry(seat: 0)
        let theirs = geometry(seat: 1)
        // seat 1의 본진은 레인의 100 쪽 끝이다. 돌려서 보면 그 끝이 왼쪽 아래에 와야 한다.
        for lane in Lane.allCases {
            let myBase = mine.point(lane: lane, pos: 0)
            let seat1Base = theirs.point(lane: lane, pos: 100)
            XCTAssertLessThan(myBase.x, 250)
            XCTAssertLessThan(seat1Base.x, 250)
            XCTAssertGreaterThan(seat1Base.y, 350)
        }
        let a = mine.basePoint(seat: 0)
        let b = theirs.basePoint(seat: 1)
        XCTAssertLessThan(a.x, 100); XCTAssertGreaterThan(a.y, 400)
        XCTAssertLessThan(b.x, 100); XCTAssertGreaterThan(b.y, 400)
    }

    func testDistanceScaleAndSidewaysOffset() {
        let g = geometry()
        XCTAssertGreaterThan(g.pixelsPerUnit(.center), 0)
        XCTAssertGreaterThan(g.pixelsPerUnit(.queenside), g.pixelsPerUnit(.center)) // 가장자리 길이 더 길다
        let base = g.point(lane: .queenside, pos: 30)
        let shifted = g.offset(lane: .queenside, pos: 30, sideways: 10)
        XCTAssertEqual((shifted - base).length, 10, accuracy: 1e-6)
        // 위로 가는 구간의 옆은 좌우 방향
        XCTAssertEqual(shifted.y, base.y, accuracy: 1e-6)
    }

    func testEmptyGeometryDoesNotCrash() {
        let g = MapGeometry(width: 0, height: 0, seat: 0)
        _ = g.point(lane: .center, pos: 50)
        XCTAssertEqual(g.length(of: .center), 0)
    }
}
