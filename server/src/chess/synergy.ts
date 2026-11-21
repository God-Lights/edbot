// 기물 시너지 (설계 8장). 같은 기물이 2명(폰은 2명/4명) 모이면 팀 전체 보너스, 3명(폰 4명)이면 효과가 약 2배.
// 같은 캐릭터는 몇 장이든 한 명으로 센다. 수치는 시뮬레이션으로 조정하는 초안이다.

import { unitDef } from "./roster";
import type { Piece, SynergyBonus } from "./types";

export interface SynergyInfo {
  id: string;
  piece: Piece;
  /** 켜지는 인원 (2 또는 3/4) */
  need: number;
  tier: 1 | 2;
  nameKo: string;
  text: string;
}

const PIECE_NAME: Record<Piece, string> = { king: "킹", queen: "퀸", rook: "룩", bishop: "비숍", knight: "나이트", pawn: "폰" };

/** 기물별 단계 인원: 폰은 2/4명, 나머지는 2/3명 */
const THRESHOLDS: Record<Piece, [number, number]> = {
  king: [2, 3], queen: [2, 3], rook: [2, 3], bishop: [2, 3], knight: [2, 3], pawn: [2, 4],
};

const TEXT: Record<Piece, string> = {
  king: "팀 전체 에너지 충전 +20%",
  queen: "능력 피해 +15%",
  rook: "받는 피해 -10%",
  bishop: "회복·보호막 +40%, 팀 공격 +8%",
  knight: "첫 도약 후 5초간 나이트 공격 +20%",
  pawn: "폰 전체 공격 +20% (4명이면 체력 +40%도)",
};

export function synergyId(piece: Piece, tier: 1 | 2): string {
  return `${piece}-${tier}`;
}

export function synergyInfo(id: string): SynergyInfo | undefined {
  return ALL_SYNERGIES.find((s) => s.id === id);
}

export const ALL_SYNERGIES: readonly SynergyInfo[] = (Object.keys(THRESHOLDS) as Piece[]).flatMap((piece) =>
  ([1, 2] as const).map((tier) => ({
    id: synergyId(piece, tier),
    piece,
    need: THRESHOLDS[piece][tier - 1]!,
    tier,
    nameKo: `${PIECE_NAME[piece]} ${THRESHOLDS[piece][tier - 1]}명`,
    text: tier === 1 ? TEXT[piece] : `${TEXT[piece]} (약 2배)`,
  })),
);

/** 켜진 시너지 id. 각 기물은 가장 높은 단계 하나만 켜진다. */
export function activeSynergies(defIds: string[]): string[] {
  const unique = [...new Set(defIds)];
  const counts = new Map<Piece, number>();
  for (const id of unique) {
    const piece = unitDef(id)?.piece;
    if (piece) counts.set(piece, (counts.get(piece) ?? 0) + 1);
  }
  const active: string[] = [];
  for (const piece of Object.keys(THRESHOLDS) as Piece[]) {
    const n = counts.get(piece) ?? 0;
    const [t1, t2] = THRESHOLDS[piece];
    if (n >= t2) active.push(synergyId(piece, 2));
    else if (n >= t1) active.push(synergyId(piece, 1));
  }
  return active;
}

export function neutralBonus(): SynergyBonus {
  return { energyGain: 1, abilityDamage: 1, dmgTaken: 1, healShield: 1, knightBoost: false, pawnAtk: 1, pawnHp: 1, teamAtk: 1 };
}

/** 켜진 시너지를 효과 수치로 합친다. (2단계는 효과가 1.5배) */
export function combineBonuses(ids: string[]): SynergyBonus {
  const b = neutralBonus();
  for (const id of ids) {
    const info = synergyInfo(id);
    if (!info) continue;
    const k = info.tier === 2 ? 2 : 1;
    switch (info.piece) {
      case "king": b.energyGain *= 1 + 0.2 * k; break;
      case "queen": b.abilityDamage *= 1 + 0.15 * k; break;
      case "rook": b.dmgTaken *= 1 - 0.1 * k; break;
      case "bishop": b.healShield *= 1 + 0.4 * k; b.teamAtk *= 1 + 0.08 * k; break;
      case "knight": b.knightBoost = true; break;
      case "pawn":
        b.pawnAtk *= 1 + 0.2 * k;
        if (info.tier === 2) b.pawnHp *= 1.4;
        break;
    }
  }
  return b;
}
