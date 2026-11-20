// 전투 시뮬레이션의 타입, 상수, 공통 도구.
// 서버 틱(0.1초)마다 한 칸씩 전투를 진행하는 결정적(deterministic) 시뮬레이션이다.
// 같은 시작 조건과 같은 입력(궁극기·레인 이동)이면 언제나 같은 결과가 나온다. (난수를 쓰지 않는다)
// Cloudflare에 의존하지 않는 순수 함수만 둔다.

import { characterById } from "../characters";
import type { RangeTier, SpeedTier } from "../characters";
import type { Lane, Seat } from "../protocol";

// ---------------------------------------------------------------------------
// 시간
// ---------------------------------------------------------------------------

/** 1초에 10틱. 모든 시간은 틱으로 센다. */
export const TICKS_PER_SECOND = 10;
export const DT = 1 / TICKS_PER_SECOND;
export const seconds = (s: number): number => Math.round(s * TICKS_PER_SECOND);

export const BATTLE_SECONDS = 120;
export const DEATHMATCH_SECONDS = 60;

// ---------------------------------------------------------------------------
// 공간: 레인 하나는 0 ~ LANE_LENGTH 의 직선이다. seat 0의 본진이 0, seat 1의 본진이 100.
// ---------------------------------------------------------------------------

export const LANE_LENGTH = 100;

/** 자기 본진에서 타워까지의 거리. */
export const TOWER_OFFSET = { outer: 35, inner: 22, main: 10 } as const;
/**
 * 타워 사거리와 가드 타워 구역 반지름. 양쪽 바깥 가드 타워(35 / 65)는 서로 30 떨어져 있고,
 * 사거리가 10이라 가운데(45~55)는 어느 쪽 타워의 영향도 받지 않는 중립 구간이 된다.
 */
export const TOWER_RANGE = 10;
export const ZONE_RADIUS = 10;
export const MAIN_TOWER_HP = 2400;
export const GUARD_TOWER_HP = 1000;
export const MAIN_TOWER_ATTACK = 50;
export const GUARD_TOWER_ATTACK = 40;
/** 가드 타워 구역 안의 아군은 초당 최대 체력의 3%를 회복하고, 적은 초당 12의 피해를 받는다. */
export const ZONE_HEAL_PCT = 0.03;
export const ZONE_DAMAGE_PER_SEC = 12;

export const SPEED_UNITS: Record<SpeedTier, number> = { slow: 3, normal: 4, fast: 5, veryFast: 7 };
export const RANGE_UNITS: Record<RangeTier, number> = { melee: 2.5, mid: 6, long: 10 };
export const ATTACK_INTERVAL_TICKS = seconds(1);

export const RESPAWN_TICKS = seconds(8);
export const PAWN_RESPAWN_BONUS_TICKS = seconds(3);

/** 점수. 킹사이드 메인 타워 7, 언더 타워 5, 처치 1. 가드 타워는 점수가 없다. */
export const SCORE_KINGSIDE_MAIN = 7;
export const SCORE_UNDER_MAIN = 5;
export const SCORE_KILL = 1;

export const ULTIMATE_STEAM_COST = 5;
export const ULTIMATE_COOLDOWN_TICKS = seconds(40);
export const STEAM_MAX = 10;
export const STEAM_PER_SECOND = 0.5;
export const LANE_MOVE_COOLDOWN_TICKS = seconds(12);

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export type EffectType =
  | "stun" // 행동 불가
  | "root" // 이동 불가 (공격은 가능)
  | "slow" // value: 이동 속도 감소 비율
  | "dot" // value: 초당 피해 (출혈, 화상, 턱 파열)
  | "dmgTakenUp" // value: 받는 피해 증가 비율 (표식, 방어 감소)
  | "dmgTakenDown" // value: 받는 피해 감소 비율
  | "atkUp" // value: 공격력 증가 비율
  | "speedUp" // value: 이동 속도 증가 비율
  | "atkSpeedUp" // value: 공격 속도 증가 비율
  | "towerDmgUp" // value: 타워에 주는 피해 증가 비율
  | "bloom"; // 로즈막티아 궁극기: 주변 지속 피해

