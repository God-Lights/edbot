using System.Collections.Generic;
using System.Text;
using Edbot.Net;
using UnityEngine;

namespace Edbot.Game
{
    /// <summary>
    /// 대장간 화면(개발용). 광석 구입, 재련, 무기 조합, 장착. 탐사·대장간·전투·데스매치 동안 쓸 수 있다.
    /// 장착은 본진이나 아군 가드 타워 근처에서만 되고 3초가 걸린다.
    /// </summary>
    internal static class ForgeView
    {
        private static string _selectedWeapon;

        public static void Draw(GameClient client, RoomSnapshot room, int seat)
        {
            var forge = room.Forge;
            var explore = room.Explore;
            if (forge == null || explore == null || seat < 0 || room.Game == null) return;

            GUILayout.Space(8);
            GUILayout.Label("대장간   스팀포스 " + forge.Steam.ToString("0.0") + "/" + forge.SteamMax.ToString("0"));

            GUILayout.BeginHorizontal();
            if (GUILayout.Button("광석 사기 (탈런트 " + forge.OrePrice + ")")) client.BuyOre(1);
            if (GUILayout.Button("재련 (광석1·탈런트2·스팀3)")) client.Smelt();
            GUILayout.EndHorizontal();

            var smelting = new StringBuilder("재련대: ");
            for (int i = 0; i < forge.Smelters.Count; i++)
            {
                var job = forge.Smelters[i];
                smelting.Append(job == null ? "비었음" : Mathf.CeilToInt((float)forge.Seconds(job.RemainingTicks)) + "초").Append("  ");
            }
            GUILayout.Label(smelting.ToString().TrimEnd());

            GUILayout.Label("조합 (누르면 바로 만든다)");
            if (client.Weapons == null)
            {
                GUILayout.Label("무기 데이터를 불러오는 중...");
            }
            else
            {
                foreach (var weapon in client.Weapons)
                {
                    GUI.enabled = weapon.CanCraft(explore.Resources);
                    if (GUILayout.Button(WeaponLabel(weapon))) client.Craft(weapon.Id);
                }
                GUI.enabled = true;
            }

            GUILayout.Label("인벤토리 (무기를 고르고, 아래에서 캐릭터를 누르면 장착)");
            bool any = false;
            foreach (var pair in forge.Inventory)
            {
                if (pair.Value <= 0) continue;
                any = true;
                var info = client.FindWeapon(pair.Key);
                string name = info == null ? pair.Key : info.NameKo + " (" + Labels.KindName(info.Kind) + ")";
                if (GUILayout.Button((_selectedWeapon == pair.Key ? "● " : "") + name + " x" + pair.Value)) _selectedWeapon = pair.Key;
            }
            if (!any) GUILayout.Label("  (비었음)");

            GUILayout.Label("장착");
            foreach (var id in room.Game.Picks[seat])
            {
                string equipped = forge.Equipped.ContainsKey(id) ? forge.Equipped[id] : null;
                EquippingSnapshot pending;
                string state = equipped == null ? "-" : NameOf(client, equipped);
                if (forge.Equipping.TryGetValue(id, out pending))
                {
                    state += "  → " + NameOf(client, pending.WeaponId) + " 끼우는 중 " + Mathf.CeilToInt((float)forge.Seconds(pending.RemainingTicks)) + "초";
                }
                GUILayout.BeginHorizontal();
                GUILayout.Label(client.DescribeCharacter(id) + ": " + state, GUILayout.Width(300));
                GUI.enabled = _selectedWeapon != null && forge.Inventory.ContainsKey(_selectedWeapon) && forge.Inventory[_selectedWeapon] > 0;
                if (GUILayout.Button("끼우기")) client.Equip(_selectedWeapon, id);
                GUI.enabled = true;
                GUILayout.EndHorizontal();
            }
        }

        private static string NameOf(GameClient client, string weaponId)
        {
            var info = client.FindWeapon(weaponId);
            return info == null ? weaponId : info.NameKo;
        }

        private static string WeaponLabel(WeaponInfo weapon)
        {
            var cost = new List<string>();
            foreach (var pair in weapon.Recipe) cost.Add(Labels.MaterialName(pair.Key) + " " + pair.Value);
            string label = weapon.NameKo + " (" + Labels.KindName(weapon.Kind) + ", 공격 +" + Mathf.RoundToInt((float)(weapon.AtkBonus * 100)) + "%)  " + string.Join(", ", cost);
            if (!string.IsNullOrEmpty(weapon.EffectText)) label += "  ★" + weapon.EffectText;
            return label;
        }
    }
}
