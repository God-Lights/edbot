import Foundation

/// 서버는 전투 상태를 초당 약 4번 보낸다. 그 사이를 부드럽게 보이려고 유닛 위치를 보간한다.
/// 새 상태가 오면 "지금 화면에 보이는 위치"에서 "새 위치"까지 짧은 시간 동안 움직인다.
/// (순간이동, 부활, 레인 이동처럼 크게 바뀐 것은 보간하지 않고 바로 옮긴다)
public final class BattleInterpolator {
    private struct Track {
        var from: Double
        var to: Double
        var start: TimeInterval
        var lane: Lane
    }

    private var tracks: [String: Track] = [:]
    /// 한 번의 이동에 걸리는 시간(초). 서버가 상태를 보내는 간격보다 약간 길게 잡아서 끊기지 않게 한다.
    public let duration: TimeInterval
    /// 이보다 크게 움직였으면 보간하지 않는다.
    public let snapDistance: Double

    public init(duration: TimeInterval = 0.3, snapDistance: Double = 15) {
        self.duration = duration
        self.snapDistance = snapDistance
    }

    /// 새 상태를 반영한다. now는 단조 증가하는 시각(초).
    public func update(_ units: [UnitSnapshot], at now: TimeInterval) {
        var next: [String: Track] = [:]
        for unit in units {
            if let old = tracks[unit.id], old.lane == unit.lane {
                let current = value(old, at: now)
                if abs(unit.pos - current) > snapDistance {
                    next[unit.id] = Track(from: unit.pos, to: unit.pos, start: now, lane: unit.lane)
                } else {
                    next[unit.id] = Track(from: current, to: unit.pos, start: now, lane: unit.lane)
                }
            } else {
                next[unit.id] = Track(from: unit.pos, to: unit.pos, start: now, lane: unit.lane)
            }
        }
        tracks = next
    }

    /// 지금 화면에 그릴 위치. 모르는 유닛이면 nil.
    public func position(of id: String, at now: TimeInterval) -> Double? {
        tracks[id].map { value($0, at: now) }
    }

    public func reset() { tracks = [:] }

    private func value(_ track: Track, at now: TimeInterval) -> Double {
        guard duration > 0 else { return track.to }
        let t = min(1, max(0, (now - track.start) / duration))
        return track.from + (track.to - track.from) * t
    }
}
