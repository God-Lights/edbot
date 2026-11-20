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
        /// <summary>전투가 동점일 때만 이어지는 연장전.</summary>
        Deathmatch,
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

    /// <summary>전투 중인 캐릭터 한 명(소환수 포함).</summary>
    public sealed class UnitSnapshot
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("characterId")] public string CharacterId { get; set; }
        [JsonProperty("seat")] public int Seat { get; set; }
        [JsonProperty("lane")] public Lane Lane { get; set; }
        /// <summary>레인 위의 위치 0~100. seat 0의 본진이 0, seat 1의 본진이 100.</summary>
        [JsonProperty("pos")] public double Pos { get; set; }
        [JsonProperty("hp")] public int Hp { get; set; }
        [JsonProperty("maxHp")] public int MaxHp { get; set; }
        [JsonProperty("alive")] public bool Alive { get; set; }
        /// <summary>죽어 있다면 되살아날 때까지 남은 틱.</summary>
        [JsonProperty("respawnInTicks")] public int? RespawnInTicks { get; set; }
        [JsonProperty("shield")] public int Shield { get; set; }
        [JsonProperty("promoted")] public bool Promoted { get; set; }
        [JsonProperty("summon")] public bool Summon { get; set; }
        [JsonProperty("effects")] public List<string> Effects { get; set; } = new List<string>();
        /// <summary>끼고 있는 무기. 내 캐릭터는 항상 보이고, 상대는 맞붙어 있을 때만 보인다.</summary>
        [JsonProperty("weapon")] public string Weapon { get; set; }
        /// <summary>궁극기를 다시 쓸 수 있게 되는 틱. 내 캐릭터에게만 들어 있다.</summary>
        [JsonProperty("ultReadyTick")] public int? UltReadyTick { get; set; }
        /// <summary>나이트의 레인 이동을 다시 쓸 수 있게 되는 틱. 내 캐릭터에게만 들어 있다.</summary>
        [JsonProperty("laneMoveReadyTick")] public int? LaneMoveReadyTick { get; set; }
    }

    public sealed class TowerSnapshot
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("seat")] public int Seat { get; set; }
        [JsonProperty("lane")] public Lane Lane { get; set; }
        /// <summary>"guard" 또는 "main".</summary>
        [JsonProperty("kind")] public string Kind { get; set; }
        [JsonProperty("pos")] public double Pos { get; set; }
        [JsonProperty("hp")] public int Hp { get; set; }
        [JsonProperty("maxHp")] public int MaxHp { get; set; }
        [JsonProperty("alive")] public bool Alive { get; set; }

        public bool IsMain { get { return Kind == "main"; } }
    }

    public sealed class BattleZone
    {
        [JsonProperty("lane")] public Lane Lane { get; set; }
        [JsonProperty("pos")] public double Pos { get; set; }
        [JsonProperty("seat")] public int Seat { get; set; }
    }

    public sealed class BattleEvent
    {
        /// <summary>전투 동안 1씩 늘어나는 번호. 이미 본 이벤트를 거르는 데 쓴다.</summary>
        [JsonProperty("seq")] public int Seq { get; set; }
        [JsonProperty("tick")] public int Tick { get; set; }
        /// <summary>kill, towerDestroyed, ultimate, skill, respawn, promote, end</summary>
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("seat")] public int? Seat { get; set; }
        [JsonProperty("unitId")] public string UnitId { get; set; }
        [JsonProperty("targetId")] public string TargetId { get; set; }
        [JsonProperty("text")] public string Text { get; set; }
    }

    /// <summary>전투와 데스매치 중의 상태.</summary>
    public sealed class BattleSnapshot
    {
        /// <summary>"battle" 또는 "deathmatch".</summary>
        [JsonProperty("mode")] public string Mode { get; set; }
        /// <summary>전투 시작부터 센 틱.</summary>
        [JsonProperty("tick")] public int Tick { get; set; }
        [JsonProperty("ticksPerSecond")] public int TicksPerSecond { get; set; } = 10;
        [JsonProperty("score")] public List<int> Score { get; set; } = new List<int>();
        [JsonProperty("kills")] public List<int> Kills { get; set; } = new List<int>();
        /// <summary>내 스팀포스. 구경꾼이면 null. 상대 것은 보이지 않는다.</summary>
        [JsonProperty("steam")] public double? Steam { get; set; }
        [JsonProperty("towers")] public List<TowerSnapshot> Towers { get; set; } = new List<TowerSnapshot>();
        [JsonProperty("units")] public List<UnitSnapshot> Units { get; set; } = new List<UnitSnapshot>();
        [JsonProperty("walls")] public List<BattleZone> Walls { get; set; } = new List<BattleZone>();
        [JsonProperty("wells")] public List<BattleZone> Wells { get; set; } = new List<BattleZone>();
        [JsonProperty("events")] public List<BattleEvent> Events { get; set; } = new List<BattleEvent>();

        public const double UltimateCost = 5;

        public bool IsDeathmatch { get { return Mode == "deathmatch"; } }

        /// <summary>그 틱까지 남은 시간(초). 이미 지났으면 0.</summary>
        public double SecondsUntilTick(int tick)
        {
            int perSecond = TicksPerSecond <= 0 ? 10 : TicksPerSecond;
            return Math.Max(0, (tick - Tick) / (double)perSecond);
        }

        /// <summary>이 캐릭터의 궁극기를 지금 쓸 수 있는가. 살아 있고, 재사용 대기가 끝났고, 스팀포스가 충분해야 한다.</summary>
        public bool CanUseUltimate(UnitSnapshot unit)
        {
            return unit != null && unit.Alive && unit.UltReadyTick.HasValue &&
                   unit.UltReadyTick.Value <= Tick && Steam.HasValue && Steam.Value >= UltimateCost;
        }

        public UnitSnapshot FindUnit(string id)
        {
            foreach (var unit in Units)
            {
                if (unit.Id == id) return unit;
            }
            return null;
        }
    }

    /// <summary>탐사 지도의 칸 하나.</summary>
    public sealed class ExploreTileSnapshot
    {
        [JsonProperty("index")] public int Index { get; set; }
        /// <summary>정체를 아는가. 안개 칸은 정찰하거나 채집하기 전에는 모른다.</summary>
        [JsonProperty("known")] public bool Known { get; set; }
        /// <summary>tree | rock | ore | chest | empty. 모르면 null.</summary>
        [JsonProperty("kind")] public string Kind { get; set; }
        [JsonProperty("depleted")] public bool Depleted { get; set; }
        [JsonProperty("respawnInTicks")] public int? RespawnInTicks { get; set; }
        /// <summary>내가 이 칸을 채집하는 중이면 끝날 때까지 남은 틱.</summary>
        [JsonProperty("myGatherInTicks")] public int? MyGatherInTicks { get; set; }
        /// <summary>내가 이 칸에 매복 중이면 끝날 때까지 남은 틱.</summary>
        [JsonProperty("myAmbushInTicks")] public int? MyAmbushInTicks { get; set; }
        /// <summary>정찰해서 상대의 매복을 알아냈다.</summary>
        [JsonProperty("enemyAmbush")] public bool EnemyAmbush { get; set; }
    }

    public sealed class ExploreResources
    {
        [JsonProperty("talent")] public int Talent { get; set; }
        [JsonProperty("branch")] public int Branch { get; set; }
        [JsonProperty("stone")] public int Stone { get; set; }
        [JsonProperty("ore")] public int Ore { get; set; }
        [JsonProperty("ironIngot")] public int IronIngot { get; set; }
        [JsonProperty("rare")] public int Rare { get; set; }
        [JsonProperty("blueprints")] public int Blueprints { get; set; }
    }

    public sealed class ExploreEvent
    {
        [JsonProperty("seq")] public int Seq { get; set; }
        [JsonProperty("tick")] public int Tick { get; set; }
        /// <summary>gathered, split, stolen, ambushHit, ambushClash, ambushExpired, scouted, trap, empty</summary>
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("tile")] public int Tile { get; set; }
        [JsonProperty("gain")] public ExploreResources Gain { get; set; }
        [JsonProperty("detail")] public string Detail { get; set; }
    }

    /// <summary>탐사 상태. 내 자원과 내 행동만 들어 있다.</summary>
    public sealed class ExploreSnapshot
    {
        [JsonProperty("tick")] public int Tick { get; set; }
        [JsonProperty("ticksPerSecond")] public int TicksPerSecond { get; set; } = 10;
        [JsonProperty("gauge")] public int Gauge { get; set; }
        [JsonProperty("gaugeMax")] public int GaugeMax { get; set; }
        /// <summary>다음 게이지가 찰 때까지 남은 틱. 가득 차 있으면 null.</summary>
        [JsonProperty("gaugeNextInTicks")] public int? GaugeNextInTicks { get; set; }
        [JsonProperty("tiles")] public List<ExploreTileSnapshot> Tiles { get; set; } = new List<ExploreTileSnapshot>();
        [JsonProperty("resources")] public ExploreResources Resources { get; set; }
        [JsonProperty("events")] public List<ExploreEvent> Events { get; set; } = new List<ExploreEvent>();

        public double Seconds(int ticks)
        {
            return ticks / (double)(TicksPerSecond <= 0 ? 10 : TicksPerSecond);
        }
    }

    public sealed class SmelterSnapshot
    {
        [JsonProperty("remainingTicks")] public int RemainingTicks { get; set; }
    }

    public sealed class EquippingSnapshot
    {
        [JsonProperty("weaponId")] public string WeaponId { get; set; }
        [JsonProperty("remainingTicks")] public int RemainingTicks { get; set; }
    }

    public sealed class ForgeEventSnapshot
    {
        [JsonProperty("seq")] public int Seq { get; set; }
        [JsonProperty("tick")] public int Tick { get; set; }
        /// <summary>smelted, equipped, equipFailed</summary>
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("detail")] public string Detail { get; set; }
    }

    /// <summary>대장간 상태. 내 것만 들어 있다.</summary>
    public sealed class ForgeSnapshot
    {
        [JsonProperty("steam")] public double Steam { get; set; }
        [JsonProperty("steamMax")] public double SteamMax { get; set; }
        /// <summary>재련대 2개. 비어 있으면 null.</summary>
        [JsonProperty("smelters")] public List<SmelterSnapshot> Smelters { get; set; } = new List<SmelterSnapshot>();
        /// <summary>무기 id -> 개수.</summary>
        [JsonProperty("inventory")] public Dictionary<string, int> Inventory { get; set; } = new Dictionary<string, int>();
        /// <summary>캐릭터 id -> 끼고 있는 무기 id.</summary>
        [JsonProperty("equipped")] public Dictionary<string, string> Equipped { get; set; } = new Dictionary<string, string>();
        [JsonProperty("equipping")] public Dictionary<string, EquippingSnapshot> Equipping { get; set; } = new Dictionary<string, EquippingSnapshot>();
        [JsonProperty("orePrice")] public int OrePrice { get; set; }
        [JsonProperty("ticksPerSecond")] public int TicksPerSecond { get; set; } = 10;
        [JsonProperty("events")] public List<ForgeEventSnapshot> Events { get; set; } = new List<ForgeEventSnapshot>();

        public double Seconds(int ticks)
        {
            return ticks / (double)(TicksPerSecond <= 0 ? 10 : TicksPerSecond);
        }
    }

    /// <summary>무기 한 개의 데이터. 서버의 GET /api/weapons 가 돌려준다.</summary>
    public sealed class WeaponInfo
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("nameKo")] public string NameKo { get; set; }
        /// <summary>heavy(중량) | polearm(장병) | ranged(원거리)</summary>
        [JsonProperty("kind")] public string Kind { get; set; }
        /// <summary>1, 2 또는 "special".</summary>
        [JsonProperty("tier")] public string Tier { get; set; }
        [JsonProperty("atkBonus")] public double AtkBonus { get; set; }
        /// <summary>재료 이름(branch, stone, ironIngot, rare, blueprints) -> 개수.</summary>
        [JsonProperty("recipe")] public Dictionary<string, int> Recipe { get; set; } = new Dictionary<string, int>();
        [JsonProperty("effectText")] public string EffectText { get; set; }

        /// <summary>내 재료로 만들 수 있는가.</summary>
        public bool CanCraft(ExploreResources r)
        {
            if (r == null) return false;
            foreach (var pair in Recipe)
            {
                if (Have(r, pair.Key) < pair.Value) return false;
            }
            return true;
        }

        private static int Have(ExploreResources r, string key)
        {
            switch (key)
            {
                case "branch": return r.Branch;
                case "stone": return r.Stone;
                case "ironIngot": return r.IronIngot;
                case "rare": return r.Rare;
                case "blueprints": return r.Blueprints;
                default: return 0;
            }
        }
    }

    /// <summary>한 판으로 바뀐 레이팅.</summary>
    public sealed class RatingChange
    {
        [JsonProperty("before")] public int Before { get; set; }
        [JsonProperty("after")] public int After { get; set; }
        public int Delta { get { return After - Before; } }
    }

    /// <summary>판이 끝난 뒤의 결과.</summary>
    public sealed class ResultSnapshot
    {
        /// <summary>seat 순서의 레이팅 변화. 로그인하지 않은 판이거나 아직 저장 전이면 null.</summary>
        [JsonProperty("ratings")] public List<RatingChange> Ratings { get; set; } = new List<RatingChange>();

        /// <summary>이긴 seat. 없으면 null.</summary>
        [JsonProperty("winner")] public int? Winner { get; set; }
        /// <summary>towers | time | deathmatch | deathmatchTime</summary>
        [JsonProperty("reason")] public string Reason { get; set; }
        [JsonProperty("score")] public List<int> Score { get; set; } = new List<int>();
        [JsonProperty("kills")] public List<int> Kills { get; set; } = new List<int>();
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

        /// <summary>전투와 데스매치 중에만 있다.</summary>
        [JsonProperty("battle")] public BattleSnapshot Battle { get; set; }

        /// <summary>탐사 단계부터 판이 끝날 때까지. 그 전에는 null.</summary>
        [JsonProperty("explore")] public ExploreSnapshot Explore { get; set; }

        /// <summary>대장간. 탐사와 함께 시작해서 판이 끝날 때까지.</summary>
        [JsonProperty("forge")] public ForgeSnapshot Forge { get; set; }

        /// <summary>결과 단계에서만 있다.</summary>
        [JsonProperty("result")] public ResultSnapshot Result { get; set; }

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
        public const string UnitDead = "unit_dead";
        public const string UnitDisabled = "unit_disabled";
        public const string NotImplemented = "not_implemented";
        public const string OnCooldown = "on_cooldown";
        public const string NotEnoughSteam = "not_enough_steam";
        public const string NoTarget = "no_target";
        public const string NotAKnight = "not_a_knight";
        public const string InvalidTile = "invalid_tile";
        public const string NoActionGauge = "no_action_gauge";
        public const string TileBusy = "tile_busy";
        public const string NothingToGather = "nothing_to_gather";
        public const string AlreadyKnown = "already_known";
        public const string NotEnoughTalent = "not_enough_talent";
        public const string NotEnoughMaterials = "not_enough_materials";
        public const string NoFreeSmelter = "no_free_smelter";
        public const string UnknownWeapon = "unknown_weapon";
        public const string NoWeapon = "no_weapon";
        public const string NotInZone = "not_in_zone";
        public const string AlreadyEquipping = "already_equipping";
        public const string AlreadyEquipped = "already_equipped";
        public const string InvalidQuantity = "invalid_quantity";
        public const string Unauthorized = "unauthorized";

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

        /// <summary>GET /api/weapons 의 응답을 해석한다. 형식이 틀리면 null.</summary>
        public static List<WeaponInfo> ParseWeapons(string json)
        {
            try
            {
                return JObject.Parse(json)["weapons"].ToObject<List<WeaponInfo>>(Serializer);
            }
            catch (Exception ex) when (ex is JsonException || ex is NullReferenceException || ex is ArgumentException)
            {
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

        /// <summary>궁극기. 안키오처럼 레인을 골라야 하는 캐릭터만 lane을 넘긴다.</summary>
        public static string Ultimate(string characterId, Lane? lane = null)
        {
            string json = "{\"t\":\"ultimate\",\"characterId\":" + JsonConvert.ToString(characterId);
            if (lane.HasValue) json += ",\"lane\":\"" + lane.Value.ToString().ToLowerInvariant() + "\"";
            return json + "}";
        }

        /// <summary>대장간: 광석 구입.</summary>
        public static string ForgeBuy(int quantity = 1)
        {
            return "{\"t\":\"forge\",\"action\":\"buy\",\"quantity\":" + quantity + "}";
        }

        /// <summary>대장간: 재련 시작.</summary>
        public static string ForgeSmelt()
        {
            return "{\"t\":\"forge\",\"action\":\"smelt\"}";
        }

        /// <summary>대장간: 무기 조합.</summary>
        public static string ForgeCraft(string weaponId)
        {
            return "{\"t\":\"forge\",\"action\":\"craft\",\"weaponId\":" + JsonConvert.ToString(weaponId) + "}";
        }

        /// <summary>대장간: 무기 장착(3초).</summary>
        public static string ForgeEquip(string weaponId, string characterId)
        {
            return "{\"t\":\"forge\",\"action\":\"equip\",\"weaponId\":" + JsonConvert.ToString(weaponId) +
                   ",\"characterId\":" + JsonConvert.ToString(characterId) + "}";
        }

        /// <summary>탐사 행동. action은 gather, ambush, scout 중 하나. tile은 0~15 (4x4, 왼쪽 위부터).</summary>
        public static string Explore(string action, int tile)
        {
            return "{\"t\":\"explore\",\"action\":" + JsonConvert.ToString(action) + ",\"tile\":" + tile + "}";
        }

        /// <summary>나이트가 다른 레인으로 옮겨 간다.</summary>
        public static string Move(string characterId, Lane lane)
        {
            return "{\"t\":\"move\",\"characterId\":" + JsonConvert.ToString(characterId) +
                   ",\"lane\":\"" + lane.ToString().ToLowerInvariant() + "\"}";
        }
    }
}
