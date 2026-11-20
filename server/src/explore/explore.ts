// 탐사: 4x4 지도에서 행동 게이지로 채집·매복·정찰을 한다. Cloudflare에 의존하지 않는 순수 규칙이다.
// 시간은 전투와 같은 틱(0.1초)으로 센다. 규칙 출처: 기획서의 "탐사 규칙".

import { characterById } from "../characters";
import type { Seat } from "../protocol";

export const TICKS_PER_SECOND = 10;
const secs = (s: number): number => Math.round(s * TICKS_PER_SECOND);

export const MAP_SIZE = 16; // 4x4
export const GAUGE_MAX = 3;
export const GAUGE_REGEN_TICKS = secs(12);
export const GATHER_TICKS = secs(3);
export const AMBUSH_TICKS = secs(10);
export const TILE_RESPAWN_TICKS = secs(25);
export const INCOME_INTERVAL_TICKS = secs(10);
export const INCOME_TALENT = 2;
export const START_TALENT = 15;
export const START_BRANCH = 3;
export const START_STONE = 3;
export const KILL_TALENT = 2;
export const TRAP_TALENT_LOSS = 3;
export const FOG_COUNT = 6;

export type TileKind = "tree" | "rock" | "ore" | "chest" | "empty";

/** 지도 구성 (합 16). 비율은 플레이 테스트로 정한다. */
const TILE_COUNTS: Record<TileKind, number> = { tree: 4, rock: 3, ore: 2, chest: 2, empty: 5 };

export interface Tile {
  kind: TileKind;
  /** 자원이 다시 생기는 틱. 지금 채집할 수 있으면 null. */
  depletedUntil: number | null;
  /** 보물상자를 이미 열었다 (다시 생기지 않는다). */
  spent: boolean;
}

export interface Resources {
  talent: number;
  branch: number;
  stone: number;
  ore: number;
  ironIngot: number;
  /** 보물상자에서 나오는 희귀 재료. */
  rare: number;
  /** 무기 설계도. */
  blueprints: number;
}

export interface GatherAction {
  seat: Seat;
  tile: number;
  startTick: number;
  completeTick: number;
}

export interface AmbushAction {
  seat: Seat;
  tile: number;
  startTick: number;
  expiresTick: number;
}

export interface ExploreEvent {
  seq: number;
  tick: number;
  /** 이 이벤트를 볼 수 있는 쪽. */
  seat: Seat;
  type:
    | "gathered"
    | "split"
    | "stolen" // 내 채집을 상대 매복에게 빼앗겼다
    | "ambushHit" // 내 매복이 성공했다
    | "ambushClash" // 같은 칸을 서로 매복해서 둘 다 사라졌다
    | "ambushExpired"
    | "scouted"
    | "trap"
    | "empty";
  tile: number;
  /** 얻거나 잃은 자원. */
  gain?: Partial<Resources>;
  /** 정찰 결과 등 짧은 설명 (tile 종류, "ambush" 등). */
  detail?: string;
}

export interface ExploreSetup {
  seed: number;
  /** seat별 팀의 캐릭터 id. 탐사 특성(기물별 보너스)에 쓴다. */
  teams: [string[], string[]];
  secondPicker: Seat;
}

export interface Traits {
  king: number;
  queen: number;
  rook: number;
  bishop: number;
  knight: number;
}

export interface ExploreState {
  tick: number;
  rngState: number;
  tiles: Tile[];
  fog: boolean[];
  /** seat별로 칸의 정체를 아는가. */
  known: [boolean[], boolean[]];
  /** seat별로 정찰한 칸. 상대의 매복이 보인다. */
  scouted: [number[], number[]];
  gauge: [number, number];
  gaugeProgress: [number, number];
  gathers: GatherAction[];
  ambushes: AmbushAction[];
  resources: [Resources, Resources];
  traits: [Traits, Traits];
  secondPicker: Seat;
  events: ExploreEvent[];
  nextEventSeq: number;
}

export type ExploreFailureCode =
  | "wrong_phase"
  | "invalid_tile"
  | "no_action_gauge"
  | "tile_busy"
  | "nothing_to_gather"
  | "already_known";

export type ExploreResult = { ok: true } | { ok: false; code: ExploreFailureCode };
const fail = (code: ExploreFailureCode): ExploreResult => ({ ok: false, code });

// ---- 난수 (판마다 같은 시드면 같은 지도) ----

