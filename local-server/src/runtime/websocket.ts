// Cloudflare의 WebSocketPair와 `new Response(null, { status: 101, webSocket })`를 Bun에서 흉내 낸다.
//
// 방 코드는 응답에 소켓의 한쪽(client)을 실어서 돌려주고, 다른 쪽(server)은 DO가 가진다.
// Bun에서는 main.ts가 그 응답을 보고 진짜 연결로 올려(upgrade) 주고, 진짜 소켓의 메시지를 server 쪽으로 넘긴다.

import type { ServerWebSocket } from "bun";

type Message = string | ArrayBuffer | Uint8Array;

/** DO가 쥐고 있는 쪽. 진짜 소켓이 붙기 전에 보낸 메시지는 모아 두었다가 붙으면 보낸다. */
export class ServerSocket {
  readyState = 1; // OPEN
  tags: string[] = [];
  /** 이 소켓을 받은 객체. 메시지·닫힘을 이쪽으로 넘긴다. */
  owner: SocketOwner | null = null;
  private attachment: unknown = null;
  private real: ServerWebSocket<unknown> | null = null;
  private pending: Array<() => void> = [];

  send(data: Message): void {
    if (this.readyState !== 1) return;
    if (!this.real) {
      this.pending.push(() => this.real?.send(data as string));
      return;
    }
    this.real.send(data as string);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (!this.real) {
      this.pending.push(() => this.real?.close(code, reason));
      return;
    }
    this.real.close(code, reason);
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  deserializeAttachment(): unknown {
    return this.attachment === null ? null : JSON.parse(JSON.stringify(this.attachment));
  }

  /** 진짜 연결이 올라왔다. */
  attach(real: ServerWebSocket<unknown>): void {
    this.real = real;
    const queued = this.pending;
    this.pending = [];
    for (const run of queued) run();
  }

  /** 진짜 연결이 닫혔다. */
  detached(): void {
    this.readyState = 3;
    this.real = null;
  }
}

/** 응답에 실려 가는 쪽. 짝(server)을 알고 있다. */
export class ClientSocket {
  constructor(readonly peer: ServerSocket) {}
}

export interface SocketOwner {
  webSocketMessage(ws: ServerSocket, message: Message): void | Promise<void>;
  webSocketClose(ws: ServerSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>;
  webSocketError(ws: ServerSocket, error: unknown): void | Promise<void>;
}

export class WebSocketPair {
  0: ClientSocket;
  1: ServerSocket;
  constructor() {
    const server = new ServerSocket();
    this[0] = new ClientSocket(server);
    this[1] = server;
  }
}

const NativeResponse = globalThis.Response;

/** `status: 101`과 `webSocket`을 받는 Response. 표준 Response는 101을 거부한다. */
class WorkersResponse extends NativeResponse {
  webSocket: ClientSocket | null = null;
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: ClientSocket | null }) {
    if (init && init.status === 101) {
      super(null, { headers: init.headers });
      this.webSocket = init.webSocket ?? null;
    } else {
      super(body, init);
    }
  }
}

export function installWebSocketGlobals(): void {
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = WebSocketPair;
  (globalThis as unknown as { Response: unknown }).Response = WorkersResponse;
}

export function upgradeTarget(response: Response): ServerSocket | null {
  const ws = (response as Response & { webSocket?: ClientSocket | null }).webSocket;
  return ws ? ws.peer : null;
}
