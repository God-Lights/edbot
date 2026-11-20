// 무기 정의와 레시피. 규칙 출처: 기획서의 "자원과 대장간", "무기 상성". 수치는 초안이고 플레이 테스트로 조정한다.

export type WeaponKind = "heavy" | "polearm" | "ranged"; // 중량, 장병, 원거리
export type MaterialKey = "branch" | "stone" | "ironIngot" | "rare" | "blueprints";
export type WeaponEffect = "burn" | "slow" | "lifesteal";

export interface Weapon {
  id: string;
  nameKo: string;
  kind: WeaponKind;
  /** 1, 2 = 일반 무기의 등급, "special" = 보물상자 설계도로 여는 특수 무기. */
  tier: 1 | 2 | "special";
  /** 공격력 증가 비율. */
  atkBonus: number;
  recipe: Partial<Record<MaterialKey, number>>;
  effect?: WeaponEffect;
  /** 특수 효과 설명. */
  effectText?: string;
}

export const WEAPONS: readonly Weapon[] = [
  { id: "stone-axe", nameKo: "돌도끼", kind: "heavy", tier: 1, atkBonus: 0.12, recipe: { branch: 1, stone: 2 } },
  { id: "wood-spear", nameKo: "나무 창", kind: "polearm", tier: 1, atkBonus: 0.12, recipe: { branch: 2, stone: 1 } },
  { id: "wood-bow", nameKo: "나무 활", kind: "ranged", tier: 1, atkBonus: 0.12, recipe: { branch: 3 } },
  { id: "iron-axe", nameKo: "철 도끼", kind: "heavy", tier: 2, atkBonus: 0.25, recipe: { ironIngot: 2, stone: 1 } },
  { id: "iron-spear", nameKo: "철 창", kind: "polearm", tier: 2, atkBonus: 0.25, recipe: { ironIngot: 2, branch: 1 } },
  { id: "iron-crossbow", nameKo: "철 석궁", kind: "ranged", tier: 2, atkBonus: 0.25, recipe: { ironIngot: 2, branch: 2 } },
  {
    id: "flame-axe", nameKo: "화염 도끼", kind: "heavy", tier: "special", atkBonus: 0.08,
    recipe: { blueprints: 1, ironIngot: 1, stone: 1 }, effect: "burn", effectText: "기본 공격이 3초 동안 화상을 입힌다",
  },
  {
    id: "frost-bow", nameKo: "서리 활", kind: "ranged", tier: "special", atkBonus: 0.08,
    recipe: { blueprints: 1, rare: 1, branch: 2 }, effect: "slow", effectText: "기본 공격이 2초 동안 이동 속도를 20% 늦춘다",
  },
  {
    id: "vampire-spear", nameKo: "흡혈 창", kind: "polearm", tier: "special", atkBonus: 0.08,
    recipe: { blueprints: 1, rare: 1, ironIngot: 1 }, effect: "lifesteal", effectText: "기본 공격으로 준 피해의 10%를 회복한다",
  },
];

export function weaponById(id: string | null | undefined): Weapon | undefined {
  return id ? WEAPONS.find((w) => w.id === id) : undefined;
}

/** 무기 상성: 중량이 장병을, 장병이 원거리를, 원거리가 중량을 이긴다. */
const BEATS: Record<WeaponKind, WeaponKind> = { heavy: "polearm", polearm: "ranged", ranged: "heavy" };
export const ADVANTAGE_DAMAGE = 1.2;
export const DISADVANTAGE_DAMAGE = 0.85;

/** 공격 무기가 방어 무기에게 주는 피해 배율. 한쪽이라도 무기가 없으면 1. */
export function matchupMultiplier(attacker: string | null | undefined, defender: string | null | undefined): number {
  const a = weaponById(attacker);
  const d = weaponById(defender);
  if (!a || !d || a.kind === d.kind) return 1;
  return BEATS[a.kind] === d.kind ? ADVANTAGE_DAMAGE : DISADVANTAGE_DAMAGE;
}
