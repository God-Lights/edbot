import { describe, expect, it } from "vitest";
import { FALLBACK_ICON_URL, buildSource, versionsFromReleases } from "../src/sidestore";
import type { GithubRelease } from "../src/sidestore";

const asset = (name: string, size = 100) => ({ name, size, browser_download_url: `https://github.com/x/y/releases/download/t/${name}` });
const release = (tag: string, published: string, extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  published_at: published,
  body: "",
  assets: [asset("Commander.ipa", 1234), asset("icon.png", 9)],
  ...extra,
});

describe("SideStore 소스", () => {
  it("ios-v* 릴리스만, 새것부터 버전 목록으로 만든다", () => {
    const { versions } = versionsFromReleases([
      release("ios-v0.1.0", "2026-11-01T00:00:00Z"),
      release("v9.9.9", "2026-12-01T00:00:00Z"), // 서버 릴리스 등 다른 태그는 무시
      release("ios-v0.2.0", "2026-11-20T00:00:00Z", { body: "밴·드래프트·배치 추가" }),
    ]);
    expect(versions.map((v) => v.version)).toEqual(["0.2.0", "0.1.0"]);
    // SideStore는 앱의 CFBundleVersion 이 buildVersion 과 같은지 검사한다. 워크플로가 둘 다 버전 번호로 맞춘다.
    for (const v of versions) expect(v.buildVersion).toBe(v.version);
    expect(versions[0]).toMatchObject({
      downloadURL: "https://github.com/x/y/releases/download/t/Commander.ipa",
      size: 1234,
      minOSVersion: "17.0",
      localizedDescription: "밴·드래프트·배치 추가",
      date: "2026-11-20T00:00:00Z",
    });
  });

  it("초안 릴리스와 .ipa가 없는 릴리스는 건너뛴다", () => {
    const { versions } = versionsFromReleases([
      release("ios-v0.3.0", "2026-11-21T00:00:00Z", { draft: true }),
      release("ios-v0.2.0", "2026-11-20T00:00:00Z", { assets: [asset("icon.png")] }),
      release("ios-v0.1.0", "2026-11-01T00:00:00Z"),
    ]);
    expect(versions.map((v) => v.version)).toEqual(["0.1.0"]);
  });

  it("설명이 비어 있으면 기본 문구를 쓴다", () => {
    expect(versionsFromReleases([release("ios-v1.0.0", "2026-11-01T00:00:00Z")]).versions[0]!.localizedDescription).toBe("COMMANDER 1.0.0");
  });

  it("아이콘은 릴리스에 올린 icon.png를 쓴다", () => {
    expect(versionsFromReleases([release("ios-v1.0.0", "2026-11-01T00:00:00Z")]).iconURL).toContain("icon.png");
    expect(versionsFromReleases([]).iconURL).toBeNull();
  });

  it("AltStore 소스 형식을 지킨다 (번들 ID, 최신 버전이 앱 최상위에도 있음)", () => {
    const source = buildSource([release("ios-v0.2.0", "2026-11-20T00:00:00Z"), release("ios-v0.1.0", "2026-11-01T00:00:00Z")], "https://s.test/sidestore.json") as {
      name: string; identifier: string; sourceURL: string; apps: Array<Record<string, unknown>>; news: unknown[];
    };
    expect(source.name).toBe("COMMANDER");
    expect(source.sourceURL).toBe("https://s.test/sidestore.json");
    expect(source.news).toEqual([]);
    const app = source.apps[0]!;
    expect(app.bundleIdentifier).toBe("com.officialgl.commander");
    expect(app.version).toBe("0.2.0");
    expect(app.downloadURL).toContain("Commander.ipa");
    expect((app.versions as unknown[]).length).toBe(2);
    expect(JSON.parse(JSON.stringify(source))).toEqual(source); // JSON으로 직렬화 가능
  });

  it("릴리스가 하나도 없으면 앱 없이 소스만 만들고, 아이콘 주소는 비지 않는다", () => {
    const source = buildSource([], "https://s.test/sidestore.json") as { apps: unknown[]; iconURL: string };
    expect(source.apps).toEqual([]);
    expect(source.iconURL).toBe(FALLBACK_ICON_URL);
  });

  it("어떤 경우에도 URL 필드는 빈 문자열이 아니다 (SideStore가 거부한다)", () => {
    const check = (value: unknown, path: string) => {
      if (Array.isArray(value)) value.forEach((v, i) => check(v, `${path}[${i}]`));
      else if (value && typeof value === "object")
        for (const [k, v] of Object.entries(value)) {
          if (/url$/i.test(k) && typeof v === "string") expect(() => new URL(v), `${path}.${k}`).not.toThrow();
          check(v, `${path}.${k}`);
        }
    };
    check(buildSource([], "https://s.test/sidestore.json"), "empty");
    check(buildSource([release("ios-v1.0.0", "2026-11-01T00:00:00Z", { assets: [asset("Commander.ipa")] })], "https://s.test/sidestore.json"), "noIcon");
    check(buildSource([release("ios-v1.0.0", "2026-11-01T00:00:00Z")], "https://s.test/sidestore.json"), "full");
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOURCE_ASSET_URL, loadSourceJson } from "../src/sidestore";

describe("소스 가져오기 (GitHub API를 쓰지 않는다)", () => {
  const reply = (status: number, body = "") => async () => new Response(body, { status });

  it("워크플로가 올린 파일이 있으면 그대로 쓴다", async () => {
    let asked = "";
    const result = await loadSourceJson("https://s.test/sidestore.json", async (url) => {
      asked = url;
      return new Response('{"name":"COMMANDER","apps":[1]}');
    });
    expect(asked).toBe(SOURCE_ASSET_URL);
    expect(asked).not.toContain("api.github.com");
    expect(result).toEqual({ ok: true, body: '{"name":"COMMANDER","apps":[1]}' });
  });

  it("파일이 아직 없으면(404) 앱 없는 빈 소스를 만든다", async () => {
    const result = await loadSourceJson("https://s.test/sidestore.json", reply(404));
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.body).apps).toEqual([]);
  });

  it("서버 오류, 깨진 JSON, 네트워크 오류는 실패", async () => {
    expect(await loadSourceJson("x", reply(500))).toEqual({ ok: false });
    expect(await loadSourceJson("x", reply(200, "not json"))).toEqual({ ok: false });
    expect(
      await loadSourceJson("x", async () => {
        throw new Error("network");
      }),
    ).toEqual({ ok: false });
  });
});

describe("소스 생성 스크립트", () => {
  it("릴리스 목록 JSON에서 소스를 만든다 (Node의 타입 제거 실행으로 서버 코드를 그대로 씀)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ss-"));
    const file = join(dir, "releases.json");
    writeFileSync(file, JSON.stringify([release("ios-v0.1.0", "2026-11-21T00:00:00Z")]));
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", "scripts/make-sidestore-source.mjs", file, "https://s.test/sidestore.json"],
      { encoding: "utf8" },
    );
    const source = JSON.parse(out);
    expect(source.apps[0].version).toBe("0.1.0");
    expect(source.sourceURL).toBe("https://s.test/sidestore.json");
  });
});
