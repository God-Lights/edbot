import { Room } from "./room";

export { Room };

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 알파벳. 4자리면 약 80만 가지.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const MAX_CREATE_ATTEMPTS = 8;

export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /api/rooms -> 새 방을 만들고 4자리 코드를 돌려준다.
    if (request.method === "POST" && parts.length === 2 && parts[0] === "api" && parts[1] === "rooms") {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        if (await roomStub(env, code).init(code)) {
          return json({ code }, 201);
        }
      }
      return json({ error: "could_not_create_room" }, 503);
    }

    // GET /api/rooms/:code -> 방이 있는지, 들어갈 수 있는지.
    if (request.method === "GET" && parts.length === 3 && parts[0] === "api" && parts[1] === "rooms") {
      const code = (parts[2] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      const info = await roomStub(env, code).info();
      return info ? json(info) : json({ error: "room_not_found" }, 404);
    }

    // GET /ws/:code?name=...&token=... -> WebSocket으로 방에 들어간다.
    if (parts.length === 2 && parts[0] === "ws") {
      const code = (parts[1] ?? "").toUpperCase();
      if (!CODE_PATTERN.test(code)) return json({ error: "room_not_found" }, 404);
      return roomStub(env, code).fetch(request);
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "edbot-server" });
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
