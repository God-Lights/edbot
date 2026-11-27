// 콘텐츠 팩(플러그인)을 검증하고 공식 콘텐츠 위에 얹어서 Content 를 만든다. 형식 설명: docs/PLUGINS.md
//
// - 팩 하나는 JSON 하나다: 캐릭터, 캐릭터 값 조정, 재료·무기, 재료 조합, 규칙 값.
// - 팩은 코드를 담을 수 없다. 능력은 공식 20가지 중에서 고르고, 무기는 숫자 배율만 줄 수 있다. (결정적 전투를 지킨다)
// - 틀린 팩은 통째로 버리고(이유를 돌려준다) 나머지는 적용한다. 팩은 id 순서로 적용해서 결과가 언제나 같다.
// - 팩이 만든 캐릭터·재료·무기 id 는 "팩id:이름" 이다. 공식 id 와 겹치지 않는다.

import { ABILITIES } from "./abilities";
import { OFFICIAL_RULES } from "./content";
import type { Content, PackGuideSection, PackInfo, PackKind, PackResources, PackSummary, Rules, WeaponStats } from "./content";
import { MATERIAL_FUSIONS, buildFusions } from "./crafting";
import { BASE, PIECE_TUNING, ROLE, ROSTER } from "./roster";
import { LITE_IDS } from "./game";
import type { AbilityId, Piece, Role, UnitDef } from "./types";
import { MATERIALS, WEAPONS } from "./weapons";
import type { MaterialDef, Rarity, WeaponDef } from "./weapons";
import type { MaterialFusion } from "./crafting";

/** 팩 형식의 버전. 형식이 호환되지 않게 바뀔 때만 올린다. */
export const CONTENT_API_VERSION = 1;

export const MAX_PACK_UNITS = 40;
export const MAX_TOTAL_UNITS = 120;
export const MAX_TOTAL_MATERIALS = 40;
export const MAX_TOTAL_WEAPONS = 60;

const PIECES: readonly Piece[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];
const ROLES = Object.keys(ROLE) as Role[];
const RARITIES: readonly Rarity[] = ["common", "uncommon", "rare", "legendary"];
const NEXT_RARITY: Record<Rarity, Rarity | null> = { common: "uncommon", uncommon: "rare", rare: "legendary", legendary: null };
/** 에너지로 쓰지 않는 패시브 능력 (공식 캐릭터와 같은 규칙) */
export const PASSIVE_ABILITIES: ReadonlySet<string> = new Set(["relic-shield", "spore", "hunger", "royal-ascent"]);
/** 팩이 바꿀 수 있는 규칙 값과 범위 (정수). poolCopies 는 가격별 1~30 */
export const RULE_RANGES: ReadonlyArray<readonly [keyof Omit<Rules, "poolCopies">, number, number]> = [
  ["startHp", 5, 200], ["startGold", 0, 50], ["baseIncome", 0, 20], ["maxInterest", 0, 10], ["maxRounds", 1, 20],
  ["maxDeploy", 3, 10], ["rerollCost", 0, 10], ["prepSeconds", 5, 120], ["firstPrepSeconds", 5, 180],
];
/** 캐릭터 배율(hpMult·atkMult) 범위와 무기 배율 범위 */
export const UNIT_MULT_RANGE = [0.3, 3] as const;
export const WEAPON_STAT_RANGES = { atk: [0.5, 2], hp: [0.5, 2], dmgTaken: [0.5, 1.5], energy: [0.5, 2] } as const;
const ID = /^[a-z][a-z0-9-]{0,30}$/;
const PACK_ID = /^[a-z][a-z0-9-]{1,30}$/;
const GAMEPLAY_KEYS = ["units", "unitOverrides", "materials", "weapons", "fusions", "rules"] as const;
const TOP_KEYS = new Set(["apiVersion", "id", "name", "version", "description", "kind", "author", "guide", "resources", ...GAMEPLAY_KEYS]);
const KINDS: readonly PackKind[] = ["plugin", "resource", "bundle"];

