import { DurableObject } from "cloudflare:workers";
import { parseClientMessage } from "./protocol";
import type { ErrorCode, ServerMessage } from "./protocol";
import {
  advancePhase,
  createRoom,
  isExpired,
  joinRoom,
  nextDeadline,
  playerBan,
  playerLock,
  playerPick,
  playerPlace,
  pruneLobby,
  setDisconnected,
  setReady,
  toSnapshot,
} from "./room-state";
import type { ActionOutcome, RoomState } from "./room-state";

const STATE_KEY = "state";

/** 소켓에 붙여 두는 값. 소켓이 잠들었다 깨어나도 누구의 소켓인지 알 수 있다. */
interface SocketAttachment {
  playerId: string;
}

export interface RoomInfo {
  code: string;
  phase: string;
  players: number;
  joinable: boolean;
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
  async init(code: string): Promise<boolean> {
    if (this.state) return false;
    this.state = createRoom(code, Date.now());
    await this.persist();
    return true;
  }

  async info(): Promise<RoomInfo | null> {
    if (!this.state) return null;
    return {
      code: this.state.code,
      phase: this.state.phase,
      players: this.state.players.length,
      joinable: this.state.phase === "lobby" && this.state.players.length < 2,
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
    const result = joinRoom(
      this.state,
      { name: url.searchParams.get("name") ?? "", token: url.searchParams.get("token") ?? undefined },
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

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.state) return;
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) return;

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
    if (!attachment) return; // 거절된 소켓 등 플레이어와 연결되지 않은 소켓
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
      this.state = null;
      await this.ctx.storage.deleteAll(); // 알람도 함께 지워진다
      return;
    }

    const pruned = pruneLobby(this.state, now);
    const advanced = advancePhase(this.state, now, this.scale);
    if (pruned || advanced) {
      await this.persist();
      this.broadcast();
    } else {
      await this.reschedule();
    }
  }

  // ---- 내부 도구 ----

  private async persist(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put(STATE_KEY, this.state);
    await this.reschedule();
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
        viewerId = (ws.deserializeAttachment() as SocketAttachment | null)?.playerId;
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