export interface Effect {
  type: EffectType;
  untilTick: number;
  value: number;
}

/** 틱마다 새로 계산하는, 효과와 패시브를 모두 합친 수정치. */
export interface Mods {
  dmgTaken: number; // 곱하는 값 (1이 기본)
  atk: number;
  speed: number;
  atkSpeed: number;
  towerDmg: number;
  stunned: boolean;
  rooted: boolean;
}

export interface Unit {
  id: string;
  /** 캐릭터 id. 소환수는 "summon-wolf", "summon-hatchling". */
  characterId: string;
  seat: Seat;
  lane: Lane;
  pos: number;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  range: number;
  alive: boolean;
  /** 죽었다면 되살아나는 틱. 부활하지 않는 유닛(소환수, 데스매치)은 null. */
  respawnAtTick: number | null;
  attackReadyTick: number;
  skillReadyTick: number;
  ultReadyTick: number;
  laneMoveReadyTick: number;
  effects: Effect[];
  shield: number;
  shieldUntilTick: number;
  promoted: boolean;
  /** 끼고 있는 무기 id. 없으면 null. 부활해도 유지된다. */
  weapon: string | null;
  /** 마지막으로 이 유닛에게 피해를 준 쪽. 처치 점수를 누구에게 줄지 정하는 데 쓴다. */
  lastAttackerSeat: Seat | null;
  lastAttackerId: string | null;
  /** 소환수라면 주인과 사라지는 틱. */
  summon: { ownerId: string; expiresTick: number } | null;
  mods: Mods;
}

export type TowerKind = "guard" | "main";

export interface Tower {
  id: string;
  seat: Seat;
  lane: Lane;
  kind: TowerKind;
  /** 0 = 바깥 가드, 1 = 안쪽 가드, 2 = 메인. 숫자가 작을수록 먼저 부숴야 한다. */
  order: 0 | 1 | 2;
  pos: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  attackReadyTick: number;
  skillReadyTick: number;
  silencedUntilTick: number;
  /** 킹사이드 타워의 일제 사격을 이미 썼는가. */
  salvoUsed: boolean;
  /** 마지막으로 이 타워에 피해를 준 유닛. 폰의 승급을 누구에게 줄지 정하는 데 쓴다. */
  lastAttackerId: string | null;
}

/** 늦게 떨어지는 공격. 대포, 낙뢰. 맞는 순간의 위치로 판정해서 움직이면 피할 수 있다. */
export interface Projectile {
  landTick: number;
  /** 쏜 쪽의 seat. 반대쪽 유닛과 타워가 맞는다. */
  seat: Seat;
  lane: Lane;
  pos: number;
  radius: number;
  unitDamage: number;
  towerDamage: number;
  srcUnitId: string | null;
  kind: "cannon" | "strike";
}

export interface Wall {
  seat: Seat;
  lane: Lane;
  pos: number;
  untilTick: number;
}

/** 라푸스의 생명의 샘. */
export interface Well {
  seat: Seat;
  lane: Lane;
  pos: number;
  radius: number;
  untilTick: number;
}

/** 제노사우로스의 알. */
export interface Hatch {
  atTick: number;
  seat: Seat;
  lane: Lane;
  pos: number;
  ownerId: string;
}

export interface BattleEvent {
  /** 전투 동안 1씩 늘어나는 번호. 클라이언트는 이 번호로 이미 본 이벤트를 걸러 낸다. */
  seq: number;
  tick: number;
  type: "kill" | "towerDestroyed" | "ultimate" | "skill" | "respawn" | "promote" | "end";
  seat?: Seat;
  unitId?: string;
  targetId?: string;
  text?: string;
}

