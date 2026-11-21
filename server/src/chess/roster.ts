// 체스판 자동 전투의 캐릭터 20명. 설계: docs/DESIGN-autochess.md 7장.
// 숫자는 가격별 기준값에 역할 배율을 곱해서 정하고, 시뮬레이션으로 조정한다.

import type { AbilityId, Piece, Role, UnitDef } from "./types";

const BASE: Record<1 | 2 | 3 | 4, { hp: number; atk: number; energy: number }> = {
  1: { hp: 500, atk: 45, energy: 60 },
  2: { hp: 650, atk: 55, energy: 80 },
  3: { hp: 850, atk: 70, energy: 100 },
  4: { hp: 1100, atk: 85, energy: 120 },
};

/** 전투가 너무 길어지지 않게 공격력에 곱하는 보정(밸런스 측정으로 정함) */
export const ATK_SCALE = 2.5;

/** 역할이 체력과 공격에 주는 배율 */
const ROLE: Record<Role, { hp: number; atk: number }> = {
  탱커: { hp: 1.25, atk: 0.8 },
  딜러: { hp: 0.85, atk: 1.2 },
  서포터: { hp: 0.9, atk: 0.8 },
  지휘: { hp: 1.0, atk: 0.9 },
  제어: { hp: 0.95, atk: 1.0 },
  암살: { hp: 0.85, atk: 1.25 },
  기동: { hp: 0.95, atk: 1.05 },
};

/** 기물이 체력과 공격에 주는 보정 (체스판에서 기물마다 움직임의 자유가 달라서, 밸런스 측정으로 맞춘다) */
const PIECE_TUNING: Record<Piece, { hp: number; atk: number }> = {
  king: { hp: 1, atk: 1 },
  queen: { hp: 0.9, atk: 0.8 },
  rook: { hp: 1.1, atk: 1.15 },
  bishop: { hp: 1.2, atk: 1.25 },
  knight: { hp: 1.05, atk: 1.1 },
  pawn: { hp: 1.1, atk: 1.25 },
};

/** 캐릭터 개별 보정. 측정에서 눈에 띄게 약하거나 강했던 캐릭터만 둔다. */
const TWEAKS: Record<string, { hp?: number; atk?: number }> = {
  dwargon: { atk: 1.25 },
  "toka-loga": { hp: 0.9 },
  mossling: { atk: 1.15 },
  "nut-wolf": { atk: 1.1 },
};

function def(
  id: string, nameKo: string, piece: Piece, faction: string, cost: 1 | 2 | 3 | 4, role: Role,
  ability: AbilityId, abilityText: string, passive = false,
): UnitDef {
  const base = BASE[cost];
  const mult = ROLE[role];
  return {
    id, nameKo, piece, faction, cost, role, ability, passive, abilityText,
    hp: Math.round((base.hp * mult.hp * PIECE_TUNING[piece].hp * (TWEAKS[id]?.hp ?? 1)) / 5) * 5,
    atk: Math.round(base.atk * mult.atk * ATK_SCALE * PIECE_TUNING[piece].atk * (TWEAKS[id]?.atk ?? 1)),
  };
}

export const ROSTER: readonly UnitDef[] = [
  def("nut-wolf", "넛울프", "pawn", "야수", 1, "딜러", "clone", "분신 1마리를 소환한다"),
  def("xenosaurs", "제노사우로스", "pawn", "이계", 1, "탱커", "hatch", "인접 칸에 새끼 1마리를 부화시킨다"),
  def("relic", "렐릭", "pawn", "고대", 1, "탱커", "relic-shield", "쓰러지면 인접 아군에게 보호막을 준다", true),
  def("mossling", "모슬링", "pawn", "숲", 1, "서포터", "spore", "쓰러지면 주변 적을 중독시킨다", true),
  def("skritch", "스크리치", "pawn", "이계", 1, "딜러", "hunger", "처치할 때마다 공격력이 오른다", true),
  def("felis", "펠리스", "bishop", "야수", 1, "서포터", "inspire", "아군 1명의 공격력을 5초간 +20% 올린다"),
  def("lappus", "라푸스", "bishop", "숲", 2, "서포터", "heal", "가장 다친 아군을 회복한다"),
  def("for-the-more", "포더모어", "bishop", "군단", 2, "서포터", "rally", "아군 전체의 공격력을 5초간 +20% 올린다"),
  def("raufaino", "라우페이노", "rook", "군단", 2, "탱커", "shield-wall", "자신과 인접 아군에게 보호막을 준다"),
  def("obelion", "오벨리온", "rook", "고대", 2, "탱커", "stone-skin", "4초간 받는 피해 -50%, 주변 적을 도발한다"),
  def("marshal-berg", "마샬 베르그", "king", "군단", 2, "지휘", "formation", "같은 줄 아군의 공격력을 6초간 +25% 올린다"),
  def("richmond", "리치몬드", "king", "군단", 3, "지휘", "invest", "앞줄 아군 2명의 공격력을 6초간 +30% 올린다"),
  def("rosmaktia", "로즈막티아", "queen", "숲", 3, "딜러", "bloom", "주변 2칸의 적에게 피해를 주고 맞힌 만큼 회복한다"),
  def("arbora", "아르보라", "queen", "숲", 3, "제어", "bind", "가장 가까운 적을 3초간 속박하고 피해를 준다"),
  def("bwtkan-jaws", "부캉죠스", "knight", "야수", 3, "암살", "leap-bite", "가장 약한 적에게 도약해 물어 기절시킨다"),
  def("zephyr", "제피르", "knight", "이계", 3, "기동", "dimension-leap", "적이 모인 곳으로 도약해 주변 적에게 피해를 준다"),
  def("ancient-lord", "에이션트 로드", "king", "고대", 4, "지휘", "pact", "아군 전체가 3초간 받는 피해 -35%"),
  def("toka-loga", "토카로가", "queen", "고대", 4, "딜러", "thunder", "공격력이 높은 적 3명에게 낙뢰를 내린다"),
  def("dwargon", "드워곤", "rook", "야수", 4, "딜러", "dragon-breath", "앞 직선의 적 모두에게 화염을 뿜는다"),
  def("ankio", "안키오", "knight", "이계", 4, "암살", "flank", "적 후열로 순간이동해 큰 피해를 준다"),
];

export const ENERGY_MAX: Record<1 | 2 | 3 | 4, number> = { 1: BASE[1].energy, 2: BASE[2].energy, 3: BASE[3].energy, 4: BASE[4].energy };

/** 공용 풀의 가격별 복사본 수 */
export const POOL_COPIES: Record<1 | 2 | 3 | 4, number> = { 1: 9, 2: 8, 3: 6, 4: 5 };

export function unitDef(id: string): UnitDef | undefined {
  return ROSTER.find((d) => d.id === id);
}

/** ★2의 능력치 배율 */
export const STAR2_STATS = 1.8;
