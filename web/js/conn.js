// 방에 연결한다: WebSocket, ping, 끊겼을 때 token으로 자동 재접속, 서버 시계 보정.

import { FATAL } from "./util.js";

const BACKOFF = [500, 1000, 2000, 4000, 8000];
const MAX_ATTEMPTS = 8;
const PING_MS = 5000;

const tokenKey = (code) => `edbot.token.${code}`;
const loadToken = (code) => {
  try { return localStorage.getItem(tokenKey(code)); } catch { return null; }
};
const saveToken = (code, token) => {
  try { localStorage.setItem(tokenKey(code), token); } catch { /* 저장이 막혀도 게임은 된다 */ }
};

export class Connection {
  /** @param {(event: object) => void} onEvent connected | state | error | reconnecting | closed */
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.ws = null;
    this.code = null;
    this.name = "";
    this.stopped = true;
    this.attempt = 0;
    this.pingTimer = null;
    /** 서버 시각 - 내 시각 (ms) */
    this.offset = 0;
    this.playerId = null;
  }

  start(code, name) {
    this.stop();
    this.code = code;
    this.name = name;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      try { ws.close(1000, "stopped"); } catch { /* 이미 닫힘 */ }
    }
  }

  open() {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams();
    if (this.name) params.set("name", this.name);
    const token = loadToken(this.code);
    if (token) params.set("token", token);
    const ws = new WebSocket(`${scheme}://${location.host}/ws/${this.code}?${params}`);
    this.ws = ws;
    let welcomed = false;

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.t) {
        case "welcome":
          welcomed = true;
          this.attempt = 0;
          this.playerId = msg.playerId;
          saveToken(this.code, msg.token);
          this.observe(msg.room);
          this.onEvent({ type: "connected", playerId: msg.playerId, room: msg.room });
          clearInterval(this.pingTimer);
          this.pingTimer = setInterval(() => this.send({ t: "ping", ts: Date.now() }), PING_MS);
          break;
        case "state":
          this.observe(msg.room);
          this.onEvent({ type: "state", room: msg.room });
          break;
        case "error":
          this.onEvent({ type: "error", code: msg.code, message: msg.message });
          if (FATAL.has(msg.code)) this.stop();
          break;
        default:
          break;
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.stopped || this.ws !== ws) return;
      if (!welcomed && this.attempt === 0) {
        // 처음부터 열리지 않았다 (로그인 안 됨, 방 없음 등은 error로 먼저 알려 준다)
      }
      if (this.attempt >= MAX_ATTEMPTS) {
        this.onEvent({ type: "closed", reason: "failed" });
        return;
      }
      const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
      this.attempt += 1;
      this.onEvent({ type: "reconnecting", attempt: this.attempt });
      setTimeout(() => { if (!this.stopped) this.open(); }, wait);
    };
  }

  observe(room) {
    if (room && typeof room.serverTime === "number") this.offset = room.serverTime - Date.now();
  }

  serverNow() { return Date.now() + this.offset; }

  /** 서버 시각 target까지 남은 ms (이미 지났으면 0). target이 없으면 null */
  remainingMs(target) {
    return target == null ? null : Math.max(0, target - this.serverNow());
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }
}
