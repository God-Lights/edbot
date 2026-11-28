import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContent } from "../src/chess/content-build";
import type { Content } from "../src/chess/content";
import { OFFICIAL_RULES, currentRuleset, rules, setActiveContent } from "../src/chess/content";
import { MATERIAL_FUSIONS, combine, fuseMaterials } from "../src/chess/crafting";
import { createChessGame, deployCap, interest, prepSeconds, rerollCost } from "../src/chess/game";
import { ROSTER, roster, unitDef } from "../src/chess/roster";
import { createCombat, runCombat } from "../src/chess/sim";
import { MATERIALS, WEAPONS, materials, weapons } from "../src/chess/weapons";
import { toChessSnapshot } from "../src/chess/snapshot";
import { createRoom, isRulesetCurrent } from "../src/room-state";
import { serverInfo } from "../src/server-info";
import { BUNDLED_PACKS } from "../packs";

afterEach(() => setActiveContent(null));

/** 올바른 팩 하나. 시험마다 조금씩 고쳐서 쓴다. */
const pack = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  apiVersion: 1, id: "demo", name: "시험 팩", version: "1.0.0",
  units: [{ id: "ghost-pawn", nameKo: "유령 폰", piece: "pawn", faction: "이계", cost: 1, role: "탱커", ability: "hatch", abilityText: "새끼를 부화시킨다" }],
  ...over,
});
const apply = (...packs: unknown[]): { content: Content; ok: boolean; errors: string[] } => {
  const r = buildContent(packs);
  setActiveContent(r.content);
  return { content: r.content!, ok: r.rejected.length === 0, errors: r.rejected.flatMap((x) => x.errors) };
};

describe("팩이 없으면 공식 그대로", () => {
  it("받아들인 팩이 없으면 content 는 null, 규칙은 공식 값", () => {
    const r = buildContent([]);
    expect(r.content).toBeNull();
    expect(roster()).toBe(ROSTER);
    expect(materials()).toBe(MATERIALS);
    expect(weapons()).toBe(WEAPONS);
    expect(rules()).toBe(OFFICIAL_RULES);
    expect(currentRuleset()).toBe("official");
  });
  it("틀린 팩만 있으면 공식 그대로 두고 이유를 돌려준다", () => {
    const r = buildContent([{ id: "x" }]);
    expect(r.content).toBeNull();
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.errors.join("\n")).toContain("apiVersion");
  });
});

describe("새 캐릭터", () => {
  it("공식 캐릭터와 같은 식으로 능력치가 정해지고, id 에 팩 이름이 붙는다", () => {
    apply(pack());
    const def = unitDef("demo:ghost-pawn")!;
    const official = unitDef("xenosaurs")!; // 같은 조건(폰, 1골드, 탱커, hatch)이고 개별 보정이 없다
    expect(def).toMatchObject({ piece: "pawn", cost: 1, role: "탱커", ability: "hatch", passive: false, hp: official.hp, atk: official.atk });
    expect(roster()).toHaveLength(ROSTER.length + 1);
    expect(unitDef("xenosaurs")).toBeDefined(); // 공식은 그대로
  });
  it("패시브 능력이면 에너지로 쓰지 않는 캐릭터가 된다", () => {
    apply(pack({ units: [{ id: "tomb", nameKo: "묘비", piece: "rook", faction: "고대", cost: 2, role: "탱커", ability: "relic-shield", abilityText: "쓰러지면 보호막" }] }));
    expect(unitDef("demo:tomb")!.passive).toBe(true);
  });
  it("hpMult·atkMult 로 값을 조절한다", () => {
    apply(pack({ units: [{ id: "big", nameKo: "거인", piece: "pawn", faction: "이계", cost: 1, role: "탱커", ability: "hatch", abilityText: "x", hpMult: 2, atkMult: 0.5 }] }));
    const base = unitDef("xenosaurs")!;
    expect(unitDef("demo:big")!.hp).toBeGreaterThan(base.hp * 1.9);
    expect(unitDef("demo:big")!.atk).toBeLessThan(base.atk * 0.55);
  });
  it("공용 풀과 상점에 나오고, lite 로 표시하면 입문 모드에도 나온다", () => {
    apply(pack({ units: [
      { id: "a", nameKo: "에이", piece: "pawn", faction: "x", cost: 1, role: "딜러", ability: "clone", abilityText: "x", lite: true },
      { id: "b", nameKo: "비", piece: "pawn", faction: "x", cost: 1, role: "딜러", ability: "clone", abilityText: "x" },
    ] }));
    const full = createChessGame(1);
    expect(full.pool["demo:a"]).toBe(OFFICIAL_RULES.poolCopies[1]);
    expect(full.pool["demo:b"]).toBe(OFFICIAL_RULES.poolCopies[1]);
    const lite = createChessGame(1, true);
    expect(lite.pool["demo:a"]).toBeDefined();
    expect(lite.pool["demo:b"]).toBeUndefined();
  });
  it("전투에 나와서 능력이 쓰인다", () => {
    apply(pack());
    const state = createCombat([[{ defId: "demo:ghost-pawn", star: 1, col: 3, row: 0 }], [{ defId: "relic", star: 1, col: 3, row: 0 }]]);
    expect(state.units[0]!.defId).toBe("demo:ghost-pawn");
    const r = runCombat([[{ defId: "demo:ghost-pawn", star: 1, col: 3, row: 0 }], [{ defId: "relic", star: 1, col: 3, row: 0 }]]);
    expect(r.beats).toBeGreaterThan(0);
  });
});