// ---- 리소스(화면·소리) ----
/** 바꿀 수 있는 색 (웹 CSS 변수와 가격 색) */
export const COLOR_KEYS = ["bgTop", "bgBottom", "panel", "gold", "goldHi", "accent", "text", "mine", "theirs", "cost1", "cost2", "cost3", "cost4", "cost5"] as const;
/** 바꿀 수 있는 효과음 (web/js/sfx.js 의 이름) */
export const SOUND_NAMES = [
  "click", "buy", "sell", "place", "ready", "hit", "ability", "death", "promote", "mine", "roundWin", "roundLose", "win", "lose",
  "pickup", "drop", "equip", "smelt", "combine", "merge", "full", "roundStart", "combatStart", "ghost", "surface", "tick", "suddenDeath",
] as const;
export const MUSIC_TRACKS = ["prep", "combat", "finale"] as const;
const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];
const AUDIO_EXT = ["mp3", "ogg", "m4a", "wav"];
/** 팩 안 파일 경로: 상대 경로, 영문·숫자·_-./ 만, .. 없음 (SVG·HTML 같은 문서 파일은 받지 않는다) */
const ASSET_PATH = /^[A-Za-z0-9_][A-Za-z0-9_\-./]{0,119}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_GUIDE_SECTIONS = 12;
export const MAX_UNIT_ART = 150;

/** 리소스 파일이 서버에서 보이는 주소 (로컬 서버·서버 앱이 plugins/ 의 팩 폴더에서 내준다) */
export const packAssetUrl = (packId: string, path: string): string => `/packs/${packId}/${path}`;

export interface BuildResult {
  /** 받아들인 팩이 없으면 null (= 공식 그대로) */
  content: Content | null;
  accepted: PackInfo[];
  rejected: Array<{ id: string; errors: string[] }>;
}

interface State {
  units: UnitDef[];
  liteIds: string[];
  materials: MaterialDef[];
  weapons: WeaponDef[];
  weaponStats: Record<string, WeaponStats>;
  fixedFusions: MaterialFusion[];
  rules: Rules;
}

function officialState(): State {
  return {
    units: ROSTER.map((u) => ({ ...u })),
    liteIds: [...LITE_IDS],
    materials: MATERIALS.map((m) => ({ ...m })),
    weapons: WEAPONS.map((w) => ({ ...w })),
    weaponStats: {},
    fixedFusions: MATERIAL_FUSIONS.map((f) => ({ ...f })),
    rules: { ...OFFICIAL_RULES, poolCopies: { ...OFFICIAL_RULES.poolCopies } },
  };
}

// ---- 값 점검 도구 ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Check {
  readonly errors: string[] = [];
  constructor(private readonly where: string) {}
  fail(path: string, message: string): void {
    this.errors.push(`${this.where}${path ? ` ${path}` : ""}: ${message}`);
  }
  str(o: Obj, key: string, path: string, opts: { max?: number; optional?: boolean } = {}): string | undefined {
    const v = o[key];
    if (v === undefined && opts.optional) return undefined;
    if (typeof v !== "string" || v.trim() === "") {
      this.fail(`${path}.${key}`, "글자(문자열)가 있어야 한다.");
      return undefined;
    }
    if (v.length > (opts.max ?? 80)) this.fail(`${path}.${key}`, `${opts.max ?? 80}자 이하여야 한다.`);
    return v.trim();
  }
  num(o: Obj, key: string, path: string, min: number, max: number, opts: { int?: boolean; optional?: boolean } = {}): number | undefined {
    const v = o[key];
    if (v === undefined && opts.optional) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || (opts.int && !Number.isInteger(v)) || v < min || v > max) {
      this.fail(`${path}.${key}`, `${opts.int ? "정수" : "숫자"} ${min}~${max} 이어야 한다.`);
      return undefined;
    }
    return v;
  }
  oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[]): T | undefined {
    const v = o[key];
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      this.fail(`${path}.${key}`, `${allowed.join(", ")} 중 하나여야 한다.`);
      return undefined;
    }
    return v as T;
  }
  noExtra(o: Obj, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(o)) if (!allowed.includes(key)) this.fail(path, `알 수 없는 항목 "${key}" (오타일 수 있다)`);
  }
}

