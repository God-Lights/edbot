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
                case Phase.Result: return "결과";
                default: return phase.ToString();
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
                case "stopped": return null; // 내가 직접 나간 경우
                default: return string.IsNullOrEmpty(codeOrReason) ? null : "연결이 끝났다: " + codeOrReason;
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
