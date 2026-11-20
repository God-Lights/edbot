using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Xunit;

namespace Edbot.Net.Tests
{
    /// <summary>진짜 네트워크 없이 접속 로직을 시험하기 위한 가짜 WebSocket.</summary>
    internal sealed class FakeTransport : IWebSocketTransport
    {
        private readonly Channel<string> _incoming = Channel.CreateUnbounded<string>();
        private readonly List<string> _sent = new List<string>();

        public Uri ConnectedUri;
        public Exception ConnectError;
        public bool Disposed;

        public List<string> Sent
        {
            get { lock (_sent) return new List<string>(_sent); }
        }

        public Task ConnectAsync(Uri uri, CancellationToken ct)
        {
            if (ConnectError != null) return Task.FromException(ConnectError);
            ConnectedUri = uri;
            return Task.CompletedTask;
        }

        public Task SendAsync(string text, CancellationToken ct)
        {
            lock (_sent) _sent.Add(text);
            return Task.CompletedTask;
        }

        public async Task<string> ReceiveAsync(CancellationToken ct)
        {
            try
            {
                return await _incoming.Reader.ReadAsync(ct);
            }
            catch (ChannelClosedException)
            {
                return null;
            }
        }

        public void Push(string json) { _incoming.Writer.TryWrite(json); }
        public void CloseGracefully() { _incoming.Writer.TryComplete(); }
        public void Drop() { _incoming.Writer.TryComplete(new IOException("network down")); }
        public void Dispose() { Disposed = true; }
    }

    internal sealed class FakeFactory : ITransportFactory
    {
        private readonly Queue<FakeTransport> _queue = new Queue<FakeTransport>();
        public int CreateCount;

        public FakeFactory(params FakeTransport[] transports)
        {
            foreach (var t in transports) _queue.Enqueue(t);
        }

        public IWebSocketTransport Create()
        {
            CreateCount++;
            if (_queue.Count == 0) throw new InvalidOperationException("예상하지 못한 연결 시도");
            return _queue.Dequeue();
        }
    }

    public class RoomConnectionTests
    {
        private static readonly ConnectionOptions Fast = new ConnectionOptions
        {
            MaxReconnectAttempts = 3,
            ReconnectBackoff = new[] { TimeSpan.FromMilliseconds(1) },
            PingInterval = TimeSpan.FromHours(1), // 테스트 중에는 처음 한 번만 보낸다
        };

        private static string Welcome(string playerId = "p1", string token = "tok1", string phase = "lobby",
            long serverTime = 1000, string phaseEndsAt = "null")
        {
            return "{\"t\":\"welcome\",\"playerId\":\"" + playerId + "\",\"token\":\"" + token + "\",\"room\":" +
                   Room(phase, serverTime, phaseEndsAt) + "}";
        }

        private static string Room(string phase, long serverTime, string phaseEndsAt = "null")
        {
            return "{\"code\":\"ABCD\",\"phase\":\"" + phase + "\",\"phaseStartedAt\":0,\"phaseEndsAt\":" + phaseEndsAt +
                   ",\"serverTime\":" + serverTime +
                   ",\"players\":[{\"id\":\"p1\",\"name\":\"에드\",\"seat\":0,\"connected\":true,\"ready\":false}]}";
        }

        private static string StateJson(string phase, long serverTime, string phaseEndsAt = "null")
        {
            return "{\"t\":\"state\",\"room\":" + Room(phase, serverTime, phaseEndsAt) + "}";
        }

        /// <summary>조건에 맞는 이벤트가 나올 때까지 기다린다. 중간에 나온 이벤트는 모두 돌려준다.</summary>
        private static List<NetEvent> WaitUntil(RoomConnection connection, Func<NetEvent, bool> isTarget, int timeoutMs = 3000)
        {
            var seen = new List<NetEvent>();
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (DateTime.UtcNow < deadline)
            {
                if (connection.TryDequeue(out var netEvent))
                {
                    seen.Add(netEvent);
                    if (isTarget(netEvent)) return seen;
                }
                else
                {
                    Thread.Sleep(2);
                }
            }
            throw new TimeoutException("기다리던 이벤트가 오지 않았다. 받은 것: " +
                                       string.Join(", ", seen.ConvertAll(e => e.GetType().Name)));
        }

        private static bool Connected(NetEvent e) { return e is ConnectedEvent; }
        private static bool Disconnected(NetEvent e) { return e is DisconnectedEvent; }

