using System;
using System.Collections.Generic;
using Edbot.Net;
using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 서버 연결을 들고 있는, 게임 전체에서 하나뿐인 객체.
    /// 네트워크 스레드에서 쌓인 이벤트를 매 프레임 메인 스레드에서 꺼내 화면 쪽에 전한다.
    /// </summary>
    public sealed class GameClient : MonoBehaviour
    {
        public static GameClient Instance { get; private set; }

        [SerializeField] private string serverUrl = "https://edgame-api.officialgl.com";

        public event Action<ConnectedEvent> Connected;
        public event Action<RoomSnapshot> StateChanged;
        public event Action<ErrorEvent> ErrorReceived;
        public event Action<int> Reconnecting;
        public event Action<string> Disconnected;

        private RoomConnection _connection;

        /// <summary>현재 방 연결. 방에 들어가지 않았으면 null.</summary>
        public RoomConnection Connection { get { return _connection; } }

        public string ServerUrl
        {
            get { return serverUrl; }
            set { serverUrl = value; }
        }

        public bool IsCreatingRoom { get; private set; }

        // ---- GL Account 로그인 ----

        private const string TokenPref = "edbot.authToken";
        private System.Threading.CancellationTokenSource _loginCts;

        /// <summary>로그인한 사용자. 로그인하지 않았으면 null.</summary>
        public AuthUser User { get; private set; }

        /// <summary>게임 세션 토큰. 서버가 로그인을 요구하지 않는 개발 서버에서는 없어도 된다.</summary>
        public string AuthToken { get; private set; }

        /// <summary>브라우저에서 로그인하기를 기다리는 중인가.</summary>
        public bool IsLoggingIn { get; private set; }

        /// <summary>캐릭터 12명의 데이터. 방에 들어갈 때 서버에서 가져온다. 아직이면 null.</summary>
        public IReadOnlyList<CharacterInfo> Roster { get; private set; }

        /// <summary>무기 9종의 데이터(레시피 포함). 아직이면 null.</summary>
        public IReadOnlyList<WeaponInfo> Weapons { get; private set; }

        private bool _loadingRoster;

        /// <summary>화면에 띄울 마지막 안내/오류 문구.</summary>
        public string LastMessage { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
            // 창이 포커스를 잃어도 연결과 타이머가 계속 돌아야 한다.
            Application.runInBackground = true;
            RestoreLogin();
        }

        private void Update()
        {
            var connection = _connection;
            if (connection == null) return;

            NetEvent netEvent;
            while (connection.TryDequeue(out netEvent))
            {
                Dispatch(netEvent);
            }
        }

        private void OnDestroy()
        {
            if (_loginCts != null) _loginCts.Cancel();
            if (Instance == this) Instance = null;
            StopConnection();
        }

        /// <summary>저장해 둔 토큰이 아직 유효한지 확인한다. 만료되었으면 지운다.</summary>
        private async void RestoreLogin()
        {
            string token = PlayerPrefs.GetString(TokenPref, "");
            if (string.IsNullOrEmpty(token)) return;
            try
            {
                using (var auth = new AuthClient(serverUrl))
                {
                    var user = await auth.GetMeAsync(token);
                    if (user == null)
                    {
                        PlayerPrefs.DeleteKey(TokenPref);
                        return;
                    }
                    AuthToken = token;
                    User = user;
                }
            }
            catch (Exception ex)
            {
                // 서버에 닿지 못한 것일 수 있어서 토큰은 지우지 않는다.
                Debug.LogWarning("로그인 상태를 확인하지 못했다: " + ex.Message);
            }
        }

        /// <summary>
        /// 로그인하기 버튼을 눌렀을 때. 브라우저로 GL Account 로그인 화면을 열고,
        /// 로그인을 마치면 게임이 토큰을 받아 온다. (자동으로 열지 않는다.)
        /// </summary>
        public async void BeginLogin()
        {
            if (IsLoggingIn) return;
            IsLoggingIn = true;
            LastMessage = null;
            _loginCts = new System.Threading.CancellationTokenSource();
            var ct = _loginCts.Token;
            try
            {
                using (var auth = new AuthClient(serverUrl))
                {
                    var start = await auth.StartAsync(ct);
                    Application.OpenURL(start.LoginUrl);
                    LastMessage = "브라우저에서 로그인한 뒤 '로그인 확인'을 눌러 주세요.";
                    var deadline = DateTime.UtcNow.AddSeconds(Mathf.Max(30, start.ExpiresInSeconds));
                    while (DateTime.UtcNow < deadline)
                    {
                        await System.Threading.Tasks.Task.Delay(2000, ct);
                        var result = await auth.PollAsync(start.LoginId, ct);
                        if (result.Status == LoginPollStatus.Pending) continue;
                        if (result.Status == LoginPollStatus.Expired) break;
                        AuthToken = result.Token;
                        User = result.User;
                        PlayerPrefs.SetString(TokenPref, result.Token);
                        PlayerPrefs.Save();
                        LastMessage = null;
                        return;
                    }
                    LastMessage = "로그인 시간이 지났다. 다시 눌러 주세요.";
                }
            }
            catch (OperationCanceledException)
            {
            }
            catch (Exception ex)
            {
                LastMessage = "로그인할 수 없다: " + ex.Message;
                Debug.LogWarning(LastMessage);
            }
            finally
            {
                IsLoggingIn = false;
            }
        }

        public void CancelLogin()
        {
            if (_loginCts != null) _loginCts.Cancel();
        }

        /// <summary>게임 세션을 끊는다. (GL 계정 로그아웃은 account.officialgl.com 에서)</summary>
        public async void Logout()
        {
            string token = AuthToken;
            AuthToken = null;
            User = null;
            PlayerPrefs.DeleteKey(TokenPref);
            if (string.IsNullOrEmpty(token)) return;
            try
            {
                using (var auth = new AuthClient(serverUrl)) await auth.LogoutAsync(token);
            }
            catch (Exception ex)
            {
                Debug.LogWarning("로그아웃 요청에 실패했다: " + ex.Message);
            }
        }

        private void HandleUnauthorized()
        {
            AuthToken = null;
            User = null;
            PlayerPrefs.DeleteKey(TokenPref);
            LastMessage = "로그인이 필요하다. 로그인하기를 눌러 주세요.";
        }

        /// <summary>새 방을 만들고 바로 들어간다.</summary>
        public async void CreateRoomAndJoin(string playerName)
        {
            if (IsCreatingRoom) return;
            IsCreatingRoom = true;
            LastMessage = null;
            try
            {
                using (var api = new ApiClient(serverUrl, null, AuthToken))
                {
                    string code = await api.CreateRoomAsync();
                    // await 뒤에는 Unity 메인 스레드로 돌아와 있다.
                    Join(code, playerName);
                }
            }
            catch (UnauthorizedException)
            {
                HandleUnauthorized();
            }
            catch (Exception ex)
            {
                LastMessage = "방을 만들 수 없다: " + ex.Message;
                Debug.LogWarning(LastMessage);
            }
            finally
            {
                IsCreatingRoom = false;
            }
        }

        /// <summary>방 코드로 들어간다.</summary>
        public void Join(string roomCode, string playerName)
        {
            StopConnection();
            LastMessage = null;

            LoadRosterAsync();
            LoadWeaponsAsync();

            var connection = new RoomConnection();
            connection.AuthToken = AuthToken;
            _connection = connection;
            try
            {
                // 로그인했다면 서버가 GL 닉네임을 이름으로 쓴다.
                connection.Start(ApiClient.ToWebSocketBase(serverUrl), roomCode, User != null ? User.Nickname : playerName);
            }
            catch (Exception ex)
            {
                LastMessage = "접속할 수 없다: " + ex.Message;
                Debug.LogWarning(LastMessage);
                _connection = null;
            }
        }

        public void Leave()
        {
            StopConnection();
        }

        public bool SetReady(bool ready)
        {
            return _connection != null && _connection.SendReady(ready);
        }

        public bool Ban(string characterId)
        {
            return _connection != null && _connection.SendBan(characterId);
        }

        public bool Pick(string characterId)
        {
            return _connection != null && _connection.SendPick(characterId);
        }

        public bool Place(string characterId, Lane lane)
        {
            return _connection != null && _connection.SendPlace(characterId, lane);
        }

        public bool LockPlacement()
        {
            return _connection != null && _connection.SendLock();
        }

        public bool UseUltimate(string characterId, Lane? lane = null)
        {
            return _connection != null && _connection.SendUltimate(characterId, lane);
        }

        /// <summary>탐사 행동. action: "gather"(채집), "ambush"(매복), "scout"(정찰).</summary>
        public bool Explore(string action, int tile)
        {
            return _connection != null && _connection.SendExplore(action, tile);
        }

        public bool MoveLane(string characterId, Lane lane)
        {
            return _connection != null && _connection.SendMoveLane(characterId, lane);
        }

        /// <summary>id로 캐릭터를 찾는다. 데이터가 아직 없거나 모르는 id면 null.</summary>
        public CharacterInfo FindCharacter(string characterId)
        {
            if (Roster == null || characterId == null) return null;
            foreach (var character in Roster)
            {
                if (character.Id == characterId) return character;
            }
            return null;
        }

        /// <summary>"이름 (기물)" 형태. 데이터가 없으면 id를 그대로 보여 준다.</summary>
        public string DescribeCharacter(string characterId)
        {
            if (characterId == null) return "-";
            var character = FindCharacter(characterId);
            return character == null ? characterId : character.NameKo + " (" + Labels.PieceName(character.Piece) + ")";
        }

        private async void LoadWeaponsAsync()
        {
            if (Weapons != null) return;
            try
            {
                using (var api = new ApiClient(serverUrl))
                {
                    Weapons = await api.GetWeaponsAsync();
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("무기 데이터를 불러오지 못했다: " + ex.Message);
            }
        }

        public WeaponInfo FindWeapon(string weaponId)
        {
            if (Weapons == null || weaponId == null) return null;
            foreach (var weapon in Weapons)
            {
                if (weapon.Id == weaponId) return weapon;
            }
            return null;
        }

        public bool BuyOre(int quantity = 1) { return _connection != null && _connection.SendForgeBuy(quantity); }
        public bool Smelt() { return _connection != null && _connection.SendForgeSmelt(); }
        public bool Craft(string weaponId) { return _connection != null && _connection.SendForgeCraft(weaponId); }
        public bool Equip(string weaponId, string characterId) { return _connection != null && _connection.SendForgeEquip(weaponId, characterId); }

        private async void LoadRosterAsync()
        {
            if (Roster != null || _loadingRoster) return;
            _loadingRoster = true;
            try
            {
                using (var api = new ApiClient(serverUrl))
                {
                    Roster = await api.GetCharactersAsync();
                }
            }
            catch (Exception ex)
            {
                LastMessage = "캐릭터 데이터를 불러오지 못했다: " + ex.Message;
                Debug.LogWarning(LastMessage);
            }
            finally
            {
                _loadingRoster = false;
            }
        }

        private void StopConnection()
        {
            if (_connection == null) return;
            _connection.Stop();
            _connection = null;
        }

        private void Dispatch(NetEvent netEvent)
        {
            switch (netEvent)
            {
                case ConnectedEvent connected:
                    LastMessage = connected.Reconnected ? "다시 연결되었다." : null;
                    if (Connected != null) Connected(connected);
                    break;
                case StateEvent state:
                    if (StateChanged != null) StateChanged(state.Room);
                    break;
                case ErrorEvent error:
                    LastMessage = Labels.Error(error.Code) ?? error.Message;
                    if (ErrorReceived != null) ErrorReceived(error);
                    break;
                case ReconnectingEvent reconnecting:
                    LastMessage = "연결이 끊겨서 다시 접속하는 중... (" + reconnecting.Attempt + ")";
                    if (Reconnecting != null) Reconnecting(reconnecting.Attempt);
                    break;
                case DisconnectedEvent disconnected:
                    // 오류 때문에 끝난 경우에는 앞서 받은 오류 문구를 그대로 둔다.
                    LastMessage = Labels.Error(disconnected.Reason) ?? LastMessage;
                    if (Disconnected != null) Disconnected(disconnected.Reason);
                    break;
            }
        }
    }
}
