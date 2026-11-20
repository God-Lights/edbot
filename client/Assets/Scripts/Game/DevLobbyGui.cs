using System.Collections.Generic;
using System.Text;
using Edbot.Net;
using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 개발용 임시 화면. 방 만들기/입장, 준비, 밴, 드래프트, 배치를 IMGUI로 그린다.
    /// 씬이나 프리팹을 따로 만들 필요가 없고, 진짜 UI가 생기면 이 파일과 DevBootstrap을 지우면 된다.
    /// </summary>
    public sealed class DevLobbyGui : MonoBehaviour
    {
        // 한국어가 네모로 보이면 한글이 들어 있는 폰트를 여기에 끌어다 놓는다.
        [SerializeField] private Font font;

        private string _name = "Player";
        private string _code = "";
        private Vector2 _scroll;

        private void OnGUI()
        {
            var client = GameClient.Instance;
            if (client == null) return;

            float scale = Mathf.Max(1f, Screen.height / 600f);
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1f));
            if (font != null) GUI.skin.font = font;

            GUILayout.BeginArea(new Rect(16, 16, 420, Screen.height / scale - 32));
            _scroll = GUILayout.BeginScrollView(_scroll);
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
            GUILayout.EndScrollView();
            GUILayout.EndArea();

            // 전투 화면과 탐사 화면은 넓어서 로비 패널 오른쪽에 따로 그린다.
            var connection2 = client.Connection;
            var room = connection2 == null ? null : connection2.Room;
            if (room == null) return;
            float width = Screen.width / scale;
            float height = Screen.height / scale;
            bool exploring = room.Explore != null &&
                             (room.Phase == Phase.Explore || room.Phase == Phase.Forge || room.Phase == Phase.Battle || room.Phase == Phase.Deathmatch);
            float exploreWidth = 330f;
            if (exploring) ExploreView.Draw(client, room.Explore, new Rect(width - exploreWidth - 8, 16, exploreWidth, height - 32));
            if (room.Battle != null && (room.Phase == Phase.Battle || room.Phase == Phase.Deathmatch))
            {
                float right = exploring ? width - exploreWidth - 24 : width - 16;
                BattleView.Draw(client, connection2, room, new Rect(452, 16, Mathf.Max(300f, right - 452), height - 32));
            }
        }

        private void DrawJoinForm(GameClient client)
        {
            GUILayout.Label("서버 주소");
            client.ServerUrl = GUILayout.TextField(client.ServerUrl);

            // 자동으로 로그인 화면으로 보내지 않고, 버튼을 눌렀을 때만 브라우저를 연다.
            if (client.User != null)
            {
                GUILayout.Label("로그인: " + client.User.Nickname);
                if (GUILayout.Button("로그아웃")) client.Logout();
            }
            else if (client.IsLoggingIn)
            {
                GUILayout.Label("브라우저에서 로그인하는 중...");
                if (GUILayout.Button("취소")) client.CancelLogin();
            }
            else if (GUILayout.Button("로그인하기"))
            {
                client.BeginLogin();
            }

            if (client.User == null)
            {
                GUILayout.Label("이름 (로그인하지 않은 개발 서버용)");
                _name = GUILayout.TextField(_name, 16);
            }

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
            GUILayout.Space(8);

            int seat = room.SeatOf(connection.PlayerId);
            var game = room.Game;
            switch (room.Phase)
            {
                case Phase.Lobby:
                    DrawLobby(client, room, connection);
                    break;
                case Phase.Ban:
                    if (game != null && seat >= 0) DrawBan(client, game, seat);
                    break;
                case Phase.Draft:
                    if (game != null && seat >= 0) DrawDraft(client, connection, game, seat);
                    break;
                case Phase.Placement:
                    if (game != null && seat >= 0) DrawPlacement(client, game, seat);
                    break;
                case Phase.Battle:
                case Phase.Deathmatch:
                    GUILayout.Label("전투 화면은 오른쪽에 있다.");
                    break;
                case Phase.Result:
                    DrawResult(room, seat);
                    break;
                default:
                    if (game != null && seat >= 0) DrawTeams(client, game, seat);
                    break;
            }

            bool forgeOpen = room.Forge != null &&
                             (room.Phase == Phase.Explore || room.Phase == Phase.Forge || room.Phase == Phase.Battle || room.Phase == Phase.Deathmatch);
            if (forgeOpen) ForgeView.Draw(client, room, seat);

            GUILayout.Space(8);
            if (GUILayout.Button("나가기")) client.Leave();
        }

        private void DrawLobby(GameClient client, RoomSnapshot room, RoomConnection connection)
        {
            if (room.Players.Count < 2) GUILayout.Label("상대를 기다리는 중... 방 코드를 알려 주자.");

            var self = room.FindPlayer(connection.PlayerId);
            bool ready = self != null && self.Ready;
            if (GUILayout.Button(ready ? "준비 취소" : "준비")) client.SetReady(!ready);
        }

        // ---- 밴 ----

        private void DrawBan(GameClient client, GameSnapshot game, int seat)
        {
            var mine = game.Bans[seat];
            var theirs = game.Bans[1 - seat];

            GUILayout.Label(mine.Locked
                ? "내 밴: " + client.DescribeCharacter(mine.CharacterId)
                : "밴할 캐릭터를 고르자. 한 번 정하면 바꿀 수 없다.");
            GUILayout.Label(theirs.Locked ? "상대가 밴을 정했다." : "상대가 고르는 중...");

            if (mine.Locked || client.Roster == null) return;
            foreach (var character in client.Roster)
            {
                if (GUILayout.Button(client.DescribeCharacter(character.Id))) client.Ban(character.Id);
            }
        }

        // ---- 드래프트 ----

        private void DrawDraft(GameClient client, RoomConnection connection, GameSnapshot game, int seat)
        {
            bool myTurn = game.TurnSeat.HasValue && game.TurnSeat.Value == seat;
            string remaining = Labels.Countdown(connection.RemainingMsUntil(game.TurnEndsAt));
            GUILayout.Label(myTurn ? "내 차례! 캐릭터를 뽑자.  (" + remaining + ")" : "상대 차례...  (" + remaining + ")");
            GUILayout.Label("순서: " + DescribePickOrder(game, seat));
            GUILayout.Label(game.FirstPicker == seat ? "내가 선공이다." : "내가 후공이다.");

            DrawTeam(client, "내 팀", game.Picks[seat]);
            DrawTeam(client, "상대 팀", game.Picks[1 - seat]);

            if (client.Roster == null) return;
            GUILayout.Space(8);
            GUILayout.Label("뽑을 수 있는 캐릭터");
            foreach (var character in client.Roster)
            {
                if (game.IsUnavailable(character.Id)) continue;
                GUI.enabled = myTurn;
                if (GUILayout.Button(client.DescribeCharacter(character.Id))) client.Pick(character.Id);
                GUI.enabled = true;
            }

            var gone = new List<string>();
            foreach (var character in client.Roster)
            {
                if (game.IsUnavailable(character.Id)) gone.Add(client.DescribeCharacter(character.Id));
            }
            if (gone.Count > 0) GUILayout.Label("밴/뽑힘: " + string.Join(", ", gone));
        }

        /// <summary>"[나] 상대 상대 나 나 ..." 형태. 이미 지난 차례는 괄호, 지금 차례는 [ ]로 표시한다.</summary>
        private static string DescribePickOrder(GameSnapshot game, int seat)
        {
            var text = new StringBuilder();
            int done = game.PickCount;
            for (int i = 0; i < game.PickOrder.Count; i++)
            {
                string who = game.PickOrder[i] == seat ? "나" : "상대";
                if (i < done) text.Append("(").Append(who).Append(") ");
                else if (i == done) text.Append("[").Append(who).Append("] ");
                else text.Append(who).Append(" ");
            }
            return text.ToString().TrimEnd();
        }

        private void DrawTeam(GameClient client, string title, List<string> picks)
        {
            var names = new List<string>();
            foreach (var id in picks) names.Add(client.DescribeCharacter(id));
            GUILayout.Label(title + " (" + picks.Count + "/5): " + (names.Count == 0 ? "-" : string.Join(", ", names)));
        }

        // ---- 배치 ----

        private void DrawPlacement(GameClient client, GameSnapshot game, int seat)
        {
            bool locked = game.PlacementLocked[seat];
            GUILayout.Label(locked ? "배치를 확정했다." : "캐릭터마다 레인을 고르고 확정하자. 정하지 않으면 기본 레인으로 간다.");
            GUILayout.Label(game.PlacementLocked[1 - seat] ? "상대가 배치를 확정했다." : "상대가 배치하는 중...");

            GUI.enabled = !locked;
            foreach (var id in game.Picks[seat])
            {
                GUILayout.Label(client.DescribeCharacter(id));
                GUILayout.BeginHorizontal();
                var current = game.LaneOf(seat, id);
                foreach (Lane lane in new[] { Lane.Queenside, Lane.Center, Lane.Kingside })
                {
                    string label = (current.HasValue && current.Value == lane ? "● " : "") + Labels.LaneName(lane);
                    if (GUILayout.Button(label)) client.Place(id, lane);
                }
                GUILayout.EndHorizontal();
            }
            if (GUILayout.Button("배치 확정")) client.LockPlacement();
            GUI.enabled = true;
        }

        // ---- 결과 ----

        private static void DrawResult(RoomSnapshot room, int seat)
        {
            var result = room.Result;
            if (result == null) return;
            string outcome = !result.Winner.HasValue ? "무승부" : (result.Winner.Value == seat ? "승리!" : "패배");
            GUILayout.Label(outcome + "   (" + Labels.ResultReason(result.Reason) + ")");
            GUILayout.Label("점수 " + result.Score[0] + " : " + result.Score[1] + "   처치 " + result.Kills[0] + " : " + result.Kills[1]
                            + "   (왼쪽이 seat 0)");
            GUILayout.Label("잠시 뒤 로비로 돌아간다.");
        }

        // ---- 탐사 이후: 두 팀과 레인을 보여 준다 ----

        private void DrawTeams(GameClient client, GameSnapshot game, int seat)
        {
            DrawTeamWithLanes(client, "내 팀", game, seat);
            DrawTeamWithLanes(client, "상대 팀", game, 1 - seat);
        }

        private void DrawTeamWithLanes(GameClient client, string title, GameSnapshot game, int seat)
        {
            GUILayout.Label(title);
            foreach (var id in game.Picks[seat])
            {
                var lane = game.LaneOf(seat, id);
                string where = lane.HasValue ? Labels.LaneName(lane.Value) : "비공개";
                GUILayout.Label("  " + client.DescribeCharacter(id) + " - " + where);
            }
        }
    }
}
