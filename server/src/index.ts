import { roster } from "./chess/roster";
import { MARKET_PRICE, materials, weapons as chessWeapons } from "./chess/weapons";
import { HYBRID_POWER, STAR_POWER, fusions } from "./chess/crafting";
import { ALL_SYNERGIES, LINEAGE_TRAITS } from "./chess/synergy";
import { EVOLUTION } from "./chess/roster";
import { CHARACTERS } from "./characters";
import { AuthStore } from "./auth-store";
import { USER_HEADER, authMode, authRequired, authStore, bearerToken, identify, loginRedirectUrl } from "./auth";
import { ensureContent } from "./content-load";
import { currentRuleset } from "./chess/content";
import { serverInfo } from "./server-info";
import type { AuthEnv } from "./auth";
import { loadSourceJson } from "./sidestore";
import { SYNERGIES } from "./synergy";
import { WEAPONS } from "./forge/weapons";
import { rankingStoreOf } from "./ranking/store";
import { approvedPage, donePage, failedPage, homePage } from "./pages";
import { Room } from "./room";
import { Matchmaker } from "./matchmaker";
import { LiveRegistry } from "./registry";
import { GUEST_HEADER, parseGuest, wsAccess } from "./guest";
import { CODE_ALPHABET, CODE_LENGTH, generateRoomCode } from "./codes";

export { AuthStore, LiveRegistry, Matchmaker, Room };



const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const MAX_CREATE_ATTEMPTS = 8;

/** 테스트 대전 방의 코드. 들어가면 사람마다 따로 만들어진 방에서 봇과 한 판을 할 수 있다. */
const TEST_ROOM_CODE = "ADMN";
/** 전체 캐릭터와 자원 시스템까지 켜진 봇 대전 (연습을 넘어선 판). */
const FULL_TEST_ROOM_CODE = "ADMF";
/** 무한 모드(뫼비우스 규칙)의 봇 대전. 전체 캐릭터와 자원 시스템이 켜져 있다. */
const INFINITE_TEST_ROOM_CODE = "ADMX";
const isTestCode = (code: string): boolean => code === TEST_ROOM_CODE || code === FULL_TEST_ROOM_CODE || code === INFINITE_TEST_ROOM_CODE;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

const SOURCE_CACHE_SECONDS = 300;

