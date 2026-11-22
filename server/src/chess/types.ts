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
  /** 낀 무기 id */
  weapon?: string;
}

/** 이번 라운드의 자원 칸(판의 절대 좌표) */
export interface ResourceTile {
  x: number;
  y: number;
  /** 재료 id */
  material: string;
}

export type EffectType = "stun" | "root" | "taunt" | "dmgTaken" | "atkUp" | "dot" | "healBloom";

export interface Effect {
  type: EffectType;
  /** dmgTaken/atkUp은 비율(1 + value), dot은 박자당 피해 */
  value: number;
  untilBeat: number;
}

/** 뫼비우스 규칙: 앞면(0)과 밑면(1). 밑면에 있는 기물은 "유령"이다. 같은 면의 기물끼리만 서로 닿는다. */
export type Face = 0 | 1;

export interface CombatUnit {
  id: string;
  defId: string;
  seat: Seat;
  /** 같은 팀끼리는 서로 때리지 않는다. 1:1에서는 seat와 같다. (2:2로 넓힐 때를 위한 자리) */
  team: number;
  /** 뫼비우스 규칙에서만 쓴다. 일반 규칙에서는 늘 0이다. */
  face: Face;
  /** 속성 게이지: 밑면에서 보낸 박자 수. 앞면에 있으면 0. */
  g: number;
  /** 폰의 진행 방향(절대 y 방향). 일반 규칙에서는 forward(seat)로 변하지 않는다. */
  dir: 1 | -1;
  /** 폰 일주: u는 가장자리 U턴 횟수(0~1), c는 완료 횟수 */
  u: number;
  c: number;
  /** 일주를 마친 폰이 밑면으로 간 상태. 밑면에서는 U턴 대신 석화한다. */
  ghosted: boolean;
  /** 석화: 밑면 가장자리에 닿아 움직이지도 공격하지도 못한다. 잡힐 수는 있다. */
  stoned: boolean;
  /** 이 폰이 분신이면 본체의 id (연동). 실체화하면 null. */
  cloneOf: string | null;
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
  /** 낀 무기 id ("a"=기본, "a*"=★2, "a+b"=융합) */
  weapon: string | null;
  /** 효과를 내는 기본 무기들과 효과 배율(★2 1.5, 융합 0.75, 기본 1) */
  weaponParts: string[];
  weaponPower: number;
  /** "쌓였다가 터지는" 확률 효과의 누적값 (출혈, 회피, 추가 공격...). 난수를 쓰지 않는다. */
  procs: Record<string, number>;
  /** 받는 피해 배율(무기), 에너지 충전 배율(무기) */
  dmgMult: number;
  energyMult: number;
}

export interface Hit {
  targetId: string;
  amount: number;
  sourceId: string | null;
  kind: "attack" | "ability" | "dot" | "true";
}

export interface CombatEvent {
  beat: number;
  type: "attack" | "ability" | "move" | "death" | "promote" | "mine" | "suddenDeath" | "end"
    | "ghost" | "surface" | "uturn" | "lap" | "clone" | "stone";
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

/** 전투 옵션. mobius가 true면 무한 모드(뫼비우스 규칙)로 싸운다. */
export interface CombatOptions {
  mobius?: boolean;
}

export interface CombatState {
  /** 무한 모드(이음매·앞뒷면·웜홀·폰 일주) */
  mobius: boolean;
  /** 이 박자부터 돌발 사망, 이 박자에 끝나지 않으면 체력 비율로 승부 */
  suddenBeat: number;
  maxBeats: number;
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
  /** 자원 칸. 누가 밟으면 mined가 true가 된다. */
  tiles: Array<ResourceTile & { mined: boolean }>;
  /** 채굴 기록: 어느 박자에 어느 칸을 누가 캤는가 */
  mines: Array<{ beat: number; tile: number; seat: Seat }>;
  /** 무기로 번 골드 (에드코인 슬링, 비트코인 대검) */
  goldBonus: [number, number];
}

export interface CombatResult {
  winner: Seat | null;
  survivors: [number, number];
  beats: number;
  suddenDeath: boolean;
}
