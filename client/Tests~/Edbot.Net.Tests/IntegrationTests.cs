using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Edbot.Net.Tests
{
    /// <summary>EDBOT_SERVER 환경 변수가 있을 때만 실행하는 테스트.</summary>
    public sealed class ServerFactAttribute : FactAttribute
    {
        public ServerFactAttribute()
        {
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("EDBOT_SERVER")))
            {
                Skip = "EDBOT_SERVER가 없어 건너뜀 (서버를 PHASE_SCALE:0.05로 띄우고 EDBOT_SERVER=http://127.0.0.1:8787 로 실행)";
            }
        }
    }

    internal sealed class TrackingFactory : ITransportFactory
    {
        public IWebSocketTransport Last;

        public IWebSocketTransport Create()
        {
            Last = new ClientWebSocketTransport();
            return Last;
        }
    }

    /// <summary>
    /// 실제 서버(wrangler dev)에 진짜 ClientWebSocket으로 붙어 한 판을 끝까지 돌린다.
    /// Unity에서 쓰는 것과 같은 코드 경로(ApiClient, RoomConnection)를 그대로 검증한다.
    /// </summary>
    public class IntegrationTests
    {
        private static readonly ConnectionOptions Fast = new ConnectionOptions
        {
            ReconnectBackoff = new[] { TimeSpan.FromMilliseconds(20) },
            PingInterval = TimeSpan.FromMilliseconds(200),
        };

        private static List<NetEvent> Drain(RoomConnection connection, Func<NetEvent, bool> stopWhen, int timeoutMs = 10_000)
        {
            var seen = new List<NetEvent>();
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                if (connection.TryDequeue(out var netEvent))
                {
                    seen.Add(netEvent);
                    if (stopWhen(netEvent)) return seen;
                }
                else
                {
                    Thread.Sleep(5);
                }
            }
            throw new TimeoutException("기다리던 이벤트가 오지 않았다. 받은 것: " +
                                       string.Join(", ", seen.ConvertAll(e => e.GetType().Name)));
        }

        private static bool IsConnected(NetEvent e) { return e is ConnectedEvent; }
        private static bool IsState(NetEvent e, Phase phase)
        {
            var state = e as StateEvent;
            return state != null && state.Room.Phase == phase;
        }

        [ServerFact]
        public async Task 방을_만들고_두_명이_한_판을_끝까지_돌린다()
        {
            string server = Environment.GetEnvironmentVariable("EDBOT_SERVER");
            string wsBase = ApiClient.ToWebSocketBase(server);

            using (var api = new ApiClient(server))
            {
                // 1. 방 만들기와 조회
                string code = await api.CreateRoomAsync();
                Assert.Matches("^[A-Z2-9]{4}$", code);
                var info = await api.GetRoomAsync(code.ToLowerInvariant()); // 소문자로 물어도 된다
                Assert.Equal("lobby", info.Phase);
                Assert.True(info.Joinable);
                Assert.Null(await api.GetRoomAsync("ZZZZ"));

                var trackingA = new TrackingFactory();
                using (var a = new RoomConnection(trackingA, Fast))
                using (var b = new RoomConnection(new ClientWebSocketTransportFactory(), Fast))
                using (var c = new RoomConnection(new ClientWebSocketTransportFactory(), Fast))
                {
                    // 2. 두 명 입장
                    a.Start(wsBase, code, "에드");
                    Drain(a, IsConnected);
                    b.Start(wsBase, code, "민수");
                    Drain(b, IsConnected);

                    Assert.Equal(2, b.Room.Players.Count);
                    Assert.Equal(0, b.Room.FindPlayer(a.PlayerId).Seat);
                    Assert.Equal(1, b.Room.FindPlayer(b.PlayerId).Seat);
                    Assert.NotEqual(a.Token, b.Token);

                    // 3. 정원 초과는 오류를 받고 끝난다 (자동 재접속하지 않는다)
                    c.Start(wsBase, code, "셋째");
                    var rejected = Drain(c, e => e is DisconnectedEvent);
                    Assert.Contains(rejected, e => e is ErrorEvent error && error.Code == ErrorCodes.RoomFull);

                    // 4. 둘 다 준비하면 ban 단계가 시작된다
                    Assert.True(a.SendReady(true));
                    Assert.True(b.SendReady(true));
                    Drain(a, e => IsState(e, Phase.Ban));
                    Assert.True(a.RemainingMs() > 0);

                    // 5. 게임 중에 A의 연결이 갑자기 끊겨도 token으로 같은 자리에 돌아온다
                    string aId = a.PlayerId;
                    trackingA.Last.Dispose();
                    var recovery = Drain(a, IsConnected);
                    Assert.Contains(recovery, e => e is ReconnectingEvent);
                    var reconnected = (ConnectedEvent)recovery[recovery.Count - 1];
                    Assert.True(reconnected.Reconnected);
                    Assert.Equal(aId, reconnected.Welcome.PlayerId);

                    // 6. 남은 단계를 순서대로 지나 로비로 돌아온다
                    var seen = new List<Phase>();
                    Drain(a, e =>
                    {
                        var state = e as StateEvent;
                        if (state != null && (seen.Count == 0 || seen[seen.Count - 1] != state.Room.Phase))
                        {
                            seen.Add(state.Room.Phase);
                        }
                        return IsState(e, Phase.Lobby);
                    }, timeoutMs: 40_000);

                    Assert.Contains(Phase.Result, seen);
                    Assert.Equal(Phase.Lobby, seen[seen.Count - 1]);
                    for (int i = 1; i < seen.Count; i++)
                    {
                        Assert.True(seen[i] > seen[i - 1] || seen[i] == Phase.Lobby,
                            "단계 순서가 거꾸로 갔다: " + string.Join(" -> ", seen));
                    }
                    Assert.All(a.Room.Players, p => Assert.False(p.Ready));

                    // 7. ping으로 시계 보정 표본이 생겼다
                    Assert.True(a.Clock.HasSample);
                    Assert.True(a.Clock.BestRttMs >= 0, "ping 표본이 없다");
                }
            }
        }
    }
}
