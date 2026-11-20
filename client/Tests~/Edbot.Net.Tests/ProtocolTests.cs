using Xunit;

namespace Edbot.Net.Tests
{
    public class ProtocolTests
    {
        // 서버(server/)가 실제로 보내는 형식 그대로의 예시
        private const string Welcome =
            "{\"t\":\"welcome\",\"playerId\":\"p-1\",\"token\":\"tok-1\",\"room\":" +
            "{\"code\":\"ABCD\",\"phase\":\"lobby\",\"phaseStartedAt\":1000,\"phaseEndsAt\":null,\"serverTime\":1500," +
            "\"players\":[{\"id\":\"p-1\",\"name\":\"에드\",\"seat\":0,\"connected\":true,\"ready\":false}]}}";

        [Fact]
        public void Welcome을_해석한다()
        {
            var message = Assert.IsType<WelcomeMessage>(MessageCodec.Parse(Welcome));
            Assert.Equal("p-1", message.PlayerId);
            Assert.Equal("tok-1", message.Token);
            Assert.Equal("ABCD", message.Room.Code);
            Assert.Equal(Phase.Lobby, message.Room.Phase);
            Assert.Null(message.Room.PhaseEndsAt);
            Assert.Equal(1500, message.Room.ServerTime);

            var player = Assert.Single(message.Room.Players);
            Assert.Equal("에드", player.Name);
            Assert.Equal(0, player.Seat);
            Assert.True(player.Connected);
            Assert.False(player.Ready);
        }

        [Theory]
        [InlineData("lobby", Phase.Lobby)]
        [InlineData("ban", Phase.Ban)]
        [InlineData("draft", Phase.Draft)]
        [InlineData("placement", Phase.Placement)]
        [InlineData("explore", Phase.Explore)]
        [InlineData("forge", Phase.Forge)]
        [InlineData("battle", Phase.Battle)]
        [InlineData("result", Phase.Result)]
        public void 모든_단계_이름을_해석한다(string wire, Phase expected)
        {
            string json = "{\"t\":\"state\",\"room\":{\"code\":\"ABCD\",\"phase\":\"" + wire +
                          "\",\"phaseStartedAt\":0,\"phaseEndsAt\":12000,\"serverTime\":0,\"players\":[]}}";
            var message = Assert.IsType<StateMessage>(MessageCodec.Parse(json));
            Assert.Equal(expected, message.Room.Phase);
            Assert.Equal(12000, message.Room.PhaseEndsAt);
        }

        [Fact]
        public void Pong과_Error를_해석한다()
        {
            var pong = Assert.IsType<PongMessage>(MessageCodec.Parse("{\"t\":\"pong\",\"ts\":10,\"serverTime\":20}"));
            Assert.Equal(10, pong.Ts);
            Assert.Equal(20, pong.ServerTime);

            var error = Assert.IsType<ErrorMessage>(
                MessageCodec.Parse("{\"t\":\"error\",\"code\":\"room_full\",\"message\":\"방이 가득 찼다.\"}"));
            Assert.Equal("room_full", error.Code);
            Assert.Equal("방이 가득 찼다.", error.Message);
        }

        [Theory]
        [InlineData("")]
        [InlineData("not json")]
        [InlineData("[]")]
        [InlineData("{}")]
        [InlineData("{\"t\":\"unknown\"}")]
        [InlineData("{\"t\":\"welcome\"}")]
        [InlineData("{\"t\":\"pong\",\"ts\":\"x\",\"serverTime\":1}")]
        public void 잘못된_메시지는_null(string json)
        {
            Assert.Null(MessageCodec.Parse(json));
        }

        [Fact]
        public void 보내는_메시지_형식이_서버와_같다()
        {
            Assert.Equal("{\"t\":\"ready\",\"ready\":true}", MessageCodec.Ready(true));
            Assert.Equal("{\"t\":\"ready\",\"ready\":false}", MessageCodec.Ready(false));
            Assert.Equal("{\"t\":\"ping\",\"ts\":1234}", MessageCodec.Ping(1234));
        }