describe("캐릭터 값 조정(unitOverrides)", () => {
  it("공식 캐릭터의 체력·공격·이름·설명을 바꾼다", () => {
    const before = unitDef("dwargon")!;
    apply(pack({ units: undefined, unitOverrides: { dwargon: { hpMult: 0.5, atkMult: 2, nameKo: "작은 용" } } }));
    const after = unitDef("dwargon")!;
    expect(after.hp).toBe(Math.round((before.hp * 0.5) / 5) * 5);
    expect(after.atk).toBe(Math.round(before.atk * 2));
    expect(after.nameKo).toBe("작은 용");
    expect(after.piece).toBe(before.piece);
  });
  it("없는 캐릭터는 팩 전체를 거절한다", () => {
    const r = buildContent([pack({ units: undefined, unitOverrides: { nobody: { hpMult: 2 } } })]);
    expect(r.content).toBeNull();
    expect(r.rejected[0]!.errors.join("\n")).toContain("unitOverrides.nobody");
  });
});

describe("새 재료와 무기", () => {
  const items = {
    materials: [{ id: "moon", nameKo: "달돌", rarity: "common", weapon: "moon-bow" }],
    weapons: [{ id: "moon-bow", nameKo: "달돌 활", material: "moon", rarity: "common", text: "공격 +30%, 체력 +20%", stats: { atk: 1.3, hp: 1.2, dmgTaken: 0.9, energy: 1.5 } }],
  };
  it("재료·무기가 더해지고 서로 가리킨다", () => {
    apply(pack({ units: undefined, ...items }));
    expect(materials().find((m) => m.id === "demo:moon")).toMatchObject({ weaponId: "demo:moon-bow", rarity: "common" });
    expect(weapons().find((w) => w.id === "demo:moon-bow")).toMatchObject({ materialId: "demo:moon" });
  });
  it("전투에서 능력치 배율이 적용된다 (공식 무기는 그대로)", () => {
    apply(pack({ units: undefined, ...items }));
    const withBow = createCombat([[{ defId: "relic", star: 1, col: 3, row: 0, weapon: "demo:moon-bow" }], [{ defId: "relic", star: 1, col: 3, row: 0 }]]);
    const plain = createCombat([[{ defId: "relic", star: 1, col: 3, row: 0 }], [{ defId: "relic", star: 1, col: 3, row: 0 }]]);
    const a = withBow.units[0]!;
    const b = plain.units[0]!;
    expect(a.maxHp).toBeCloseTo(b.maxHp * 1.2, 5);
    expect(a.atk).toBeCloseTo(b.atk * 1.3, 5);
    expect(a.dmgMult).toBeCloseTo(0.9, 5);
    expect(a.energyMult).toBeCloseTo(1.5, 5);
    // ★2(효과 1.5배)와 융합(0.75배)도 공식 무기와 같은 규칙
    const star = createCombat([[{ defId: "relic", star: 1, col: 3, row: 0, weapon: "demo:moon-bow*" }], [{ defId: "relic", star: 1, col: 3, row: 0 }]]).units[0]!;
    expect(star.atk).toBeCloseTo(b.atk * (1 + 0.3 * 1.5), 5);
  });
  it("재료와 무기가 서로를 가리키지 않으면 거절한다", () => {
    const bad = { ...items, weapons: [{ ...items.weapons[0]!, material: "other" }] };
    const r = buildContent([pack({ units: undefined, ...bad })]);
    expect(r.content).toBeNull();
    expect(r.rejected[0]!.errors.join("\n")).toContain("서로를 가리켜야");
  });
  it("재련하면 그 무기가 나오고, 같은 무기를 합치면 ★2가 된다", () => {
    apply(pack({ units: undefined, ...items }));
    expect(combine({ kind: "weapon", id: "demo:moon-bow" }, { kind: "weapon", id: "demo:moon-bow" })).toEqual({ kind: "weapon", id: "demo:moon-bow*" });
    expect(combine({ kind: "weapon", id: "demo:moon-bow" }, { kind: "material", id: "demo:moon" })).toEqual({ kind: "weapon", id: "demo:moon-bow*" });
  });
});

