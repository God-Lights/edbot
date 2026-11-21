// 체스판 자동 전투의 타입. 설계: docs/DESIGN-autochess.md
// 전투는 1초 한 박자로 진행하는 결정적 시뮬레이션이다. 난수를 쓰지 않아서 같은 배치면 언제나 같은 결과가 나온다.

import type { Piece, Seat } from "../protocol";

export type { Piece, Seat };

export const BOARD_SIZE = 8;
/** 한 쪽이 기물을 놓을 수 있는 줄 수 (아래 4줄 / 위 4줄) */
export const DEPLOY_ROWS = 4;

export type Role = "탱커" | "딜러" | "서포터" | "지휘" | "제어" | "암살" | "기동";

export type AbilityId =
  | "clone" | "hatch" | "relic-shield" | "spore" | "hunger"
  | "inspire" | "heal" | "rally" | "shield-wall" | "stone-skin"
  | "formation" | "invest" | "bloom" | "bind" | "leap-bite"
  | "dimension-leap" | "pact" | "thunder" | "dragon-breath" | "flank";

export interface UnitDef {
  id: string;
  nameKo: string;
  piece: Piece;
  /** 계열은 이야기용 이름표일 뿐 규칙에 쓰지 않는다. */
  faction: string;
  cost: 1 | 2 | 3 | 4;
  role: Role;
  hp: number;
  atk: number;
  /** 능력 id. 에너지가 가득 차면 자동 발동. 패시브형이면 passiveOnly가 true다. */
  ability: AbilityId;
  /** true면 에너지로 발동하지 않는 패시브(쓰러질 때, 처치할 때 같은 조건으로 발동) */
  passive: boolean;
  abilityText: string;
}

/** 내 쪽 시점의 배치: col 0~7(왼쪽부터), row 0~3(0이 가운데에 가장 가까운 앞줄) */
export interface Placement {
  defId: string;
  star: 1 | 2;
  col: number;
  row: number;
}

export type EffectType = "stun" | "root" | "taunt" | "dmgTaken" | "atkUp" | "dot" | "healBloom";

export interface Effect {
  type: EffectType;
  /** dmgTaken/atkUp은 비율(1 + value), dot은 박자당 피해 */
  value: number;
  untilBeat: number;
}

export interface CombatUnit {
  id: string;
  defId: string;
  seat: Seat;
  star: 1 | 2;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  energy: number;
  energyMax: number | null;
  alive: boolean;
  /** 지금의 기물 모양. 폰이 승급하면 queen이 된다. */
  piece: Piece;
  promoted: boolean;
  shield: number;
  shieldUntilBeat: number;
  summon: boolean;
  effects: Effect[];
  kills: number;
  /** 스크리치처럼 쌓이는 공격력 배율(1이 기본) */
  atkStack: number;
  /** 마지막으로 이 기물을 때린 기물의 id (처치 보상 계산용) */
  lastHitBy: string | null;
}

export interface Hit {
  targetId: string;
  amount: number;
  sourceId: string | null;
  kind: "attack" | "ability" | "dot" | "true";
}

export interface CombatEvent {
  beat: number;
  type: "attack" | "ability" | "move" | "death" | "promote" | "suddenDeath" | "end";
  unitId?: string;
  targetId?: string;
  text?: string;
}

export interface SynergyBonus {
  /** 팀 전체 에너지 충전 배율 */
  energyGain: number;
  abilityDamage: number;
  dmgTaken: number;
  healShield: number;
  knightBoost: boolean;
  pawnAtk: number;
  pawnHp: number;
  /** 팀 전체 공격력 배율 */
  teamAtk: number;
}

export interface CombatState {
  beat: number;
  units: CombatUnit[];
  nextUnitNumber: number;
  /** seat별 켜진 시너지 id (예: "king-2") */
  synergies: [string[], string[]];
  bonuses: [SynergyBonus, SynergyBonus];
  /** 나이트 시너지: 이 박자까지 나이트 공격력 +20% (seat별, 처음 도약하면 시작) */
  knightBoostUntil: [number, number];
  hits: Hit[];
  events: CombatEvent[];
  finished: boolean;
  /** 이긴 seat. 비겼으면 null */
  winner: Seat | null;
  /** 끝났을 때 살아남은 기물 수(소환수 제외) */
  survivors: [number, number];
}

export interface CombatResult {
  winner: Seat | null;
  survivors: [number, number];
  beats: number;
  suddenDeath: boolean;
}