/** SideStore 소스. 릴리스 때 워크플로가 만든 파일을 가져와서 5분 동안 캐시한다. */
async function sideStoreSource(origin: string): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`${origin}/sidestore.json`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const result = await loadSourceJson(`${origin}/sidestore.json`);
  if (!result.ok) return json({ error: "releases_unavailable" }, 503);
  const response = new Response(result.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${SOURCE_CACHE_SECONDS}`,
      ...CORS_HEADERS,
    },
  });
  await cache.put(key, response.clone());
  return response;
}

/** ADMN은 접속한 사람마다 자기만의 방(Durable Object)을 쓴다. 다른 사람과 섞이지 않는다. */
function testRoomStub(env: Env, owner: string, kind: "lite" | "full" | "infinite" = "lite") {
  const prefix = kind === "full" ? "testfull" : kind === "infinite" ? "testinf" : "test";
  return env.ROOM.get(env.ROOM.idFromName(`${prefix}:${owner}`));
}
const testKind = (code: string): "lite" | "full" | "infinite" => (code === FULL_TEST_ROOM_CODE ? "full" : code === INFINITE_TEST_ROOM_CODE ? "infinite" : "lite");

function testOwner(user: { id: string } | null, request: Request): string {
  if (user) return user.id;
  // 로그인 검사를 끈 개발 서버: 이름으로 구분한다.
  const name = new URL(request.url).searchParams.get("name") ?? "anonymous";
  return `anon:${name.slice(0, 16)}`;
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

export default {
  async fetch(request: Request, rawEnv: Env): Promise<Response> {
    const env = rawEnv as Env & AuthEnv;
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const origin = url.origin;
    ensureContent(env); // 이 서버가 엑스퍼트면 배포에 담긴 콘텐츠 팩을 적용한다(한 번만)
    const enabled = authRequired(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ---- GL Account 로그인 ----

    // GET /api/server -> 이 서버의 이름·환경·로그인 방식·에디션·프로토콜 버전. 클라이언트가 로비를 맞추는 데 쓴다.
    if (request.method === "GET" && url.pathname === "/api/server") return json(serverInfo(env));

    // GET / -> 현재 로그인 상태. 자동으로 로그인 화면으로 보내지 않고, 버튼을 눌러야 간다.
    if (request.method === "GET" && url.pathname === "/") {
      return homePage(await identify(env, request), enabled, origin);
    }
    // GET /auth/login[?login=id] -> (버튼을 눌렀을 때) GL Account 로그인 화면으로.
    if (request.method === "GET" && url.pathname === "/auth/login") {
      const loginId = url.searchParams.get("login");
      const back = new URL("/auth/done", origin);
      if (loginId) back.searchParams.set("login", loginId);
      return Response.redirect(loginRedirectUrl(back.toString()), 302);
    }
    // GET /auth/done -> 로그인하고 돌아오는 곳.
    if (request.method === "GET" && url.pathname === "/auth/done") {
      // 웹 클라이언트에서 로그인하고 돌아왔다면(게임 클라이언트의 승인 요청이 아니면) 웹 게임으로 보낸다.
      if (!url.searchParams.get("login") && (await identify(env, request))) return Response.redirect(`${origin}/`, 302);
      return donePage(await identify(env, request), url.searchParams.get("login"));
    }
    // POST /auth/approve -> 게임 클라이언트의 로그인 요청을 승인한다.
    if (request.method === "POST" && url.pathname === "/auth/approve") {
      if (request.headers.get("origin") !== origin) return failedPage();
      const form = await request.formData().catch(() => null);
      const loginId = form?.get("login");
      const user = await identify(env, request);
      if (!user || typeof loginId !== "string" || !(await authStore(env).approve(loginId, user))) {
        return failedPage();
      }
      return approvedPage();
    }
    // POST /api/auth/start -> 게임 클라이언트가 로그인을 시작한다. 브라우저로 loginUrl을 열게 하고 poll로 기다린다.
    if (request.method === "POST" && url.pathname === "/api/auth/start") {
      const loginId = await authStore(env).start();
      return json({ loginId, loginUrl: `${origin}/auth/login?login=${loginId}`, expiresInSeconds: 600 });
    }
    // GET /api/auth/poll?id= -> 승인되면 게임 세션 토큰을 한 번만 돌려준다.
    if (request.method === "GET" && url.pathname === "/api/auth/poll") {
      const result = await authStore(env).claim(url.searchParams.get("id") ?? "");
      if (result.status === "unknown") return json({ error: "login_expired" }, 404);
      if (result.status === "pending") return json({ status: "pending" }, 202);
      return json({ status: "approved", token: result.token, user: result.user });
    }
    // GET /api/auth/me -> 지금 로그인한 사용자.
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      const user = await identify(env, request);
      return user ? json({ user }) : json({ error: "unauthorized" }, 401);
    }
    // POST /api/auth/logout -> 게임 세션을 끊는다. (GL 계정 로그아웃은 account.officialgl.com 에서)
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = bearerToken(request);
      if (token) await authStore(env).logout(token);
      return json({ ok: true });
    }

    // 방을 만들거나 들어가려면 로그인이 필요하다. (개발할 때는 REQUIRE_AUTH=false)
    // 게스트(학번 + 이름)는 게스트 방에 GL 로그인 없이 들어올 수 있다. (방이 게스트 방인지는 방에서 다시 확인한다.)
    const isWs = parts.length === 2 && parts[0] === "ws";
    const guest = isWs ? parseGuest(url.searchParams.get("guest"), url.searchParams.get("name")) : null;
    const guestWs = !!guest && url.searchParams.get("spectate") !== "1";
    const needsLogin = enabled && ((request.method === "POST" && url.pathname === "/api/rooms") || (isWs && !guestWs));
    // hybrid(개발 서버): 로그인은 필요 없지만, 로그인한 사람이면 그 계정으로 방에 들어가고 전적이 남는다.
    const mayLogin = authMode(env) === "hybrid" && ((request.method === "POST" && url.pathname === "/api/rooms") || isWs);
    const user = needsLogin || mayLogin ? await identify(env, request) : null;
    if (needsLogin && !user) {
      return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
    }

    // POST /api/rooms -> 새 방을 만들고 4자리 코드를 돌려준다.
    if (request.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "rooms") {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        // 기본은 체스판 자동 전투. 옛 레인 타워 게임은 ?mode=lanes
        const mode = url.searchParams.get("mode") === "lanes" ? "lanes" : "chess";
        // 게스트 방(?guest=1): GL 계정으로 로그인한 사람이 만들고, 학번과 이름만으로 들어올 수 있다. 전적은 남기지 않는다.
        const guestRoom = url.searchParams.get("guest") === "1";
        // 무한 모드(?mobius=1): 앞뒷면·이음매·웜홀이 있는 뫼비우스 규칙으로 싸운다.
        const mobius = url.searchParams.get("mobius") === "1" && mode === "chess";
        if (await roomStub(env, code).init(code, false, mode, false, guestRoom, user?.nickname ?? "", user?.id ?? "", mobius)) {
          return json({ code }, 201);
        }
      }
      return json({ error: "could_not_create_room" }, 503);
    }

    // GET /api/live -> 진행 중인 게스트 방 목록 (관전할 곳 고르기). GL 로그인이 필요하다. mine은 내가 만든 방(지울 수 있다)이다.
    // GET /api/my-rooms -> 내가 만든 방(게스트 방과 일반 방) 목록.
    if (request.method === "GET" && (url.pathname === "/api/live" || url.pathname === "/api/my-rooms")) {
      const me = await identify(env, request);
      if (enabled && !me) return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
      try {
        const all = await env.LIVE.get(env.LIVE.idFromName("global")).list();
        const isMine = (r: { hostId: string; host: string }): boolean =>
          !enabled || (!!me && (r.hostId ? r.hostId === me.id : r.host !== "" && r.host === me.nickname));
        const publicRoom = ({ hostId: _hostId, ...rest }: (typeof all)[number]) => ({ ...rest, mine: isMine({ hostId: _hostId, host: rest.host }) });
        const rooms = url.pathname === "/api/live"
          ? all.filter((r) => r.guest).map(publicRoom)
          : all.filter((r) => isMine({ hostId: r.hostId, host: r.host })).map(publicRoom);
        return json({ rooms });
      } catch {
        return json({ error: "live_unavailable" }, 503);
      }
    }

    // POST /api/rooms/:code/close -> 방을 닫는다 (만든 사람만). 모두의 연결이 끊기고 방의 내용이 지워진다.
    if (request.method === "POST" && parts.length === 4 && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "close") {
      const code = (parts[2] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      const me = await identify(env, request);
      if (enabled && !me) return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
      const result = await roomStub(env, code).close(me ? { id: me.id, nickname: me.nickname } : null, enabled);
      if (result === "not_found") return json({ error: "room_not_found" }, 404);
      if (result === "forbidden") return json({ error: "forbidden", message: "방을 만든 사람만 닫을 수 있어요." }, 403);
      return json({ ok: true });
    }

    // ---- 빠른 대전 매칭 ----
    // POST /api/match/join -> 줄을 선다. 비슷한 레이팅의 상대가 있으면 바로 방 코드를 돌려준다.
    // GET /api/match/poll?ticket= -> 기다리는 중이면 waiting, 짝이 지어지면 방 코드. POST /api/match/cancel?ticket= -> 줄에서 나온다.
    if (parts.length === 3 && parts[0] === "api" && parts[1] === "match") {
      const me = await identify(env, request);
      if (enabled && !me) return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
      const matchmaker = env.MATCH.get(env.MATCH.idFromName("global"));
      if (request.method === "POST" && parts[2] === "join") {
        const name = (me?.nickname ?? url.searchParams.get("name") ?? "Player").slice(0, 16);
        const userId = me?.id ?? `anon:${name}`;
        let rating = 1000;
        if (me) {
          try {
            rating = (await rankingStoreOf(env).getPlayerStats(me.id))?.rating ?? 1000;
          } catch {
            rating = 1000; // 랭킹 DB가 준비되지 않아도 매칭은 된다
          }
        }
        return json(await matchmaker.join({ userId, name, rating }));
      }
      if (request.method === "GET" && parts[2] === "poll") {
        const status = await matchmaker.poll(url.searchParams.get("ticket") ?? "");
        return status ? json(status) : json({ error: "ticket_expired" }, 404);
      }
      if (request.method === "POST" && parts[2] === "cancel") {
        return json({ ok: await matchmaker.cancel(url.searchParams.get("ticket") ?? "") });
      }
    }

    // GET /api/characters -> 캐릭터 12명의 데이터 (이름, 기물, 능력치).
    if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "characters") {
      return json({ characters: CHARACTERS });
    }

    // GET /api/replays/:id -> 끝난 판의 다시 보기 데이터 (id는 내 전적 목록의 id).
    if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "replays") {
      try {
        const data = await rankingStoreOf(env).getReplay(decodeURIComponent(parts[2] ?? ""));
        if (!data) return json({ error: "replay_not_found" }, 404);
        return new Response(data, { headers: { "content-type": "application/json", ...CORS_HEADERS } });
      } catch {
        return json({ error: "replay_unavailable" }, 503);
      }
    }

    // GET /api/leaderboard?limit=20 -> 레이팅 순위. 로그인했다면 내 줄에 isMe가 붙는다.
    if (request.method === "GET" && url.pathname === "/api/leaderboard") {
      const me = await identify(env, request);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      try {
        const entries = await rankingStoreOf(env).getLeaderboard(Number.isFinite(limit) ? limit : 20, me?.id ?? null);
        return json({ entries });
      } catch {
        return json({ error: "ranking_unavailable" }, 503);
      }
    }
    // GET /api/me/stats, /api/me/matches -> 내 전적 (로그인 필요)
    if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "me") {
      const me = await identify(env, request);
      if (!me) return json({ error: "unauthorized", loginUrl: `${origin}/auth/login` }, 401);
      try {
        if (parts[2] === "stats") return json({ stats: await rankingStoreOf(env).getPlayerStats(me.id) });
        if (parts[2] === "matches") {
          const limit = Number(url.searchParams.get("limit") ?? 10);
          return json({ matches: await rankingStoreOf(env).getRecentMatches(me.id, Number.isFinite(limit) ? limit : 10) });
        }
      } catch {
        return json({ error: "ranking_unavailable" }, 503);
      }
    }

    // GET /sidestore.json -> SideStore(AltStore 호환) 소스. SideStore에서 "소스 추가"에 이 주소를 넣는다.
    if (request.method === "GET" && url.pathname === "/sidestore.json") {
      return sideStoreSource(origin);
    }

    // GET /api/chess -> 체스판 자동 전투의 캐릭터 20명과 기물 시너지.
    if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "chess") {
      return json({
        units: roster().map(({ id, nameKo, piece, faction, cost, role, hp, atk, abilityText, passive, evolveOnly, promotesTo }) => ({
          id, nameKo, piece, faction, cost, role, hp, atk, abilityText, passive, ...(evolveOnly ? { evolveOnly: true } : {}),
          ...(promotesTo ? { promotesTo } : {}),
        })),
        synergies: ALL_SYNERGIES.map(({ id, piece, need, tier, nameKo, text }) => ({ id, piece, need, tier, nameKo, text })),
        // 계보 시너지(기물 종류가 아닌 묶음). 오래된 앱이 synergies 의 piece 를 해석하지 못하지 않게 따로 보낸다.
        traits: LINEAGE_TRAITS.map(({ id, nameKo, need, tier, text, members }) => ({ id, nameKo, need, tier, text, members })),
        // 데도키온의 진화 규칙 (진행 막대를 그리는 데 쓴다)
        evolution: EVOLUTION,
        materials: materials().map((m) => ({ ...m, price: MARKET_PRICE[m.rarity] })),
        weapons: chessWeapons(),
        // 조합: 재료 조합표(재료 둘 -> 한 단계 위 재료)와 무기 조합의 효과 배율
        fusions: fusions(),
        crafting: { starPower: STAR_POWER, hybridPower: HYBRID_POWER },
        // 규칙 묶음 이름: 클라이언트가 도감을 다시 받아야 하는지 알 수 있다. (공식이면 "official")
        ruleset: currentRuleset(),
      });
    }

    // GET /api/synergies -> 캐릭터 시너지 목록 (이름, 조건, 효과 설명).
    if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "synergies") {
      return json({
        synergies: SYNERGIES.map(({ id, nameKo, requirement, description }) => ({ id, nameKo, requirement, description })),
      });
    }

    // GET /api/weapons -> 무기 목록과 레시피.
    if (request.method === "GET" && parts.length === 2 && parts[0] === "api" && parts[1] === "weapons") {
      return json({ weapons: WEAPONS });
    }

    // GET /api/rooms/:code -> 방이 있는지, 들어갈 수 있는지.
    if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "rooms") {
      const code = (parts[2] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      if (isTestCode(code)) {
        // 아직 만들어지지 않았어도 들어갈 수 있다. (들어가는 순간 만들어진다)
        const me = await identify(env, request);
        const info = me || !enabled ? await testRoomStub(env, testOwner(me, request), testKind(code)).info() : null;
        return json(info ?? { code, phase: "lobby", players: 0, joinable: true, mode: "chess" });
      }
      const info = await roomStub(env, code).info();
      return info ? json(info) : json({ error: "room_not_found" }, 404);
    }

    // GET /ws/:code?name=...&token=... -> WebSocket으로 방에 들어간다.
    if (parts.length === 2 && parts[0] === "ws") {
      const code = (parts[1] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      const forwarded = new Request(request);
      forwarded.headers.delete(USER_HEADER);
      forwarded.headers.delete(GUEST_HEADER);
      const access = wsAccess({ authRequired: enabled, hasGlUser: !!user, guest, spectate: url.searchParams.get("spectate") === "1" });
      if (!access.ok) return json({ error: access.error, loginUrl: `${origin}/auth/login` }, 401);
      if (user) forwarded.headers.set(USER_HEADER, JSON.stringify({ id: user.id, nickname: user.nickname }));
      else if (guest && guestWs) forwarded.headers.set(GUEST_HEADER, JSON.stringify(guest));
      if (isTestCode(code)) {
        const kind = testKind(code);
        const stub = testRoomStub(env, testOwner(user, request), kind);
        await stub.init(code, true, "chess", kind === "lite", false, "", "", kind === "infinite"); // 이미 있으면 false를 돌려줄 뿐이다
        return stub.fetch(forwarded);
      }
      return roomStub(env, code).fetch(forwarded);
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "edbot-server" });
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
