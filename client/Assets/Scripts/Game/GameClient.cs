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

        [SerializeField] private string serverUrl = "http://127.0.0.1:8787";

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

        /// <summary>캐릭터 12명의 데이터. 방에 들어갈 때 서버에서 가져온다. 아직이면 null.</summary>
        public IReadOnlyList<CharacterInfo> Roster { get; private set; }

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
            if (Instance == this) Instance = null;
            StopConnection();
        }

        /// <summary>새 방을 만들고 바로 들어간다.</summary>
        public async void CreateRoomAndJoin(string playerName)
        {
            if (IsCreatingRoom) return;
            IsCreatingRoom = true;
            LastMessage = null;
            try
            {
                using (var api = new ApiClient(serverUrl))
                {
                    string code = await api.CreateRoomAsync();
                    // await 뒤에는 Unity 메인 스레드로 돌아와 있다.
                    Join(code, playerName);
                }
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

            var connection = new RoomConnection();
            _connection = connection;
            try
            {
                connection.Start(ApiClient.ToWebSocketBase(serverUrl), roomCode, playerName);
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
