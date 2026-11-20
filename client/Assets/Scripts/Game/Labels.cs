using Edbot.Net;

namespace Edbot.Game
{
    /// <summary>화면에 보여 줄 한국어 문구.</summary>
    public static class Labels
    {
        public static string PhaseName(Phase phase)
        {
            switch (phase)
            {
                case Phase.Lobby: return "로비";
                case Phase.Ban: return "밴";
                case Phase.Draft: return "드래프트";
                case Phase.Placement: return "배치";
                case Phase.Explore: return "탐사";
                case Phase.Forge: return "대장간";
                case Phase.Battle: return "전투";
                case Phase.Deathmatch: return "데스매치";
                case Phase.Result: return "결과";
                default: return phase.ToString();
            }
        }

        public static string PieceName(Piece piece)
        {
            switch (piece)
            {
                case Piece.King: return "킹";
                case Piece.Queen: return "퀸";
                case Piece.Rook: return "룩";
                case Piece.Bishop: return "비숍";
                case Piece.Knight: return "나이트";
                case Piece.Pawn: return "폰";
                default: return piece.ToString();
            }
        }

        public static string LaneName(Lane lane)
        {
            switch (lane)
            {
                case Lane.Queenside: return "퀸사이드";
                case Lane.Center: return "센터";
                case Lane.Kingside: return "킹사이드";
                default: return lane.ToString();
            }
        }

        /// <summary>서버 오류 코드나 연결이 끝난 이유를 사람이 읽을 문장으로 바꾼다.</summary>
        public static string Error(string codeOrReason)
        {
            switch (codeOrReason)
            {
                case ErrorCodes.RoomFull: return "방이 가득 찼다.";
                case ErrorCodes.GameInProgress: return "이미 게임이 진행 중인 방이다.";
                case ErrorCodes.RoomNotFound: return "방을 찾을 수 없다. 코드를 확인해 보자.";
                case ErrorCodes.NotInLobby: return "로비에서만 할 수 있다.";
                case ErrorCodes.BadMessage: return "서버가 이해하지 못한 요청이다.";
                case ErrorCodes.WrongPhase: return "지금 단계에서는 할 수 없다.";
                case ErrorCodes.UnknownCharacter: return "없는 캐릭터다.";
                case ErrorCodes.CharacterUnavailable: return "이미 밴되었거나 뽑힌 캐릭터다.";
                case ErrorCodes.NotYourTurn: return "네 차례가 아니다.";
                case ErrorCodes.AlreadyDone: return "이미 정했다. 바꿀 수 없다.";
                case ErrorCodes.NotYourCharacter: return "내 팀의 캐릭터가 아니다.";
                case ErrorCodes.InvalidLane: return "올바르지 않은 레인이다.";
                case ErrorCodes.UnitDead: return "쓰러진 캐릭터다.";
                case ErrorCodes.UnitDisabled: return "움직일 수 없는 상태다.";
                case ErrorCodes.NotImplemented: return "아직 쓸 수 없는 궁극기다.";
                case ErrorCodes.OnCooldown: return "아직 쓸 수 없다. (재사용 대기)";
                case ErrorCodes.NotEnoughSteam: return "스팀포스가 부족하다.";
                case ErrorCodes.NoTarget: return "대상이 없다.";
                case ErrorCodes.NotAKnight: return "나이트만 레인을 옮길 수 있다.";
                case ErrorCodes.InvalidTile: return "없는 칸이다.";
                case ErrorCodes.NoActionGauge: return "행동 게이지가 부족하다.";
                case ErrorCodes.TileBusy: return "이미 그 칸에서 행동 중이다.";
                case ErrorCodes.NothingToGather: return "채집할 게 없는 칸이다.";
                case ErrorCodes.AlreadyKnown: return "이미 알고 있는 칸이다.";
                case ErrorCodes.NotEnoughTalent: return "탈런트가 부족하다.";
                case ErrorCodes.NotEnoughMaterials: return "재료가 부족하다.";
                case ErrorCodes.NoFreeSmelter: return "빈 재련대가 없다.";
                case ErrorCodes.UnknownWeapon: return "없는 무기다.";
                case ErrorCodes.NoWeapon: return "그 무기를 가지고 있지 않다.";
                case ErrorCodes.NotInZone: return "본진이나 아군 가드 타워 근처에서만 장착할 수 있다.";
                case ErrorCodes.AlreadyEquipping: return "이미 무기를 끼우는 중이다.";
                case ErrorCodes.AlreadyEquipped: return "이미 끼고 있는 무기다.";
                case ErrorCodes.InvalidQuantity: return "살 수 있는 개수가 아니다.";
                case ErrorCodes.Unauthorized: return "로그인이 필요하다.";
                case "stopped": return null; // 내가 직접 나간 경우
                default: return string.IsNullOrEmpty(codeOrReason) ? null : "연결이 끝났다: " + codeOrReason;
            }
        }

