using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

namespace Edbot.Net
{
    public enum ConnectionState
    {
        Disconnected,
        Connecting,
        Connected,
        Reconnecting,
    }

    /// <summary>
    /// 네트워크 스레드에서 일어난 일을 게임 쪽에 전하는 이벤트.
    /// Unity는 메인 스레드에서만 화면을 바꿀 수 있어서, 이벤트를 큐에 쌓아 두고
    /// 매 프레임 <see cref="RoomConnection.TryDequeue"/>로 꺼내 쓴다.
    /// </summary>
    public abstract class NetEvent
    {
    }

    public sealed class ConnectedEvent : NetEvent
    {
        public WelcomeMessage Welcome { get; set; }
        /// <summary>끊겼다가 token으로 다시 들어온 경우 true.</summary>
        public bool Reconnected { get; set; }
    }

    public sealed class StateEvent : NetEvent
    {
        public RoomSnapshot Room { get; set; }
    }

    public sealed class ErrorEvent : NetEvent
    {
        public string Code { get; set; }
        public string Message { get; set; }
    }

    public sealed class ReconnectingEvent : NetEvent
    {
        public int Attempt { get; set; }
    }

    /// <summary>연결이 완전히 끝났다. 더 이상 자동 재접속하지 않는다.</summary>
    public sealed class DisconnectedEvent : NetEvent
    {
        public string Reason { get; set; }
    }

    public sealed class ConnectionOptions
    {
        public int MaxReconnectAttempts = 8;

        /// <summary>재접속 시도 사이의 대기 시간. 시도가 더 많으면 마지막 값을 계속 쓴다.</summary>
        public TimeSpan[] ReconnectBackoff =
        {
            TimeSpan.FromMilliseconds(500),
            TimeSpan.FromSeconds(1),
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(4),
        };

        public TimeSpan PingInterval = TimeSpan.FromSeconds(5);
    }

    /// <summary>
    /// 방 하나에 대한 연결. 접속, 메시지 해석, ping으로 시계 보정, 끊겼을 때 token으로 자동 재접속을 맡는다.
    /// 모든 일은 백그라운드에서 돌고, 결과는 이벤트 큐로만 나온다.
    /// </summary>
    public sealed class RoomConnection : IDisposable
    {
        private readonly ITransportFactory _factory;
        private readonly Func<long> _nowMs;
        private readonly ConnectionOptions _options;
        private readonly ConcurrentQueue<NetEvent> _events = new ConcurrentQueue<NetEvent>();
        private readonly ServerClock _clock = new ServerClock();

        private CancellationTokenSource _cts;
        private CancellationToken _ct;
        private Task _runTask;
        private volatile IWebSocketTransport _transport;

        private string _wsBase;
        private string _roomCode;
        private string _name;

        private volatile string _token;
        private volatile string _playerId;
        private volatile RoomSnapshot _room;
        private int _state = (int)ConnectionState.Disconnected;
        private int _attempt;
        private volatile bool _fatal;
        private string _fatalCode;

