using System;
using System.Collections.Generic;
using System.Linq;
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
                Skip = "EDBOT_SERVER가 없어 건너뜀 (서버를 PHASE_SCALE:0.1로 띄우고 EDBOT_SERVER=http://127.0.0.1:8787 로 실행)";
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

        /// <summary>한 사람의 연결과 가장 최근에 받은 상태, 받은 오류를 모아 두는 테스트용 도우미.</summary>
        private sealed class Player : IDisposable
        {
            public readonly RoomConnection Connection = new RoomConnection(new ClientWebSocketTransportFactory(), Fast);
            public readonly List<ErrorEvent> Errors = new List<ErrorEvent>();
            public RoomSnapshot Room;

            public int Seat { get { return Room == null ? -1 : Room.SeatOf(Connection.PlayerId); } }

            public void Pump()
            {
                NetEvent netEvent;
                while (Connection.TryDequeue(out netEvent))
                {
                    var connected = netEvent as ConnectedEvent;
                    var state = netEvent as StateEvent;
                    var error = netEvent as ErrorEvent;
                    if (connected != null) Room = connected.Welcome.Room;
                    else if (state != null) Room = state.Room;
                    else if (error != null) Errors.Add(error);
                }
            }

            public bool GotError(string code)
            {
                Pump();
                return Errors.Any(e => e.Code == code);
            }

            public void Dispose() { Connection.Dispose(); }
        }

        private static void Until(Func<bool> condition, Player[] players, string what, int timeoutMs = 10_000)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (true)
            {
                foreach (var p in players) p.Pump();
                bool ok;
                try { ok = condition(); }
                catch (NullReferenceException) { ok = false; } // 아직 상태를 받지 못했다
                if (ok) return;
                if (DateTime.UtcNow > deadline) throw new TimeoutException("기다리던 일이 일어나지 않았다: " + what);
                Thread.Sleep(5);
            }
        }

        [ServerFact]
        public async Task 직접_밴_드래프트_배치를_진행한다()
        {
            string server = Environment.GetEnvironmentVariable("EDBOT_SERVER");
            string wsBase = ApiClient.ToWebSocketBase(server);

            using (var api = new ApiClient(server))
            {
                // 캐릭터 데이터
                var roster = await api.GetCharactersAsync();
                Assert.Equal(12, roster.Count);
                Assert.Equal(12, roster.Select(c => c.Id).Distinct().Count());
                Assert.Equal(Piece.King, roster.First(c => c.Id == "ancient-lord").Piece);
                Assert.Equal("제노사우로스", roster.First(c => c.Id == "xenosaurs").NameKo);

                string code = await api.CreateRoomAsync();
                using (var a = new Player())
                using (var b = new Player())
                {
                    var both = new[] { a, b };
                    var bySeat = new[] { a, b };

                    a.Connection.Start(wsBase, code, "에드");
                    Until(() => a.Room != null, both, "A 입장");
                    b.Connection.Start(wsBase, code, "민수");
                    Until(() => b.Room != null, both, "B 입장");
                    Assert.Equal(0, a.Seat);
                    Assert.Equal(1, b.Seat);
                    Assert.Null(a.Room.Game); // 로비에는 게임 상태가 없다

                    // ---- 밴
                    Assert.True(a.Connection.SendReady(true));
                    Assert.True(b.Connection.SendReady(true));
                    Until(() => a.Room.Phase == Phase.Ban && b.Room.Phase == Phase.Ban, both, "밴 단계 시작");
                    long banEndsAt = a.Room.PhaseEndsAt.Value;

                    Assert.True(a.Connection.SendBan("ancient-lord"));
                    Until(() => b.Room.Game.Bans[0].Locked, both, "상대가 밴했다는 알림");
                    Assert.Null(b.Room.Game.Bans[0].CharacterId); // 무엇을 밴했는지는 모른다
                    Until(() => a.Room.Game.Bans[0].CharacterId == "ancient-lord", both, "내 밴 확인");

                    a.Connection.SendBan("richmond"); // 한 번 정하면 바꿀 수 없다
                    Until(() => a.GotError(ErrorCodes.AlreadyDone), both, "already_done");
                    b.Connection.SendBan("no-such-character");
                    Until(() => b.GotError(ErrorCodes.UnknownCharacter), both, "unknown_character");

                    b.Connection.SendBan("xenosaurs");
                    Until(() => a.Room.Phase == Phase.Draft && b.Room.Phase == Phase.Draft, both, "드래프트 단계 시작");
                    Assert.True(a.Room.PhaseStartedAt < banEndsAt, "둘 다 밴하면 시간이 남아도 바로 넘어간다");
                    Assert.Equal("ancient-lord", b.Room.Game.Bans[0].CharacterId); // 이제 공개된다
                    Assert.Equal("xenosaurs", a.Room.Game.Bans[1].CharacterId);

                    // ---- 드래프트
                    Assert.Equal(10, a.Room.Game.PickOrder.Count);
                    var firstTurn = a.Room.Game.TurnSeat.Value;
                    Assert.Equal(a.Room.Game.FirstPicker, firstTurn);

                    var outOfTurn = bySeat[1 - firstTurn];
                    outOfTurn.Connection.SendPick(roster[2].Id);
                    Until(() => outOfTurn.GotError(ErrorCodes.NotYourTurn), both, "not_your_turn");

                    int guard = 0;
                    while (true)
                    {
                        foreach (var p in both) p.Pump();
                        if (a.Room.Phase != Phase.Draft) break;
                        Assert.True(guard++ < 40, "드래프트가 끝나지 않는다");

                        var game = a.Room.Game;
                        int turn = game.TurnSeat.Value;
                        int count = game.PickCount;
                        string pick = roster.First(c => !game.IsUnavailable(c.Id)).Id;
                        bySeat[turn].Connection.SendPick(pick);
                        Until(() => a.Room.Phase != Phase.Draft || a.Room.Game.PickCount > count, both, "뽑기 반영");
                    }

                    Until(() => a.Room.Phase == Phase.Placement && b.Room.Phase == Phase.Placement, both, "배치 단계 시작");
                    var picks = a.Room.Game.Picks;
                    Assert.Equal(5, picks[0].Count);
                    Assert.Equal(5, picks[1].Count);
                    var everyone = picks[0].Concat(picks[1]).ToList();
                    Assert.Equal(10, everyone.Distinct().Count());
                    Assert.DoesNotContain("ancient-lord", everyone);
                    Assert.DoesNotContain("xenosaurs", everyone);
                    long placementEndsAt = a.Room.PhaseEndsAt.Value;

                    // ---- 배치: 내 배치만 보인다
                    var lanes = new[] { Lane.Queenside, Lane.Center, Lane.Kingside, Lane.Center, Lane.Queenside };
                    for (int seat = 0; seat < 2; seat++)
                    {
                        for (int i = 0; i < 5; i++) bySeat[seat].Connection.SendPlace(picks[seat][i], lanes[i]);
                    }
                    Until(() => a.Room.Game.LaneOf(0, picks[0][4]) == lanes[4], both, "내 배치 반영");
                    Assert.Null(a.Room.Game.LaneOf(1, picks[1][0])); // 상대의 배치는 보이지 않는다

                    a.Connection.SendLock();
                    Until(() => b.Room.Game.PlacementLocked[0], both, "상대의 확정 알림");
                    Assert.Null(b.Room.Game.LaneOf(0, picks[0][0])); // 확정했다는 것만 안다
                    b.Connection.SendLock();
                    Until(() => a.Room.Phase == Phase.Explore && b.Room.Phase == Phase.Explore, both, "탐사 단계 시작");
                    Assert.True(a.Room.PhaseStartedAt < placementEndsAt, "둘 다 확정하면 시간이 남아도 바로 넘어간다");

                    for (int i = 0; i < 5; i++)
                    {
                        Assert.Equal(lanes[i], a.Room.Game.LaneOf(0, picks[0][i]));
                        Assert.Equal(lanes[i], b.Room.Game.LaneOf(1, picks[1][i]));
                    }
                    Assert.Null(a.Room.Game.LaneOf(1, picks[1][0])); // 전투 전에는 계속 숨겨진다
                    Assert.Null(b.Room.Game.LaneOf(0, picks[0][0]));
                }
            }
        }
    }
}
