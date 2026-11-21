import Foundation

public struct Vec2: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }

    public static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
    public static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
    public static func * (a: Vec2, k: Double) -> Vec2 { Vec2(a.x * k, a.y * k) }
    public var length: Double { (x * x + y * y).squareRoot() }
    public var normalized: Vec2 { length > 0 ? Vec2(x / length, y / length) : Vec2(0, 0) }
}

/// 위에서 내려다본 2D 지도(롤 같은 배치). 서버의 레인 위치(0~100)를 화면 좌표로 바꾼다.
///
/// - 아군 본진은 항상 왼쪽 아래, 적 본진은 오른쪽 위에 온다. (seat 1이면 지도를 180도 돌려서 그렇게 보이게 한다)
/// - 레인은 위쪽 길(퀸사이드), 가운데 대각선(센터), 아래쪽 길(킹사이드) 세 개다.
/// - 서버는 레인을 0(seat 0 본진)~100(seat 1 본진)의 직선으로 계산하므로, 지도는 그 직선을 꺾인 길로 보여 줄 뿐이다.
public struct MapGeometry: Sendable {
    public let size: Vec2
    /// seat 1 시점이면 true. 지도를 180도 돌린다.
    public let rotated: Bool

    public init(width: Double, height: Double, seat: Int) {
        size = Vec2(width, height)
        rotated = seat == 1
    }

    /// 지도 위의 길(비율 좌표, seat 0 본진에서 seat 1 본진 방향).
    static let lanePoints: [Lane: [(Double, Double)]] = [
        .queenside: [(0.10, 0.84), (0.10, 0.10), (0.84, 0.10)],
        .center: [(0.15, 0.85), (0.85, 0.15)],
        .kingside: [(0.16, 0.90), (0.90, 0.90), (0.90, 0.16)],
    ]

    /// seat 0 / seat 1 본진의 비율 좌표.
    static let bases: [(Double, Double)] = [(0.07, 0.93), (0.93, 0.07)]

    private func screen(_ p: (Double, Double)) -> Vec2 {
        let x = rotated ? 1 - p.0 : p.0
        let y = rotated ? 1 - p.1 : p.1
        return Vec2(x * size.x, y * size.y)
    }

    /// 레인의 길(화면 좌표).
    public func path(for lane: Lane) -> [Vec2] {
        (Self.lanePoints[lane] ?? []).map(screen)
    }

    public func basePoint(seat: Int) -> Vec2 {
        screen(Self.bases[seat == 1 ? 1 : 0])
    }

    private func segments(_ lane: Lane) -> (points: [Vec2], lengths: [Double], total: Double) {
        let points = path(for: lane)
        var lengths: [Double] = []
        var total = 0.0
        for index in 1..<max(1, points.count) {
            let length = (points[index] - points[index - 1]).length
            lengths.append(length)
            total += length
        }
        return (points, lengths, total)
    }

    /// 레인 위의 위치(0~100)의 화면 좌표와 진행 방향(seat 0 본진 -> seat 1 본진)의 단위 벡터.
    public func frame(lane: Lane, pos: Double) -> (point: Vec2, direction: Vec2) {
        let (points, lengths, total) = segments(lane)
        guard points.count >= 2, total > 0 else { return (points.first ?? Vec2(0, 0), Vec2(1, 0)) }
        var remaining = max(0, min(100, pos)) / 100 * total
        for (index, length) in lengths.enumerated() {
            if remaining <= length || index == lengths.count - 1 {
                let a = points[index]
                let b = points[index + 1]
                let direction = (b - a).normalized
                return (a + direction * min(remaining, length), direction)
            }
            remaining -= length
        }
        return (points[points.count - 1], Vec2(1, 0))
    }

    public func point(lane: Lane, pos: Double) -> Vec2 { frame(lane: lane, pos: pos).point }

    /// 길의 총 길이(화면 좌표 기준 px).
    public func length(of lane: Lane) -> Double { segments(lane).total }

    /// 레인 위치 1칸이 화면에서 몇 px인가. 타워의 사거리 같은 거리를 화면에 그릴 때 쓴다.
    public func pixelsPerUnit(_ lane: Lane) -> Double { length(of: lane) / 100 }

    /// 진행 방향에 수직인 옆으로 offset만큼 비켜 선 좌표. 유닛이 한 줄로 겹쳐 보이지 않게 흩어 놓는 데 쓴다.
    public func offset(lane: Lane, pos: Double, sideways: Double) -> Vec2 {
        let (point, direction) = frame(lane: lane, pos: pos)
        return point + Vec2(-direction.y, direction.x) * sideways
    }
}
