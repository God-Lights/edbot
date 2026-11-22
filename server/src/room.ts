import { DurableObject } from "cloudflare:workers";
import { USER_HEADER } from "./auth";
import { GUEST_HEADER, guestUserId, parseGuest } from "./guest";
import type { LiveRoom } from "./liveboard";
import { runBotUntilIdle } from "./bot";
import { matchIdOf, rankingStoreOf } from "./ranking/store";
import { parseClientMessage } from "./protocol";
import type { ErrorCode, ServerMessage } from "./protocol";
import {
  addBotIfNeeded, setBotLevel,
  advancePhase,
  buildReplay,
  canCloseRoom,
  createRoom,
  isExpired,
  joinRoom,
  nextDeadline,
  playerBan,
  playerChess,
  playerLock,
  playerExplore,
  playerForge,
  playerMoveLane,
  playerPick,
  playerPlace,
  playerSurrender,
  playerUltimate,
  pruneLobby,
  setDisconnected,
  setReady,
  takeMatchRecord,
  toSnapshot,
} from "./room-state";
import type { ActionOutcome, RoomState } from "./room-state";

const STATE_KEY = "state";

/** 소켓에 붙여 두는 값. 소켓이 잠들었다 깨어나도 누구의 소켓인지 알 수 있다. */
interface SocketAttachment {
  playerId: string;
  /** 관전자 (플레이어가 아니다) */
  spectator?: boolean;
}

const SPECTATOR_TAG = "spectator";
const MAX_SPECTATORS = 8;

export interface RoomInfo {
  code: string;
  phase: string;
  players: number;
  joinable: boolean;
  mode: string;
  /** 게스트 방 (학번과 이름으로 들어올 수 있다) */
  guest: boolean;
  /** 무한 모드(뫼비우스 규칙) */
  mobius: boolean;
}

/**
 * 방 하나 = Durable Object 하나.
 * 방의 모든 상태는 여기서만 바뀌고, 그 결과를 연결된 소켓에 그대로 뿌린다.
 * WebSocket Hibernation을 써서, 아무도 메시지를 보내지 않는 동안에는 메모리에서 내려가
 * 비용이 거의 들지 않는다. 단계 타이머는 알람(alarm)이 깨워 준다.
 */
