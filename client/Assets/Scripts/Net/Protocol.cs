// 서버(server/src/protocol.ts)와 주고받는 메시지 형식.
// UnityEngine에 의존하지 않는 순수 C#이라 에디터 없이 `dotnet test`로 검증할 수 있다.
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;

namespace Edbot.Net
{
    /// <summary>한 판이 흐르는 단계. 서버의 Phase와 같은 순서다.</summary>
    public enum Phase
    {
        Lobby,
        Ban,
        Draft,
        Placement,
        Explore,
        Forge,
        Battle,
        Result,
    }

    /// <summary>세 레인. 킹사이드는 체스에서 킹이 서 있는 쪽이다.</summary>
    public enum Lane
    {
        Queenside,
        Center,
        Kingside,
    }

    public enum Piece
    {
        King,
        Queen,
        Rook,
        Bishop,
        Knight,
        Pawn,
    }

    public sealed class PublicPlayer
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Name { get; set; }
        /// <summary>0 또는 1. 먼저 들어온 사람이 0.</summary>
        [JsonProperty("seat")] public int Seat { get; set; }
        [JsonProperty("connected")] public bool Connected { get; set; }
        [JsonProperty("ready")] public bool Ready { get; set; }
    }

    /// <summary>캐릭터 한 명의 데이터. 서버의 GET /api/characters 가 돌려준다.</summary>
    public sealed class CharacterInfo
    {
        /// <summary>메시지에서 캐릭터를 가리키는 고정 id. 예: "ancient-lord"</summary>
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("nameKo")] public string NameKo { get; set; }
        [JsonProperty("nameEn")] public string NameEn { get; set; }
        [JsonProperty("piece")] public Piece Piece { get; set; }
        [JsonProperty("hp")] public int Hp { get; set; }
        [JsonProperty("attack")] public int Attack { get; set; }
        [JsonProperty("speed")] public string Speed { get; set; }
        [JsonProperty("range")] public string Range { get; set; }
    }

    /// <summary>한 사람의 밴 상태.</summary>
    public sealed class BanSnapshot
    {
        /// <summary>밴을 정했다. (밴 시간이 끝나면 못 한 사람도 true)</summary>
        [JsonProperty("locked")] public bool Locked { get; set; }

        /// <summary>밴한 캐릭터. 밴 단계 중에는 내 것만 보이고 상대 것은 null, 단계가 끝나면 둘 다 보인다.</summary>
        [JsonProperty("characterId")] public string CharacterId { get; set; }
    }

    /// <summary>밴, 드래프트, 배치의 진행 상황. 모든 배열은 seat 순서([seat 0, seat 1])다.</summary>
    public sealed class GameSnapshot
    {
        /// <summary>드래프트에서 먼저 뽑는 seat (선공).</summary>
        [JsonProperty("firstPicker")] public int FirstPicker { get; set; }
        [JsonProperty("bans")] public List<BanSnapshot> Bans { get; set; } = new List<BanSnapshot>();

        /// <summary>뽑는 순서 전체(스네이크, 10개). 앞에서부터 뽑은 수만큼은 이미 지나간 차례다.</summary>
        [JsonProperty("pickOrder")] public List<int> PickOrder { get; set; } = new List<int>();

        /// <summary>seat별로 뽑은 캐릭터 id (뽑은 순서). 드래프트 결과는 모두에게 공개된다.</summary>
        [JsonProperty("picks")] public List<List<string>> Picks { get; set; } = new List<List<string>>();

        /// <summary>드래프트 중 지금 뽑을 차례인 seat. 드래프트가 아니면 null.</summary>
        [JsonProperty("turnSeat")] public int? TurnSeat { get; set; }

        /// <summary>이번 차례가 끝나는 서버 시각(ms). 시간이 지나면 서버가 대신 뽑는다.</summary>
        [JsonProperty("turnEndsAt")] public long? TurnEndsAt { get; set; }

        /// <summary>seat별 캐릭터 id -> 레인. 상대 것은 전투가 시작되기 전에는 null.</summary>
        [JsonProperty("lanes")] public List<Dictionary<string, Lane>> Lanes { get; set; } = new List<Dictionary<string, Lane>>();

        [JsonProperty("placementLocked")] public List<bool> PlacementLocked { get; set; } = new List<bool>();

        public int PickCount
        {
            get
            {
                int count = 0;
                foreach (var team in Picks) count += team == null ? 0 : team.Count;
                return count;
            }
        }

        /// <summary>밴되었거나 이미 뽑힌 캐릭터인가. (내가 아직 볼 수 없는 상대의 밴은 알 수 없어 포함되지 않는다.)</summary>
        public bool IsUnavailable(string characterId)
        {
            foreach (var ban in Bans)
            {
                if (ban != null && ban.CharacterId == characterId) return true;
            }
            foreach (var team in Picks)
            {
                if (team != null && team.Contains(characterId)) return true;
            }
            return false;
        }

        /// <summary>그 레인에 배치되어 있는가. 아직 정해지지 않았거나 볼 수 없으면 null.</summary>
        public Lane? LaneOf(int seat, string characterId)
        {
            if (seat < 0 || seat >= Lanes.Count) return null;
            var lanes = Lanes[seat];
            if (lanes == null) return null;
            Lane lane;
            return lanes.TryGetValue(characterId, out lane) ? lane : (Lane?)null;
        }
    }

    public sealed class RoomSnapshot
    {
        [JsonProperty("code")] public string Code { get; set; }
        [JsonProperty("phase")] public Phase Phase { get; set; }
        [JsonProperty("phaseStartedAt")] public long PhaseStartedAt { get; set; }

        /// <summary>단계가 끝나는 서버 시각(ms). 로비처럼 타이머가 없으면 null.</summary>
        [JsonProperty("phaseEndsAt")] public long? PhaseEndsAt { get; set; }

        /// <summary>이 스냅샷을 만든 서버 시각(ms). 시계 차이를 보정하는 데 쓴다.</summary>
        [JsonProperty("serverTime")] public long ServerTime { get; set; }

        [JsonProperty("players")] public List<PublicPlayer> Players { get; set; } = new List<PublicPlayer>();

        /// <summary>밴, 드래프트, 배치 상태. 로비에서는 null.</summary>
        [JsonProperty("game")] public GameSnapshot Game { get; set; }

        public PublicPlayer FindPlayer(string playerId)
        {
            if (Players == null || playerId == null) return null;
            foreach (var player in Players)
            {
                if (player.Id == playerId) return player;
            }
            return null;
        }

        /// <summary>이 플레이어의 seat. 방에 없으면 -1.</summary>
        public int SeatOf(string playerId)
        {
            var player = FindPlayer(playerId);
            return player == null ? -1 : player.Seat;
        }
    }

    public sealed class RoomInfo
    {
        [JsonProperty("code")] public string Code { get; set; }
        [JsonProperty("phase")] public string Phase { get; set; }
        [JsonProperty("players")] public int Players { get; set; }
        [JsonProperty("joinable")] public bool Joinable { get; set; }
    }

    // ---- 서버 -> 클라이언트 ----

    public abstract class ServerMessage
    {
    }

    public sealed class WelcomeMessage : ServerMessage
    {
        public string PlayerId { get; set; }
        /// <summary>재접속할 때 다시 보내는 값. 다른 사람에게 보이면 안 된다.</summary>
        public string Token { get; set; }
        public RoomSnapshot Room { get; set; }
    }

    public sealed class StateMessage : ServerMessage
    {
        public RoomSnapshot Room { get; set; }
    }

    public sealed class PongMessage : ServerMessage
    {
        public long Ts { get; set; }
        public long ServerTime { get; set; }
    }

    public sealed class ErrorMessage : ServerMessage
    {
        public string Code { get; set; }
        public string Message { get; set; }
    }

    /// <summary>서버 오류 코드. 서버의 ErrorCode와 같은 문자열이다.</summary>
    public static class ErrorCodes
    {
        public const string BadMessage = "bad_message";
        public const string RoomNotFound = "room_not_found";
        public const string RoomFull = "room_full";
        public const string GameInProgress = "game_in_progress";
        public const string NotInLobby = "not_in_lobby";
        public const string WrongPhase = "wrong_phase";
        public const string UnknownCharacter = "unknown_character";
        public const string CharacterUnavailable = "character_unavailable";
        public const string NotYourTurn = "not_your_turn";
        public const string AlreadyDone = "already_done";
        public const string NotYourCharacter = "not_your_character";
        public const string InvalidLane = "invalid_lane";

        /// <summary>다시 시도해도 소용없는 오류. 이 오류를 받으면 자동 재접속을 멈춘다.</summary>
        public static bool IsFatal(string code)
        {
            return code == RoomNotFound || code == RoomFull || code == GameInProgress;
        }
    }

    public static class MessageCodec
    {
        // enum을 문자열("lobby", "queenside")로 읽는다. 대소문자는 구분하지 않는다.
        private static readonly JsonSerializer Serializer = JsonSerializer.CreateDefault(
            new JsonSerializerSettings { Converters = { new StringEnumConverter() } });

        /// <summary>서버가 보낸 JSON을 해석한다. 형식이 틀리거나 모르는 메시지면 null.</summary>
        public static ServerMessage Parse(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;

            JObject obj;
            try
            {
                obj = JObject.Parse(json);
            }
            catch (JsonException)
            {
                return null;
            }

            try
            {
                switch ((string)obj["t"])
                {
                    case "welcome":
                        return new WelcomeMessage
                        {
                            PlayerId = (string)obj["playerId"],
                            Token = (string)obj["token"],
                            Room = obj["room"].ToObject<RoomSnapshot>(Serializer),
                        };
                    case "state":
                        return new StateMessage { Room = obj["room"].ToObject<RoomSnapshot>(Serializer) };
                    case "pong":
                        return new PongMessage { Ts = (long)obj["ts"], ServerTime = (long)obj["serverTime"] };
                    case "error":
                        return new ErrorMessage { Code = (string)obj["code"], Message = (string)obj["message"] };
                    default:
                        return null;
                }
            }
            catch (Exception ex) when (
                ex is JsonException ||
                ex is NullReferenceException ||
                ex is InvalidCastException ||
                ex is FormatException ||
                ex is OverflowException)
            {
                // 필드가 빠졌거나 타입이 다른 메시지. 한 메시지가 이상하다고 연결 전체가 끊기면 안 되어서 무시한다.
                return null;
            }
        }

        /// <summary>GET /api/characters 의 응답을 해석한다. 형식이 틀리면 null.</summary>
        public static List<CharacterInfo> ParseCharacters(string json)
        {
            try
            {
                return JObject.Parse(json)["characters"].ToObject<List<CharacterInfo>>(Serializer);
            }
            catch (Exception ex) when (ex is JsonException || ex is NullReferenceException || ex is ArgumentException)
            {
                return null;
            }
        }

        public static string Ready(bool ready)
        {
            return "{\"t\":\"ready\",\"ready\":" + (ready ? "true" : "false") + "}";
        }

        public static string Ping(long timestampMs)
        {
            return "{\"t\":\"ping\",\"ts\":" + timestampMs + "}";
        }

        public static string Ban(string characterId)
        {
            return "{\"t\":\"ban\",\"characterId\":" + JsonConvert.ToString(characterId) + "}";
        }

        public static string Pick(string characterId)
        {
            return "{\"t\":\"pick\",\"characterId\":" + JsonConvert.ToString(characterId) + "}";
        }

        public static string Place(string characterId, Lane lane)
        {
            return "{\"t\":\"place\",\"characterId\":" + JsonConvert.ToString(characterId) +
                   ",\"lane\":\"" + lane.ToString().ToLowerInvariant() + "\"}";
        }

        public static string Lock()
        {
            return "{\"t\":\"lock\"}";
        }
    }
}
