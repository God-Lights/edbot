using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Edbot.Net
{
    /// <summary>서버의 HTTP API (방 만들기, 방 정보 조회).</summary>
    public sealed class ApiClient : IDisposable
    {
        private readonly HttpClient _http;
        private readonly string _baseUrl;

        public ApiClient(string serverUrl, HttpMessageHandler handler = null)
        {
            _baseUrl = NormalizeServerUrl(serverUrl);
            _http = handler != null ? new HttpClient(handler) : new HttpClient();
            _http.Timeout = TimeSpan.FromSeconds(10);
        }

        /// <summary>"127.0.0.1:8787" 처럼 적어도 되도록 주소를 다듬는다. 끝의 '/'는 뺀다.</summary>
        public static string NormalizeServerUrl(string serverUrl)
        {
            string url = (serverUrl ?? "").Trim();
            if (url.Length == 0) throw new ArgumentException("서버 주소가 비어 있다.");
            if (!url.Contains("://")) url = "http://" + url;
            return url.TrimEnd('/');
        }

        /// <summary>http(s) 주소를 ws(s) 주소로 바꾼다.</summary>
        public static string ToWebSocketBase(string serverUrl)
        {
            string url = NormalizeServerUrl(serverUrl);
            if (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return "wss://" + url.Substring(8);
            if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return "ws://" + url.Substring(7);
            return url; // 이미 ws:// 또는 wss://
        }

        /// <summary>새 방을 만들고 4자리 방 코드를 돌려준다.</summary>
        public async Task<string> CreateRoomAsync(CancellationToken ct = default(CancellationToken))
        {
            using (var response = await _http.PostAsync(_baseUrl + "/api/rooms", new StringContent(""), ct).ConfigureAwait(false))
            {
                string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                {
                    throw new HttpRequestException("방을 만들 수 없다 (" + (int)response.StatusCode + ")");
                }
                var code = (string)JObject.Parse(body)["code"];
                if (string.IsNullOrEmpty(code)) throw new HttpRequestException("서버 응답에 방 코드가 없다.");
                return code;
            }
        }

        /// <summary>방 정보를 조회한다. 방이 없으면 null.</summary>
        public async Task<RoomInfo> GetRoomAsync(string code, CancellationToken ct = default(CancellationToken))
        {
            string normalized = (code ?? "").Trim().ToUpperInvariant();
            using (var response = await _http.GetAsync(_baseUrl + "/api/rooms/" + Uri.EscapeDataString(normalized), ct).ConfigureAwait(false))
            {
                if (response.StatusCode == HttpStatusCode.NotFound) return null;
                response.EnsureSuccessStatusCode();
                string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                return JsonConvert.DeserializeObject<RoomInfo>(body);
            }
        }

        public void Dispose()
        {
            _http.Dispose();
        }
    }
}