describe("재료 조합표", () => {
  const items = {
    materials: [{ id: "moon", nameKo: "달돌", rarity: "common", weapon: "moon-bow" }],
    weapons: [{ id: "moon-bow", nameKo: "달돌 활", material: "moon", rarity: "common", text: "x", stats: { atk: 1.1 } }],
  };
  it("공식 짝의 결과는 그대로이고, 새 재료의 짝이 더해진다", () => {
    apply(pack({ units: undefined, ...items }));
    for (const f of MATERIAL_FUSIONS) expect(fuseMaterials(f.a, f.b), `${f.a}+${f.b}`).toBe(f.result);
    expect(fuseMaterials("clawstone", "demo:moon")).not.toBeNull(); // 새 짝
    expect(fuseMaterials("demo:moon", "bit")).not.toBeNull();
  });
  it("fusions 로 짝의 결과를 정한다", () => {
    apply(pack({ units: undefined, ...items, fusions: [{ a: "moon", b: "bit", result: "redocean" }] }));
    expect(fuseMaterials("demo:moon", "bit")).toBe("redocean");
  });
  it("희귀도가 맞지 않는 조합은 거절한다", () => {
    const r = buildContent([pack({ units: undefined, ...items, fusions: [{ a: "moon", b: "bit", result: "bitcoin" }] })]);
    expect(r.content).toBeNull();
    expect(r.rejected[0]!.errors.join("\n")).toContain("한 단계 위");
  });
});

describe("규칙 값", () => {
  it("rules 로 시작 체력, 골드, 이자, 새로고침, 시간, 라운드 수, 풀을 바꾼다", () => {
    apply(pack({ units: undefined, rules: { startHp: 50, startGold: 12, baseIncome: 7, maxInterest: 1, maxRounds: 5, maxDeploy: 5, rerollCost: 3, prepSeconds: 30, firstPrepSeconds: 60, poolCopies: { "1": 20 } } }));
    const g = createChessGame(1);
    expect(g.players[0].hp).toBe(3); // 8전 5승제: startHp 는 쓰지 않고, 목숨 = 이기는 데 필요한 승수 (5라운드면 3승)
    expect(g.players[0].gold).toBe(12);
    expect(g.pool["relic"]).toBe(20);
    expect(g.pool["felis"]).toBe(20);
    expect(g.pool["lappus"]).toBe(OFFICIAL_RULES.poolCopies[2]); // 안 정한 값은 공식 그대로
    expect(deployCap(10)).toBe(5);
    expect(interest(100)).toBe(1);
    expect(rerollCost(g.players[0])).toBe(3);
    expect(prepSeconds(1)).toBe(60);
    expect(prepSeconds(2)).toBe(30);
    expect(rules().maxRounds).toBe(5);
    const snap = toChessSnapshot(g, 0, false);
    expect(snap.maxRounds).toBe(5);
    expect(snap.startHp).toBe(3);
    expect(snap.winTarget).toBe(3);
    expect(snap.me!.nextIncome).toBe(7 + 1);
  });
  it("범위를 벗어난 값, 모르는 항목은 거절한다", () => {
    for (const rulesValue of [{ startHp: 0 }, { startHp: 5.5 }, { maxDeploy: 99 }, { poolCopies: { "5": 3 } }, { nothing: 1 }]) {
      const r = buildContent([pack({ units: undefined, rules: rulesValue })]);
      expect(r.content, JSON.stringify(rulesValue)).toBeNull();
      expect(r.rejected[0]!.errors.join("\n"), JSON.stringify(rulesValue)).toContain("rules");
    }
  });
});