        private static void WaitFor(Func<bool> condition, int timeoutMs = 3000)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            while (!condition())
            {
                if (DateTime.UtcNow > deadline) throw new TimeoutException("조건이 충족되지 않았다.");
                Thread.Sleep(2);
            }
        }

        [Fact]
        public void 입장하면_주소를_만들고_Welcome을_이벤트로_전한다()
        {
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast))
            {
                connection.Start("ws://127.0.0.1:8787/", " abcd ", "에드 & 민수");
                transport.Push(Welcome());

                var events = WaitUntil(connection, Connected);
                var connected = (ConnectedEvent)events[events.Count - 1];

                Assert.Equal("ws://127.0.0.1:8787/ws/ABCD?name=" + Uri.EscapeDataString("에드 & 민수"),
                    transport.ConnectedUri.OriginalString);
                Assert.False(connected.Reconnected);
                Assert.Equal("p1", connected.Welcome.PlayerId);
                Assert.Equal(ConnectionState.Connected, connection.State);
                Assert.Equal("p1", connection.PlayerId);
                Assert.Equal("tok1", connection.Token);
                Assert.Equal(Phase.Lobby, connection.Room.Phase);
            }
        }

        [Fact]
        public void 상태_메시지를_받으면_방_상태와_이벤트가_갱신된다()
        {
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                transport.Push(Welcome());
                WaitUntil(connection, Connected);

                transport.Push(StateJson("ban", 2000, "12000"));
                var events = WaitUntil(connection, e => e is StateEvent);
                var state = (StateEvent)events[events.Count - 1];

                Assert.Equal(Phase.Ban, state.Room.Phase);
                Assert.Equal(Phase.Ban, connection.Room.Phase);
                Assert.Equal(12000, connection.Room.PhaseEndsAt);
            }
        }

        [Fact]
        public void 남은_시간은_서버_시계로_보정된다()
        {
            long localNow = 100_500; // 내 시계가 서버보다 500ms 빠르다
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast, () => localNow))
            {
                connection.Start("ws://x", "ABCD", "에드");
                transport.Push(Welcome(serverTime: 100_000, phase: "ban", phaseEndsAt: "110000"));
                WaitUntil(connection, Connected);

                // 내 시계로 101_500 = 서버 시각 101_000 -> 종료(110_000)까지 9초
                localNow = 101_500;
                Assert.Equal(9_000, connection.RemainingMs());
            }
        }

        [Fact]
        public void 접속하면_ping을_보내고_pong으로_시계를_보정한다()
        {
            var transport = new FakeTransport();
            long localNow = 1_000;
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast, () => localNow))
            {
                connection.Start("ws://x", "ABCD", "에드");
                transport.Push(Welcome(serverTime: 5_000));
                WaitUntil(connection, Connected);

                WaitFor(() => transport.Sent.Count >= 1);
                Assert.Equal("{\"t\":\"ping\",\"ts\":1000}", transport.Sent[0]);

                localNow = 1_100;
                transport.Push("{\"t\":\"pong\",\"ts\":1000,\"serverTime\":5050}");
                WaitFor(() => connection.Clock.BestRttMs == 100);
                Assert.Equal(-4_000, connection.Clock.OffsetMs);
            }
        }

        [Fact]
        public void 접속하기_전에는_준비를_보낼_수_없고_접속_후에는_보낸다()
        {
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast))
            {
                Assert.False(connection.SendReady(true));

                connection.Start("ws://x", "ABCD", "에드");
                transport.Push(Welcome());
                WaitUntil(connection, Connected);

                Assert.True(connection.SendReady(true));
                WaitFor(() => transport.Sent.Contains("{\"t\":\"ready\",\"ready\":true}"));
            }
        }

        [Fact]
        public void 끊기면_token으로_다시_접속한다()
        {
            var first = new FakeTransport();
            var second = new FakeTransport();
            var factory = new FakeFactory(first, second);
            using (var connection = new RoomConnection(factory, Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                first.Push(Welcome(token: "tok-A"));
                WaitUntil(connection, Connected);

                first.Drop();
                var events = WaitUntil(connection, e => e is ReconnectingEvent);
                Assert.Equal(1, ((ReconnectingEvent)events[events.Count - 1]).Attempt);

                second.Push(Welcome(token: "tok-A"));
                var after = WaitUntil(connection, Connected);
                Assert.True(((ConnectedEvent)after[after.Count - 1]).Reconnected);

                Assert.Contains("&token=tok-A", second.ConnectedUri.OriginalString);
                Assert.DoesNotContain("token=", first.ConnectedUri.OriginalString);
                Assert.True(first.Disposed);
                Assert.Equal(ConnectionState.Connected, connection.State);
            }
        }

        [Fact]
        public void 서버가_정상적으로_닫아도_다시_접속한다()
        {
            var first = new FakeTransport();
            var second = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(first, second), Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                first.Push(Welcome());
                WaitUntil(connection, Connected);

                first.CloseGracefully();
                WaitUntil(connection, e => e is ReconnectingEvent);
                second.Push(Welcome());
                WaitUntil(connection, Connected);
            }
        }

        [Fact]
        public void 정원_초과는_재접속하지_않고_끝낸다()
        {
            var transport = new FakeTransport();
            var factory = new FakeFactory(transport);
            using (var connection = new RoomConnection(factory, Fast))
            {
                connection.Start("ws://x", "ABCD", "셋째");
                transport.Push("{\"t\":\"error\",\"code\":\"room_full\",\"message\":\"방이 가득 찼다.\"}");
                transport.CloseGracefully();

                var events = WaitUntil(connection, Disconnected);
                var error = Assert.IsType<ErrorEvent>(events[0]);
                Assert.Equal("room_full", error.Code);
                Assert.Equal("room_full", ((DisconnectedEvent)events[events.Count - 1]).Reason);
                Assert.Equal(1, factory.CreateCount);
                Assert.Equal(ConnectionState.Disconnected, connection.State);
            }
        }

        [Fact]
        public void 치명적이지_않은_오류는_이벤트로만_전한다()
        {
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                transport.Push(Welcome());
                WaitUntil(connection, Connected);

                transport.Push("{\"t\":\"error\",\"code\":\"bad_message\",\"message\":\"알 수 없는 메시지다.\"}");
                var events = WaitUntil(connection, e => e is ErrorEvent);
                Assert.Equal("bad_message", ((ErrorEvent)events[events.Count - 1]).Code);
                Assert.Equal(ConnectionState.Connected, connection.State);
            }
        }

        [Fact]
        public void 한_번도_입장하지_못하고_실패하면_반복하지_않고_끝낸다()
        {
            var transport = new FakeTransport { ConnectError = new IOException("서버에 닿지 않는다") };
            var factory = new FakeFactory(transport);
            using (var connection = new RoomConnection(factory, Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                var events = WaitUntil(connection, Disconnected);
                Assert.Equal("서버에 닿지 않는다", ((DisconnectedEvent)events[events.Count - 1]).Reason);
                Assert.Equal(1, factory.CreateCount);
            }
        }

        [Fact]
        public void 재접속을_계속_실패하면_정해진_횟수_뒤에_포기한다()
        {
            var first = new FakeTransport();
            var failing = new[]
            {
                new FakeTransport { ConnectError = new IOException("x") },
                new FakeTransport { ConnectError = new IOException("x") },
                new FakeTransport { ConnectError = new IOException("x") },
            };
            var all = new List<FakeTransport> { first };
            all.AddRange(failing);
            var factory = new FakeFactory(all.ToArray());

            using (var connection = new RoomConnection(factory, Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                first.Push(Welcome());
                WaitUntil(connection, Connected);
                first.Drop();

                var events = WaitUntil(connection, Disconnected);
                int attempts = events.FindAll(e => e is ReconnectingEvent).Count;
                Assert.Equal(Fast.MaxReconnectAttempts, attempts);
            }
        }

        [Fact]
        public void Stop을_부르면_멈추고_Disconnected가_나온다()
        {
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                transport.Push(Welcome());
                WaitUntil(connection, Connected);

                connection.Stop();
                var events = WaitUntil(connection, Disconnected);
                Assert.Equal("stopped", ((DisconnectedEvent)events[events.Count - 1]).Reason);
                Assert.True(connection.WaitUntilStopped(TimeSpan.FromSeconds(2)));
                Assert.Equal(ConnectionState.Disconnected, connection.State);
                Assert.False(connection.SendReady(true));
            }
        }

        [Fact]
        public void 접속_중에_다시_Start하면_예외()
        {
            var transport = new FakeTransport();
            using (var connection = new RoomConnection(new FakeFactory(transport), Fast))
            {
                connection.Start("ws://x", "ABCD", "에드");
                Assert.Throws<InvalidOperationException>(() => connection.Start("ws://x", "ABCD", "에드"));
            }
        }
    }
}
