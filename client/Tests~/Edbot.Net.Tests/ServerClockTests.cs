using Xunit;

namespace Edbot.Net.Tests
{
    public class ServerClockTests
    {
        [Fact]
        public void 표본이_없으면_시계_차이는_0이다()
        {
            var clock = new ServerClock();
            Assert.False(clock.HasSample);
            Assert.Equal(1000, clock.ServerNow(1000));
        }

        [Fact]
        public void 내_시계가_서버보다_빠르면_보정한다()
        {
            var clock = new ServerClock();
            // 서버 시각 10_000인 메시지를 내 시계 10_500에 받았다 -> 내 시계가 500ms 빠르다
            clock.ObserveState(10_000, 10_500);
            Assert.Equal(500, clock.OffsetMs);
            Assert.Equal(20_000, clock.ServerNow(20_500));
        }

        [Fact]
        public void 남은_시간은_서버_시각_기준으로_계산한다()
        {
            var clock = new ServerClock();
            clock.ObserveState(10_000, 10_500); // 내 시계가 500ms 빠름
            // 단계는 서버 시각 15_000에 끝난다. 내 시계로 11_500이면 서버 시각은 11_000 -> 4초 남음
            Assert.Equal(4_000, clock.RemainingMs(15_000, 11_500));
        }

        [Fact]
        public void 지났으면_0이고_타이머가_없으면_null()
        {
            var clock = new ServerClock();
            clock.ObserveState(0, 0);
            Assert.Equal(0, clock.RemainingMs(1_000, 5_000));
            Assert.Null(clock.RemainingMs(null, 5_000));
        }

        [Fact]
        public void Pong은_왕복의_절반을_보정한다()
        {
            var clock = new ServerClock();
            // 내 시계 1000에 보냄, 1100에 받음 (왕복 100ms). 서버가 답에 적은 시각은 5_050.
            // 서버가 받은 순간은 내 시계로 1050 -> 내 시계는 서버보다 1050 - 5050 = -4000
            clock.ObservePong(1_000, 5_050, 1_100);
            Assert.Equal(100, clock.BestRttMs);
            Assert.Equal(-4_000, clock.OffsetMs);
        }

        [Fact]
        public void 왕복이_더_짧은_표본만_받아들인다()
        {
            var clock = new ServerClock();
            clock.ObservePong(0, 1_000, 200); // rtt 200 -> offset 100 - 1000 = -900
            clock.ObservePong(0, 2_000, 400); // rtt 400, 더 나쁘다 -> 무시
            Assert.Equal(200, clock.BestRttMs);
            Assert.Equal(-900, clock.OffsetMs);

            clock.ObservePong(1_000, 1_900, 1_040); // rtt 40, 더 좋다 -> 채택, offset 1020 - 1900 = -880
            Assert.Equal(40, clock.BestRttMs);
            Assert.Equal(-880, clock.OffsetMs);
        }

        [Fact]
        public void Pong_표본이_생기면_상태_메시지로_덮어쓰지_않는다()
        {
            var clock = new ServerClock();
            clock.ObservePong(1_000, 5_050, 1_100);
            clock.ObserveState(9_999, 10_000);
            Assert.Equal(-4_000, clock.OffsetMs);
        }
    }
}