export type BattleReason = "towers" | "time" | "deathmatch" | "deathmatchTime";

export interface BattleState {
  mode: "battle" | "deathmatch";
  tick: number;
  modeStartTick: number;
  units: Unit[];
  towers: Tower[];
  projectiles: Projectile[];
  walls: Wall[];
  wells: Well[];
  hatches: Hatch[];
  score: [number, number];
  kills: [number, number];
  steam: [number, number];
  finished: boolean;
  winner: Seat | null;
  reason: BattleReason | null;
  events: BattleEvent[];
  nextEventSeq: number;
  /** 이번 틱에 쌓인 피해/회복. 틱 끝에 한꺼번에 반영해서 같은 틱의 교환이 공평하다. */
  hits: Hit[];
  heals: Heal[];
  nextSummonNumber: number;
  /** 데스매치에서 처음 처치한 seat. 시간 안에 승부가 안 나고 체력도 같을 때의 판정에 쓴다. */
  firstDeathmatchKill: Seat | null;
  /**
   * 탈런트는 탐사 쪽 자원이라 전투는 사본만 본다. 방이 틱마다 [talent]를 채워 주고,
   * 전투가 쓰고 얻은 양을 [talentDelta]에 쌓아 두면 방이 가져가서 반영한다.
   */
  talent: [number, number];
  talentDelta: [number, number];
  /** 리치몬드의 황금 계약: 진행 중인 재련을 단축할 틱. 방이 가져간다. */
  smeltHaste: [number, number];
  /** 모든 판정이 같을 때 이기는 쪽. 드래프트 후공 팀. */
  secondPicker: Seat;
  tuning: BattleTuning;
}

export interface Hit {
  targetKind: "unit" | "tower";
  targetId: string;
  amount: number;
  srcSeat: Seat;
  srcUnitId: string | null;
  /** 반사 피해처럼 다시 반사되면 안 되는 피해. */
  noReflect?: boolean;
  /** 피해 감소 효과를 무시하는 비율(0~1). 부캉죠스의 "물어뜯기". */
  penetration?: number;
  /** 기본 공격인가. 무기의 특수 효과는 기본 공격에만 붙는다. */
  basic?: boolean;
  /** 근접 공격인가. 제노사우로스의 산성 점액이 근접 공격자에게만 반응한다. */
  melee?: boolean;
}

export interface Heal {
  targetId: string;
  amount: number;
}

/** 밸런스를 조정하는 계수. 기본값(1)이 실제 규칙이고, 테스트와 튜닝에서만 바꾼다. */
export interface BattleTuning {
  /** 유닛이 받는 모든 피해(공격, 스킬, 타워, 구역)에 곱한다. 작을수록 처치가 줄어든다. */
  unitDamageScale: number;
  /** 모든 타워의 체력에 곱한다. */
  towerHpScale: number;
}

/**
 * 기본값. 유닛 피해를 0.6배로 낮춘 것은 밸런스 시뮬레이션 결과다. 1배일 때는 한 판에 처치가 약 27번 나와서
 * 점수 대부분이 처치에서 나왔다. 0.6배로 낮추면 처치가 약 18번으로 줄고 타워를 노리는 쪽이 이득이 된다.
 * 처치 5번이 언더 타워 하나와 같도록 한 기획 의도에 맞추려는 값이고, 플레이 테스트로 다시 조정한다.
 */
export const DEFAULT_TUNING: BattleTuning = { unitDamageScale: 0.6, towerHpScale: 1 };

export interface BattleSetup {
  /** seat별 5명의 캐릭터 id와 레인. */
  teams: [
    Array<{ characterId: string; lane: Lane; weapon?: string | null }>,
    Array<{ characterId: string; lane: Lane; weapon?: string | null }>,
  ];
  secondPicker: Seat;
  /** 전투가 시작될 때 쌓여 있는 스팀포스. 기본 10. */
  steam?: [number, number];
  tuning?: Partial<BattleTuning>;
}

