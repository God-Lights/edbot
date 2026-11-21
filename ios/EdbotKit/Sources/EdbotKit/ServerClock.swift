import Foundation

/// 서버 시계와 내 시계의 차이를 기억해서 "서버 시각 X까지 남은 시간"을 계산한다.
public struct ServerClock: Equatable, Sendable {
    /// 서버 시각 - 내 시각 (ms)
    public private(set) var offsetMs: Int64 = 0
    public private(set) var hasSample = false

    public init() {}

    /// 서버가 보낸 시각(serverTime)을 받은 순간의 내 시각으로 차이를 갱신한다.
    public mutating func observe(serverTime: Int64, localNowMs: Int64) {
        offsetMs = serverTime - localNowMs
        hasSample = true
    }

    public func serverNow(localNowMs: Int64) -> Int64 { localNowMs + offsetMs }

    /// 서버 시각 target까지 남은 ms. 이미 지났으면 0, target이 nil이면 nil.
    public func remainingMs(until target: Int64?, localNowMs: Int64) -> Int64? {
        guard let target else { return nil }
        return max(0, target - serverNow(localNowMs: localNowMs))
    }
}

public func currentTimeMs() -> Int64 {
    Int64((Date().timeIntervalSince1970 * 1000).rounded())
}
