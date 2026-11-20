import { describe, expect, it, vi } from "vitest";
import { VERIFY_CACHE_MS, authRequired, loginRedirectUrl, readCookie, verifyGlSession } from "../src/auth";
import { escapeHtml } from "../src/pages";
import { createRoom, joinRoom } from "../src/room-state";

const glUser = { id: "u-1", email: "a@b.c", username: "ed", nickname: "에드", emailVerified: true };
const okFetch = () => vi.fn(async () => new Response(JSON.stringify({ user: glUser }), { status: 200 }));

describe("GL Account 세션 검증", () => {
  it("키와 토큰을 담아 verify-session을 부르고, 이메일은 빼고 돌려준다", async () => {
    const fetcher = okFetch();
    const user = await verifyGlSession({ GL_ACCOUNT_KEY: "secret-key" }, "tok-a", 1_000, fetcher as never);
    expect(user).toEqual({ id: "u-1", username: "ed", nickname: "에드", emailVerified: true });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://account.officialgl.com/api/internal/verify-session");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
    expect(JSON.parse(init.body as string)).toEqual({ token: "tok-a" });
  });

  it("30초 안에는 캐시를 쓰고 그 뒤에는 다시 묻는다", async () => {
    const fetcher = okFetch();
    await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-b", 1_000, fetcher as never);
    await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-b", 1_000 + VERIFY_CACHE_MS - 1, fetcher as never);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-b", 1_000 + VERIFY_CACHE_MS, fetcher as never);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("401이면 비로그인, 장애(500)나 네트워크 오류도 비로그인이지만 캐시하지 않는다", async () => {
    const unauthorized = vi.fn(async () => new Response("{}", { status: 401 }));
    expect(await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-c", 0, unauthorized as never)).toBeNull();
    const broken = vi.fn(async () => new Response("", { status: 500 }));
    expect(await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-d", 0, broken as never)).toBeNull();
    await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-d", 1, broken as never);
    expect(broken).toHaveBeenCalledTimes(2);
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await verifyGlSession({ GL_ACCOUNT_KEY: "k" }, "tok-e", 0, down as never)).toBeNull();
  });

  it("키가 설정되지 않았으면 GL Account를 부르지 않는다", async () => {
    const fetcher = okFetch();
    expect(await verifyGlSession({}, "tok-f", 0, fetcher as never)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("도우미", () => {
  it("쿠키에서 gl_session을 찾는다", () => {
    expect(readCookie("a=1; gl_session=abc%20d; b=2", "gl_session")).toBe("abc d");
    expect(readCookie("a=1", "gl_session")).toBeNull();
    expect(readCookie(null, "gl_session")).toBeNull();
  });
  it("돌아올 주소를 인코딩해서 로그인 주소를 만든다", () => {
    expect(loginRedirectUrl("https://edgame-api.officialgl.com/auth/done?login=x")).toBe(
      "https://account.officialgl.com/?return=https%3A%2F%2Fedgame-api.officialgl.com%2Fauth%2Fdone%3Flogin%3Dx",
    );
  });
  it("REQUIRE_AUTH=false일 때만 로그인 검사를 끈다", () => {
    expect(authRequired({})).toBe(true);
    expect(authRequired({ REQUIRE_AUTH: "false" })).toBe(false);
  });
  it("HTML을 이스케이프한다", () => {
    expect(escapeHtml('<script>"x"&</script>')).not.toContain("<");
  });
});

describe("방에 들어올 때", () => {
  it("같은 GL 계정은 토큰이 없어도 원래 자리로 돌아온다", () => {
    let n = 0;
    const state = createRoom("ABCD", 0);
    const first = joinRoom(state, { name: "에드", userId: "u-1" }, 0, () => `id${++n}`);
    const again = joinRoom(state, { name: "에드", userId: "u-1" }, 1, () => `id${++n}`);
    expect(first.ok && again.ok && again.reconnected && again.player.id === first.player.id).toBe(true);
    expect(state.players).toHaveLength(1);
  });
});
