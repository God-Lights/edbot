// GET /api/server: 이 서버가 어떤 서버인지 클라이언트에 알려 준다. (이름, 환경, 로그인 방식, 에디션, 프로토콜 버전)
// 앱과 웹은 이걸 보고 로비의 로그인 영역을 바꾸고, 운영이 아닌 서버에서는 안내 띠를 보여 준다.

import { authMode } from "./auth";
import type { AuthEnv, AuthMode } from "./auth";
import { PROTOCOL_VERSION } from "./protocol";

export type ServerEnvironment = "production" | "development" | "local";
export type Edition = "vanilla" | "expert";

export interface ServerEnv extends AuthEnv {
  SERVER_NAME?: string;
  SERVER_ENV?: string;
  EDITION?: string;
  SERVER_VERSION?: string;
  RECORD_ANONYMOUS?: string;
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
  /** 규칙 묶음의 이름. 지금은 공식 규칙뿐이라 "official". (플러그인을 도입하면 해시가 들어간다) */
  ruleset: string;
  /** 판이 끝나면 전적과 랭킹이 남는 서버인가 */
  ranking: boolean;
  /** 게스트(학번과 이름) 방을 쓸 수 있는가: GL 로그인이 있는 서버에서만 의미가 있다 */
  guestRooms: boolean;
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
    ruleset: "official",
    ranking: mode === "open" ? env.RECORD_ANONYMOUS === "true" : true,
    guestRooms: mode !== "open",
  };
}
