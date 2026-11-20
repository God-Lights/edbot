using System.Collections.Generic;
using Newtonsoft.Json;

namespace Edbot.Net
{
    /// <summary>랭킹 한 줄. 서버는 사용자 id를 내보내지 않고, 내 줄에만 IsMe가 붙는다.</summary>
    public sealed class LeaderboardEntry
    {
        [JsonProperty("rank")] public int Rank { get; set; }
        [JsonProperty("nickname")] public string Nickname { get; set; }
        [JsonProperty("rating")] public int Rating { get; set; }
        [JsonProperty("games")] public int Games { get; set; }
        [JsonProperty("wins")] public int Wins { get; set; }
        [JsonProperty("losses")] public int Losses { get; set; }
        [JsonProperty("draws")] public int Draws { get; set; }
        [JsonProperty("isMe")] public bool IsMe { get; set; }
    }

    /// <summary>내 전적과 순위.</summary>
    public sealed class PlayerStats
    {
        [JsonProperty("nickname")] public string Nickname { get; set; }
        [JsonProperty("rating")] public int Rating { get; set; }
        [JsonProperty("rank")] public int Rank { get; set; }
        [JsonProperty("games")] public int Games { get; set; }
        [JsonProperty("wins")] public int Wins { get; set; }
        [JsonProperty("losses")] public int Losses { get; set; }
        [JsonProperty("draws")] public int Draws { get; set; }
    }

    /// <summary>내 최근 판 하나. 점수와 처치는 [내 쪽, 상대 쪽] 순서다.</summary>
    public sealed class MatchSummary
    {
        [JsonProperty("endedAt")] public long EndedAt { get; set; }
        [JsonProperty("opponent")] public string Opponent { get; set; }
        /// <summary>win | loss | draw</summary>
        [JsonProperty("result")] public string Result { get; set; }
        [JsonProperty("reason")] public string Reason { get; set; }
        [JsonProperty("score")] public List<int> Score { get; set; } = new List<int>();
        [JsonProperty("kills")] public List<int> Kills { get; set; } = new List<int>();
        [JsonProperty("picks")] public List<string> Picks { get; set; } = new List<string>();
        [JsonProperty("opponentPicks")] public List<string> OpponentPicks { get; set; } = new List<string>();
        [JsonProperty("ratingBefore")] public int RatingBefore { get; set; }
        [JsonProperty("ratingAfter")] public int RatingAfter { get; set; }
    }
}
