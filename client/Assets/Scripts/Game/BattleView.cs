using System.Collections.Generic;
using Edbot.Net;
using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 전투 화면(개발용). 레인 3개를 가로 막대로 그리고, 타워와 유닛을 네모로 보여 준다.
    /// 내 본진이 항상 왼쪽에 오도록 seat 1이면 좌우를 뒤집는다.
    /// </summary>
    internal static class BattleView
    {
        private static readonly Color Mine = new Color(0.25f, 0.6f, 1f);
        private static readonly Color Theirs = new Color(1f, 0.4f, 0.35f);
        private static readonly Lane[] Lanes = { Lane.Queenside, Lane.Center, Lane.Kingside };

        public static void Draw(GameClient client, RoomConnection connection, RoomSnapshot room, Rect area)
        {
            var battle = room.Battle;
            int seat = room.SeatOf(connection.PlayerId);
            GUILayout.BeginArea(area);

            double seconds = connection.RemainingMs().HasValue ? connection.RemainingMs().Value / 1000.0 : 0;
            string mode = battle.IsDeathmatch ? "데스매치" : "전투";
            string score = seat >= 0
                ? "내 점수 " + battle.Score[seat] + " : " + battle.Score[1 - seat] + " 상대"
                : battle.Score[0] + " : " + battle.Score[1];
            GUILayout.Label(mode + "   " + score + "   남은 시간 " + Labels.Countdown(connection.RemainingMs()) +
                            (battle.Steam.HasValue ? "   스팀포스 " + battle.Steam.Value.ToString("0.0") + "/10" : ""));

            float laneHeight = 90f;
            float width = area.width - 8f;
            foreach (var lane in Lanes)
            {
                Rect row = GUILayoutUtility.GetRect(width, laneHeight);
                DrawLane(client, battle, seat, lane, row);
            }

            if (seat >= 0) DrawControls(client, battle, seat);
            GUILayout.EndArea();
        }

        private static float X(Rect row, double pos, int seat)
        {
            double p = seat == 1 ? 100 - pos : pos;
            return row.x + 8f + (float)(p / 100.0) * (row.width - 16f);
        }

        private static void Box(Rect rect, Color color)
        {
            var old = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = old;
        }

        private static void DrawLane(GameClient client, BattleSnapshot battle, int seat, Lane lane, Rect row)
        {
            Box(row, new Color(0.15f, 0.15f, 0.18f));
            GUI.Label(new Rect(row.x + 4, row.y + 2, 120, 20), Labels.LaneName(lane));
            float mid = row.y + row.height * 0.55f;
            Box(new Rect(row.x + 8, mid, row.width - 16, 2), new Color(0.35f, 0.35f, 0.4f));

            foreach (var well in battle.Wells)
            {
                if (well.Lane != lane) continue;
                Box(new Rect(X(row, well.Pos, seat) - 14, mid - 14, 28, 28), new Color(0.3f, 0.9f, 0.5f, 0.35f));
            }
            foreach (var wall in battle.Walls)
            {
                if (wall.Lane != lane) continue;
                Box(new Rect(X(row, wall.Pos, seat) - 3, mid - 26, 6, 52), new Color(0.8f, 0.8f, 0.8f));
            }
            foreach (var tower in battle.Towers)
            {
                if (tower.Lane != lane) continue;
                float size = tower.IsMain ? 26 : 18;
                var color = tower.Seat == seat || seat < 0 && tower.Seat == 0 ? Mine : Theirs;
                if (!tower.Alive) color = new Color(0.3f, 0.3f, 0.3f);
                var rect = new Rect(X(row, tower.Pos, seat) - size / 2, mid - size / 2 - 22, size, size);
                Box(rect, color);
                if (tower.Alive) Box(new Rect(rect.x, rect.y - 5, size * tower.Hp / Mathf.Max(1, tower.MaxHp), 3), Color.green);
            }
            foreach (var unit in battle.Units)
            {
                if (unit.Lane != lane || !unit.Alive) continue;
                float size = unit.Summon ? 9 : 14;
                bool mine = unit.Seat == seat || seat < 0 && unit.Seat == 0;
                var rect = new Rect(X(row, unit.Pos, seat) - size / 2, mid - size / 2 + 12 + (unit.Seat == seat ? 0 : 10), size, size);
                Box(rect, mine ? Mine : Theirs);
                Box(new Rect(rect.x - 2, rect.y + size + 1, (size + 4) * unit.Hp / Mathf.Max(1, unit.MaxHp), 2), Color.green);
                if (!unit.Summon)
                {
                    var info = client.FindCharacter(unit.CharacterId);
                    GUI.Label(new Rect(rect.x - 20, rect.y + size + 2, 60, 18), info != null ? info.NameEn.Split(' ')[0] : unit.CharacterId);
                }
            }
        }

        private static void DrawControls(GameClient client, BattleSnapshot battle, int seat)
        {
            GUILayout.Space(6);
            GUILayout.Label("내 캐릭터 (궁극기: 스팀포스 5, 40초마다)");
            foreach (var unit in battle.Units)
            {
                if (unit.Seat != seat || unit.Summon) continue;
                var info = client.FindCharacter(unit.CharacterId);
                string name = client.DescribeCharacter(unit.CharacterId);
                string state = unit.Alive
                    ? "HP " + unit.Hp + "/" + unit.MaxHp + "  " + Labels.LaneName(unit.Lane)
                    : "쓰러짐 (" + Mathf.CeilToInt((unit.RespawnInTicks ?? 0) / (float)battle.TicksPerSecond) + "초 뒤 부활)";
                GUILayout.BeginHorizontal();
                GUILayout.Label(name + "  " + state, GUILayout.Width(300));

                bool ready = battle.CanUseUltimate(unit);
                string cooldown = unit.UltReadyTick.HasValue && unit.UltReadyTick.Value > battle.Tick
                    ? " (" + Mathf.CeilToInt((float)battle.SecondsUntilTick(unit.UltReadyTick.Value)) + ")" : "";
                GUI.enabled = ready;
                if (unit.CharacterId == "ankio")
                {
                    // 안키오는 적 가드 타워 뒤로 순간이동할 레인을 고른다.
                    foreach (var lane in Lanes)
                    {
                        if (GUILayout.Button("궁극기→" + Labels.LaneName(lane) + cooldown)) client.UseUltimate(unit.CharacterId, lane);
                    }
                }
                else if (GUILayout.Button("궁극기" + cooldown))
                {
                    client.UseUltimate(unit.CharacterId);
                }
                GUI.enabled = true;

                if (info != null && info.Piece == Piece.Knight && unit.Alive)
                {
                    bool moveReady = !unit.LaneMoveReadyTick.HasValue || unit.LaneMoveReadyTick.Value <= battle.Tick;
                    GUI.enabled = moveReady;
                    foreach (var lane in Lanes)
                    {
                        if (lane == unit.Lane) continue;
                        if (GUILayout.Button("이동→" + Labels.LaneName(lane))) client.MoveLane(unit.CharacterId, lane);
                    }
                    GUI.enabled = true;
                }
                GUILayout.EndHorizontal();
            }

            GUILayout.Space(4);
            int from = Mathf.Max(0, battle.Events.Count - 5);
            for (int i = from; i < battle.Events.Count; i++)
            {
                var e = battle.Events[i];
                GUILayout.Label("· " + DescribeEvent(client, e));
            }
        }

        private static string DescribeEvent(GameClient client, BattleEvent e)
        {
            string who = e.UnitId == null ? "" : client.DescribeCharacter(Strip(e.UnitId));
            string target = e.TargetId == null ? "" : client.DescribeCharacter(Strip(e.TargetId));
            switch (e.Type)
            {
                case "kill": return who + " 이(가) " + target + " 처치";
                case "towerDestroyed": return "타워 파괴: " + (e.TargetId ?? "");
                case "ultimate": return who + " 궁극기";
                case "respawn": return who + " 부활";
                case "promote": return who + " 승급";
                case "end": return "전투 종료 " + (e.Text ?? "");
                default: return e.Type + " " + who;
            }
        }

        /// <summary>"0:dwargon" 같은 유닛 id에서 캐릭터 id만 꺼낸다.</summary>
        private static string Strip(string unitId)
        {
            int colon = unitId.IndexOf(':');
            return colon >= 0 ? unitId.Substring(colon + 1) : unitId;
        }
    }
}