function nextRandom(state: { rngState: number }): number {
  // mulberry32
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle<T>(items: T[], state: { rngState: number }): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

export function emptyResources(): Resources {
  return { talent: 0, branch: 0, stone: 0, ore: 0, ironIngot: 0, rare: 0, blueprints: 0 };
}

function traitsOf(ids: string[]): Traits {
  const traits: Traits = { king: 0, queen: 0, rook: 0, bishop: 0, knight: 0 };
  for (const id of ids) {
    const piece = characterById(id)?.piece;
    if (piece && piece !== "pawn") traits[piece] += 1;
  }
  return traits;
}

export function createExplore(setup: ExploreSetup): ExploreState {
  const rng = { rngState: setup.seed | 0 };
  const kinds: TileKind[] = [];
  for (const kind of Object.keys(TILE_COUNTS) as TileKind[]) {
    for (let i = 0; i < TILE_COUNTS[kind]; i++) kinds.push(kind);
  }
  const tiles: Tile[] = shuffle(kinds, rng).map((kind) => ({ kind, depletedUntil: null, spent: false }));
  const fogIndexes = new Set(shuffle([...Array(MAP_SIZE).keys()], rng).slice(0, FOG_COUNT));
  const fog = tiles.map((_, i) => fogIndexes.has(i));
  const start = (): Resources => ({ ...emptyResources(), talent: START_TALENT, branch: START_BRANCH, stone: START_STONE });
  return {
    tick: 0,
    rngState: rng.rngState,
    tiles,
    fog,
    known: [fog.map((f) => !f), fog.map((f) => !f)],
    scouted: [[], []],
    gauge: [GAUGE_MAX, GAUGE_MAX],
    gaugeProgress: [0, 0],
    gathers: [],
    ambushes: [],
    resources: [start(), start()],
    traits: [traitsOf(setup.teams[0]), traitsOf(setup.teams[1])],
    secondPicker: setup.secondPicker,
    events: [],
    nextEventSeq: 1,
  };
}

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

function emit(state: ExploreState, event: Omit<ExploreEvent, "seq" | "tick">): void {
  state.events.push({ seq: state.nextEventSeq++, tick: state.tick, ...event });
  if (state.events.length > 60) state.events.splice(0, state.events.length - 60);
}

function validTile(tile: unknown): tile is number {
  return typeof tile === "number" && Number.isInteger(tile) && tile >= 0 && tile < MAP_SIZE;
}

function busyOnTile(state: ExploreState, seat: Seat, tile: number): boolean {
  return (
    state.gathers.some((g) => g.seat === seat && g.tile === tile) ||
    state.ambushes.some((a) => a.seat === seat && a.tile === tile)
  );
}

function available(tile: Tile): boolean {
  return tile.depletedUntil === null && !tile.spent;
}

/** 내가 아는 한 채집할 게 있는 칸인가. 안개 칸은 모르니까 일단 시도할 수 있다. */
function looksGatherable(state: ExploreState, seat: Seat, index: number): boolean {
  if (!state.known[seat][index]) return true;
  const tile = state.tiles[index]!;
  return tile.kind !== "empty" && available(tile);
}

// ---- 플레이어의 행동 ----

export function startGather(state: ExploreState, seat: Seat, tile: number): ExploreResult {
  if (!validTile(tile)) return fail("invalid_tile");
  if (state.gauge[seat] < 1) return fail("no_action_gauge");
  if (busyOnTile(state, seat, tile)) return fail("tile_busy");
  if (!looksGatherable(state, seat, tile)) return fail("nothing_to_gather");
  state.gauge[seat] -= 1;
  state.gathers.push({ seat, tile, startTick: state.tick, completeTick: state.tick + GATHER_TICKS });
  return { ok: true };
}

export function startAmbush(state: ExploreState, seat: Seat, tile: number): ExploreResult {
  if (!validTile(tile)) return fail("invalid_tile");
  if (state.gauge[seat] < 1) return fail("no_action_gauge");
  if (busyOnTile(state, seat, tile)) return fail("tile_busy");
  state.gauge[seat] -= 1;

  const clash = state.ambushes.find((a) => a.seat === other(seat) && a.tile === tile);
  if (clash) {
    // 양쪽이 같은 칸을 매복하면 서로 무효가 된다.
    state.ambushes = state.ambushes.filter((a) => a !== clash);
    emit(state, { seat, type: "ambushClash", tile });
    emit(state, { seat: other(seat), type: "ambushClash", tile });
    return { ok: true };
  }
  state.ambushes.push({ seat, tile, startTick: state.tick, expiresTick: state.tick + AMBUSH_TICKS });
  return { ok: true };
}

/** 안개 칸의 정체와 그 칸의 상대 매복을 확인한다. 퀸이 팀에 있으면 안개 칸을 하나 더 확인한다. */
export function startScout(state: ExploreState, seat: Seat, tile: number): ExploreResult {
  if (!validTile(tile)) return fail("invalid_tile");
  if (state.known[seat][tile]) return fail("already_known");
  if (state.gauge[seat] < 1) return fail("no_action_gauge");
  state.gauge[seat] -= 1;

  const targets = [tile];
  for (let extra = 0; extra < state.traits[seat].queen; extra++) {
    const rest = state.tiles.map((_, i) => i).filter((i) => !state.known[seat][i] && !targets.includes(i));
    if (rest.length === 0) break;
    targets.push(rest[Math.floor(nextRandom(state) * rest.length)]!);
  }
  for (const index of targets) {
    state.known[seat][index] = true;
    if (!state.scouted[seat].includes(index)) state.scouted[seat].push(index);
    const ambush = state.ambushes.some((a) => a.seat === other(seat) && a.tile === index);
    emit(state, { seat, type: "scouted", tile: index, detail: state.tiles[index]!.kind + (ambush ? ",ambush" : "") });
  }
  return { ok: true };
}

// ---- 시간이 흐른다 ----

interface Yield {
  resources: Partial<Resources>;
  trap: boolean;
}

/** 칸 종류에서 나오는 기본 수확. 보물상자는 여기서 난수로 정한다. */
function baseYield(state: ExploreState, kind: TileKind): Yield {
  switch (kind) {
    case "tree":
      return { resources: { branch: 2 }, trap: false };
    case "rock":
      return { resources: { stone: 2 }, trap: false };
    case "ore":
      return { resources: { ore: 1 }, trap: false };
    case "chest": {
      const roll = nextRandom(state);
      if (roll < 0.2) return { resources: { talent: -TRAP_TALENT_LOSS }, trap: true }; // 함정
      if (roll < 0.6) return { resources: { rare: 1 }, trap: false };
      return { resources: { blueprints: 1 }, trap: false };
    }
    default:
      return { resources: {}, trap: false };
  }
}

/** 팀의 탐사 특성 보너스: 룩 돌·광석 +1, 비숍 나뭇가지 +1. 실제로 얻는 자원이 있을 때만 붙는다. */
function gatherBonus(state: ExploreState, seat: Seat, base: Partial<Resources>): Partial<Resources> {
  const bonus: Partial<Resources> = {};
  const traits = state.traits[seat];
  if (base.branch) bonus.branch = traits.bishop;
  if (base.stone) bonus.stone = traits.rook;
  if (base.ore) bonus.ore = traits.rook;
  return bonus;
}

/** 빼앗을 때 나이트 특성: 빼앗는 주 자원이 나이트 수만큼 늘어난다. */
function knightBonus(state: ExploreState, seat: Seat, base: Partial<Resources>): Partial<Resources> {
  const count = state.traits[seat].knight;
  if (count === 0) return {};
  const key = (Object.keys(base) as Array<keyof Resources>).find((k) => (base[k] ?? 0) > 0);
  return key ? { [key]: count } : {};
}

function add(target: Resources, delta: Partial<Resources>): void {
  for (const key of Object.keys(delta) as Array<keyof Resources>) {
    target[key] = Math.max(0, target[key] + (delta[key] ?? 0));
  }
}

function merge(a: Partial<Resources>, b: Partial<Resources>): Partial<Resources> {
  const out: Partial<Resources> = { ...a };
  for (const key of Object.keys(b) as Array<keyof Resources>) out[key] = (out[key] ?? 0) + (b[key] ?? 0);
  return out;
}

function spendTile(state: ExploreState, index: number): void {
  const tile = state.tiles[index]!;
  if (tile.kind === "chest") tile.spent = true;
  else tile.depletedUntil = state.tick + TILE_RESPAWN_TICKS;
  tile.kind = tile.spent ? "empty" : tile.kind; // 열린 상자는 빈 땅이 된다
}

function giveTo(state: ExploreState, seat: Seat, delta: Partial<Resources>, event: Omit<ExploreEvent, "seq" | "tick" | "seat" | "gain">): void {
  add(state.resources[seat], delta);
  emit(state, { seat, gain: delta, ...event });
}

/** 같은 칸을 서로 채집했을 때의 승자: 관련 특성이 높은 쪽, 같으면 드래프트 후공 팀. */
function tiebreakWinner(state: ExploreState, base: Partial<Resources>): Seat {
  const score = (seat: Seat): number => {
    const bonus = gatherBonus(state, seat, base);
    return (bonus.branch ?? 0) + (bonus.stone ?? 0) + (bonus.ore ?? 0);
  };
  const a = score(0);
  const b = score(1);
  if (a !== b) return a > b ? 0 : 1;
  return state.secondPicker;
}

function halves(base: Partial<Resources>, winnerGetsExtra: boolean): [Partial<Resources>, Partial<Resources>] {
  const winner: Partial<Resources> = {};
  const loser: Partial<Resources> = {};
  for (const key of Object.keys(base) as Array<keyof Resources>) {
    const value = base[key] ?? 0;
    if (value < 0) {
      // 함정은 둘 다 절반씩(올림) 잃는다.
      winner[key] = -Math.ceil(-value / 2);
      loser[key] = -Math.ceil(-value / 2);
    } else {
      const low = Math.floor(value / 2);
      winner[key] = low + (value % 2);
      loser[key] = low;
    }
  }
  return winnerGetsExtra ? [winner, loser] : [loser, winner];
}

function resolveGather(state: ExploreState, gather: GatherAction): void {
  const seat = gather.seat;
  const index = gather.tile;
  const tile = state.tiles[index]!;
  state.known[seat][index] = true;

  // 이미 상대가 먼저 채집해 가서 비었다.
  if (tile.kind === "empty" || !available(tile)) {
    emit(state, { seat, type: "empty", tile: index });
    return;
  }

  const ambush = state.ambushes.find((a) => a.seat === other(seat) && a.tile === index);
  const rival = state.gathers.find((g) => g.seat === other(seat) && g.tile === index);
  const base = baseYield(state, tile.kind);

  if (ambush) {
    // 채집이 끝나는 순간 매복한 쪽이 자원을 가진다.
    state.ambushes = state.ambushes.filter((a) => a !== ambush);
    const gain = merge(merge(base.resources, gatherBonus(state, ambush.seat, base.resources)), knightBonus(state, ambush.seat, base.resources));
    giveTo(state, ambush.seat, gain, { type: base.trap ? "trap" : "ambushHit", tile: index });
    emit(state, { seat, type: "stolen", tile: index });
    spendTile(state, index);
    return;
  }

  if (rival) {
    // 양쪽이 같은 칸을 동시에 채집하면 반씩 나눠 가진다. 상대의 채집도 여기서 끝난다.
    state.gathers = state.gathers.filter((g) => g !== rival);
    const winner = tiebreakWinner(state, base.resources);
    const [forWinner, forLoser] = halves(base.resources, true);
    const loser = other(winner);
    state.known[rival.seat][index] = true;
    giveTo(state, winner, merge(forWinner, gatherBonus(state, winner, base.resources)), { type: base.trap ? "trap" : "split", tile: index });
    giveTo(state, loser, merge(forLoser, gatherBonus(state, loser, base.resources)), { type: base.trap ? "trap" : "split", tile: index });
    spendTile(state, index);
    return;
  }

  const gain = merge(base.resources, gatherBonus(state, seat, base.resources));
  giveTo(state, seat, gain, { type: base.trap ? "trap" : "gathered", tile: index });
  spendTile(state, index);
}

/** 탐사를 한 틱 진행한다. */
export function stepExplore(state: ExploreState): void {
  state.tick += 1;
  const t = state.tick;

  // 행동 게이지
  for (const seat of [0, 1] as const) {
    if (state.gauge[seat] >= GAUGE_MAX) {
      state.gaugeProgress[seat] = 0;
      continue;
    }
    state.gaugeProgress[seat] += 1;
    if (state.gaugeProgress[seat] >= GAUGE_REGEN_TICKS) {
      state.gauge[seat] += 1;
      state.gaugeProgress[seat] = 0;
    }
  }

  // 10초마다 기본 지급. 킹이 있는 팀은 킹마다 +1.
  if (t % INCOME_INTERVAL_TICKS === 0) {
    for (const seat of [0, 1] as const) state.resources[seat].talent += INCOME_TALENT + state.traits[seat].king;
  }

  // 채집한 칸에 자원이 다시 생긴다.
  for (const tile of state.tiles) {
    if (tile.depletedUntil !== null && tile.depletedUntil <= t) tile.depletedUntil = null;
  }

  // 채집 완료 (같은 틱이면 후공 팀 먼저)
  const due = state.gathers
    .filter((g) => g.completeTick <= t)
    .sort((a, b) => a.completeTick - b.completeTick || (a.seat === state.secondPicker ? -1 : 1) - (b.seat === state.secondPicker ? -1 : 1));
  for (const gather of due) {
    if (!state.gathers.includes(gather)) continue; // 같은 칸의 상대 채집과 함께 이미 끝났다
    state.gathers = state.gathers.filter((g) => g !== gather);
    resolveGather(state, gather);
  }

  // 아무도 오지 않은 매복은 사라진다.
  const expired = state.ambushes.filter((a) => a.expiresTick <= t);
  if (expired.length > 0) {
    state.ambushes = state.ambushes.filter((a) => a.expiresTick > t);
    for (const a of expired) emit(state, { seat: a.seat, type: "ambushExpired", tile: a.tile });
  }
}

/** 처치 보상. */
export function awardKill(state: ExploreState, seat: Seat): void {
  state.resources[seat].talent += KILL_TALENT;
}