const round5 = (n: number): number => Math.round(n / 5) * 5;

/** 공식 캐릭터와 같은 식으로 능력치를 정한다. (가격별 기준값 x 역할 x 기물 보정) */
function buildUnit(
  id: string, nameKo: string, piece: Piece, faction: string, cost: 1 | 2 | 3 | 4, role: Role, ability: AbilityId, abilityText: string,
  hpMult: number, atkMult: number,
): UnitDef {
  const base = BASE[cost];
  return {
    id, nameKo, piece, faction, cost, role, ability, abilityText, passive: PASSIVE_ABILITIES.has(ability),
    hp: round5(base.hp * ROLE[role].hp * PIECE_TUNING[piece].hp * hpMult),
    atk: Math.round(base.atk * ROLE[role].atk * 2.5 * PIECE_TUNING[piece].atk * atkMult),
  };
}

// ---- 팩 하나를 얹는다 ----

function applyPack(base: State, raw: unknown): { state: State; info: PackInfo } | { errors: string[]; id: string } {
  const idForError = isObj(raw) && typeof raw.id === "string" ? raw.id : "(id 없음)";
  const c = new Check(`팩 "${idForError}"`);
  if (!isObj(raw)) return { errors: ['팩은 JSON 객체여야 한다.'], id: idForError };
  c.noExtra(raw, "", [...TOP_KEYS]);
  if (raw.apiVersion !== CONTENT_API_VERSION) c.fail("apiVersion", `${CONTENT_API_VERSION} 이어야 한다. (이 서버가 아는 팩 형식 버전)`);
  const packId = c.str(raw, "id", "", { max: 31 });
  if (packId !== undefined && !PACK_ID.test(packId)) c.fail("id", "영소문자로 시작하는 영소문자·숫자·하이픈 2~31자여야 한다.");
  const name = c.str(raw, "name", "", { max: 40 });
  const version = c.str(raw, "version", "", { max: 20 });
  if (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 300)) c.fail("description", "300자 이하 글자여야 한다.");
  const author = c.str(raw, "author", "", { max: 40, optional: true });
  const hasGameplay = GAMEPLAY_KEYS.some((k) => raw[k] !== undefined);
  const hasResources = raw.resources !== undefined;
  // kind 를 안 적으면 내용으로 정한다 (예전 팩은 plugin)
  let kind: PackKind = hasResources ? (hasGameplay ? "bundle" : "resource") : "plugin";
  if (raw.kind !== undefined) {
    const k = c.oneOf(raw, "kind", "", KINDS);
    if (k) kind = k;
    if (k === "resource" && hasGameplay) c.fail("kind", `리소스 팩에는 규칙·캐릭터(${GAMEPLAY_KEYS.filter((x) => raw[x] !== undefined).join(", ")})를 넣을 수 없다. 종합 팩이면 "bundle".`);
    if (k === "plugin" && hasResources) c.fail("kind", '플러그인 팩에는 resources 를 넣을 수 없다. 종합 팩이면 "bundle".');
  }
  const guide: PackGuideSection[] = [];
  if (raw.guide !== undefined) {
    if (!Array.isArray(raw.guide)) c.fail("guide", "[{ title, body }] 목록이어야 한다.");
    else {
      if (raw.guide.length > MAX_GUIDE_SECTIONS) c.fail("guide", `${MAX_GUIDE_SECTIONS}개까지다.`);
      raw.guide.forEach((g, i) => {
        const path = `guide[${i}]`;
        if (!isObj(g)) return c.fail(path, "객체여야 한다.");
        c.noExtra(g, path, ["title", "body"]);
        const title = c.str(g, "title", path, { max: 40 });
        const body = c.str(g, "body", path, { max: 4000 });
        if (title && body) guide.push({ title, body });
      });
    }
  }

  const state: State = {
    units: base.units.map((u) => ({ ...u })),
    liteIds: [...base.liteIds],
    materials: base.materials.map((m) => ({ ...m })),
    weapons: base.weapons.map((w) => ({ ...w })),
    weaponStats: { ...base.weaponStats },
    fixedFusions: base.fixedFusions.map((f) => ({ ...f })),
    rules: { ...base.rules, poolCopies: { ...base.rules.poolCopies } },
  };
  const prefix = packId ?? "pack";
  const full = (local: string): string => `${prefix}:${local}`;
  const abilityIds = Object.keys(ABILITIES);

  // 캐릭터 값 조정 (공식·다른 팩의 캐릭터)
  if (raw.unitOverrides !== undefined) {
    if (!isObj(raw.unitOverrides)) c.fail("unitOverrides", "{ 캐릭터id: { ... } } 형태여야 한다.");
    else {
      for (const [uid, value] of Object.entries(raw.unitOverrides)) {
        const path = `unitOverrides.${uid}`;
        const index = state.units.findIndex((u) => u.id === uid);
        if (index < 0 || !isObj(value)) {
          c.fail(path, index < 0 ? "그런 캐릭터가 없다." : "객체여야 한다.");
          continue;
        }
        c.noExtra(value, path, ["hpMult", "atkMult", "nameKo", "abilityText", "lite"]);
        const hpMult = c.num(value, "hpMult", path, 0.3, 3, { optional: true });
        const atkMult = c.num(value, "atkMult", path, 0.3, 3, { optional: true });
        const nameKo = c.str(value, "nameKo", path, { max: 24, optional: true });
        const abilityText = c.str(value, "abilityText", path, { max: 80, optional: true });
        if (value.lite !== undefined && typeof value.lite !== "boolean") c.fail(`${path}.lite`, "true 또는 false 여야 한다.");
        const old = state.units[index]!;
        state.units[index] = {
          ...old,
          hp: hpMult === undefined ? old.hp : round5(old.hp * hpMult),
          atk: atkMult === undefined ? old.atk : Math.round(old.atk * atkMult),
          nameKo: nameKo ?? old.nameKo,
          abilityText: abilityText ?? old.abilityText,
        };
        if (value.lite === true && !state.liteIds.includes(uid)) state.liteIds.push(uid);
        if (value.lite === false) state.liteIds = state.liteIds.filter((x) => x !== uid);
      }
    }
  }

  // 새 캐릭터
  if (raw.units !== undefined) {
    if (!Array.isArray(raw.units)) c.fail("units", "목록이어야 한다.");
    else {
      if (raw.units.length > MAX_PACK_UNITS) c.fail("units", `한 팩에 ${MAX_PACK_UNITS}명까지다.`);
      const seen = new Set<string>();
      raw.units.forEach((u, i) => {
        const path = `units[${i}]`;
        if (!isObj(u)) return c.fail(path, "객체여야 한다.");
        c.noExtra(u, path, ["id", "nameKo", "piece", "faction", "cost", "role", "ability", "abilityText", "hpMult", "atkMult", "lite"]);
        const local = c.str(u, "id", path, { max: 31 });
        if (local !== undefined) {
          if (!ID.test(local)) c.fail(`${path}.id`, "영소문자로 시작하는 영소문자·숫자·하이픈 1~31자여야 한다.");
          if (seen.has(local)) c.fail(`${path}.id`, `"${local}" 이(가) 두 번 나온다.`);
          seen.add(local);
        }
        const nameKo = c.str(u, "nameKo", path, { max: 24 });
        const piece = c.oneOf(u, "piece", path, PIECES);
        const faction = c.str(u, "faction", path, { max: 16 });
        const cost = c.num(u, "cost", path, 1, 4, { int: true });
        const role = c.oneOf(u, "role", path, ROLES);
        const ability = c.oneOf(u, "ability", path, abilityIds as AbilityId[]);
        const abilityText = c.str(u, "abilityText", path, { max: 80 });
        const hpMult = c.num(u, "hpMult", path, 0.3, 3, { optional: true }) ?? 1;
        const atkMult = c.num(u, "atkMult", path, 0.3, 3, { optional: true }) ?? 1;
        if (u.lite !== undefined && typeof u.lite !== "boolean") c.fail(`${path}.lite`, "true 또는 false 여야 한다.");
        if (local && nameKo && piece && faction && cost && role && ability && abilityText) {
          const id = full(local);
          if (state.units.some((x) => x.id === id)) c.fail(`${path}.id`, `"${id}" 은(는) 이미 있다.`);
          else {
            state.units.push(buildUnit(id, nameKo, piece, faction, cost as 1 | 2 | 3 | 4, role, ability, abilityText, hpMult, atkMult));
            if (u.lite === true) state.liteIds.push(id);
          }
        }
      });
    }
  }

  // 새 재료와 무기: 서로를 가리켜야 한다. (재료를 재련하면 그 무기가 나온다)
  const newMaterials = new Map<string, { nameKo: string; rarity: Rarity; weapon: string }>();
  const newWeapons = new Map<string, { nameKo: string; material: string; rarity: Rarity; text: string; stats: WeaponStats }>();
  if (raw.weapons !== undefined) {
    if (!Array.isArray(raw.weapons)) c.fail("weapons", "목록이어야 한다.");
    else {
      raw.weapons.forEach((w, i) => {
        const path = `weapons[${i}]`;
        if (!isObj(w)) return c.fail(path, "객체여야 한다.");
        c.noExtra(w, path, ["id", "nameKo", "material", "rarity", "text", "stats"]);
        const local = c.str(w, "id", path, { max: 31 });
        if (local !== undefined && !ID.test(local)) c.fail(`${path}.id`, "영소문자로 시작하는 영소문자·숫자·하이픈 1~31자여야 한다.");
        const nameKo = c.str(w, "nameKo", path, { max: 24 });
        const material = c.str(w, "material", path, { max: 31 });
        const rarity = c.oneOf(w, "rarity", path, RARITIES);
        const text = c.str(w, "text", path, { max: 100 });
        const stats: WeaponStats = {};
        if (!isObj(w.stats)) c.fail(`${path}.stats`, "{ atk, hp, dmgTaken, energy } 중 하나 이상이 있어야 한다. (배율, 1이 기본)");
        else {
          c.noExtra(w.stats, `${path}.stats`, ["atk", "hp", "dmgTaken", "energy"]);
          const atk = c.num(w.stats, "atk", `${path}.stats`, 0.5, 2, { optional: true });
          const hp = c.num(w.stats, "hp", `${path}.stats`, 0.5, 2, { optional: true });
          const dmgTaken = c.num(w.stats, "dmgTaken", `${path}.stats`, 0.5, 1.5, { optional: true });
          const energy = c.num(w.stats, "energy", `${path}.stats`, 0.5, 2, { optional: true });
          if (atk !== undefined) stats.atk = atk;
          if (hp !== undefined) stats.hp = hp;
          if (dmgTaken !== undefined) stats.dmgTaken = dmgTaken;
          if (energy !== undefined) stats.energy = energy;
          if (Object.keys(stats).length === 0) c.fail(`${path}.stats`, "배율이 하나 이상 있어야 한다.");
        }
        if (local && nameKo && material && rarity && text) {
          if (newWeapons.has(local)) c.fail(`${path}.id`, `"${local}" 이(가) 두 번 나온다.`);
          else newWeapons.set(local, { nameKo, material, rarity, text, stats });
        }
      });
    }
  }
  if (raw.materials !== undefined) {
    if (!Array.isArray(raw.materials)) c.fail("materials", "목록이어야 한다.");
    else {
      raw.materials.forEach((m, i) => {
        const path = `materials[${i}]`;
        if (!isObj(m)) return c.fail(path, "객체여야 한다.");
        c.noExtra(m, path, ["id", "nameKo", "rarity", "weapon"]);
        const local = c.str(m, "id", path, { max: 31 });
        if (local !== undefined && !ID.test(local)) c.fail(`${path}.id`, "영소문자로 시작하는 영소문자·숫자·하이픈 1~31자여야 한다.");
        const nameKo = c.str(m, "nameKo", path, { max: 24 });
        const rarity = c.oneOf(m, "rarity", path, RARITIES);
        const weapon = c.str(m, "weapon", path, { max: 31 });
        if (local && nameKo && rarity && weapon) {
          if (newMaterials.has(local)) c.fail(`${path}.id`, `"${local}" 이(가) 두 번 나온다.`);
          else newMaterials.set(local, { nameKo, rarity, weapon });
        }
      });
    }
  }
  for (const [local, m] of newMaterials) {
    const w = newWeapons.get(m.weapon);
    if (!w) c.fail(`materials.${local}`, `재련하면 나오는 무기 "${m.weapon}" 이(가) 이 팩의 weapons 에 없다.`);
    else if (w.material !== local) c.fail(`materials.${local}`, `무기 "${m.weapon}" 의 material 이 "${w.material}" 이다. 재료와 무기가 서로를 가리켜야 한다.`);
    else if (w.rarity !== m.rarity) c.fail(`materials.${local}`, `재료(${m.rarity})와 무기(${w.rarity})의 희귀도가 같아야 한다.`);
  }
  for (const [local, w] of newWeapons) {
    if (!newMaterials.has(w.material)) c.fail(`weapons.${local}`, `무기의 material "${w.material}" 이(가) 이 팩의 materials 에 없다.`);
  }
  if (c.errors.length === 0) {
    for (const [local, m] of newMaterials) {
      const w = newWeapons.get(m.weapon)!;
      state.materials.push({ id: full(local), nameKo: m.nameKo, rarity: m.rarity, weaponId: full(m.weapon) });
      state.weapons.push({ id: full(m.weapon), nameKo: w.nameKo, materialId: full(local), rarity: w.rarity, text: w.text });
      state.weaponStats[full(m.weapon)] = w.stats;
    }
  }

  // 재료 조합: 정하지 않은 짝은 자동으로 채운다
  if (raw.fusions !== undefined) {
    if (!Array.isArray(raw.fusions)) c.fail("fusions", "목록이어야 한다.");
    else {
      const resolve = (ref: string): string => (newMaterials.has(ref) ? full(ref) : ref);
      raw.fusions.forEach((f, i) => {
        const path = `fusions[${i}]`;
        if (!isObj(f)) return c.fail(path, "객체여야 한다.");
        c.noExtra(f, path, ["a", "b", "result"]);
        const a = c.str(f, "a", path, { max: 63 });
        const b = c.str(f, "b", path, { max: 63 });
        const result = c.str(f, "result", path, { max: 63 });
        if (!a || !b || !result) return;
        const [ra, rb, rr] = [resolve(a), resolve(b), resolve(result)];
        const [ma, mb, mr] = [ra, rb, rr].map((id) => state.materials.find((m) => m.id === id));
        if (!ma || !mb || !mr) return c.fail(path, "없는 재료가 있다. (이 팩의 재료는 짧은 id, 공식·다른 팩 재료는 전체 id)");
        if (ra === rb) return c.fail(path, "서로 다른 두 재료여야 한다.");
        if (ma.rarity !== mb.rarity || NEXT_RARITY[ma.rarity] !== mr.rarity) return c.fail(path, "같은 희귀도의 재료 둘 -> 한 단계 위 희귀도의 재료여야 한다.");
        const [x, y] = [ra, rb].sort() as [string, string];
        state.fixedFusions = state.fixedFusions.filter((existing) => !(existing.a === x && existing.b === y));
        state.fixedFusions.push({ a: x, b: y, result: rr });
      });
    }
  }

  // 규칙 값
  if (raw.rules !== undefined) {
    if (!isObj(raw.rules)) c.fail("rules", "객체여야 한다.");
    else {
      const r = raw.rules;
      c.noExtra(r, "rules", ["startHp", "startGold", "baseIncome", "maxInterest", "maxRounds", "maxDeploy", "rerollCost", "prepSeconds", "firstPrepSeconds", "poolCopies"]);
      for (const [key, min, max] of RULE_RANGES) {
        const v = c.num(r, key, "rules", min, max, { int: true, optional: true });
        if (v !== undefined) state.rules[key] = v;
      }
      if (r.poolCopies !== undefined) {
        if (!isObj(r.poolCopies)) c.fail("rules.poolCopies", "{ \"1\": 9, \"2\": 8, \"3\": 6, \"4\": 5 } 형태여야 한다.");
        else {
          c.noExtra(r.poolCopies, "rules.poolCopies", ["1", "2", "3", "4"]);
          for (const cost of [1, 2, 3, 4] as const) {
            const v = c.num(r.poolCopies, String(cost), "rules.poolCopies", 1, 30, { int: true, optional: true });
            if (v !== undefined) state.rules.poolCopies[cost] = v;
          }
        }
      }
    }
  }

  // 리소스: 색, 로고·배경, 캐릭터 그림, 효과음·음악 (경로는 팩 폴더 안의 파일)
  let resources: PackResources | undefined;
  if (hasResources) {
    const res = raw.resources;
    if (!isObj(res)) c.fail("resources", "객체여야 한다.");
    else {
      resources = {};
      c.noExtra(res, "resources", ["colors", "logo", "lobbyBackground", "boardBackground", "units", "sounds", "music"]);
      const asset = (value: unknown, path: string, exts: readonly string[]): string | undefined => {
        if (typeof value !== "string" || !ASSET_PATH.test(value) || value.includes("..") || value.includes("//")) {
          c.fail(path, "팩 안의 파일 경로여야 한다. (예: assets/logo.png, 영문·숫자·_-./ 만)");
          return undefined;
        }
        const ext = value.split(".").pop()!.toLowerCase();
        if (!exts.includes(ext)) {
          c.fail(path, `${exts.join(", ")} 파일이어야 한다.`);
          return undefined;
        }
        return packAssetUrl(packId ?? "pack", value);
      };
      if (res.colors !== undefined) {
        if (!isObj(res.colors)) c.fail("resources.colors", "{ 이름: \"#rrggbb\" } 형태여야 한다.");
        else {
          c.noExtra(res.colors, "resources.colors", COLOR_KEYS);
          const colors: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.colors)) {
            if (typeof v !== "string" || !COLOR.test(v)) c.fail(`resources.colors.${k}`, "#rrggbb 색이어야 한다.");
            else colors[k] = v.toLowerCase();
          }
          resources.colors = colors;
        }
      }
      for (const key of ["logo", "lobbyBackground", "boardBackground"] as const) {
        if (res[key] !== undefined) resources[key] = asset(res[key], `resources.${key}`, IMAGE_EXT);
      }
      if (res.units !== undefined) {
        if (!isObj(res.units)) c.fail("resources.units", "{ 캐릭터id: 그림 경로 } 형태여야 한다.");
        else {
          if (Object.keys(res.units).length > MAX_UNIT_ART) c.fail("resources.units", `${MAX_UNIT_ART}개까지다.`);
          const units: Record<string, string> = {};
          for (const [uid, v] of Object.entries(res.units)) {
            // 이 팩의 캐릭터는 짧은 id, 공식·다른 팩 캐릭터는 전체 id
            const id = state.units.some((u) => u.id === full(uid)) ? full(uid) : uid;
            if (!state.units.some((u) => u.id === id)) { c.fail(`resources.units.${uid}`, "그런 캐릭터가 없다."); continue; }
            const url = asset(v, `resources.units.${uid}`, IMAGE_EXT);
            if (url) units[id] = url;
          }
          resources.units = units;
        }
      }
      if (res.sounds !== undefined) {
        if (!isObj(res.sounds)) c.fail("resources.sounds", "{ 효과음 이름: 소리 경로 } 형태여야 한다.");
        else {
          c.noExtra(res.sounds, "resources.sounds", SOUND_NAMES);
          const sounds: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.sounds)) { const url = asset(v, `resources.sounds.${k}`, AUDIO_EXT); if (url) sounds[k] = url; }
          resources.sounds = sounds;
        }
      }
      if (res.music !== undefined) {
        if (!isObj(res.music)) c.fail("resources.music", "{ prep, combat, finale } 형태여야 한다.");
        else {
          c.noExtra(res.music, "resources.music", MUSIC_TRACKS);
          const music: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.music)) { const url = asset(v, `resources.music.${k}`, AUDIO_EXT); if (url) music[k] = url; }
          resources.music = music;
        }
      }
    }
  }

  // 요약 (가이드 "팩" 탭의 자동 설명)
  const summary: PackSummary = {
    units: state.units.filter((u) => !base.units.some((b) => b.id === u.id)).map((u) => u.id),
    overrides: isObj(raw.unitOverrides) ? Object.keys(raw.unitOverrides) : [],
    materials: state.materials.filter((m) => !base.materials.some((b) => b.id === m.id)).map((m) => m.id),
    weapons: state.weapons.filter((w) => !base.weapons.some((b) => b.id === w.id)).map((w) => w.id),
    rules: isObj(raw.rules) ? Object.keys(raw.rules) : [],
  };

  // 전체 점검: 개수 제한, 가격·희귀도마다 하나 이상
  if (c.errors.length === 0) {
    if (state.units.length > MAX_TOTAL_UNITS) c.fail("", `캐릭터가 너무 많다. (전체 ${MAX_TOTAL_UNITS}명까지)`);
    if (state.materials.length > MAX_TOTAL_MATERIALS) c.fail("", `재료가 너무 많다. (전체 ${MAX_TOTAL_MATERIALS}종까지)`);
    if (state.weapons.length > MAX_TOTAL_WEAPONS) c.fail("", `무기가 너무 많다. (전체 ${MAX_TOTAL_WEAPONS}종까지)`);
  }
  if (c.errors.length > 0 || !name || !version || !packId) return { errors: c.errors, id: idForError };
  const info: PackInfo = { id: packId, name, version, kind, summary };
  if (typeof raw.description === "string" && raw.description.trim()) info.description = raw.description.trim();
  if (author) info.author = author;
  if (guide.length) info.guide = guide;
  if (resources) info.resources = resources;
  return { state, info };
}

