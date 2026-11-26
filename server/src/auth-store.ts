import { DurableObject } from "cloudflare:workers";
import type { ClaimResult, PublicUser } from "./auth";
import { LinkHubCore } from "./link-hub";
import type { LinkStorage } from "./link-hub";
import { LinkedCore } from "./linked";
import type { LinkCredentials, RemoteLogin } from "./linked";

const PENDING_LOGIN_MS = 10 * 60_000;
const GAME_SESSION_MS = 7 * 24 * 60 * 60_000;

// ---- 게임 세션 저장소 (Durable Object 하나) ----

interface PendingLogin {
  createdAt: number;
  /** 브라우저에서 확인을 마치면 채워진다. */
  user: PublicUser | null;
}
interface GameSession {
  user: PublicUser;
  expiresAt: number;
}

function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class AuthStore extends DurableObject {
  async start(now = Date.now()): Promise<string> {
    const id = randomToken(24);
    await this.ctx.storage.put(`login:${id}`, { createdAt: now, user: null } satisfies PendingLogin);
    await this.ctx.storage.setAlarm(now + PENDING_LOGIN_MS);
    return id;
  }

  async approve(id: string, user: PublicUser, now = Date.now()): Promise<boolean> {
    const pending = await this.ctx.storage.get<PendingLogin>(`login:${id}`);
    if (!pending || now - pending.createdAt > PENDING_LOGIN_MS) return false;
    pending.user = user;
    await this.ctx.storage.put(`login:${id}`, pending);
    return true;
  }

  /** 승인되었으면 게임 세션 토큰을 한 번만 내준다. */
  async claim(id: string, now = Date.now()): Promise<ClaimResult> {
    const pending = await this.ctx.storage.get<PendingLogin>(`login:${id}`);
    if (!pending || now - pending.createdAt > PENDING_LOGIN_MS) return { status: "unknown" };
    if (!pending.user) return { status: "pending" };
    await this.ctx.storage.delete(`login:${id}`);
    const token = randomToken(32);
    await this.ctx.storage.put(`session:${token}`, {
      user: pending.user,
      expiresAt: now + GAME_SESSION_MS,
    } satisfies GameSession);
    return { status: "approved", token, user: pending.user };
  }

  async session(token: string, now = Date.now()): Promise<PublicUser | null> {
    const session = await this.ctx.storage.get<GameSession>(`session:${token}`);
    if (!session) return null;
    if (session.expiresAt <= now) {
      await this.ctx.storage.delete(`session:${token}`);
      return null;
    }
    // GL 연결 서버: 주인이 막은 사람은 이미 받은 세션도 쓸 수 없다
    if (await this.linked().isBanned(session.user.id)) return null;
    return session.user;
  }

  async logout(token: string): Promise<void> {
    await this.ctx.storage.delete(`session:${token}`);
  }

  // ---- GL 연결 서버: 공식 쪽 (link-hub.ts) ----

  private hub(): LinkHubCore {
    return new LinkHubCore(this.ctx.storage as unknown as LinkStorage);
  }
  linkRegister(name: unknown) { return this.hub().register(name); }
  async linkStart(input: { serverId: unknown; secret: unknown; name: unknown; returnTo?: unknown }) {
    const result = await this.hub().start(input);
    if (result.ok) await this.ctx.storage.setAlarm(Date.now() + PENDING_LOGIN_MS);
    return result;
  }
  linkInfo(linkId: unknown) { return this.hub().info(linkId); }
  linkApprove(linkId: unknown, user: PublicUser) { return this.hub().approve(linkId, user); }
  linkPoll(linkId: unknown, pollSecret: unknown) { return this.hub().poll(linkId, pollSecret); }
  linkBlock(serverId: string, blocked: boolean) { return this.hub().setBlocked(serverId, blocked); }

  // ---- GL 연결 서버: 개인 서버 쪽 (linked.ts) ----

  private linked(): LinkedCore {
    return new LinkedCore(this.ctx.storage as unknown as LinkStorage);
  }
  linkCredentials() { return this.linked().credentials(); }
  setLinkCredentials(cred: LinkCredentials | null) { return this.linked().setCredentials(cred); }
  async saveRemote(loginId: string, remote: Omit<RemoteLogin, "createdAt">) {
    await this.linked().saveRemote(loginId, remote);
  }
  remote(loginId: string) { return this.linked().remote(loginId); }
  dropRemote(loginId: string) { return this.linked().dropRemote(loginId); }
  rememberUser(user: PublicUser) { return this.linked().rememberUser(user); }
  isBanned(userId: string) { return this.linked().isBanned(userId); }
  setBanned(userId: string, banned: boolean) { return this.linked().setBanned(userId, banned); }
  knownUsers() { return this.linked().users(); }

  /** 오래된 로그인 시도와 만료된 세션을 치운다. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const logins = await this.ctx.storage.list<PendingLogin>({ prefix: "login:" });
    for (const [key, value] of logins) if (now - value.createdAt > PENDING_LOGIN_MS) await this.ctx.storage.delete(key);
    const sessions = await this.ctx.storage.list<GameSession>({ prefix: "session:" });
    for (const [key, value] of sessions) if (value.expiresAt <= now) await this.ctx.storage.delete(key);
    await this.hub().sweep(now);
    await this.linked().sweep(now);
  }
}

