// 캐릭터 시너지: 뽑은 5명의 구성에 따라 팀 전체가 받는 보너스. 드래프트에서 구성을 고민하게 만드는 장치다.
// 시너지는 전투가 시작될 때의 팀 구성으로 정해지고 판 내내 유지된다. 수치는 작게 잡았고 플레이 테스트로 조정한다.
// (서버가 계산하고, 앱은 `GET /api/synergies` 목록과 방 상태의 `game.synergies`로 보여 준다.)

import { characterById } from "./characters";
import type { Piece } from "./protocol";

/** 시너지가 바꾸는 값. 곱하는 값은 1이 기본, respawnReduceTicks는 빼 주는 틱. */
export interface SynergyEffects {
  dmgTaken: number;
  atk: number;
  speed: number;
  towerDmg: number;
  /** 스킬 쿨다운 배율 (작을수록 빨리 돌아온다) */
  cooldown: number;
  /** 최대 체력 배율 (전투가 시작될 때 한 번 적용) */
  maxHp: number;
  respawnReduceTicks: number;
}

export interface Synergy {
  id: string;
  nameKo: string;
  /** 어떻게 만드는가 (화면에 보여 줄 문장) */
  requirement: string;
  /** 무엇을 주는가 */
  description: string;
  effects: Partial<SynergyEffects>;
  /** 팀 구성(캐릭터 id 목록)이 조건을 채웠는가 */
  active(team: string[]): boolean;
}

const pieces = (team: string[]): Piece[] => team.flatMap((id) => characterById(id)?.piece ?? []);
const count = (team: string[], piece: Piece): number => pieces(team).filter((p) => p === piece).length;
const has = (team: string[], ...ids: string[]): boolean => ids.every((id) => team.includes(id));

export const SYNERGIES: readonly Synergy[] = [
  {
    id: "twin-kings", nameKo: "쌍왕", requirement: "킹 2명", description: "팀 전체가 받는 피해 -5%",
    effects: { dmgTaken: 0.95 }, active: (t) => count(t, "king") >= 2,
  },
  {
    id: "twin-queens", nameKo: "여왕의 화력", requirement: "퀸 2명", description: "팀 전체의 스킬 쿨다운 -10%",
    effects: { cooldown: 0.9 }, active: (t) => count(t, "queen") >= 2,
  },
  {
    id: "twin-rooks", nameKo: "철옹성", requirement: "룩 2명", description: "팀 전체가 타워에 주는 피해 +15%",
    effects: { towerDmg: 1.15 }, active: (t) => count(t, "rook") >= 2,
  },
  {
    id: "twin-bishops", nameKo: "성가대", requirement: "비숍 2명", description: "팀 전체의 최대 체력 +8%",
    effects: { maxHp: 1.08 }, active: (t) => count(t, "bishop") >= 2,
  },
  {
    id: "twin-knights", nameKo: "기습조", requirement: "나이트 2명", description: "팀 전체의 이동 속도 +8%",
    effects: { speed: 1.08 }, active: (t) => count(t, "knight") >= 2,
  },
  {
    id: "twin-pawns", nameKo: "병졸의 결의", requirement: "폰 2명", description: "팀 전체의 부활 시간 -2초",
    effects: { respawnReduceTicks: 20 }, active: (t) => count(t, "pawn") >= 2,
  },
  {
    id: "diverse", nameKo: "정예 편성", requirement: "서로 다른 기물 4종 이상", description: "팀 전체의 공격력 +5%",
    effects: { atk: 1.05 }, active: (t) => new Set(pieces(t)).size >= 4,
  },
  {
    id: "bulwark-and-heal", nameKo: "방벽과 치유", requirement: "라우페이노 + 라푸스", description: "팀 전체가 받는 피해 -5%",
    effects: { dmgTaken: 0.95 }, active: (t) => has(t, "raufaino", "lappus"),
  },
  {
    id: "royal-charge", nameKo: "왕의 돌격", requirement: "에이션트 로드 + 부캉죠스", description: "팀 전체의 이동 속도 +5%",
    effects: { speed: 1.05 }, active: (t) => has(t, "ancient-lord", "bwtkan-jaws"),
  },
];

export function synergyById(id: string): Synergy | undefined {
  return SYNERGIES.find((s) => s.id === id);
}

/** 이 팀 구성이 채운 시너지의 id (SYNERGIES 순서). 아직 5명이 안 모였어도 지금까지 뽑은 것으로 계산한다. */
export function activeSynergyIds(team: string[]): string[] {
  return SYNERGIES.filter((s) => s.active(team)).map((s) => s.id);
}

export function neutralEffects(): SynergyEffects {
  return { dmgTaken: 1, atk: 1, speed: 1, towerDmg: 1, cooldown: 1, maxHp: 1, respawnReduceTicks: 0 };
}

/** 여러 시너지의 효과를 합친다. 곱하는 값은 곱하고, 부활 단축은 더한다. */
export function combineEffects(ids: string[]): SynergyEffects {
  const total = neutralEffects();
  for (const id of ids) {
    const fx = synergyById(id)?.effects;
    if (!fx) continue;
    total.dmgTaken *= fx.dmgTaken ?? 1;
    total.atk *= fx.atk ?? 1;
    total.speed *= fx.speed ?? 1;
    total.towerDmg *= fx.towerDmg ?? 1;
    total.cooldown *= fx.cooldown ?? 1;
    total.maxHp *= fx.maxHp ?? 1;
    total.respawnReduceTicks += fx.respawnReduceTicks ?? 0;
  }
  return total;
}
