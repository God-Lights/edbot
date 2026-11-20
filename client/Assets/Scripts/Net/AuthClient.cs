using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Edbot.Net
{
    /// <summary>GL Account 로그인한 사용자. 이메일은 서버가 내려 주지 않는다.</summary>
    public sealed class AuthUser
    {
        /// <summary>사용자 식별자(UUID). 이메일, 아이디, 닉네임은 바뀔 수 있어서 이 값을 쓴다.</summary>
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("username")] public string Username { get; set; }
        [JsonProperty("nickname")] public string Nickname { get; set; }
        [JsonProperty("emailVerified")] public bool EmailVerified { get; set; }
    }

    public sealed class LoginStart
    {
        [JsonProperty("loginId")] public string LoginId { get; set; }
        /// <summary>브라우저로 열 주소. 로그인하기 버튼을 눌렀을 때만 연다.</summary>
        [JsonProperty("loginUrl")] public string LoginUrl { get; set; }
        [JsonProperty("expiresInSeconds")] public int ExpiresInSeconds { get; set; }
    }

    public enum LoginPollStatus
    {
        Pending,
        Approved,
        /// <summary>로그인 요청이 만료되었거나 없다.</summary>
        Expired,
    }

    public sealed class LoginPollResult
    {
        public LoginPollStatus Status { get; set; }
        /// <summary>게임 세션 토큰. 승인된 순간에 한 번만 받는다.</summary>
        public string Token { get; set; }
        public AuthUser User { get; set; }
    }

    /// <summary>
    /// GL Account 로그인 (기기 로그인). 브라우저에서 로그인하는 동안 게임이 기다렸다가 토큰을 받는다.
    /// 로그인·회원가입 화면은 account.officialgl.com 에서 처리하고, 게임에서는 만들지 않는다.
    /// </summary>
    public sealed class AuthClient : IDisposable
    {
        private readonly HttpClient _http;
        private readonly string _baseUrl;

        public AuthClient(string serverUrl, HttpMessageHandler handler = null)
        {
            _baseUrl = ApiClient.NormalizeServerUrl(serverUrl);
            _http = handler != null ? new HttpClient(handler) : new HttpClient();
            _http.Timeout = TimeSpan.FromSeconds(10);
        }

        public async Task<LoginStart> StartAsync(CancellationToken ct = default(CancellationToken))
        {
            using (var response = await _http.PostAsync(_baseUrl + "/api/auth/start", new StringContent(""), ct).ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                var start = JsonConvert.DeserializeObject<LoginStart>(body);
                if (start == null || string.IsNullOrEmpty(start.LoginId) || string.IsNullOrEmpty(start.LoginUrl))
                {
                    throw new HttpRequestException("서버 응답에 로그인 정보가 없다.");
                }
                return start;
            }
        }

        public async Task<LoginPollResult> PollAsync(string loginId, CancellationToken ct = default(CancellationToken))
        {
            using (var response = await _http.GetAsync(_baseUrl + "/api/auth/poll?id=" + Uri.EscapeDataString(loginId), ct).ConfigureAwait(false))
            {
                if (response.StatusCode == HttpStatusCode.NotFound) return new LoginPollResult { Status = LoginPollStatus.Expired };
                if (response.StatusCode == HttpStatusCode.Accepted) return new LoginPollResult { Status = LoginPollStatus.Pending };
                response.EnsureSuccessStatusCode();
                string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                var obj = JObject.Parse(body);
                string token = (string)obj["token"];
                if (string.IsNullOrEmpty(token)) throw new HttpRequestException("서버 응답에 토큰이 없다.");
                return new LoginPollResult
                {
                    Status = LoginPollStatus.Approved,
                    Token = token,
                    User = obj["user"] == null ? null : obj["user"].ToObject<AuthUser>(),
                };
            }
        }

        /// <summary>토큰이 아직 유효한지 확인하고 사용자를 돌려준다. 만료되었으면 null.</summary>
        public async Task<AuthUser> GetMeAsync(string token, CancellationToken ct = default(CancellationToken))
        {
            using (var request = new HttpRequestMessage(HttpMethod.Get, _baseUrl + "/api/auth/me"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using (var response = await _http.SendAsync(request, ct).ConfigureAwait(false))
                {
                    if (response.StatusCode == HttpStatusCode.Unauthorized) return null;
                    response.EnsureSuccessStatusCode();
                    string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    return JObject.Parse(body)["user"].ToObject<AuthUser>();
                }
            }
        }

        public async Task LogoutAsync(string token, CancellationToken ct = default(CancellationToken))
        {
            using (var request = new HttpRequestMessage(HttpMethod.Post, _baseUrl + "/api/auth/logout"))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using (await _http.SendAsync(request, ct).ConfigureAwait(false)) { }
            }
        }

        public void Dispose()
        {
            _http.Dispose();
        }
    }
}