// ---- 해시(규칙 묶음 이름) ----

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 팩들을 검증하고 얹어서 Content 를 만든다. 팩은 id 순서로 적용한다.
 * 같은 팩 id 가 둘이면 뒤의 것을 버린다. 받아들인 팩이 하나도 없으면 content 는 null(공식).
 */
export function buildContent(rawPacks: readonly unknown[]): BuildResult {
  const accepted: PackInfo[] = [];
  const rejected: Array<{ id: string; errors: string[] }> = [];
  let state = officialState();
  const ordered = [...rawPacks].sort((a, b) => String(isObj(a) ? a.id : "").localeCompare(String(isObj(b) ? b.id : "")));
  for (const raw of ordered) {
    const rawId = isObj(raw) && typeof raw.id === "string" ? raw.id : "";
    if (rawId && accepted.some((p) => p.id === rawId)) {
      rejected.push({ id: rawId, errors: [`팩 "${rawId}": 같은 id의 팩이 둘이다. 뒤의 것은 쓰지 않는다.`] });
      continue;
    }
    const result = applyPack(state, raw);
    if ("errors" in result) {
      rejected.push({ id: result.id, errors: result.errors });
      continue;
    }
    state = result.state;
    accepted.push(result.info);
  }
  if (accepted.length === 0) return { content: null, accepted, rejected };

  const fusions = buildFusions(state.materials, state.fixedFusions);
  const body = { units: state.units, materials: state.materials, weapons: state.weapons, weaponStats: state.weaponStats, fusions, rules: state.rules, liteIds: state.liteIds };
  // 리소스 팩만 있으면 규칙은 공식 그대로다 (진행 중인 판·전적이 공식과 같은 규칙으로 남는다)
  const gameplay = accepted.some((p) => p.kind !== "resource");
  const content: Content = {
    ruleset: gameplay ? `custom-${fnv1a(JSON.stringify(body))}` : "official",
    packs: accepted,
    units: state.units,
    unitMap: new Map(state.units.map((u) => [u.id, u])),
    liteIds: state.liteIds,
    materials: state.materials,
    weapons: state.weapons,
    weaponStats: state.weaponStats,
    fusions,
    rules: state.rules,
  };
  return { content, accepted, rejected };
}