describe("검증", () => {
  const rejects = (over: Record<string, unknown>, text: string) => {
    const r = buildContent([pack(over)]);
    expect(r.content, text).toBeNull();
    expect(r.rejected[0]!.errors.join("\n"), text).toContain(text);
  };
  it("틀린 곳을 어디가 왜 틀렸는지 알려 주고 팩 전체를 거절한다", () => {
    rejects({ apiVersion: 2 }, "apiVersion");
    rejects({ id: "A" }, "id");
    rejects({ name: "" }, "name");
    rejects({ extra: 1 }, "알 수 없는 항목");
    rejects({ units: [{ id: "x", nameKo: "엑스", piece: "dragon", faction: "f", cost: 1, role: "탱커", ability: "hatch", abilityText: "t" }] }, "units[0].piece");
    rejects({ units: [{ id: "x", nameKo: "엑스", piece: "pawn", faction: "f", cost: 5, role: "탱커", ability: "hatch", abilityText: "t" }] }, "units[0].cost");
    rejects({ units: [{ id: "x", nameKo: "엑스", piece: "pawn", faction: "f", cost: 1, role: "마법사", ability: "hatch", abilityText: "t" }] }, "units[0].role");
    rejects({ units: [{ id: "x", nameKo: "엑스", piece: "pawn", faction: "f", cost: 1, role: "탱커", ability: "fireball", abilityText: "t" }] }, "units[0].ability");
    rejects({ units: [{ id: "X Y", nameKo: "엑스", piece: "pawn", faction: "f", cost: 1, role: "탱커", ability: "hatch", abilityText: "t" }] }, "units[0].id");
    rejects({ units: [{ id: "x", nameKo: "엑스", piece: "pawn", faction: "f", cost: 1, role: "탱커", ability: "hatch", abilityText: "t", hpMult: 50 }] }, "hpMult");
    rejects({ units: [{ id: "x", nameKo: "엑스", piece: "pawn", faction: "f", cost: 1, role: "탱커", ability: "hatch", abilityText: "t", script: "evil()" }] }, "알 수 없는 항목");
    const twice = { id: "x", nameKo: "엑스", piece: "pawn", faction: "f", cost: 1, role: "탱커", ability: "hatch", abilityText: "t" };
    rejects({ units: [twice, twice] }, "두 번 나온다");
  });
  it("팩이 코드를 담을 수 없다 (능력은 공식 목록에서만, 무기는 숫자만)", () => {
    rejects({ weapons: [{ id: "w", nameKo: "무기", material: "m", rarity: "common", text: "t", stats: { atk: 1.2, proc: "bleed" } }], materials: [{ id: "m", nameKo: "재료", rarity: "common", weapon: "w" }], units: undefined }, "알 수 없는 항목");
  });
  it("틀린 팩 하나가 다른 팩을 막지 않는다", () => {
    const r = buildContent([pack({ id: "good" }), pack({ id: "bad", apiVersion: 9 })]);
    expect(r.accepted.map((p) => p.id)).toEqual(["good"]);
    expect(r.rejected.map((p) => p.id)).toEqual(["bad"]);
    expect(r.content!.units.some((u) => u.id === "good:ghost-pawn")).toBe(true);
  });
  it("같은 id 의 팩이 둘이면 뒤의 것을 버린다", () => {
    const r = buildContent([pack(), pack({ version: "2.0.0" })]);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected[0]!.errors.join("\n")).toContain("같은 id");
  });
  it("팩 하나가 캐릭터를 너무 많이 가지면 거절한다", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `u${i}`, nameKo: `유${i}`, piece: "pawn", faction: "f", cost: 1, role: "딜러", ability: "clone", abilityText: "t" }));
    rejects({ units: many }, "40명까지");
  });
});

describe("같은 팩이면 같은 결과", () => {
  it("팩을 넣는 순서가 달라도 규칙 묶음 이름이 같고, 값이 달라지면 이름도 달라진다", () => {
    const a = pack({ id: "aaa" });
    const b = pack({ id: "bbb", units: [{ id: "q", nameKo: "큐", piece: "knight", faction: "f", cost: 3, role: "기동", ability: "dimension-leap", abilityText: "t" }] });
    const one = buildContent([a, b]).content!;
    const two = buildContent([b, a]).content!;
    expect(one.ruleset).toBe(two.ruleset);
    expect(one.ruleset).toMatch(/^custom-[0-9a-f]{8}$/);
    const changed = buildContent([a, { ...b, units: [{ ...(b.units as Array<Record<string, unknown>>)[0], cost: 4 }] }]).content!;
    expect(changed.ruleset).not.toBe(one.ruleset);
  });
  it("적용하면 currentRuleset 이 바뀌고, 해제하면 공식으로 돌아온다", () => {
    apply(pack());
    expect(currentRuleset()).toMatch(/^custom-/);
    setActiveContent(null);
    expect(currentRuleset()).toBe("official");
    expect(unitDef("demo:ghost-pawn")).toBeUndefined();
  });
});

