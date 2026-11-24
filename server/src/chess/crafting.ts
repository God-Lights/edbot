// 조합: 재료와 무기를 서로 합쳐 새로운 재료나 무기를 만든다. 설계: docs/DESIGN-autochess.md 19장.
//
// - 재료 + 재료: 같은 희귀도의 서로 다른 재료 둘 -> 한 단계 위 희귀도의 재료 하나 (어느 재료가 나오는지는 조합표로 정해져 있다)
// - 무기 + 무기: 같은 무기 둘 -> ★2 무기(효과 1.5배), 다른 무기 둘 -> 융합 무기(두 효과를 각각 75%)
// - 무기 + 재료: 그 무기의 원재료를 합치면 -> ★2 무기
// 무기의 이름표(id)는 문자열 하나로 정한다: "clawstone-axe"(기본), "clawstone-axe*"(★2), "clawstone-axe+edmium-blade"(융합, 사전순).

import { activeContent } from "./content";
import { MATERIALS, materialDef, weaponDef } from "./weapons";
import type { Rarity } from "./weapons";

export interface ItemRef {
  kind: "material" | "weapon";
  id: string;
}

/** ★2 무기의 효과 배율 */
export const STAR_POWER = 1.5;
/** 융합 무기에서 각 무기 효과의 배율 */
export const HYBRID_POWER = 0.75;

export interface ParsedWeapon {
  kind: "single" | "star" | "hybrid";
  /** 효과를 내는 기본 무기들 (융합이면 둘) */
  parts: string[];
  power: number;
}

export function parseWeapon(id: string): ParsedWeapon | null {
  if (id.endsWith("*")) {
    const base = id.slice(0, -1);
    return weaponDef(base) ? { kind: "star", parts: [base], power: STAR_POWER } : null;
  }
  if (id.includes("+")) {
    const pieces = id.split("+");
    const [a, b] = pieces;
    // 사전순으로 정렬된 서로 다른 두 무기만 올바른 이름표다
    if (pieces.length !== 2 || !a || !b || a >= b || !weaponDef(a) || !weaponDef(b)) return null;
    return { kind: "hybrid", parts: [a, b], power: HYBRID_POWER };
  }
  return weaponDef(id) ? { kind: "single", parts: [id], power: 1 } : null;
}

export const starWeaponId = (id: string): string => `${id}*`;
export const hybridWeaponId = (a: string, b: string): string => [a, b].sort().join("+");

const NEXT_RARITY: Record<Rarity, Rarity | null> = { common: "uncommon", uncommon: "rare", rare: "legendary", legendary: null };

export interface MaterialFusion {
  a: string;
  b: string;
  result: string;
}

/**
 * 재료 조합표. 같은 희귀도의 서로 다른 두 재료(사전순으로 짝을 세어서)가 한 단계 위 희귀도의 재료를 돌아가며 만든다.
 * 흔함 4종(짝 6개) -> 보통 4종, 보통 4종(6개) -> 희귀 3종, 희귀 3종(3개) -> 전설 2종.
 */
export function buildFusions(materials: ReadonlyArray<{ id: string; rarity: Rarity; special?: boolean }>, fixed: readonly MaterialFusion[] = []): MaterialFusion[] {
  const table: MaterialFusion[] = [...fixed];
  // 진화 재료(special)는 정해진 조합으로만 만든다. 자동 조합표의 재료·결과에는 넣지 않는다.
  const regular = materials.filter((m) => !m.special);
  for (const rarity of ["common", "uncommon", "rare"] as const) {
    const sameTier = regular.filter((m) => m.rarity === rarity).map((m) => m.id).sort();
    const upper = regular.filter((m) => m.rarity === NEXT_RARITY[rarity]).map((m) => m.id);
    if (upper.length === 0) continue;
    // 정해져 있는 짝(공식 조합표)은 그대로 두고, 없는 짝만 위 단계 재료를 돌아가며 채운다.
    let index = table.filter((f) => sameTier.includes(f.a) && sameTier.includes(f.b)).length;
    for (let i = 0; i < sameTier.length; i++) {
      for (let j = i + 1; j < sameTier.length; j++) {
        if (table.some((f) => f.a === sameTier[i] && f.b === sameTier[j])) continue;
        table.push({ a: sameTier[i]!, b: sameTier[j]!, result: upper[index % upper.length]! });
        index += 1;
      }
    }
  }
  return table;
}

/** 진화 재료를 만드는 정해진 조합 (희귀도가 다른 짝이라 자동 조합표의 순서에 영향이 없다) */
export const EVOLUTION_FUSIONS: readonly MaterialFusion[] = [
  // 보통 재료(30% 확률)와 짝지어서 8라운드 안에 모을 수 있게 한다. (희귀 재료 짝은 측정에서 진화가 0회였다)
  { a: "bit", b: "edgem", result: "xe-code" },
  { a: "bit", b: "redocean", result: "ve-code" },
  { a: "clawstone", b: "titanium", result: "zesent" },
];

// 자동 조합표(15개) 뒤에 진화 재료 조합(3개)을 붙인다.
export const MATERIAL_FUSIONS: readonly MaterialFusion[] = [...buildFusions(MATERIALS), ...EVOLUTION_FUSIONS];

/** 지금 적용된 재료 조합표(공식 + 팩). 팩이 없으면 MATERIAL_FUSIONS와 같다. */
export const fusions = (): readonly MaterialFusion[] => activeContent()?.fusions ?? MATERIAL_FUSIONS;

export function fuseMaterials(a: string, b: string): string | null {
  const [x, y] = [a, b].sort();
  return fusions().find((f) => f.a === x && f.b === y)?.result ?? null;
}

/** 두 아이템을 합친 결과. 합칠 수 없으면 null. (순서는 상관없다) */
export function combine(a: ItemRef, b: ItemRef): ItemRef | null {
  if (a.kind === "material" && b.kind === "material") {
    if (a.id === b.id || !materialDef(a.id) || !materialDef(b.id)) return null;
    const result = fuseMaterials(a.id, b.id);
    return result ? { kind: "material", id: result } : null;
  }
  if (a.kind === "weapon" && b.kind === "weapon") {
    const pa = parseWeapon(a.id);
    const pb = parseWeapon(b.id);
    if (!pa || !pb || pa.kind !== "single" || pb.kind !== "single") return null; // ★2와 융합 무기는 더 합치지 않는다
    return { kind: "weapon", id: a.id === b.id ? starWeaponId(a.id) : hybridWeaponId(a.id, b.id) };
  }
  const weapon = a.kind === "weapon" ? a : b;
  const material = a.kind === "material" ? a : b;
  const parsed = parseWeapon(weapon.id);
  if (!parsed || parsed.kind !== "single") return null;
  return weaponDef(weapon.id)?.materialId === material.id ? { kind: "weapon", id: starWeaponId(weapon.id) } : null;
}
