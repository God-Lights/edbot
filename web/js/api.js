// 서버의 HTTP API. 같은 출처라서 로그인 쿠키(gl_session)가 자동으로 간다.

async function request(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

export const api = {
  /** 로그인한 사용자. 안 했으면 null */
  async me() {
    const r = await request("/api/auth/me");
    return r.ok ? r.body.user : null;
  },
  /** 새 방을 만들고 코드를 돌려준다. 실패하면 { error } */
  async createRoom() {
    const r = await request("/api/rooms", { method: "POST" });
    if (r.status === 201 || r.ok) return { code: r.body.code };
    return { error: r.body?.error ?? "could_not_create_room", status: r.status };
  },
  async room(code) {
    const r = await request(`/api/rooms/${encodeURIComponent(code)}`);
    return r.ok ? r.body : null;
  },
  async chessCatalog() {
    const r = await request("/api/chess");
    return r.ok ? r.body : null;
  },
  async leaderboard(limit = 20) {
    const r = await request(`/api/leaderboard?limit=${limit}`);
    return r.ok ? r.body.entries : { error: r.status };
  },
  async myStats() {
    const r = await request("/api/me/stats");
    return r.ok ? r.body.stats : null;
  },
  async myMatches(limit = 10) {
    const r = await request(`/api/me/matches?limit=${limit}`);
    return r.ok ? r.body.matches : [];
  },
};