        public static string ResultReason(string reason)
        {
            switch (reason)
            {
                case "towers": return "본진 타워 파괴";
                case "time": return "시간 종료 (점수)";
                case "deathmatch": return "데스매치 전멸";
                case "deathmatchTime": return "데스매치 시간 종료 (남은 체력)";
                default: return reason ?? "";
            }
        }

        public static string TileName(string kind)
        {
            switch (kind)
            {
                case "tree": return "나무";
                case "rock": return "바위";
                case "ore": return "광맥";
                case "chest": return "보물상자";
                case "empty": return "빈 땅";
                default: return "?";
            }
        }

        public static string ExploreEventText(ExploreEvent e)
        {
            string tile = "(" + (e.Tile % 4 + 1) + "," + (e.Tile / 4 + 1) + ")";
            switch (e.Type)
            {
                case "gathered": return tile + " 채집 완료 " + Gain(e.Gain);
                case "split": return tile + " 같은 칸을 채집해서 나눠 가졌다 " + Gain(e.Gain);
                case "stolen": return tile + " 상대의 매복에 빼앗겼다!";
                case "ambushHit": return tile + " 매복 성공! " + Gain(e.Gain);
                case "ambushClash": return tile + " 서로 매복해서 둘 다 사라졌다";
                case "ambushExpired": return tile + " 매복이 아무도 못 잡고 끝났다";
                case "scouted": return tile + " 정찰: " + TileName((e.Detail ?? "").Split(',')[0]) + ((e.Detail ?? "").Contains("ambush") ? " — 상대 매복 있음!" : "");
                case "trap": return tile + " 함정! " + Gain(e.Gain);
                case "empty": return tile + " 빈 땅이었다";
                default: return e.Type;
            }
        }

        private static string Gain(ExploreResources r)
        {
            if (r == null) return "";
            var parts = new System.Collections.Generic.List<string>();
            if (r.Talent != 0) parts.Add("탈런트 " + (r.Talent > 0 ? "+" : "") + r.Talent);
            if (r.Branch != 0) parts.Add("나뭇가지 +" + r.Branch);
            if (r.Stone != 0) parts.Add("돌 +" + r.Stone);
            if (r.Ore != 0) parts.Add("광석 +" + r.Ore);
            if (r.Rare != 0) parts.Add("희귀 재료 +" + r.Rare);
            if (r.Blueprints != 0) parts.Add("설계도 +" + r.Blueprints);
            return parts.Count == 0 ? "" : "(" + string.Join(", ", parts) + ")";
        }

        public static string MaterialName(string key)
        {
            switch (key)
            {
                case "branch": return "나뭇가지";
                case "stone": return "돌";
                case "ironIngot": return "철괴";
                case "rare": return "희귀 재료";
                case "blueprints": return "설계도";
                default: return key;
            }
        }

        public static string KindName(string kind)
        {
            switch (kind)
            {
                case "heavy": return "중량";
                case "polearm": return "장병";
                case "ranged": return "원거리";
                default: return kind;
            }
        }

        public static string Countdown(long? remainingMs)
        {
            if (!remainingMs.HasValue) return "-";
            long seconds = (remainingMs.Value + 999) / 1000; // 올림해서 0초가 되기 전까지 1초로 보인다
            return seconds + "초";
        }
    }
}
