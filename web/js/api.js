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
  /** 빠른 대전 줄서기. { ticket, status, code } 또는 { error } */
  async matchJoin(name) {
    const r = await request(`/api/match/join?name=${encodeURIComponent(name)}`, { method: "POST" });
    return r.ok ? r.body : { error: r.body?.error ?? "match_failed", status: r.status };
  },
  async matchPoll(ticket) {
    const r = await request(`/api/match/poll?ticket=${encodeURIComponent(ticket)}`);
    return r.ok ? r.body : { error: r.body?.error ?? "ticket_expired" };
  },
  async matchCancel(ticket) {
    await request(`/api/match/cancel?ticket=${encodeURIComponent(ticket)}`, { method: "POST" });
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
