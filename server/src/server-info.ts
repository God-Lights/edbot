// GET /api/server: 이 서버가 어떤 서버인지 클라이언트에 알려 준다. (이름, 환경, 로그인 방식, 에디션, 프로토콜 버전)
// 앱과 웹은 이걸 보고 로비의 로그인 영역을 바꾸고, 운영이 아닌 서버에서는 안내 띠를 보여 준다.

import { authMode } from "./auth";
import type { AuthEnv, AuthMode } from "./auth";
import { activeContent, currentRuleset } from "./chess/content";
import type { PackInfo } from "./chess/content";
import { PROTOCOL_VERSION } from "./protocol";

export type ServerEnvironment = "production" | "development" | "local";
export type Edition = "vanilla" | "expert";

export interface ServerEnv extends AuthEnv {
  SERVER_NAME?: string;
  SERVER_ENV?: string;
  EDITION?: string;
  SERVER_VERSION?: string;
  RECORD_ANONYMOUS?: string;
  LINK_OWNER?: string;
}

export interface ServerInfo {
  /** 메시지 형식 버전 (protocol.ts의 PROTOCOL_VERSION) */
  protocol: number;
  name: string;
  /** production(공식) | development(개발) | local(로컬 서버) */
  env: ServerEnvironment;
  authMode: AuthMode;
  /** vanilla: 공식과 같은 규칙. expert: 플러그인(캐릭터·아이템·모드)을 더할 수 있다. */
  edition: Edition;
  version: string;
  /** 규칙 묶음의 이름: 공식이면 "official", 콘텐츠 팩이 있으면 "custom-<해시>" */
  ruleset: string;
  /** 적용된 콘텐츠 팩(없으면 빈 목록). 엑스퍼트 서버에서만 있을 수 있다. 설명서·리소스는 /api/packs 에서 */
  packs: Array<Pick<PackInfo, "id" | "name" | "version" | "kind">>;
  /** 판이 끝나면 전적과 랭킹이 남는 서버인가 */
  ranking: boolean;
  /** 게스트(학번과 이름) 방을 쓸 수 있는가: GL 로그인이 있는 서버에서만 의미가 있다 */
  guestRooms: boolean;
  /** GL 연결 서버: 로그인은 GL 계정(공식 서버가 확인), 전적은 이 서버. 이때 authMode 는 gl(GL 계정만) 또는 hybrid(이름도 됨) */
  linked?: { owner: string | null };
}

const ENVIRONMENTS: readonly string[] = ["production", "development", "local"];

export function serverInfo(env: ServerEnv): ServerInfo {
  const mode = authMode(env);
  const declared = env.SERVER_ENV ?? "";
  // 운영 서버(gl)는 환경 변수를 안 적어도 production, 그 밖의 방식은 development로 본다.
  const environment: ServerEnvironment = ENVIRONMENTS.includes(declared)
    ? (declared as ServerEnvironment)
    : mode === "gl" ? "production" : "development";
  return {
    protocol: PROTOCOL_VERSION,
    name: (env.SERVER_NAME ?? "").trim() || "COMMANDER",
    env: environment,
    authMode: mode,
    edition: env.EDITION === "expert" ? "expert" : "vanilla",
    version: env.SERVER_VERSION ?? "0.0.0",
    ruleset: currentRuleset(),
    packs: (activeContent()?.packs ?? []).map(({ id, name, version, kind }) => ({ id, name, version, kind })),
    ranking: mode === "open" ? env.RECORD_ANONYMOUS === "true" : true,
    guestRooms: mode !== "open",
    ...(String(env.AUTH_MODE) === "linked" ? { linked: { owner: (env.LINK_OWNER ?? "").trim() || null } } : {}),
  };
}
