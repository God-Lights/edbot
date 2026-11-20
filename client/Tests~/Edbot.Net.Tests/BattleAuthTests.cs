using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Edbot.Net;
using Xunit;

namespace Edbot.Net.Tests
{
    internal sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _respond;
        public HttpRequestMessage Last;
        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) { _respond = respond; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Last = request;
            return Task.FromResult(_respond(request));
        }
    }

    public class BattleProtocolTests
    {
        private const string BattleState = @"{""t"":""state"",""room"":{""code"":""ABCD"",""phase"":""battle"",""phaseStartedAt"":1,""phaseEndsAt"":2,""serverTime"":1,
          ""players"":[],""game"":null,""result"":null,
          ""battle"":{""mode"":""battle"",""tick"":120,""ticksPerSecond"":10,""score"":[7,1],""kills"":[2,1],""steam"":6.5,
            ""towers"":[{""id"":""t0:center:0"",""seat"":0,""lane"":""center"",""kind"":""guard"",""pos"":35,""hp"":900,""maxHp"":1000,""alive"":true}],
            ""units"":[{""id"":""0:dwargon"",""characterId"":""dwargon"",""seat"":0,""lane"":""kingside"",""pos"":12.5,""hp"":700,""maxHp"":1400,""alive"":true,
                        ""respawnInTicks"":null,""shield"":0,""promoted"":false,""summon"":false,""effects"":[""slow""],""ultReadyTick"":100,""laneMoveReadyTick"":null},
                       {""id"":""1:lappus"",""characterId"":""lappus"",""seat"":1,""lane"":""kingside"",""pos"":80,""hp"":0,""maxHp"":750,""alive"":false,
                        ""respawnInTicks"":30,""shield"":0,""promoted"":false,""summon"":false,""effects"":[],""ultReadyTick"":null,""laneMoveReadyTick"":null}],
            ""walls"":[],""wells"":[{""lane"":""center"",""pos"":5,""seat"":0}],
            ""events"":[{""seq"":3,""tick"":100,""type"":""kill"",""seat"":0,""unitId"":""0:dwargon"",""targetId"":""1:lappus"",""text"":null}]}}}";

        [Fact]
        public void ParsesBattleSnapshot()
        {
            var state = (StateMessage)MessageCodec.Parse(BattleState);
            var battle = state.Room.Battle;
            Assert.Equal(Phase.Battle, state.Room.Phase);
            Assert.Equal(120, battle.Tick);
            Assert.Equal(7, battle.Score[0]);
            Assert.Equal(6.5, battle.Steam);
            Assert.Single(battle.Towers);
            Assert.False(battle.Towers[0].IsMain);
            Assert.Equal(Lane.Kingside, battle.Units[0].Lane);
            Assert.Equal(12.5, battle.Units[0].Pos);
            Assert.Equal(30, battle.Units[1].RespawnInTicks);
            Assert.Equal(3, battle.Events[0].Seq);
            Assert.Single(battle.Wells);
            Assert.Null(state.Room.Result);
        }

        [Fact]
        public void UltimateIsReadyOnlyWhenAliveOffCooldownAndEnoughSteam()
        {
            var battle = ((StateMessage)MessageCodec.Parse(BattleState)).Room.Battle;
            var mine = battle.FindUnit("0:dwargon");
            Assert.True(battle.CanUseUltimate(mine));                 // 틱 100 <= 120, 스팀 6.5 >= 5
            battle.Steam = 4.9;
            Assert.False(battle.CanUseUltimate(mine));
            battle.Steam = 10;
            mine.UltReadyTick = 121;
            Assert.False(battle.CanUseUltimate(mine));
            Assert.Equal(0.1, battle.SecondsUntilTick(121), 3);
            Assert.False(battle.CanUseUltimate(battle.FindUnit("1:lappus"))); // 상대 유닛은 준비 정보가 없다
        }

        [Fact]
        public void ParsesDeathmatchAndResult()
        {
            const string json = @"{""t"":""state"",""room"":{""code"":""ABCD"",""phase"":""result"",""phaseStartedAt"":1,""phaseEndsAt"":2,""serverTime"":1,
              ""players"":[],""game"":null,""battle"":null,
              ""result"":{""winner"":1,""reason"":""deathmatchTime"",""score"":[3,3],""kills"":[1,2]}}}";
            var room = ((StateMessage)MessageCodec.Parse(json)).Room;
            Assert.Equal(Phase.Result, room.Phase);
            Assert.Equal(1, room.Result.Winner);
            Assert.Equal("deathmatchTime", room.Result.Reason);
            var dm = (StateMessage)MessageCodec.Parse(@"{""t"":""state"",""room"":{""code"":""ABCD"",""phase"":""deathmatch"",""phaseStartedAt"":1,""phaseEndsAt"":2,""serverTime"":1,""players"":[],""game"":null,""battle"":null,""result"":null}}");
            Assert.Equal(Phase.Deathmatch, dm.Room.Phase);
        }

        [Fact]
        public void BuildsBattleCommands()
        {
            Assert.Equal(@"{""t"":""ultimate"",""characterId"":""dwargon""}", MessageCodec.Ultimate("dwargon"));
            Assert.Equal(@"{""t"":""ultimate"",""characterId"":""ankio"",""lane"":""kingside""}", MessageCodec.Ultimate("ankio", Lane.Kingside));
            Assert.Equal(@"{""t"":""move"",""characterId"":""x"",""lane"":""center""}", MessageCodec.Move("x", Lane.Center));
        }
    }

    public class ExploreProtocolTests
    {
        [Fact]
        public void ParsesExploreSnapshot()
        {
            const string json = @"{""t"":""state"",""room"":{""code"":""ABCD"",""phase"":""explore"",""phaseStartedAt"":1,""phaseEndsAt"":2,""serverTime"":1,
              ""players"":[],""game"":null,""battle"":null,""result"":null,
              ""explore"":{""tick"":50,""ticksPerSecond"":10,""gauge"":2,""gaugeMax"":3,""gaugeNextInTicks"":70,
                ""tiles"":[{""index"":0,""known"":true,""kind"":""tree"",""depleted"":false,""respawnInTicks"":null,""myGatherInTicks"":20,""myAmbushInTicks"":null,""enemyAmbush"":false},
                           {""index"":1,""known"":false,""kind"":null,""depleted"":false,""respawnInTicks"":null,""myGatherInTicks"":null,""myAmbushInTicks"":null,""enemyAmbush"":false}],
                ""resources"":{""talent"":15,""branch"":3,""stone"":3,""ore"":0,""ironIngot"":0,""rare"":0,""blueprints"":0},
                ""events"":[{""seq"":1,""tick"":40,""type"":""gathered"",""tile"":0,""gain"":{""branch"":2},""detail"":null}]}}}";
            var room = ((StateMessage)MessageCodec.Parse(json)).Room;
            var explore = room.Explore;
            Assert.Equal(Phase.Explore, room.Phase);
            Assert.Equal(2, explore.Gauge);
            Assert.Equal(7.0, explore.Seconds(explore.GaugeNextInTicks.Value));
            Assert.Equal("tree", explore.Tiles[0].Kind);
            Assert.Equal(20, explore.Tiles[0].MyGatherInTicks);
            Assert.False(explore.Tiles[1].Known);
            Assert.Null(explore.Tiles[1].Kind);
            Assert.Equal(15, explore.Resources.Talent);
            Assert.Equal(2, explore.Events[0].Gain.Branch);
        }

        [Fact]
        public void BuildsExploreCommand()
        {
            Assert.Equal(@"{""t"":""explore"",""action"":""gather"",""tile"":5}", MessageCodec.Explore("gather", 5));
        }
    }

    public class ForgeProtocolTests
    {
        [Fact]
        public void ParsesForgeSnapshotAndWeapons()
        {
            const string json = @"{""t"":""state"",""room"":{""code"":""ABCD"",""phase"":""forge"",""phaseStartedAt"":1,""phaseEndsAt"":2,""serverTime"":1,
              ""players"":[],""game"":null,""battle"":null,""result"":null,""explore"":null,
              ""forge"":{""steam"":7.5,""steamMax"":10,""smelters"":[{""remainingTicks"":80},null],
                ""inventory"":{""wood-bow"":1},""equipped"":{""dwargon"":""stone-axe""},
                ""equipping"":{""lappus"":{""weaponId"":""wood-bow"",""remainingTicks"":20}},
                ""orePrice"":3,""ticksPerSecond"":10,""events"":[{""seq"":1,""tick"":5,""type"":""smelted"",""detail"":null}]}}}";
            var forge = ((StateMessage)MessageCodec.Parse(json)).Room.Forge;
            Assert.Equal(7.5, forge.Steam);
            Assert.Equal(80, forge.Smelters[0].RemainingTicks);
            Assert.Null(forge.Smelters[1]);
            Assert.Equal(1, forge.Inventory["wood-bow"]);
            Assert.Equal("stone-axe", forge.Equipped["dwargon"]);
            Assert.Equal(2.0, forge.Seconds(forge.Equipping["lappus"].RemainingTicks));
            Assert.Equal(3, forge.OrePrice);

            var weapons = MessageCodec.ParseWeapons(@"{""weapons"":[{""id"":""stone-axe"",""nameKo"":""돌도끼"",""kind"":""heavy"",""tier"":1,""atkBonus"":0.12,""recipe"":{""branch"":1,""stone"":2}}]}");
            var axe = weapons[0];
            Assert.Equal("돌도끼", axe.NameKo);
            Assert.True(axe.CanCraft(new ExploreResources { Branch = 3, Stone = 3 }));
            Assert.False(axe.CanCraft(new ExploreResources { Branch = 3, Stone = 1 }));
            Assert.Null(MessageCodec.ParseWeapons("nope"));
        }

        [Fact]
        public void BuildsForgeCommands()
        {
            Assert.Equal(@"{""t"":""forge"",""action"":""buy"",""quantity"":2}", MessageCodec.ForgeBuy(2));
            Assert.Equal(@"{""t"":""forge"",""action"":""smelt""}", MessageCodec.ForgeSmelt());
            Assert.Equal(@"{""t"":""forge"",""action"":""craft"",""weaponId"":""wood-bow""}", MessageCodec.ForgeCraft("wood-bow"));
            Assert.Equal(@"{""t"":""forge"",""action"":""equip"",""weaponId"":""a"",""characterId"":""b""}", MessageCodec.ForgeEquip("a", "b"));
        }

        [Fact]
        public void UnitSnapshotCarriesWeapon()
        {
            var battle = Newtonsoft.Json.JsonConvert.DeserializeObject<UnitSnapshot>(@"{""id"":""0:x"",""characterId"":""x"",""seat"":0,""lane"":""center"",""pos"":1,""hp"":1,""maxHp"":1,""alive"":true,""weapon"":""wood-bow"",""effects"":[]}",
                new Newtonsoft.Json.JsonSerializerSettings { Converters = { new Newtonsoft.Json.Converters.StringEnumConverter() } });
            Assert.Equal("wood-bow", battle.Weapon);
        }
    }

    public class RankingTests
    {
        private static HttpResponseMessage Json(string body)
        {
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) };
        }

        [Fact]
        public async Task LeaderboardAndStats()
        {
            var handler = new StubHandler(r => r.RequestUri.AbsolutePath.EndsWith("leaderboard")
                ? Json(@"{""entries"":[{""rank"":1,""nickname"":""에드"",""rating"":1020,""games"":1,""wins"":1,""losses"":0,""draws"":0,""isMe"":true}]}")
                : Json(@"{""stats"":{""nickname"":""에드"",""rating"":1020,""rank"":1,""games"":1,""wins"":1,""losses"":0,""draws"":0}}"));
            using (var api = new ApiClient("https://x", handler, "tok"))
            {
                var board = await api.GetLeaderboardAsync(5);
                Assert.Equal("에드", board[0].Nickname);
                Assert.True(board[0].IsMe);
                Assert.Contains("limit=5", handler.Last.RequestUri.Query);
                var stats = await api.GetMyStatsAsync();
                Assert.Equal(1020, stats.Rating);
                Assert.Equal("tok", handler.Last.Headers.Authorization.Parameter);
            }
        }

        [Fact]
        public async Task StatsAreNullBeforeFirstGameAndMatchesParse()
        {
            using (var api = new ApiClient("https://x", new StubHandler(r => Json(@"{""stats"":null}"))))
                Assert.Null(await api.GetMyStatsAsync());
            const string matches = @"{""matches"":[{""endedAt"":5,""opponent"":""민수"",""result"":""win"",""reason"":""towers"",""score"":[17,3],""kills"":[4,2],
              ""picks"":[""a""],""opponentPicks"":[""b""],""ratingBefore"":1000,""ratingAfter"":1020}]}";
            using (var api = new ApiClient("https://x", new StubHandler(r => Json(matches))))
            {
                var list = await api.GetMyMatchesAsync();
                Assert.Equal("win", list[0].Result);
                Assert.Equal(17, list[0].Score[0]);
                Assert.Equal(20, list[0].RatingAfter - list[0].RatingBefore);
            }
        }

        [Fact]
        public async Task Unauthorized()
        {
            using (var api = new ApiClient("https://x", new StubHandler(r => new HttpResponseMessage(HttpStatusCode.Unauthorized))))
                await Assert.ThrowsAsync<UnauthorizedException>(() => api.GetMyStatsAsync());
        }

        [Fact]
        public void ResultCarriesRatings()
        {
            const string json = @"{""t"":""state"",""room"":{""code"":""ABCD"",""phase"":""result"",""phaseStartedAt"":1,""phaseEndsAt"":2,""serverTime"":1,
              ""players"":[],""game"":null,""battle"":null,
              ""result"":{""ratings"":[{""before"":1000,""after"":1020},null],""winner"":0,""reason"":""time"",""score"":[3,1],""kills"":[1,0]}}}";
            var result = ((StateMessage)MessageCodec.Parse(json)).Room.Result;
            Assert.Equal(20, result.Ratings[0].Delta);
            Assert.Null(result.Ratings[1]);
        }
    }

    public class AuthClientTests
    {
        private static HttpResponseMessage Json(HttpStatusCode code, string body)
        {
            return new HttpResponseMessage(code) { Content = new StringContent(body) };
        }

        [Fact]
        public async Task StartReturnsLoginUrl()
        {
            var handler = new StubHandler(r => Json(HttpStatusCode.OK, @"{""loginId"":""abc"",""loginUrl"":""https://x/auth/login?login=abc"",""expiresInSeconds"":600}"));
            using (var auth = new AuthClient("https://x", handler))
            {
                var start = await auth.StartAsync();
                Assert.Equal("abc", start.LoginId);
                Assert.Equal("https://x/auth/login?login=abc", start.LoginUrl);
                Assert.Equal("/api/auth/start", handler.Last.RequestUri.AbsolutePath);
            }
        }

        [Fact]
        public async Task PollMapsPendingExpiredAndApproved()
        {
            using (var auth = new AuthClient("https://x", new StubHandler(r => Json(HttpStatusCode.Accepted, @"{""status"":""pending""}"))))
                Assert.Equal(LoginPollStatus.Pending, (await auth.PollAsync("a")).Status);
            using (var auth = new AuthClient("https://x", new StubHandler(r => Json(HttpStatusCode.NotFound, @"{""error"":""login_expired""}"))))
                Assert.Equal(LoginPollStatus.Expired, (await auth.PollAsync("a")).Status);
            using (var auth = new AuthClient("https://x", new StubHandler(r => Json(HttpStatusCode.OK,
                @"{""status"":""approved"",""token"":""tok"",""user"":{""id"":""u1"",""username"":""ed"",""nickname"":""에드"",""emailVerified"":true}}"))))
            {
                var result = await auth.PollAsync("a");
                Assert.Equal(LoginPollStatus.Approved, result.Status);
                Assert.Equal("tok", result.Token);
                Assert.Equal("에드", result.User.Nickname);
                Assert.Equal("u1", result.User.Id);
            }
        }

        [Fact]
        public async Task GetMeSendsBearerAndReturnsNullWhenUnauthorized()
        {
            var handler = new StubHandler(r => Json(HttpStatusCode.Unauthorized, @"{""error"":""unauthorized""}"));
            using (var auth = new AuthClient("https://x", handler))
            {
                Assert.Null(await auth.GetMeAsync("tok"));
                Assert.Equal("Bearer", handler.Last.Headers.Authorization.Scheme);
                Assert.Equal("tok", handler.Last.Headers.Authorization.Parameter);
            }
        }

        [Fact]
        public async Task CreateRoomSendsTokenAndThrowsUnauthorizedOn401()
        {
            var handler = new StubHandler(r => Json(HttpStatusCode.Unauthorized, @"{""error"":""unauthorized""}"));
            using (var api = new ApiClient("https://x", handler, "tok"))
            {
                await Assert.ThrowsAsync<UnauthorizedException>(() => api.CreateRoomAsync());
                Assert.Equal("tok", handler.Last.Headers.Authorization.Parameter);
            }
        }
    }
}