export class Room extends DurableObject<Env> {
  private state: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>(STATE_KEY)) ?? null;
    });
  }

  private get scale(): number {
    const value = Number(this.env.PHASE_SCALE);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  // ---- Worker가 부르는 RPC ----

  /** 방을 처음 만든다. 이미 있으면 false. (코드가 겹쳤을 때 Worker가 다른 코드로 다시 시도한다.) */
  async init(code: string, testMatch = false, mode: "lanes" | "chess" = "chess", lite = testMatch, guest = false, hostName = "", hostId = "", mobius = false): Promise<boolean> {
    if (this.state) return false;
    this.state = createRoom(code, Date.now(), testMatch, mode, lite, guest, hostName, hostId, mobius);
    await this.persist();
    return true;
  }

  /**
   * 방을 닫는다: 모두에게 알리고 연결을 끊고, 방의 모든 저장 내용(알람 포함)을 지운다.
   * enforce가 false면(로그인 검사를 끈 개발 서버) 누구나 닫을 수 있다.
   */
  async close(requester: { id: string; nickname: string } | null, enforce: boolean): Promise<"ok" | "forbidden" | "not_found"> {
    const state = this.state;
    if (!state) return "not_found";
    if (enforce && (!requester || !canCloseRoom(state, requester))) return "forbidden";
    for (const ws of this.ctx.getWebSockets()) {
      try {
        sendTo(ws, { t: "error", code: "room_closed", message: "방이 닫혔다." });
        ws.close(1000, "room_closed");
      } catch {
        // 이미 닫힌 소켓
      }
    }
    this.state = null;
    await this.ctx.storage.deleteAll(); // 알람도 함께 지워진다
    try {
      await this.env.LIVE.get(this.env.LIVE.idFromName("global")).remove(state.code);
    } catch {
      // 목록에서 못 지워도 20분 뒤에는 사라진다
    }
    return "ok";
  }

  async info(): Promise<RoomInfo | null> {
    if (!this.state) return null;
    return {
      code: this.state.code,
      phase: this.state.phase,
      players: this.state.players.length,
      joinable: this.state.phase === "lobby" && this.state.players.length < 2,
      mode: this.state.mode,
      guest: this.state.guest ?? false,
      mobius: this.state.mobius === true,
    };
  }

  // ---- WebSocket 연결 ----

  async fetch(request: Request): Promise<Response> {
    if (!this.state) return jsonResponse({ error: "room_not_found" }, 404);
    if (request.headers.get("Upgrade") !== "websocket") {
      return jsonResponse({ error: "expected_websocket" }, 426);
    }

    const url = new URL(request.url);
    const now = Date.now();
    // Worker가 GL Account로 확인한 사용자. 로그인한 사람은 닉네임이 이름이 된다.
    let glUser: { id: string; nickname: string } | null = null;
    try {
      const raw = request.headers.get(USER_HEADER);
      if (raw) glUser = JSON.parse(raw) as { id: string; nickname: string };
    } catch {
      glUser = null;
    }
    // Worker가 확인한 게스트(학번과 이름). 게스트 방에서만 받아 준다.
    let guest: ReturnType<typeof parseGuest> = null;
    try {
      const raw = request.headers.get(GUEST_HEADER);
      if (raw) {
        const parsed = JSON.parse(raw) as { studentId?: string; name?: string };
        guest = parseGuest(parsed.studentId, parsed.name);
      }
    } catch {
      guest = null;
    }
    if (url.searchParams.get("spectate") === "1") return this.acceptSpectator(now);
    if (guest && !this.state.guest) return this.rejectSocket("unauthorized", "게스트로 들어갈 수 있는 방이 아니에요. 로그인이 필요해요.");
    const result = joinRoom(
      this.state,
      {
        name: guest?.name ?? glUser?.nickname ?? url.searchParams.get("name") ?? "",
        token: url.searchParams.get("token") ?? undefined,
        userId: guest ? guestUserId(guest) : glUser?.id,
        guestId: guest?.studentId,
      },
      now,
      () => crypto.randomUUID(),
    );

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];

    if (!result.ok) {
      // 거절할 때도 소켓은 열어서 이유를 알려 준 뒤 닫는다. (HTTP 오류보다 클라이언트가 처리하기 쉽다.)
      this.ctx.acceptWebSocket(server);
      sendTo(server, { t: "error", code: result.code, message: result.message });
      server.close(1008, result.code);
      return new Response(null, { status: 101, webSocket: client });
    }

    const { player } = result;
    // 같은 사람이 다시 접속하면 이전 소켓은 정리한다.
    for (const old of this.ctx.getWebSockets(player.id)) old.close(4000, "replaced");

    this.ctx.acceptWebSocket(server, [player.id]);
    server.serializeAttachment({ playerId: player.id } satisfies SocketAttachment);

    // 테스트 대전(ADMN)이면 상대 자리에 봇을 앉힌다. ?level=easy|normal|hard 로 봇 난이도를 고를 수 있다.
    const level = url.searchParams.get("level");
    if (level) setBotLevel(this.state, level);
    if (addBotIfNeeded(this.state)) runBotUntilIdle(this.state, now, this.scale, Math.random);
    await this.persist();
    sendTo(server, {
      t: "welcome",
      playerId: player.id,
      token: player.token,
      room: toSnapshot(this.state, now, player.id),
    });
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 소켓을 열어 이유를 알려 주고 닫는다. (HTTP 오류보다 클라이언트가 처리하기 쉽다.) */
  private rejectSocket(code: ErrorCode, message: string): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    sendTo(server, { t: "error", code, message });
    server.close(1008, code);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 관전자로 들어온다. 전투만 볼 수 있고(준비 단계의 상점·배치는 안 보인다) 아무것도 조작할 수 없다. */
  private acceptSpectator(now: number): Response {
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    const state = this.state!;
    const reject = (code: ErrorCode, message: string) => {
      this.ctx.acceptWebSocket(server);
      sendTo(server, { t: "error", code, message });
      server.close(1008, code);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (state.mode !== "chess" || state.testMatch) return reject("spectate_unavailable", "이 방은 관전할 수 없다.");
    if (this.ctx.getWebSockets(SPECTATOR_TAG).length >= MAX_SPECTATORS) return reject("room_full", "관전자가 가득 찼다.");
    this.ctx.acceptWebSocket(server, [SPECTATOR_TAG]);
    server.serializeAttachment({ playerId: "", spectator: true } satisfies SocketAttachment);
    sendTo(server, { t: "welcome", playerId: "spectator", token: "", room: toSnapshot(state, now, undefined) });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.state) return;
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;
    if (attachment.spectator) {
      // 관전자는 ping만 보낼 수 있다.
      const spectatorMsg = parseClientMessage(message);
      if (spectatorMsg?.t === "ping") sendTo(ws, { t: "pong", ts: spectatorMsg.ts, serverTime: Date.now() });
      else sendTo(ws, { t: "error", code: "wrong_phase", message: "관전 중에는 할 수 없다." });
      return;
    }

    const msg = parseClientMessage(message);
    if (!msg) {
      sendTo(ws, { t: "error", code: "bad_message", message: "알 수 없는 메시지다." });
      return;
    }

    const now = Date.now();
    const playerId = attachment.playerId;
    const scale = this.scale;
    switch (msg.t) {
      case "ping":
        sendTo(ws, { t: "pong", ts: msg.ts, serverTime: now });
        return;
      case "ready": {
        const result = setReady(this.state, playerId, msg.ready, now, scale);
        await this.finishAction(ws, result);
        return;
      }
      case "ban":
        await this.finishAction(ws, playerBan(this.state, playerId, msg.characterId, now, scale));
        return;
      case "pick":
        await this.finishAction(ws, playerPick(this.state, playerId, msg.characterId, now, scale));
        return;
      case "place":
        await this.finishAction(
          ws,
          playerPlace(this.state, playerId, msg.characterId, msg.lane, now, scale),
        );
        return;
      case "lock":
        await this.finishAction(ws, playerLock(this.state, playerId, now, scale));
        return;
      case "ultimate":
        await this.finishAction(
          ws,
          playerUltimate(this.state, playerId, msg.characterId, msg.lane, now, scale),
        );
        return;
      case "buy":
      case "sell":
      case "reroll":
      case "market":
      case "smelt":
      case "equip":
      case "unequip":
      case "combine":
      case "deploy":
      case "bench":
      case "done":
        await this.finishAction(ws, playerChess(this.state, playerId, msg, now, scale));
        return;
      case "surrender":
        await this.finishAction(ws, playerSurrender(this.state, playerId, now, scale));
        return;
      case "forge":
        await this.finishAction(ws, playerForge(this.state, playerId, msg, now, scale));
        return;
      case "explore":
        await this.finishAction(
          ws,
          playerExplore(this.state, playerId, msg.action, msg.tile, now, scale),
        );
        return;
      case "move":
        await this.finishAction(
          ws,
          playerMoveLane(this.state, playerId, msg.characterId, msg.lane, now, scale),
        );
        return;
    }
  }

  /** 선택이 받아들여졌으면 저장하고 모두에게 알리고, 거절되었으면 보낸 사람에게만 이유를 알린다. */
  private async finishAction(
    ws: WebSocket,
    result: ActionOutcome | { ok: true; started: boolean } | { ok: false; code: ErrorCode; message: string },
  ): Promise<void> {
    if (!result.ok) {
      sendTo(ws, { t: "error", code: result.code, message: result.message });
      return;
    }
    runBotUntilIdle(this.state!, Date.now(), this.scale, Math.random);
    await this.persist();
    this.broadcast();
    await this.recordIfFinished();
  }

  /** 판이 끝났으면 전적과 레이팅을 D1에 저장하고, 레이팅 변화를 결과에 담아 다시 알린다. */
  private async recordIfFinished(): Promise<void> {
    if (!this.state) return;
    const match = takeMatchRecord(this.state, Date.now(), this.env.RECORD_ANONYMOUS === "true");
    if (!match) return;
    try {
      const store = rankingStoreOf(this.env);
      const ratings = await store.recordMatch(match);
      if (ratings && this.state.result) {
        this.state.result.ratings = [ratings[0], ratings[1]];
        const replay = buildReplay(this.state);
        if (replay) await store.saveReplay(matchIdOf(match.roomCode, match.startedAt), replay);
      }
    } catch (error) {
      // 랭킹 저장이 실패해도 판 진행에는 영향이 없다. (예: 아직 마이그레이션을 적용하지 않았을 때)
      console.error("전적 저장 실패", error instanceof Error ? error.message : error);
    }
    await this.persist();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    closeQuietly(ws, code, reason);
    await this.handleSocketGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleSocketGone(ws);
  }

  private async handleSocketGone(ws: WebSocket): Promise<void> {
    if (!this.state) return;
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || attachment.spectator) return; // 거절된 소켓, 관전자 등 플레이어와 연결되지 않은 소켓
    const stillOpen = this.ctx
      .getWebSockets(attachment.playerId)
      .some((other) => other !== ws && other.readyState === WebSocket.OPEN);
    if (stillOpen) return; // 재접속으로 새 소켓이 이미 있다
    setDisconnected(this.state, attachment.playerId, Date.now());
    await this.persist();
    this.broadcast();
  }

  // ---- 단계 타이머 ----

  async alarm(): Promise<void> {
    if (!this.state) return;
    const now = Date.now();

    if (isExpired(this.state, now)) {
      try { await this.env.LIVE.get(this.env.LIVE.idFromName("global")).remove(this.state.code); } catch { /* 무시 */ }
      this.state = null;
      await this.ctx.storage.deleteAll(); // 알람도 함께 지워진다
      return;
    }

    const pruned = pruneLobby(this.state, now);
    const advanced = advancePhase(this.state, now, this.scale);
    const botActed = runBotUntilIdle(this.state, now, this.scale, Math.random);
    if (pruned || advanced || botActed) {
      await this.persist();
      this.broadcast();
      await this.recordIfFinished();
    } else {
      await this.reschedule();
    }
  }

  // ---- 내부 도구 ----

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put(STATE_KEY, this.state);
    await this.reschedule();
    await this.reportLive();
  }

  private lastLiveSignature = "";

  /** 게스트 방이면 진행 상황을 관전 목록(LiveRegistry)에 알린다. 단계·라운드·사람이 바뀔 때만 보낸다. */
  private async reportLive(): Promise<void> {
    const state = this.state;
    if (!state || state.testMatch) return; // 테스트 대전(봇) 방은 사람마다 따로 있어서 목록에 올리지 않는다
    const hps = state.chess ? ([state.chess.players[0].hp, state.chess.players[1].hp] as [number, number]) : null;
    const room: LiveRoom = {
      code: state.code,
      host: state.hostName,
      hostId: state.hostId ?? "",
      guest: state.guest ?? false,
      players: state.players.map((p) => ({ name: p.name, studentId: p.guestId, connected: p.connected })),
      phase: state.phase,
      round: state.chess?.round ?? 0,
      maxRounds: 8,
      hps,
      updatedAt: Date.now(),
    };
    const signature = JSON.stringify([room.phase, room.round, room.players, room.hps]);
    if (signature === this.lastLiveSignature) return;
    this.lastLiveSignature = signature;
    try {
      await this.env.LIVE.get(this.env.LIVE.idFromName("global")).upsert(room);
    } catch {
      // 목록이 잠깐 안 갱신돼도 게임에는 영향이 없다.
    }
  }

  private async reschedule(): Promise<void> {
    const deadline = this.state ? nextDeadline(this.state) : null;
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  /** 모두에게 현재 상태를 보낸다. 밴과 배치는 상대에게 숨겨야 해서 소켓마다 따로 만든다. */
  private broadcast(): void {
    if (!this.state) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      let viewerId: string | undefined;
      try {
        const attached = ws.deserializeAttachment() as SocketAttachment | null;
        viewerId = attached?.spectator ? undefined : attached?.playerId;
        const message: ServerMessage = { t: "state", room: toSnapshot(this.state, now, viewerId) };
        ws.send(JSON.stringify(message));
      } catch {
        // 이미 닫힌 소켓. close 이벤트가 따로 정리한다.
      }
    }
  }
}

function sendTo(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

/**
 * 상대가 보낸 종료 코드를 그대로 돌려주면 1005, 1006 같은 "보낼 수 없는 코드"에서 예외가 난다.
 * 보낼 수 있는 코드로 바꿔서 닫고, 이미 닫혀 있어도 조용히 넘어간다.
 */
function closeQuietly(ws: WebSocket, code: number, reason: string): void {
  const sendable = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 && code !== 1015;
  try {
    ws.close(sendable ? code : 1000, reason.slice(0, 100));
  } catch {
    // 이미 닫힌 소켓
  }
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type { ErrorCode };
