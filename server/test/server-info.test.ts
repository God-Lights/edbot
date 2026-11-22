import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { authMode, authRequired } from "../src/auth";
import { PROTOCOL_VERSION } from "../src/protocol";
import { serverInfo } from "../src/server-info";

describe("로그인 방식", () => {
  it("AUTH_MODE가 있으면 그것을, 없으면 예전 변수(REQUIRE_AUTH)로 정한다", () => {
    expect(authMode({ AUTH_MODE: "gl" })).toBe("gl");
    expect(authMode({ AUTH_MODE: "hybrid" })).toBe("hybrid");
    expect(authMode({ AUTH_MODE: "open" })).toBe("open");
    expect(authMode({})).toBe("gl"); // 아무것도 없으면 가장 엄격한 쪽
    expect(authMode({ REQUIRE_AUTH: "false" })).toBe("open");
    expect(authMode({ REQUIRE_AUTH: "true" })).toBe("gl");
    expect(authMode({ AUTH_MODE: "gl", REQUIRE_AUTH: "false" })).toBe("gl"); // AUTH_MODE가 먼저
    expect(authMode({ AUTH_MODE: "엉뚱한 값" })).toBe("gl"); // 모르는 값은 엄격한 쪽으로
    expect(authMode({ AUTH_MODE: "엉뚱한 값", REQUIRE_AUTH: "false" })).toBe("open");
  });
  it("GL 로그인이 꼭 필요한 건 gl 방식뿐이다", () => {
    expect(authRequired({ AUTH_MODE: "gl" })).toBe(true);
    expect(authRequired({ AUTH_MODE: "hybrid" })).toBe(false);
    expect(authRequired({ AUTH_MODE: "open" })).toBe(false);
    expect(authRequired({})).toBe(true);
  });
});

describe("/api/server 정보", () => {
  it("운영(gl): 환경을 안 적어도 production, 전적이 남고 게스트 방을 쓴다", () => {
    expect(serverInfo({ AUTH_MODE: "gl" })).toEqual({
      protocol: PROTOCOL_VERSION, name: "COMMANDER", env: "production", authMode: "gl", edition: "vanilla",
      version: "0.0.0", ruleset: "official", packs: [], ranking: true, guestRooms: true,
    });
  });
  it("개발(hybrid): GL 계정 둘이면 전적이 남는다", () => {
    const info = serverInfo({ AUTH_MODE: "hybrid", SERVER_ENV: "development", SERVER_NAME: " 개발 서버 ", EDITION: "expert" });
    expect(info).toMatchObject({ authMode: "hybrid", env: "development", name: "개발 서버", edition: "expert", ranking: true, guestRooms: true });
  });
  it("로컬(open): 이름으로 전적을 남길 때만 ranking, 게스트 방은 필요 없다", () => {
    expect(serverInfo({ AUTH_MODE: "open", SERVER_ENV: "local", RECORD_ANONYMOUS: "true" })).toMatchObject({ env: "local", ranking: true, guestRooms: false });
    expect(serverInfo({ AUTH_MODE: "open" })).toMatchObject({ env: "development", ranking: false });
  });
  it("모르는 환경·에디션 값은 안전한 쪽으로", () => {
    expect(serverInfo({ AUTH_MODE: "gl", SERVER_ENV: "엉뚱" }).env).toBe("production");
    expect(serverInfo({ AUTH_MODE: "open", SERVER_ENV: "엉뚱" }).env).toBe("development");
    expect(serverInfo({ EDITION: "엉뚱" }).edition).toBe("vanilla");
  });
  it("이름이 비어 있으면 COMMANDER", () => {
    expect(serverInfo({ SERVER_NAME: "   " }).name).toBe("COMMANDER");
  });
});

describe("배포 설정 지킴이 (wrangler.jsonc)", () => {
  // 주석(// 와 /* */)을 지운다. 문자열 안의 // (주소 등)은 건드리지 않는다.
  function parseJsonc(text: string): Record<string, unknown> {
    let out = "";
    let inString = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (inString) {
        out += c;
        if (c === "\\") out += text[++i] ?? "";
        else if (c === '"') inString = false;
      } else if (c === '"') {
        inString = true;
        out += c;
      } else if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        out += "\n";
      } else if (c === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i += 1;
      } else out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
  }
  const config = parseJsonc(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "wrangler.jsonc"), "utf8")) as {
    vars: Record<string, string>;
    env: { dev: { vars: Record<string, string>; name: string; routes: unknown[]; d1_databases: Array<{ database_name: string }> } };
    name: string;
    d1_databases: Array<{ database_name: string }>;
  };

  it("운영 서버는 반드시 GL 로그인(gl)이고, 로그인 검사를 끄는 변수가 없다", () => {
    expect(config.vars.AUTH_MODE).toBe("gl");
    expect(config.vars.SERVER_ENV).toBe("production");
    expect(config.vars.REQUIRE_AUTH).toBeUndefined();
  });
  it("open 방식은 로컬 서버 전용이라 어느 Worker 설정에도 없다", () => {
    expect(config.env.dev.vars.AUTH_MODE).not.toBe("open");
    expect(config.env.dev.vars.REQUIRE_AUTH).toBeUndefined();
  });
  it("개발 서버는 운영과 이름·D1·도메인이 모두 다르다 (데이터가 섞이지 않는다)", () => {
    expect(config.env.dev.name).not.toBe(config.name);
    expect(config.env.dev.d1_databases[0]!.database_name).not.toBe(config.d1_databases[0]!.database_name);
    expect(config.env.dev.routes).toEqual([]);
  });
});