// ---------------------------------------------------------------------------
// 만들기
// ---------------------------------------------------------------------------

export const LANE_LIST: readonly Lane[] = ["queenside", "center", "kingside"];

export function emptyMods(): Mods {
  return { dmgTaken: 1, atk: 1, speed: 1, atkSpeed: 1, towerDmg: 1, stunned: false, rooted: false };
}

/** 자기 본진에서 offset만큼 떨어진 레인 위의 위치. */
export function lanePosition(seat: Seat, offsetFromBase: number): number {
  return seat === 0 ? offsetFromBase : LANE_LENGTH - offsetFromBase;
}

export function basePosition(seat: Seat): number {
  return seat === 0 ? 0 : LANE_LENGTH;
}

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

export function makeUnit(characterId: string, seat: Seat, lane: Lane): Unit {
  const character = characterById(characterId);
  if (!character) throw new Error(`알 수 없는 캐릭터: ${characterId}`);
  return {
    id: `${seat}:${characterId}`,
    characterId,
    seat,
    lane,
    pos: basePosition(seat),
    hp: character.hp,
    maxHp: character.hp,
    atk: character.attack,
    speed: SPEED_UNITS[character.speed],
    range: RANGE_UNITS[character.range],
    alive: true,
    respawnAtTick: null,
    attackReadyTick: 0,
    skillReadyTick: 0,
    ultReadyTick: 0,
    laneMoveReadyTick: 0,
    effects: [],
    shield: 0,
    shieldUntilTick: 0,
    promoted: false,
    weapon: null,
    lastAttackerSeat: null,
    lastAttackerId: null,
    summon: null,
    mods: emptyMods(),
  };
}

function makeTowers(seat: Seat, hpScale: number): Tower[] {
  const towers: Tower[] = [];
  for (const lane of LANE_LIST) {
    const defs: Array<{ kind: TowerKind; order: 0 | 1 | 2; offset: number }> = [
      { kind: "guard", order: 0, offset: TOWER_OFFSET.outer },
      { kind: "guard", order: 1, offset: TOWER_OFFSET.inner },
      { kind: "main", order: 2, offset: TOWER_OFFSET.main },
    ];
    for (const def of defs) {
      const hp = (def.kind === "main" ? MAIN_TOWER_HP : GUARD_TOWER_HP) * hpScale;
      towers.push({
        id: `t${seat}:${lane}:${def.order}`,
        seat,
        lane,
        kind: def.kind,
        order: def.order,
        pos: lanePosition(seat, def.offset),
        hp,
        maxHp: hp,
        alive: true,
        attackReadyTick: 0,
        skillReadyTick: seconds(3), // 시작하자마자 쏘지 않도록 약간의 여유
        silencedUntilTick: 0,
        salvoUsed: false,
        lastAttackerId: null,
      });
    }
  }
  return towers;
}

export function createBattle(setup: BattleSetup): BattleState {
  const units: Unit[] = [];
  for (const seat of [0, 1] as const) {
    for (const member of setup.teams[seat]) {
      const unit = makeUnit(member.characterId, seat, member.lane);
      unit.weapon = member.weapon ?? null;
      units.push(unit);
    }
  }
  const tuning: BattleTuning = { ...DEFAULT_TUNING, ...setup.tuning };
  return {
    mode: "battle",
    tick: 0,
    modeStartTick: 0,
    units,
    towers: [...makeTowers(0, tuning.towerHpScale), ...makeTowers(1, tuning.towerHpScale)],
    projectiles: [],
    walls: [],
    wells: [],
    hatches: [],
    score: [0, 0],
    kills: [0, 0],
    steam: setup.steam ? [setup.steam[0], setup.steam[1]] : [STEAM_MAX, STEAM_MAX],
    finished: false,
    winner: null,
    reason: null,
    events: [],
    nextEventSeq: 1,
    hits: [],
    heals: [],
    nextSummonNumber: 1,
    firstDeathmatchKill: null,
    talent: [0, 0],
    talentDelta: [0, 0],
    smeltHaste: [0, 0],
    secondPicker: setup.secondPicker,
    tuning,
  };
}

