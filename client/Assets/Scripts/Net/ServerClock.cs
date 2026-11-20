using System;

namespace Edbot.Net
{
    /// <summary>
    /// 서버 시계와 내 시계의 차이를 추정한다.
    /// 서버가 알려 주는 단계 종료 시각(phaseEndsAt)은 서버 시각이라서, 그대로 내 시계와 비교하면
    /// 카운트다운이 틀어진다. 모든 시각은 Unix epoch 밀리초다.
    /// </summary>
    public sealed class ServerClock
    {
        private long _offsetMs; // 내 시각 - 서버 시각
        private bool _hasSample;
        private bool _hasPongSample;
        private long _bestRttMs = long.MaxValue;

        public bool HasSample { get { return _hasSample; } }
        public long OffsetMs { get { return _offsetMs; } }
        /// <summary>왕복 시간이 가장 짧았던 ping의 값. 아직 없으면 -1.</summary>
        public long BestRttMs { get { return _hasPongSample ? _bestRttMs : -1; } }

        /// <summary>
        /// 상태 메시지를 받은 순간의 거친 추정. 보내는 데 걸린 시간만큼 오차가 있어서,
        /// ping 결과가 생기기 전까지만 쓴다.
        /// </summary>
        public void ObserveState(long serverTimeMs, long localNowMs)
        {
            if (_hasPongSample) return;
            _offsetMs = localNowMs - serverTimeMs;
            _hasSample = true;
        }

        /// <summary>
        /// ping을 보낸 시각, 서버가 답에 적은 시각, 답을 받은 시각으로 계산한다.
        /// 왕복이 가장 짧았던 표본이 가장 정확해서 그것만 남긴다.
        /// </summary>
        public void ObservePong(long sentLocalMs, long serverTimeMs, long receivedLocalMs)
        {
            long rtt = Math.Max(0, receivedLocalMs - sentLocalMs);
            if (_hasPongSample && rtt > _bestRttMs) return;
            _bestRttMs = rtt;
            _offsetMs = (sentLocalMs + rtt / 2) - serverTimeMs;
            _hasSample = true;
            _hasPongSample = true;
        }

        public long ServerNow(long localNowMs)
        {
            return localNowMs - _offsetMs;
        }

        /// <summary>단계가 끝날 때까지 남은 시간(ms). 타이머가 없는 단계면 null.</summary>
        public long? RemainingMs(long? phaseEndsAtServerMs, long localNowMs)
        {
            if (!phaseEndsAtServerMs.HasValue) return null;
            return Math.Max(0, phaseEndsAtServerMs.Value - ServerNow(localNowMs));
        }
    }
}
