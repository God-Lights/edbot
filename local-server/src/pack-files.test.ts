// 팩 .zip 풀기와 /packs/<id>/ 파일 내주기
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { extractZipPacks, packAsset } from "./pack-files";
import { packRoot, readZip } from "./zip";
import { loadPlugins } from "./plugins";

/** 시험용 zip 만들기 (deflate). crc 는 읽는 쪽이 보지 않아서 0 */
function makeZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const comp = new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length + comp.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30); local.set(comp, 30 + n.length);
    const cen = new Uint8Array(46 + n.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    cen.set(n, 46);
    locals.push(local); central.push(cen);
    offset += local.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const part of [...locals, ...central, end]) { out.set(part, p); p += part.length; }
  return out;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const skinPack = { apiVersion: 1, id: "night-skin", name: "밤 스킨", version: "1.0.0", kind: "resource", guide: [{ title: "소개", body: "밤 색" }], resources: { colors: { gold: "#88aaff" }, logo: "assets/logo.png" } };

describe("팩 zip", () => {
  test("읽기: deflate, 폴더째 넣은 zip 도 pack.json 기준으로", () => {
    const files = readZip(makeZip({ "night/pack.json": JSON.stringify(skinPack), "night/assets/logo.png": PNG, "__MACOSX/night/._x": "junk" }));
    const root = packRoot(files)!;
    expect([...root.keys()].sort()).toEqual(["assets/logo.png", "pack.json"]);
    expect(root.get("assets/logo.png")).toEqual(PNG);
  });

  test("위험한 경로·zip 이 아닌 것은 거절", () => {
    expect(() => readZip(makeZip({ "../evil.png": PNG }))).toThrow();
    expect(() => readZip(new TextEncoder().encode("not a zip"))).toThrow();
    expect(packRoot(readZip(makeZip({ "a.png": PNG })))).toBeNull();
  });

  test("진짜 zip 프로그램으로 만든 파일도 읽는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "zipcli-"));
    mkdirSync(join(dir, "p/assets"), { recursive: true });
    writeFileSync(join(dir, "p/pack.json"), JSON.stringify(skinPack));
    writeFileSync(join(dir, "p/assets/logo.png"), PNG);
    try {
      execFileSync("zip", ["-qr", "p.zip", "p"], { cwd: dir });
    } catch {
      return; // zip 이 없는 곳은 건너뛴다
    }
    const root = packRoot(readZip(new Uint8Array(readFileSync(join(dir, "p.zip")))))!;
    expect(root.get("assets/logo.png")).toEqual(PNG);
  });

  test("plugins/ 의 zip 을 풀고, 읽고, /packs/<id>/ 로 그림을 내준다", async () => {
    const data = mkdtempSync(join(tmpdir(), "packs-"));
    mkdirSync(join(data, "plugins"), { recursive: true });
    writeFileSync(join(data, "plugins", "night.zip"), makeZip({ "pack.json": JSON.stringify(skinPack), "assets/logo.png": PNG }));
    writeFileSync(join(data, "plugins", "old.json.off"), JSON.stringify({ ...skinPack, id: "old" }));
    expect(extractZipPacks(join(data, "plugins"))).toEqual([]);
    expect(existsSync(join(data, "plugins", "night", "pack.json"))).toBe(true);
    // 두 번째는 바뀐 게 없어서 다시 풀지 않는다
    expect(extractZipPacks(join(data, "plugins"))).toEqual([]);

    const report = loadPlugins(data);
    expect(report.rejected).toEqual([]);
    expect(report.accepted.map((p) => [p.id, p.kind])).toEqual([["night-skin", "resource"]]);
    expect(report.ruleset).toBe("official"); // 리소스 팩만: 규칙은 공식
    const dirs = new Map(report.accepted.filter((p) => p.dir).map((p) => [p.id, p.dir!]));
    const ok = packAsset("/packs/night-skin/assets/logo.png", dirs)!;
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);
    expect(packAsset("/packs/night-skin/pack.json", dirs)!.status).toBe(404); // 문서는 내주지 않는다
    expect(packAsset("/packs/night-skin/../../secret.png", dirs)!.status).toBe(404);
    expect(packAsset("/packs/nope/assets/logo.png", dirs)!.status).toBe(404);
    expect(packAsset("/api/chess", dirs)).toBeNull();
  });
});
