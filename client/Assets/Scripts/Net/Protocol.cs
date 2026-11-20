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

    public sealed class PublicPlayer
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("name")] public string Name { get; set; }
        /// <summary>0 또는 1. 먼저 들어온 사람이 0.</summary>
        [JsonProperty("seat")] public int Seat { get; set; }
        [JsonProperty("connected")] public bool Connected { get; set; }
        [JsonProperty("ready")] public bool Ready { get; set; }
    }

    public sealed class RoomSnapshot
    {
        [JsonProperty("code")] public string Code { get; set; }

        [JsonProperty("phase")]
        [JsonConverter(typeof(StringEnumConverter))]
        public Phase Phase { get; set; }

        [JsonProperty("phaseStartedAt")] public long PhaseStartedAt { get; set; }

        /// <summary>단계가 끝나는 서버 시각(ms). 로비처럼 타이머가 없으면 null.</summary>
        [JsonProperty("phaseEndsAt")] public long? PhaseEndsAt { get; set; }

        /// <summary>이 스냅샷을 만든 서버 시각(ms). 시계 차이를 보정하는 데 쓴다.</summary>
        [JsonProperty("serverTime")] public long ServerTime { get; set; }

        [JsonProperty("players")] public List<PublicPlayer> Players { get; set; } = new List<PublicPlayer>();

        public PublicPlayer FindPlayer(string playerId)
        {
            if (Players == null || playerId == null) return null;
            foreach (var player in Players)
            {
                if (player.Id == playerId) return player;
            }
            return null;
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

        /// <summary>다시 시도해도 소용없는 오류. 이 오류를 받으면 자동 재접속을 멈춘다.</summary>
        public static bool IsFatal(string code)
        {
            return code == RoomNotFound || code == RoomFull || code == GameInProgress;
        }
    }

    public static class MessageCodec
    {
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
                            Room = obj["room"].ToObject<RoomSnapshot>(),
                        };
                    case "state":
                        return new StateMessage { Room = obj["room"].ToObject<RoomSnapshot>() };
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

        public static string Ready(bool ready)
        {
            return "{\"t\":\"ready\",\"ready\":" + (ready ? "true" : "false") + "}";
        }

        public static string Ping(long timestampMs)
        {
            return "{\"t\":\"ping\",\"ts\":" + timestampMs + "}";
        }
    }
}