// ---------------------------------------------------------------------------
// 조회 도구
// ---------------------------------------------------------------------------

export function unitById(state: BattleState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function towerById(state: BattleState, id: string): Tower | undefined {
  return state.towers.find((t) => t.id === id);
}

export function distance(a: { pos: number }, b: { pos: number }): number {
  return Math.abs(a.pos - b.pos);
}

/** 같은 레인에 있는 살아 있는 적 유닛 중 radius 안의 것. 가까운 순서, 같으면 id 순서. */
export function enemiesNear(state: BattleState, unit: Unit, radius: number): Unit[] {
  return state.units
    .filter((u) => u.alive && u.seat !== unit.seat && u.lane === unit.lane && distance(u, unit) <= radius)
    .sort((a, b) => distance(a, unit) - distance(b, unit) || (a.id < b.id ? -1 : 1));
}

/** 같은 레인에 있는 살아 있는 아군 유닛 중 radius 안의 것 (자신 포함 여부를 고른다). */
export function alliesNear(state: BattleState, unit: Unit, radius: number, includeSelf = true): Unit[] {
  return state.units.filter(
    (u) =>
      u.alive &&
      u.seat === unit.seat &&
      u.lane === unit.lane &&
      distance(u, unit) <= radius &&
      (includeSelf || u.id !== unit.id),
  );
}

/** 이 레인에서 seat 쪽에 남아 있는 타워 중 가장 먼저 부숴야 하는 것. 다 부서졌으면 undefined. */
export function frontTower(state: BattleState, seat: Seat, lane: Lane): Tower | undefined {
  return state.towers
    .filter((t) => t.seat === seat && t.lane === lane && t.alive)
    .sort((a, b) => a.order - b.order)[0];
}

export function aliveGuardTowers(state: BattleState, seat: Seat, lane: Lane): Tower[] {
  return state.towers.filter((t) => t.seat === seat && t.lane === lane && t.kind === "guard" && t.alive);
}

/** 유닛이 아군 가드 타워 구역 안에 있는가. */
export function inAlliedZone(state: BattleState, unit: Unit): boolean {
  return aliveGuardTowers(state, unit.seat, unit.lane).some((t) => distance(t, unit) <= ZONE_RADIUS);
}

export function hasEffect(unit: Unit, type: EffectType): boolean {
  return unit.effects.some((e) => e.type === type);
}

export function addEffect(unit: Unit, effect: Effect): void {
  // 같은 종류는 더 센 쪽, 같으면 더 오래 가는 쪽만 남긴다. (효과가 겹쳐서 무한히 쌓이지 않는다)
  const same = unit.effects.find((e) => e.type === effect.type && e.value === effect.value);
  if (same) {
    same.untilTick = Math.max(same.untilTick, effect.untilTick);
    return;
  }
  unit.effects.push({ ...effect });
}

export function removeDots(unit: Unit): void {
  unit.effects = unit.effects.filter((e) => e.type !== "dot");
}

// ---------------------------------------------------------------------------
// 피해와 회복 (틱 끝에 한꺼번에 반영)
// ---------------------------------------------------------------------------

export function queueHit(state: BattleState, hit: Hit): void {
  state.hits.push(hit);
}

export function queueHeal(state: BattleState, targetId: string, amount: number): void {
  state.heals.push({ targetId, amount });
}

export function pushEvent(state: BattleState, event: Omit<BattleEvent, "tick" | "seq">): void {
  state.events.push({ seq: state.nextEventSeq++, tick: state.tick, ...event });
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
}

