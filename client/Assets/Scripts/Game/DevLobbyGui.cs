using Edbot.Net;
using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 개발용 임시 화면. 방 만들기/입장, 준비, 단계와 남은 시간을 IMGUI로 그린다.
    /// 씬이나 프리팹을 따로 만들 필요가 없고, 진짜 UI가 생기면 이 파일과 DevBootstrap을 지우면 된다.
    /// </summary>
    public sealed class DevLobbyGui : MonoBehaviour
    {
        // 한국어가 네모로 보이면 한글이 들어 있는 폰트를 여기에 끌어다 놓는다.
        [SerializeField] private Font font;

        private string _name = "Player";
        private string _code = "";

        private void OnGUI()
        {
            var client = GameClient.Instance;
            if (client == null) return;

            float scale = Mathf.Max(1f, Screen.height / 600f);
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1f));
            if (font != null) GUI.skin.font = font;

            GUILayout.BeginArea(new Rect(16, 16, 380, Screen.height / scale - 32));
            GUILayout.Label("edbot 개발용 로비");

            var connection = client.Connection;
            if (connection == null || connection.State == ConnectionState.Disconnected)
            {
                DrawJoinForm(client);
            }
            else
            {
                DrawRoom(client, connection);
            }

            if (!string.IsNullOrEmpty(client.LastMessage))
            {
                GUILayout.Space(8);
                GUILayout.Label(client.LastMessage);
            }
            GUILayout.EndArea();
        }

        private void DrawJoinForm(GameClient client)
        {
            GUILayout.Label("서버 주소");
            client.ServerUrl = GUILayout.TextField(client.ServerUrl);
            GUILayout.Label("이름");
            _name = GUILayout.TextField(_name, 16);

            GUI.enabled = !client.IsCreatingRoom;
            if (GUILayout.Button(client.IsCreatingRoom ? "방을 만드는 중..." : "방 만들기"))
            {
                client.CreateRoomAndJoin(_name);
            }
            GUI.enabled = true;

            GUILayout.Space(8);
            GUILayout.Label("방 코드");
            _code = GUILayout.TextField(_code, 4).ToUpperInvariant();
            GUI.enabled = _code.Length == 4;
            if (GUILayout.Button("입장"))
            {
                client.Join(_code, _name);
            }
            GUI.enabled = true;
        }

        private void DrawRoom(GameClient client, RoomConnection connection)
        {
            var room = connection.Room;
            if (room == null)
            {
                GUILayout.Label(connection.State == ConnectionState.Reconnecting ? "다시 연결하는 중..." : "접속하는 중...");
                if (GUILayout.Button("취소")) client.Leave();
                return;
            }

            GUILayout.Label("방 코드: " + room.Code);
            GUILayout.Label("단계: " + Labels.PhaseName(room.Phase) + "   남은 시간: " + Labels.Countdown(connection.RemainingMs()));
            if (connection.State == ConnectionState.Reconnecting) GUILayout.Label("(다시 연결하는 중...)");

            GUILayout.Space(8);
            foreach (var player in room.Players)
            {
                string me = player.Id == connection.PlayerId ? " (나)" : "";
                string status = player.Connected ? (player.Ready ? "준비 완료" : "") : "연결 끊김";
                GUILayout.Label(player.Name + me + "   " + status);
            }

            if (room.Phase == Phase.Lobby)
            {
                if (room.Players.Count < 2) GUILayout.Label("상대를 기다리는 중... 방 코드를 알려 주자.");

                var self = room.FindPlayer(connection.PlayerId);
                bool ready = self != null && self.Ready;
                if (GUILayout.Button(ready ? "준비 취소" : "준비")) client.SetReady(!ready);
            }

            GUILayout.Space(8);
            if (GUILayout.Button("나가기")) client.Leave();
        }
    }
}