        // 서버가 드래프트 중에 보내는 상태. seat 0 입장에서 본 것: 상대(seat 1)의 레인은 null.
        private const string DraftState =
            "{\"t\":\"state\",\"room\":{\"code\":\"ABCD\",\"phase\":\"draft\",\"phaseStartedAt\":3000,\"phaseEndsAt\":43000,\"serverTime\":5000," +
            "\"players\":[{\"id\":\"p-1\",\"name\":\"에드\",\"seat\":0,\"connected\":true,\"ready\":false}," +
            "{\"id\":\"p-2\",\"name\":\"민수\",\"seat\":1,\"connected\":true,\"ready\":false}]," +
            "\"game\":{\"firstPicker\":0,\"bans\":[{\"locked\":true,\"characterId\":\"ancient-lord\"},{\"locked\":true,\"characterId\":\"xenosaurs\"}]," +
            "\"pickOrder\":[0,1,1,0,0,1,1,0,0,1],\"picks\":[[\"richmond\"],[\"rosmaktia\"]],\"turnSeat\":1,\"turnEndsAt\":9000," +
            "\"lanes\":[{\"richmond\":\"kingside\"},null],\"placementLocked\":[false,false]}}}";

        [Fact]
        public void 게임_상태를_해석한다()
        {
            var room = Assert.IsType<StateMessage>(MessageCodec.Parse(DraftState)).Room;
            Assert.Equal(Phase.Draft, room.Phase);
            Assert.Equal(0, room.SeatOf("p-1"));
            Assert.Equal(1, room.SeatOf("p-2"));
            Assert.Equal(-1, room.SeatOf("ghost"));

            var game = room.Game;
            Assert.Equal(0, game.FirstPicker);
            Assert.Equal(2, game.Bans.Count);
            Assert.True(game.Bans[0].Locked);
            Assert.Equal("ancient-lord", game.Bans[0].CharacterId);
            Assert.Equal(new[] { 0, 1, 1, 0, 0, 1, 1, 0, 0, 1 }, game.PickOrder);
            Assert.Equal(new[] { "richmond" }, game.Picks[0]);
            Assert.Equal(new[] { "rosmaktia" }, game.Picks[1]);
            Assert.Equal(2, game.PickCount);
            Assert.Equal(1, game.TurnSeat);
            Assert.Equal(9000, game.TurnEndsAt);
            Assert.Equal(new[] { false, false }, game.PlacementLocked);
        }

        [Fact]
        public void 레인은_내_것만_보이고_상대_것은_null이다()
        {
            var game = Assert.IsType<StateMessage>(MessageCodec.Parse(DraftState)).Room.Game;
            Assert.Equal(Lane.Kingside, game.LaneOf(0, "richmond"));
            Assert.Null(game.LaneOf(0, "lappus")); // 아직 정하지 않았다
            Assert.Null(game.LaneOf(1, "rosmaktia")); // 상대의 배치는 보이지 않는다
            Assert.Null(game.LaneOf(2, "richmond")); // 범위 밖 seat
        }

        [Fact]
        public void 밴되었거나_뽑힌_캐릭터는_고를_수_없다()
        {
            var game = Assert.IsType<StateMessage>(MessageCodec.Parse(DraftState)).Room.Game;
            Assert.True(game.IsUnavailable("ancient-lord")); // 밴
            Assert.True(game.IsUnavailable("xenosaurs"));
            Assert.True(game.IsUnavailable("richmond")); // 뽑힘
            Assert.True(game.IsUnavailable("rosmaktia"));
            Assert.False(game.IsUnavailable("lappus"));
        }

        [Fact]
        public void 밴_단계에서_상대의_밴은_null이다()
        {
            string json = "{\"t\":\"state\",\"room\":{\"code\":\"ABCD\",\"phase\":\"ban\",\"phaseStartedAt\":0,\"phaseEndsAt\":10000,\"serverTime\":1,\"players\":[]," +
                          "\"game\":{\"firstPicker\":1,\"bans\":[{\"locked\":true,\"characterId\":null},{\"locked\":false,\"characterId\":null}]," +
                          "\"pickOrder\":[],\"picks\":[[],[]],\"turnSeat\":null,\"turnEndsAt\":null,\"lanes\":[{},null],\"placementLocked\":[false,false]}}}";
            var game = Assert.IsType<StateMessage>(MessageCodec.Parse(json)).Room.Game;
            Assert.True(game.Bans[0].Locked);
            Assert.Null(game.Bans[0].CharacterId);
            Assert.Null(game.TurnSeat);
            Assert.Null(game.TurnEndsAt);
        }