describe("개발 서버에 담기는 예시 팩", () => {
  it("틀린 곳이 없고, 캐릭터·재료·무기가 더해진다", () => {
    const r = buildContent(BUNDLED_PACKS);
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((p) => p.id)).toEqual(["example"]);
    setActiveContent(r.content);
    expect(unitDef("example:moon-guard")).toMatchObject({ piece: "rook", cost: 2 });
    expect(unitDef("example:star-hunter")).toMatchObject({ piece: "knight", cost: 3 });
    expect(weapons().some((w) => w.id === "example:moon-bow")).toBe(true);
    expect(createChessGame(1, true).pool["example:moon-guard"]).toBeDefined(); // lite 로 표시했다
  });
});

describe("서버가 팩을 적용하는 조건 (ensureContent)", () => {
  const fresh = async () => {
    vi.resetModules();
    const content = await import("../src/chess/content");
    const load = await import("../src/content-load");
    content.setActiveContent(null);
    return { content, load };
  };
  it("바닐라(운영)는 팩을 읽지 않는다", async () => {
    const { content, load } = await fresh();
    load.ensureContent({ EDITION: "vanilla" });
    expect(content.activeContent()).toBeNull();
    load.ensureContent({});
    expect(content.activeContent()).toBeNull();
  });
  it("엑스퍼트는 배포에 담긴 팩을 한 번만 적용한다", async () => {
    const { content, load } = await fresh();
    load.ensureContent({ EDITION: "expert" });
    const first = content.activeContent();
    expect(first?.packs.map((p) => p.id)).toEqual(["example"]);
    load.ensureContent({ EDITION: "expert" });
    expect(content.activeContent()).toBe(first); // 두 번째 부름은 아무 일도 하지 않는다
  });
  it("서버 밖(로컬 서버의 plugins/)에서 적용하는 경우에는 읽지 않는다", async () => {
    const { content, load } = await fresh();
    load.useExternalContent();
    load.ensureContent({ EDITION: "expert" });
    expect(content.activeContent()).toBeNull();
  });
});

describe("방의 규칙 묶음 고정", () => {
  it("진행 중인 판이 없으면 언제나 이어 갈 수 있다", () => {
    expect(isRulesetCurrent(createRoom("ABCD", 0, false, "chess"), "custom-12345678")).toBe(true);
  });
  it("판이 시작될 때의 규칙 묶음과 같을 때만 이어 간다 (예전 판은 official)", () => {
    const room = createRoom("ABCD", 0, false, "chess");
    room.chess = createChessGame(1);
    expect(isRulesetCurrent(room, "official")).toBe(true);
    expect(isRulesetCurrent(room, "custom-12345678")).toBe(false);
    delete room.chess.ruleset; // 이 기능이 생기기 전에 시작한 판
    expect(isRulesetCurrent(room, "official")).toBe(true);
    apply(pack());
    const room2 = createRoom("WXYZ", 0, false, "chess");
    room2.chess = createChessGame(1);
    expect(room2.chess.ruleset).toBe(currentRuleset());
    expect(isRulesetCurrent(room2, currentRuleset())).toBe(true);
    expect(isRulesetCurrent(room2, "official")).toBe(false);
  });
});

describe("/api/server 에 규칙 묶음과 팩이 나온다", () => {
  it("팩이 없으면 official, 있으면 custom 과 팩 목록", () => {
    expect(serverInfo({ AUTH_MODE: "gl" })).toMatchObject({ ruleset: "official", packs: [] });
    apply(pack());
    const info = serverInfo({ AUTH_MODE: "hybrid", EDITION: "expert" });
    expect(info.ruleset).toMatch(/^custom-/);
    expect(info.packs).toEqual([{ id: "demo", name: "시험 팩", version: "1.0.0", kind: "plugin" }]);
  });
});
