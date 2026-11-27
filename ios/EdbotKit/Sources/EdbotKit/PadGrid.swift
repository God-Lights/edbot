import Foundation

/// 게임 컨트롤러로 준비 단계 화면을 옮겨 다니는 칸.
/// 위에서 아래로: 판(0..<chessDeployRows 줄, index = 열), 대기석 줄(index = 칸, 마지막은 '자동 배치'),
/// 상점 줄(index 0 = 새로고침, 1... = 상점 카드)
public struct PadSpot: Equatable, Sendable {
    public var row: Int
    public var index: Int
    public init(row: Int, index: Int) { self.row = row; self.index = index }

    public static var benchRow: Int { chessDeployRows }
    public static var shopRow: Int { chessDeployRows + 1 }
}

public enum PadDirection: Sendable { case up, down, left, right }

/// 준비 단계 칸 사이를 옮기는 규칙 (화면 모양을 따라 위아래로는 가장 가까운 칸으로)
public enum ChessPadGrid {
    /// 줄마다 칸 수
    public static func rowLength(_ row: Int, benchCount: Int, shopCount: Int) -> Int {
        if row < chessDeployRows { return chessBoardSize }
        if row == PadSpot.benchRow { return benchCount + 1 }
        return shopCount + 1
    }

    /// 칸의 가로 위치 (0~1). 판과 대기석은 같은 칸 폭, 상점 줄은 새로고침 + 카드가 판 너비를 나눠 쓴다.
    public static func x(_ spot: PadSpot, shopCount: Int) -> Double {
        if spot.row == PadSpot.shopRow { return (Double(spot.index) + 0.5) / Double(shopCount + 1) }
        return (Double(spot.index) + 0.5) / Double(chessBoardSize)
    }

    /// 칸 수가 바뀌었을 때(대기석·상점 크기) 화면 안으로 되돌린다
    public static func clamp(_ spot: PadSpot, benchCount: Int, shopCount: Int) -> PadSpot {
        let row = min(max(0, spot.row), PadSpot.shopRow)
        let index = min(max(0, spot.index), rowLength(row, benchCount: benchCount, shopCount: shopCount) - 1)
        return PadSpot(row: row, index: index)
    }

    /// 한 칸 옮긴다. 끝에서는 그대로 (돌아가지 않는다)
    public static func move(_ from: PadSpot, _ direction: PadDirection, benchCount: Int, shopCount: Int) -> PadSpot {
        let spot = clamp(from, benchCount: benchCount, shopCount: shopCount)
        switch direction {
        case .left:
            return PadSpot(row: spot.row, index: max(0, spot.index - 1))
        case .right:
            return PadSpot(row: spot.row, index: min(rowLength(spot.row, benchCount: benchCount, shopCount: shopCount) - 1, spot.index + 1))
        case .up, .down:
            let row = direction == .up ? max(0, spot.row - 1) : min(PadSpot.shopRow, spot.row + 1)
            guard row != spot.row else { return spot }
            let target = x(spot, shopCount: shopCount)
            let length = rowLength(row, benchCount: benchCount, shopCount: shopCount)
            let best = (0..<length).min { a, b in
                abs(x(PadSpot(row: row, index: a), shopCount: shopCount) - target) < abs(x(PadSpot(row: row, index: b), shopCount: shopCount) - target)
            } ?? 0
            return PadSpot(row: row, index: best)
        }
    }
}
