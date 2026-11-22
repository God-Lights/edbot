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
  /** 이 서버의 이름·환경·로그인 방식·에디션·프로토콜 버전. 오래된 서버(이 API가 없는)면 null */
  async server() {
    const r = await request("/api/server");
    return r.ok && r.body && typeof r.body.protocol === "number" ? r.body : null;
  },
  async me() {
    const r = await request("/api/auth/me");
    return r.ok ? r.body.user : null;
  },
  /** 새 방을 만들고 코드를 돌려준다. 실패하면 { error } */
  async createRoom(guest = false, mobius = false) {
    const query = [guest ? "guest=1" : "", mobius ? "mobius=1" : ""].filter(Boolean).join("&");
    const r = await request(`/api/rooms${query ? `?${query}` : ""}`, { method: "POST" });
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
  /** 끝난 판의 다시 보기 데이터. 없으면 null */
  async replay(id) {
    const r = await request(`/api/replays/${encodeURIComponent(id)}`);
    return r.ok ? r.body : null;
  },
  /** 진행 중인 게스트 방 목록 (GL 로그인 필요). 실패하면 { error } */
  async live() {
    const r = await request("/api/live");
    return r.ok ? r.body.rooms : { error: r.status };
  },
  /** 내가 만든 방 목록 (게스트 방과 일반 방). 실패하면 { error } */
  async myRooms() {
    const r = await request("/api/my-rooms");
    return r.ok ? r.body.rooms : { error: r.status };
  },
  /** 방을 닫는다 (만든 사람만). { ok } 또는 { error, status } */
  async closeRoom(code) {
    const r = await request(`/api/rooms/${encodeURIComponent(code)}/close`, { method: "POST" });
    return r.ok ? { ok: true } : { error: r.body?.error ?? "close_failed", status: r.status, message: r.body?.message };
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