        [Theory]
        [InlineData("queenside", Lane.Queenside)]
        [InlineData("center", Lane.Center)]
        [InlineData("kingside", Lane.Kingside)]
        public void 레인_이름을_해석한다(string wire, Lane expected)
        {
            string json = "{\"t\":\"state\",\"room\":{\"code\":\"A\",\"phase\":\"placement\",\"phaseStartedAt\":0,\"phaseEndsAt\":1,\"serverTime\":1,\"players\":[]," +
                          "\"game\":{\"firstPicker\":0,\"bans\":[],\"pickOrder\":[],\"picks\":[[\"x\"],[]],\"turnSeat\":null,\"turnEndsAt\":null," +
                          "\"lanes\":[{\"x\":\"" + wire + "\"},null],\"placementLocked\":[false,false]}}}";
            var game = Assert.IsType<StateMessage>(MessageCodec.Parse(json)).Room.Game;
            Assert.Equal(expected, game.LaneOf(0, "x"));
        }

        [Fact]
        public void 캐릭터_데이터를_해석한다()
        {
            string json = "{\"characters\":[" +
                          "{\"id\":\"ancient-lord\",\"nameKo\":\"에이션트 로드\",\"nameEn\":\"Ancient Lord\",\"piece\":\"king\",\"hp\":1500,\"attack\":60,\"speed\":\"slow\",\"range\":\"mid\"}," +
                          "{\"id\":\"ankio\",\"nameKo\":\"안키오\",\"nameEn\":\"Ankio\",\"piece\":\"knight\",\"hp\":850,\"attack\":70,\"speed\":\"veryFast\",\"range\":\"melee\"}]}";
            var characters = MessageCodec.ParseCharacters(json);
            Assert.Equal(2, characters.Count);
            Assert.Equal("ancient-lord", characters[0].Id);
            Assert.Equal("에이션트 로드", characters[0].NameKo);
            Assert.Equal(Piece.King, characters[0].Piece);
            Assert.Equal(1500, characters[0].Hp);
            Assert.Equal(Piece.Knight, characters[1].Piece);
            Assert.Equal("veryFast", characters[1].Speed);
            Assert.Null(MessageCodec.ParseCharacters("not json"));
            Assert.Null(MessageCodec.ParseCharacters("{}"));
        }

        [Fact]
        public void 밴_뽑기_배치_확정_메시지_형식이_서버와_같다()
        {
            Assert.Equal("{\"t\":\"ban\",\"characterId\":\"ancient-lord\"}", MessageCodec.Ban("ancient-lord"));
            Assert.Equal("{\"t\":\"pick\",\"characterId\":\"lappus\"}", MessageCodec.Pick("lappus"));
            Assert.Equal("{\"t\":\"place\",\"characterId\":\"lappus\",\"lane\":\"center\"}", MessageCodec.Place("lappus", Lane.Center));
            Assert.Equal("{\"t\":\"place\",\"characterId\":\"x\",\"lane\":\"queenside\"}", MessageCodec.Place("x", Lane.Queenside));
            Assert.Equal("{\"t\":\"place\",\"characterId\":\"x\",\"lane\":\"kingside\"}", MessageCodec.Place("x", Lane.Kingside));
            Assert.Equal("{\"t\":\"lock\"}", MessageCodec.Lock());
        }

        [Fact]
        public void 캐릭터_id의_따옴표는_이스케이프된다()
        {
            Assert.Equal("{\"t\":\"pick\",\"characterId\":\"a\\\"b\"}", MessageCodec.Pick("a\"b"));
        }

        [Fact]
        public void 치명적인_오류_코드()
        {
            Assert.True(ErrorCodes.IsFatal(ErrorCodes.RoomFull));
            Assert.True(ErrorCodes.IsFatal(ErrorCodes.GameInProgress));
            Assert.True(ErrorCodes.IsFatal(ErrorCodes.RoomNotFound));
            Assert.False(ErrorCodes.IsFatal(ErrorCodes.BadMessage));
            Assert.False(ErrorCodes.IsFatal(ErrorCodes.NotInLobby));
        }

        [Theory]
        [InlineData("127.0.0.1:8787", "http://127.0.0.1:8787", "ws://127.0.0.1:8787")]
        [InlineData("http://localhost:8787/", "http://localhost:8787", "ws://localhost:8787")]
        [InlineData("https://edbot.example.workers.dev", "https://edbot.example.workers.dev", "wss://edbot.example.workers.dev")]
        [InlineData("  https://a.b/  ", "https://a.b", "wss://a.b")]
        public void 서버_주소를_다듬고_ws로_바꾼다(string input, string http, string ws)
        {
            Assert.Equal(http, ApiClient.NormalizeServerUrl(input));
            Assert.Equal(ws, ApiClient.ToWebSocketBase(input));
        }

        [Fact]
        public void 빈_서버_주소는_예외()
        {
            Assert.Throws<System.ArgumentException>(() => ApiClient.NormalizeServerUrl("  "));
        }
    }
}
