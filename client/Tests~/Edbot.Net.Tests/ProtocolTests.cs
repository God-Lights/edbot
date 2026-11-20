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