        public RoomConnection(ITransportFactory factory = null, ConnectionOptions options = null, Func<long> nowMs = null)
        {
            _factory = factory ?? new ClientWebSocketTransportFactory(() => _authToken);
            _options = options ?? new ConnectionOptions();
            _nowMs = nowMs ?? (() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        }

        private volatile string _authToken;

        /// <summary>GL 로그인으로 받은 게임 세션 토큰. 접속(과 재접속)할 때 Authorization 헤더로 보낸다.</summary>
        public string AuthToken
        {
            get { return _authToken; }
            set { _authToken = value; }
        }

        public ConnectionState State { get { return (ConnectionState)Volatile.Read(ref _state); } }
        public string PlayerId { get { return _playerId; } }
        public string Token { get { return _token; } }
        /// <summary>가장 최근에 받은 방 상태.</summary>
        public RoomSnapshot Room { get { return _room; } }
        public ServerClock Clock { get { return _clock; } }
        public long NowMs() { return _nowMs(); }

        /// <summary>단계가 끝날 때까지 남은 시간(ms). 타이머가 없으면 null.</summary>
        public long? RemainingMs()
        {
            var room = _room;
            return room == null ? null : _clock.RemainingMs(room.PhaseEndsAt, _nowMs());
        }

        /// <summary>방에 접속한다. 이미 접속 중이면 예외.</summary>
        /// <param name="wsBase">예: ws://127.0.0.1:8787 (ApiClient.ToWebSocketBase 참고)</param>
        public void Start(string wsBase, string roomCode, string name)
        {
            if (_runTask != null && !_runTask.IsCompleted)
            {
                throw new InvalidOperationException("이미 연결 중이다.");
            }

            _wsBase = wsBase.TrimEnd('/');
            _roomCode = (roomCode ?? "").Trim().ToUpperInvariant();
            _name = name ?? "";
            _token = null;
            _playerId = null;
            _room = null;
            _fatal = false;
            _fatalCode = null;
            _attempt = 0;

            _cts = new CancellationTokenSource();
            _ct = _cts.Token;
            _runTask = Task.Run(() => RunAsync(_ct));
        }

        public void Stop()
        {
            var cts = _cts;
            if (cts != null) cts.Cancel();
        }

        public void Dispose()
        {
            Stop();
        }

        public bool TryDequeue(out NetEvent netEvent)
        {
            return _events.TryDequeue(out netEvent);
        }

        /// <summary>준비 상태를 서버에 보낸다. 지금 접속 상태가 아니면 false.</summary>
        public bool SendReady(bool ready)
        {
            return TrySend(MessageCodec.Ready(ready));
        }

        /// <summary>밴 단계에서 캐릭터 한 명을 금지한다. 한 번 정하면 바꿀 수 없다.</summary>
        public bool SendBan(string characterId)
        {
            return TrySend(MessageCodec.Ban(characterId));
        }

        /// <summary>드래프트에서 내 차례에 캐릭터 한 명을 뽑는다.</summary>
        public bool SendPick(string characterId)
        {
            return TrySend(MessageCodec.Pick(characterId));
        }

        /// <summary>배치 단계에서 내 캐릭터 한 명의 레인을 정한다. 확정하기 전에는 다시 바꿀 수 있다.</summary>
        public bool SendPlace(string characterId, Lane lane)
        {
            return TrySend(MessageCodec.Place(characterId, lane));
        }

        /// <summary>전투 중 궁극기를 쓴다 (스팀포스 5). 안키오는 갈 레인도 보낸다.</summary>
        public bool SendUltimate(string characterId, Lane? lane = null)
        {
            return TrySend(MessageCodec.Ultimate(characterId, lane));
        }

        public bool SendForgeBuy(int quantity = 1) { return TrySend(MessageCodec.ForgeBuy(quantity)); }
        public bool SendForgeSmelt() { return TrySend(MessageCodec.ForgeSmelt()); }
        public bool SendForgeCraft(string weaponId) { return TrySend(MessageCodec.ForgeCraft(weaponId)); }
        public bool SendForgeEquip(string weaponId, string characterId) { return TrySend(MessageCodec.ForgeEquip(weaponId, characterId)); }

        /// <summary>탐사 행동을 보낸다. action: "gather" | "ambush" | "scout".</summary>
        public bool SendExplore(string action, int tile)
        {
            return TrySend(MessageCodec.Explore(action, tile));
        }

        /// <summary>전투 중 나이트가 다른 레인으로 옮겨 간다.</summary>
        public bool SendMoveLane(string characterId, Lane lane)
        {
            return TrySend(MessageCodec.Move(characterId, lane));
        }

        /// <summary>배치를 확정한다. 정하지 않은 캐릭터는 기본 레인으로 간다.</summary>
        public bool SendLock()
        {
            return TrySend(MessageCodec.Lock());
        }

        /// <summary>서버 시각(ms)까지 남은 시간(ms). 서버 시계로 보정한다. 시각이 없으면 null.</summary>
        public long? RemainingMsUntil(long? serverTimeMs)
        {
            return _clock.RemainingMs(serverTimeMs, _nowMs());
        }

        /// <summary>끝날 때까지 기다린다. 주로 테스트에서 쓴다.</summary>
        public bool WaitUntilStopped(TimeSpan timeout)
        {
            var task = _runTask;
            return task == null || task.Wait(timeout);
        }

        // ---- 내부 ----

        private async Task RunAsync(CancellationToken ct)
        {
            string endReason = null;

            while (!ct.IsCancellationRequested)
            {
                bool isRetry = _attempt > 0;
                SetState(isRetry ? ConnectionState.Reconnecting : ConnectionState.Connecting);
                if (isRetry) Enqueue(new ReconnectingEvent { Attempt = _attempt });

                string failure = null;
                IWebSocketTransport transport = null;
                try
                {
                    transport = _factory.Create();
                    await transport.ConnectAsync(BuildUri(), ct).ConfigureAwait(false);
                    _transport = transport;

                    using (var pingCts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                    {
                        Task pingTask = PingLoopAsync(transport, pingCts.Token);
                        try
                        {
                            await ReceiveLoopAsync(transport, ct).ConfigureAwait(false);
                        }
                        finally
                        {
                            pingCts.Cancel();
                            try { await pingTask.ConfigureAwait(false); } catch { }
                        }
                    }
                    failure = "연결이 끊겼다";
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    failure = ex.Message;
                }
                finally
                {
                    _transport = null;
                    if (transport != null) transport.Dispose();
                }

                if (ct.IsCancellationRequested) break;

                if (_fatal)
                {
                    endReason = _fatalCode;
                    break;
                }
                if (_token == null)
                {
                    // 한 번도 입장하지 못했다. 서버 주소나 방 코드가 틀렸을 가능성이 커서 자동으로 반복하지 않는다.
                    endReason = failure;
                    break;
                }

                _attempt++;
                if (_attempt > _options.MaxReconnectAttempts)
                {
                    endReason = failure;
                    break;
                }

                try
                {
                    await Task.Delay(Backoff(_attempt), ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }

            SetState(ConnectionState.Disconnected);
            Enqueue(new DisconnectedEvent { Reason = endReason ?? "stopped" });
        }

        private async Task ReceiveLoopAsync(IWebSocketTransport transport, CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                string text = await transport.ReceiveAsync(ct).ConfigureAwait(false);
                if (text == null) return; // 서버가 정상적으로 닫았다
                HandleMessage(text);
            }
        }

        private async Task PingLoopAsync(IWebSocketTransport transport, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    await transport.SendAsync(MessageCodec.Ping(_nowMs()), ct).ConfigureAwait(false);
                    await Task.Delay(_options.PingInterval, ct).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception)
            {
                // 보내기에 실패했다면 받기 쪽에서도 곧 끊김을 알아챈다.
            }
        }

        private void HandleMessage(string text)
        {
            var message = MessageCodec.Parse(text);
            long now = _nowMs();

            switch (message)
            {
                case WelcomeMessage welcome:
                {
                    bool reconnected = _token != null;
                    _playerId = welcome.PlayerId;
                    _token = welcome.Token;
                    _room = welcome.Room;
                    if (welcome.Room != null) _clock.ObserveState(welcome.Room.ServerTime, now);
                    _attempt = 0;
                    SetState(ConnectionState.Connected);
                    Enqueue(new ConnectedEvent { Welcome = welcome, Reconnected = reconnected });
                    break;
                }
                case StateMessage state:
                {
                    _room = state.Room;
                    if (state.Room != null) _clock.ObserveState(state.Room.ServerTime, now);
                    Enqueue(new StateEvent { Room = state.Room });
                    break;
                }
                case PongMessage pong:
                {
                    _clock.ObservePong(pong.Ts, pong.ServerTime, now);
                    break;
                }
                case ErrorMessage error:
                {
                    if (ErrorCodes.IsFatal(error.Code))
                    {
                        _fatal = true;
                        _fatalCode = error.Code;
                    }
                    Enqueue(new ErrorEvent { Code = error.Code, Message = error.Message });
                    break;
                }
            }
        }

        private bool TrySend(string text)
        {
            var transport = _transport;
            if (transport == null || State != ConnectionState.Connected) return false;
            var ignored = SendSafeAsync(transport, text);
            return true;
        }

        private async Task SendSafeAsync(IWebSocketTransport transport, string text)
        {
            try
            {
                await transport.SendAsync(text, _ct).ConfigureAwait(false);
            }
            catch (Exception)
            {
                // 연결이 끊겼다면 받기 쪽이 알아채고 재접속을 시작한다.
            }
        }

        private Uri BuildUri()
        {
            string uri = _wsBase + "/ws/" + _roomCode + "?name=" + Uri.EscapeDataString(_name);
            var token = _token;
            if (token != null) uri += "&token=" + Uri.EscapeDataString(token);
            return new Uri(uri);
        }

        private TimeSpan Backoff(int attempt)
        {
            var steps = _options.ReconnectBackoff;
            if (steps == null || steps.Length == 0) return TimeSpan.FromSeconds(1);
            return steps[Math.Min(attempt - 1, steps.Length - 1)];
        }

        private void SetState(ConnectionState state)
        {
            Volatile.Write(ref _state, (int)state);
        }

        private void Enqueue(NetEvent netEvent)
        {
            _events.Enqueue(netEvent);
        }
    }
}
