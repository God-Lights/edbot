using Edbot.Net;
using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 탐사 화면(개발용). 4x4 지도에서 칸을 고르고 채집·매복·정찰을 한다.
    /// 탐사·대장간·전투·데스매치 동안 계속 열어 둘 수 있고, 열어 둔 동안에도 전투는 멈추지 않는다.
    /// </summary>
    internal static class ExploreView
    {
        private static readonly string[] Actions = { "gather", "ambush", "scout" };
        private static readonly string[] ActionNames = { "채집", "매복", "정찰" };
        private static int _action;
        private static int _selected = -1;

        public static void Draw(GameClient client, ExploreSnapshot explore, Rect area)
        {
            GUILayout.BeginArea(area);
            GUILayout.Label("탐사   행동 게이지 " + explore.Gauge + "/" + explore.GaugeMax +
                            (explore.GaugeNextInTicks.HasValue ? " (+1까지 " + Mathf.CeilToInt((float)explore.Seconds(explore.GaugeNextInTicks.Value)) + "초)" : ""));
            var r = explore.Resources;
            if (r != null)
            {
                GUILayout.Label("탈런트 " + r.Talent + "  나뭇가지 " + r.Branch + "  돌 " + r.Stone + "  광석 " + r.Ore +
                                "  희귀 " + r.Rare + "  설계도 " + r.Blueprints);
            }

            GUILayout.BeginHorizontal();
            for (int i = 0; i < Actions.Length; i++)
            {
                if (GUILayout.Button((_action == i ? "● " : "") + ActionNames[i])) _action = i;
            }
            GUILayout.EndHorizontal();

            // 4x4 칸
            for (int row = 0; row < 4; row++)
            {
                GUILayout.BeginHorizontal();
                for (int col = 0; col < 4; col++)
                {
                    int index = row * 4 + col;
                    if (index >= explore.Tiles.Count) continue;
                    if (GUILayout.Button(TileLabel(explore, explore.Tiles[index], index == _selected), GUILayout.Width(74), GUILayout.Height(54)))
                    {
                        _selected = index;
                        client.Explore(Actions[_action], index);
                    }
                }
                GUILayout.EndHorizontal();
            }

            GUILayout.Space(4);
            int from = Mathf.Max(0, explore.Events.Count - 6);
            for (int i = explore.Events.Count - 1; i >= from; i--)
            {
                GUILayout.Label("· " + Labels.ExploreEventText(explore.Events[i]));
            }
            GUILayout.EndArea();
        }

        private static string TileLabel(ExploreSnapshot explore, ExploreTileSnapshot tile, bool selected)
        {
            string name = tile.Known ? Labels.TileName(tile.Kind) : "안개";
            if (tile.Known && tile.Depleted && tile.Kind != "empty")
            {
                name += "\n(비었음" + (tile.RespawnInTicks.HasValue ? " " + Mathf.CeilToInt((float)explore.Seconds(tile.RespawnInTicks.Value)) + "초" : "") + ")";
            }
            if (tile.MyGatherInTicks.HasValue) name += "\n채집 " + Mathf.CeilToInt((float)explore.Seconds(tile.MyGatherInTicks.Value));
            if (tile.MyAmbushInTicks.HasValue) name += "\n매복 " + Mathf.CeilToInt((float)explore.Seconds(tile.MyAmbushInTicks.Value));
            if (tile.EnemyAmbush) name += "\n⚠ 상대 매복";
            return (selected ? "▶ " : "") + name;
        }
    }
}
