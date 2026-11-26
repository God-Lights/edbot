// 팩 종류(plugin / resource / bundle), 팩 설명서, 리소스(색·그림·소리) 검증
import { describe, expect, it } from "vitest";
import { buildContent } from "../src/chess/content-build";

const base = { apiVersion: 1, name: "팩", version: "1.0.0" };
const unit = { id: "moon", nameKo: "달", piece: "rook", faction: "밤", cost: 2, role: "탱커", ability: "stone-skin", abilityText: "단단해진다" };

describe("팩 종류", () => {
  it("kind 를 안 적으면 내용으로 정한다 (예전 팩은 plugin)", () => {
    const r = buildContent([
      { ...base, id: "rules-only", rules: { startGold: 5 } },
      { ...base, id: "skin-only", resources: { colors: { gold: "#FFAA00" } } },
      { ...base, id: "both", units: [unit], resources: { units: { moon: "assets/moon.png" } } },
    ]);
    expect(r.rejected).toEqual([]);
    expect(Object.fromEntries(r.accepted.map((p) => [p.id, p.kind]))).toEqual({ "rules-only": "plugin", "skin-only": "resource", both: "bundle" });
  });

  it("리소스 팩에 규칙을, 플러그인 팩에 리소스를 넣으면 거절한다", () => {
    const r = buildContent([
      { ...base, id: "bad-skin", kind: "resource", rules: { startGold: 5 }, resources: {} },
      { ...base, id: "bad-plugin", kind: "plugin", resources: { colors: { gold: "#ffaa00" } } },
      { ...base, id: "bad-kind", kind: "theme" },
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.id).sort()).toEqual(["bad-kind", "bad-plugin", "bad-skin"]);
    expect(r.rejected.find((x) => x.id === "bad-skin")!.errors.join()).toContain("bundle");
  });

  it("리소스 팩만 있으면 규칙 묶음은 official 그대로", () => {
    const skin = buildContent([{ ...base, id: "skin", kind: "resource", resources: { colors: { bgTop: "#000000" } } }]);
    expect(skin.content?.ruleset).toBe("official");
    const plugin = buildContent([{ ...base, id: "pl", rules: { startGold: 5 } }]);
    expect(plugin.content?.ruleset).toMatch(/^custom-/);
  });
});

describe("팩 설명서와 요약", () => {
  it("guide 는 [{title, body}] 이고, 요약에 새 캐릭터·바꾼 규칙이 나온다", () => {
    const r = buildContent([{
      ...base, id: "night", description: "밤의 팩", author: "누군가",
      guide: [{ title: "시작하기", body: "달 캐릭터를 써 보세요.\n두 줄." }],
      units: [unit], unitOverrides: { relic: { hpMult: 1.1 } }, rules: { startGold: 5, rerollCost: 1 },
    }]);
    const info = r.accepted[0]!;
    expect(info.description).toBe("밤의 팩");
    expect(info.author).toBe("누군가");
    expect(info.guide).toEqual([{ title: "시작하기", body: "달 캐릭터를 써 보세요.\n두 줄." }]);
    expect(info.summary).toEqual({ units: ["night:moon"], overrides: ["relic"], materials: [], weapons: [], rules: ["startGold", "rerollCost"] });
  });

  it("설명서 꼭지가 너무 많거나 비어 있으면 거절", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ title: `t${i}`, body: "b" }));
    expect(buildContent([{ ...base, id: "g1", guide: many }]).rejected).toHaveLength(1);
    expect(buildContent([{ ...base, id: "g2", guide: [{ title: "", body: "x" }] }]).rejected).toHaveLength(1);
  });
});

describe("리소스", () => {
  it("파일 경로는 서버 주소(/packs/팩id/경로)로 바뀌고, 캐릭터는 짧은 id·공식 id 둘 다 된다", () => {
    const r = buildContent([{
      ...base, id: "skin", kind: "bundle", units: [unit],
      resources: {
        colors: { gold: "#C8AA6E", cost5: "#ffffff" },
        logo: "assets/logo.png", lobbyBackground: "assets/bg.jpg", boardBackground: "board.webp",
        units: { moon: "assets/units/moon.png", relic: "assets/units/relic.png" },
        sounds: { buy: "sfx/buy.mp3", merge: "sfx/merge.ogg" },
        music: { prep: "music/prep.mp3" },
      },
    }]);
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]!.resources).toEqual({
      colors: { gold: "#c8aa6e", cost5: "#ffffff" },
      logo: "/packs/skin/assets/logo.png", lobbyBackground: "/packs/skin/assets/bg.jpg", boardBackground: "/packs/skin/board.webp",
      units: { "skin:moon": "/packs/skin/assets/units/moon.png", relic: "/packs/skin/assets/units/relic.png" },
      sounds: { buy: "/packs/skin/sfx/buy.mp3", merge: "/packs/skin/sfx/merge.ogg" },
      music: { prep: "/packs/skin/music/prep.mp3" },
    });
  });

  it("밖으로 나가는 경로, 문서 파일(svg·html), 틀린 색·효과음·캐릭터는 거절", () => {
    const bad = (resources: unknown) => buildContent([{ ...base, id: "bad", resources }]).rejected.length === 1;
    expect(bad({ logo: "../secret.png" })).toBe(true);
    expect(bad({ logo: "/etc/logo.png" })).toBe(true);
    expect(bad({ logo: "assets/logo.svg" })).toBe(true);
    expect(bad({ logo: "page.html" })).toBe(true);
    expect(bad({ colors: { gold: "gold" } })).toBe(true);
    expect(bad({ colors: { pink: "#ff00ff" } })).toBe(true);
    expect(bad({ sounds: { explode: "a.mp3" } })).toBe(true);
    expect(bad({ sounds: { buy: "a.png" } })).toBe(true);
    expect(bad({ music: { boss: "a.mp3" } })).toBe(true);
    expect(bad({ units: { nobody: "a.png" } })).toBe(true);
    expect(bad({ colors: { gold: "#ffaa00" } })).toBe(false);
  });
});
