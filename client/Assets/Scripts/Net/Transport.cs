using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Edbot.Net
{
    /// <summary>
    /// WebSocket 한 개를 감싼 얇은 인터페이스. 접속 로직(RoomConnection)을 진짜 네트워크 없이
    /// 테스트하려고 분리했다.
    /// </summary>
    public interface IWebSocketTransport : IDisposable
    {
        Task ConnectAsync(Uri uri, CancellationToken ct);
        Task SendAsync(string text, CancellationToken ct);

        /// <summary>다음 텍스트 메시지를 받는다. 상대가 정상적으로 닫으면 null.</summary>
        Task<string> ReceiveAsync(CancellationToken ct);
    }

    public interface ITransportFactory
    {
        IWebSocketTransport Create();
    }

    public sealed class ClientWebSocketTransportFactory : ITransportFactory
    {
        private readonly Func<string> _authToken;

        /// <param name="authToken">접속할 때마다 불러서 Authorization 헤더에 넣을 토큰을 얻는다. 없으면 null.</param>
        public ClientWebSocketTransportFactory(Func<string> authToken = null)
        {
            _authToken = authToken;
        }

        public IWebSocketTransport Create()
        {
            return new ClientWebSocketTransport(_authToken == null ? null : _authToken());
        }
    }

    /// <summary>System.Net.WebSockets.ClientWebSocket을 쓰는 실제 구현. (Unity PC 빌드에서 동작)</summary>
    public sealed class ClientWebSocketTransport : IWebSocketTransport
    {
        private readonly ClientWebSocket _socket = new ClientWebSocket();
        // ClientWebSocket은 동시에 두 번 보내면 예외가 나서 보내기를 한 줄로 세운다.
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private readonly byte[] _buffer = new byte[16 * 1024];

        public ClientWebSocketTransport(string authToken = null)
        {
            if (!string.IsNullOrEmpty(authToken)) _socket.Options.SetRequestHeader("Authorization", "Bearer " + authToken);
        }

        public Task ConnectAsync(Uri uri, CancellationToken ct)
        {
            return _socket.ConnectAsync(uri, ct);
        }

        public async Task SendAsync(string text, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            await _sendLock.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct)
                    .ConfigureAwait(false);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        public async Task<string> ReceiveAsync(CancellationToken ct)
        {
            using (var message = new MemoryStream())
            {
                while (true)
                {
                    var result = await _socket.ReceiveAsync(new ArraySegment<byte>(_buffer), ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        try
                        {
                            if (_socket.State == WebSocketState.CloseReceived)
                            {
                                await _socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None)
                                    .ConfigureAwait(false);
                            }
                        }
                        catch (WebSocketException)
                        {
                            // 이미 끊긴 연결
                        }
                        return null;
                    }

                    message.Write(_buffer, 0, result.Count);
                    if (result.EndOfMessage) break;
                }
                return Encoding.UTF8.GetString(message.ToArray());
            }
        }

        public void Dispose()
        {
            _socket.Dispose();
        }
    }
}
