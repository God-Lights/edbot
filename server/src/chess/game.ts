// 체스판 자동 전투의 게임 규칙: 상점, 경제, 공용 풀, ★2 합성, 라운드. Cloudflare에 의존하지 않는 순수 함수다.
// 설계: docs/DESIGN-autochess.md 3, 4, 6장.

import { activeContent, currentRuleset, rules } from "./content";
import { roster, unitDef } from "./roster";
import { recordCombat } from "./sim";
import type { CombatRecording } from "./sim";
import type { Placement, ResourceTile, Seat } from "./types";
import { combine } from "./crafting";
import type { ItemRef } from "./crafting";
import { parseWeapon } from "./crafting";
import { MARKET_PRICE, materialDef, materials } from "./weapons";
import type { Rarity } from "./weapons";

export const START_HP = 30;
export const START_GOLD = 5;
export const BASE_INCOME = 5;
export const MAX_INTEREST = 3;
export const SHOP_SIZE = 5;
export const BENCH_SIZE = 6;
export const MAX_ROUNDS = 8;
export const MAX_DEPLOY = 7;
export const REROLL_COST = 2;
export const PREP_SECONDS = 25;
export const FIRST_PREP_SECONDS = 40;
/** 전투가 끝난 뒤 결과를 보여 주는 시간(초) */
export const COMBAT_LINGER_SECONDS = 3;

export interface OwnedUnit {
  uid: string;
  defId: string;
  star: 1 | 2;
  /** 낀 무기 id */
  weapon?: string;
}

export const SMELTER_COUNT = 2;
/** 광물 시장에 한 라운드에 나오는 재료 수 최대 */
export const MARKET_MAX = 2;

export interface BoardUnit extends OwnedUnit {
  col: number;
  row: number;
}

export interface ChessPlayer {
  seat: Seat;
  hp: number;
  gold: number;
  /** 상점 5칸. 산 칸은 null */
  shop: Array<string | null>;
  bench: Array<OwnedUnit | null>;
  board: BoardUnit[];
  /** 준비를 끝냈다. 둘 다 끝내면 시간이 남아도 바로 전투로 간다. */
  done: boolean;
  /** 자원 시스템: 재료 id -> 개수, 무기 id -> 개수(아직 안 낀 것) */
  materials: Record<string, number>;
  weapons: Record<string, number>;
  /** 재련대. 재련 중인 무기 id (다음 라운드 시작에 완성), 비었으면 null */
  smelters: Array<string | null>;
  /** 이번 라운드에 광물 시장에서 이미 샀다 */
  marketBought: boolean;
}

export interface RoundSummary {
  round: number;
  winner: Seat | null;
  /** seat별로 잃은 체력 */
  damage: [number, number];
  survivors: [number, number];
}

/** 다시 보기용 라운드 기록 (클라이언트가 그대로 재생한다) */
export interface ReplayRound {
  round: number;
  boards: [Placement[], Placement[]];
  units: CombatRecording["units"];
  frames: CombatRecording["frames"];
  events: CombatRecording["events"];
  tiles: CombatRecording["tiles"];
  mines: CombatRecording["mines"];
  winner: Seat | null;
  survivors: [number, number];
  damage: [number, number];
  beats: number;
  mobius?: boolean;
}

export interface CombatRecord extends CombatRecording {
  /** 전투에 나간 배치(자기 시점) */
  boards: [Placement[], Placement[]];
  /** 이 전투로 잃게 될 체력. 전투 단계가 끝날 때 적용한다. */
  damage: [number, number];
}

export interface ChessGame {
  /** 자원 시스템(자원 칸, 광물 시장, 재련, 무기)을 쓰는가. 입문 모드는 쓰지 않는다. */
  resources: boolean;
  /** 이번 라운드의 자원 칸(판의 절대 좌표). 내 쪽과 상대 쪽이 거울로 같다. */
  tiles: ResourceTile[];
  /** 이번 라운드 광물 시장에 나온 재료 id */
  market: string[];
  /** 지난 라운드들의 전투 기록. 판이 끝나면 다시 보기로 저장한다. */
  history: ReplayRound[];
  /** 입문 모드: 상점에 쉬운 캐릭터(1~2골드)만 나온다. */
  lite: boolean;
  /** 무한 모드: 전투를 뫼비우스 규칙으로 한다. */
  mobius: boolean;
  /** 이 판을 시작할 때의 규칙 묶음 이름. 서버의 콘텐츠 팩이 바뀐 뒤에는 옛 판을 이어 가지 않는다. 예전 판에는 없다("official"). */
  ruleset?: string;
  round: number;
  rngState: number;
  nextUid: number;
  /** 캐릭터 id -> 남은 복사본 수 */
  pool: Record<string, number>;
  players: [ChessPlayer, ChessPlayer];
  roundWins: [number, number];
  lastRound: RoundSummary | null;
  combat: CombatRecord | null;
  /** 게임이 끝났다면 이긴 seat(비기면 null)와 이유 */
  over: { winner: Seat | null; reason: "hp" | "rounds" | "surrender" | "forfeit" } | null;
}

export type ChessFailureCode =
  | "wrong_phase"
  | "invalid_slot"
  | "shop_empty"
  | "not_enough_gold"
  | "bench_full"
  | "unit_not_found"
  | "invalid_cell"
  | "deploy_full"
  | "no_resources"
  | "market_empty"
  | "market_sold"
  | "no_material"
  | "no_free_smelter"
  | "no_weapon"
  | "invalid_recipe";

export type ChessResult = { ok: true } | { ok: false; code: ChessFailureCode };
const fail = (code: ChessFailureCode): ChessResult => ({ ok: false, code });

// ---- 난수 (판마다 같은 시드면 같은 상점) ----

function nextRandom(game: ChessGame): number {
  game.rngState = (game.rngState + 0x6d2b79f5) | 0;
  let t = game.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- 만들기 ----

function emptyPlayer(seat: Seat): ChessPlayer {
  return { seat, hp: rules().startHp, gold: rules().startGold, shop: Array(SHOP_SIZE).fill(null), bench: Array(BENCH_SIZE).fill(null), board: [], done: false,
    materials: {}, weapons: {}, smelters: Array(SMELTER_COUNT).fill(null), marketBought: false };
}

/** 입문용 풀: 1~2골드 캐릭터 11명만. 처음 하는 사람이 배울 것을 줄인다. (폰 4, 비숍 3, 룩 2, 킹 1... 시너지는 폰·비숍·룩만 켜진다) */
export const LITE_IDS: readonly string[] = [
  "nut-wolf", "xenosaurs", "relic", "mossling", "skritch", "felis",
  "lappus", "for-the-more", "raufaino", "obelion", "marshal-berg",
];

/** 지금 적용된 입문 모드 캐릭터 목록(공식 + 팩이 lite로 표시한 캐릭터) */
export const liteIds = (): readonly string[] => activeContent()?.liteIds ?? LITE_IDS;

export function createChessGame(seed: number, lite = false, mobius = false): ChessGame {
  const pool: Record<string, number> = {};
  const lites = liteIds();
  for (const def of roster()) if (!lite || lites.includes(def.id)) pool[def.id] = rules().poolCopies[def.cost];
  return {
    resources: !lite,
    history: [],
    tiles: [],
    market: [],
    lite,
    mobius,
    ruleset: currentRuleset(),
    round: 0,
    rngState: seed | 0,
    nextUid: 1,
    pool,
    players: [emptyPlayer(0), emptyPlayer(1)],
    roundWins: [0, 0],
    lastRound: null,
    combat: null,
    over: null,
  };
}

// ---- 규칙 값 ----

/** 판에 올릴 수 있는 기물 수: 1라운드 3, 이후 +1, 최대 7 */
export const deployCap = (round: number): number => Math.min(rules().maxDeploy, Math.max(3, round + 2));

export const interest = (gold: number): number => Math.min(rules().maxInterest, Math.floor(gold / 10));

/** 상점의 가격별 등장 확률(%) [1골드, 2골드, 3골드, 4골드]. 라운드가 갈수록 비싼 캐릭터가 늘어난다. */
export function shopOdds(round: number, lite = false): [number, number, number, number] {
  if (lite) return round <= 2 ? [75, 25, 0, 0] : [55, 45, 0, 0];
  if (round <= 2) return [75, 25, 0, 0];
  if (round <= 4) return [55, 35, 10, 0];
  if (round <= 6) return [35, 35, 25, 5];
  return [20, 30, 35, 15];
}

export function rerollCost(player: ChessPlayer): number {
  // 리치몬드가 판에 있으면 새로고침 -1골드(최소 1)
  const richmond = player.board.some((u) => u.defId === "richmond");
  return Math.max(1, rules().rerollCost - (richmond ? 1 : 0));
}

export function prepSeconds(round: number): number {
  return round === 1 ? rules().firstPrepSeconds : rules().prepSeconds;
}

// ---- 상점과 풀 ----

function returnShopToPool(game: ChessGame, player: ChessPlayer): void {
  for (const defId of player.shop) if (defId) game.pool[defId] = (game.pool[defId] ?? 0) + 1;
  player.shop = Array(SHOP_SIZE).fill(null);
}

function drawFromPool(game: ChessGame, cost: 1 | 2 | 3 | 4): string | null {
  const candidates = roster().filter((d) => d.cost === cost && (game.pool[d.id] ?? 0) > 0);
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, d) => sum + (game.pool[d.id] ?? 0), 0);
  let roll = nextRandom(game) * total;
  for (const d of candidates) {
    roll -= game.pool[d.id] ?? 0;
    if (roll < 0) return d.id;
  }
  return candidates[candidates.length - 1]!.id;
}

function rollShop(game: ChessGame, player: ChessPlayer): void {
  returnShopToPool(game, player);
  const odds = shopOdds(game.round, game.lite);
  for (let slot = 0; slot < SHOP_SIZE; slot++) {
    let roll = nextRandom(game) * 100;
    let cost: 1 | 2 | 3 | 4 = 1;
    for (let i = 0; i < 4; i++) {
      roll -= odds[i]!;
      if (roll < 0) {
        cost = (i + 1) as 1 | 2 | 3 | 4;
        break;
      }
    }
    // 그 가격의 캐릭터가 풀에 없으면 다른 가격에서 찾는다
    const order: Array<1 | 2 | 3 | 4> = [cost, 1, 2, 3, 4];
    let picked: string | null = null;
    for (const c of order) {
      picked = drawFromPool(game, c);
      if (picked) break;
    }
    player.shop[slot] = picked;
    if (picked) game.pool[picked] = (game.pool[picked] ?? 0) - 1;
  }
}

// ---- 라운드 시작 ----

/** 희귀도를 확률(%)로 뽑는다. 전설은 includeLegendary일 때만(칸에서 3%). */
function rollRarity(game: ChessGame, includeLegendary: boolean): Rarity {
  if (includeLegendary && nextRandom(game) < 0.03) return "legendary";
  const roll = nextRandom(game) * 100;
  return roll < 60 ? "common" : roll < 90 ? "uncommon" : "rare";
}

function rollMaterial(game: ChessGame, includeLegendary: boolean, exclude: string[] = []): string {
  const rarity = rollRarity(game, includeLegendary);
  const options = materials().filter((m) => m.rarity === rarity && !exclude.includes(m.id));
  const pool = options.length > 0 ? options : materials().filter((m) => m.rarity === rarity);
  return pool[Math.floor(nextRandom(game) * pool.length) % pool.length]!.id;
}

/** 라운드마다 자원 칸 4개(내 쪽 2개 + 거울로 상대 쪽 2개)와 광물 시장을 정한다. */
function rollResources(game: ChessGame): void {
  // seat 0 쪽의 앞 두 줄(y 4, 5)에서 서로 다른 칸 2개. seat 1 쪽은 판을 180도 돌린 칸이다.
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 4; y <= 5; y++) for (let x = 0; x < 8; x++) cells.push({ x, y });
  const picked: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 2; i++) {
    const index = Math.floor(nextRandom(game) * cells.length) % cells.length;
    picked.push(cells.splice(index, 1)[0]!);
  }
  const first = rollMaterial(game, true);
  const second = rollMaterial(game, true, [first]);
  const materials = [first, second];
  game.tiles = [];
  picked.forEach((cell, i) => {
    game.tiles.push({ x: cell.x, y: cell.y, material: materials[i]! });
    game.tiles.push({ x: 7 - cell.x, y: 7 - cell.y, material: materials[i]! });
  });
  // 광물 시장: 1~2종 (전설은 팔지 않는다)
  const count = nextRandom(game) < 0.5 ? 1 : MARKET_MAX;
  game.market = [];
  for (let i = 0; i < count; i++) game.market.push(rollMaterial(game, false, game.market));
}

/** 새 라운드를 시작한다: 재련 완성, 골드(기본 + 이자), 상점 새로 채우기, 준비 상태 초기화. */
export function startRound(game: ChessGame): void {
  game.round += 1;
  game.combat = null;
  // 공용 풀에서 먼저 뽑는 쪽이 유리하지 않게, 라운드마다 상점을 채우는 순서를 번갈아 바꾼다.
  const order: ChessPlayer[] = game.round % 2 === 1 ? [game.players[0], game.players[1]] : [game.players[1], game.players[0]];
  for (const player of order) {
    if (game.resources) {
      // 재련대의 무기가 완성된다. 디지털 채굴기 포대는 매 라운드 시작에 비트 1개를 만든다.
      player.smelters = player.smelters.map((weaponId) => {
        if (weaponId) player.weapons[weaponId] = (player.weapons[weaponId] ?? 0) + 1;
        return null;
      });
      const pouches = [...player.board, ...player.bench.filter((u): u is OwnedUnit => u !== null)].filter((u) => u.weapon && parseWeapon(u.weapon)?.parts.includes("digital-miner-pouch")).length;
      if (pouches > 0) player.materials.bit = (player.materials.bit ?? 0) + pouches;
      player.marketBought = false;
    }
    player.gold += rules().baseIncome + interest(player.gold);
    player.done = false;
    rollShop(game, player);
  }
  if (game.resources) rollResources(game);
}

// ---- 기물 찾기와 합성 ----

function findUnit(player: ChessPlayer, uid: string): { unit: OwnedUnit; where: { bench: number } | { board: number } } | undefined {
  const benchIndex = player.bench.findIndex((u) => u?.uid === uid);
  if (benchIndex >= 0) return { unit: player.bench[benchIndex]!, where: { bench: benchIndex } };
  const boardIndex = player.board.findIndex((u) => u.uid === uid);
  if (boardIndex >= 0) return { unit: player.board[boardIndex]!, where: { board: boardIndex } };
  return undefined;
}

/**
 * 같은 캐릭터 ★1이 3장이면 합쳐서 ★2 하나로 만든다. 판 위에 있던 것이 있으면 그 자리가 우선이다.
 * extra는 아직 어느 칸에도 놓지 않은(대기석이 가득 찬 채로 산) 기물이다.
 */
function mergeIfPossible(game: ChessGame, player: ChessPlayer, defId: string, extra?: OwnedUnit): void {
  const onBoard = player.board.filter((u) => u.defId === defId && u.star === 1);
  const onBench = player.bench.filter((u): u is OwnedUnit => u !== null && u.defId === defId && u.star === 1);
  const all: OwnedUnit[] = [...onBoard, ...onBench, ...(extra ? [extra] : [])];
  if (all.length < 3) return;
  const three = all.slice(0, 3);
  const anchor = three[0]!;
  const anchorBoard = onBoard.find((u) => u.uid === anchor.uid);
  const upgraded: OwnedUnit = { uid: `i${game.nextUid++}`, defId, star: 2 };
  // 무기는 하나를 ★2가 이어받고, 나머지는 보관함으로 돌아온다.
  const carried = three.map((u) => u.weapon).filter((w): w is string => !!w);
  if (carried[0]) upgraded.weapon = carried[0];
  for (const w of carried.slice(1)) player.weapons[w] = (player.weapons[w] ?? 0) + 1;

  const remove = new Set(three.map((u) => u.uid));
  player.board = player.board.filter((u) => !remove.has(u.uid));
  player.bench = player.bench.map((u) => (u && remove.has(u.uid) ? null : u));
  if (anchorBoard) {
    player.board.push({ ...upgraded, col: anchorBoard.col, row: anchorBoard.row });
  } else {
    const slot = player.bench.findIndex((u) => u === null);
    player.bench[slot >= 0 ? slot : 0] = upgraded; // 세 장이 모두 대기석에 있었으므로 자리가 있다
  }
}

// ---- 플레이어의 행동 (준비 단계에서만) ----

export function buy(game: ChessGame, seat: Seat, slot: number): ChessResult {
  const player = game.players[seat];
  if (!Number.isInteger(slot) || slot < 0 || slot >= SHOP_SIZE) return fail("invalid_slot");
  const defId = player.shop[slot];
  if (!defId) return fail("shop_empty");
  const def = unitDef(defId)!;
  if (player.gold < def.cost) return fail("not_enough_gold");
  const benchSlot = player.bench.findIndex((u) => u === null);
  // 합쳐질 자리가 있으면 대기석이 가득 차 있어도 살 수 있다(합치면 자리가 비니까)
  const owned = [...player.board, ...player.bench.filter((u): u is OwnedUnit => u !== null)].filter((u) => u.defId === defId && u.star === 1).length;
  if (benchSlot < 0 && owned < 2) return fail("bench_full");
  player.gold -= def.cost;
  player.shop[slot] = null;
  const unit: OwnedUnit = { uid: `i${game.nextUid++}`, defId, star: 1 };
  if (benchSlot >= 0) {
    player.bench[benchSlot] = unit;
    mergeIfPossible(game, player, defId);
  } else {
    mergeIfPossible(game, player, defId, unit); // 대기석이 가득해도 합쳐지면 살 수 있다
  }
  return { ok: true };
}

export function sell(game: ChessGame, seat: Seat, uid: string): ChessResult {
  const player = game.players[seat];
  const found = findUnit(player, uid);
  if (!found) return fail("unit_not_found");
  const def = unitDef(found.unit.defId)!;
  const copies = found.unit.star === 1 ? 1 : 3;
  player.gold += def.cost * copies;
  game.pool[def.id] = (game.pool[def.id] ?? 0) + copies;
  if (found.unit.weapon) player.weapons[found.unit.weapon] = (player.weapons[found.unit.weapon] ?? 0) + 1;
  if ("bench" in found.where) player.bench[found.where.bench] = null;
  else player.board.splice(found.where.board, 1);
  return { ok: true };
}

export function reroll(game: ChessGame, seat: Seat): ChessResult {
  const player = game.players[seat];
  const cost = rerollCost(player);
  if (player.gold < cost) return fail("not_enough_gold");
  player.gold -= cost;
  rollShop(game, player);
  return { ok: true };
}

/** 기물을 판의 칸(col 0~7, row 0~3, row 0이 앞줄)에 놓는다. 이미 있는 기물과는 자리를 바꾼다. */
export function deploy(game: ChessGame, seat: Seat, uid: string, col: number, row: number): ChessResult {
  const player = game.players[seat];
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col > 7 || row < 0 || row > 3) return fail("invalid_cell");
  const found = findUnit(player, uid);
  if (!found) return fail("unit_not_found");
  const occupantIndex = player.board.findIndex((u) => u.col === col && u.row === row && u.uid !== uid);
  const cap = deployCap(game.round);

  if ("bench" in found.where) {
    if (occupantIndex < 0 && player.board.length >= cap) return fail("deploy_full");
    const occupant = occupantIndex >= 0 ? player.board.splice(occupantIndex, 1)[0]! : undefined;
    player.bench[found.where.bench] = occupant ? { uid: occupant.uid, defId: occupant.defId, star: occupant.star, ...(occupant.weapon ? { weapon: occupant.weapon } : {}) } : null;
    player.board.push({ ...found.unit, col, row });
    return { ok: true };
  }
  // 판 위에서 다른 칸으로
  const mine = player.board[found.where.board]!;
  if (occupantIndex >= 0) {
    const other = player.board[occupantIndex]!;
    other.col = mine.col;
    other.row = mine.row;
  }
  mine.col = col;
  mine.row = row;
  return { ok: true };
}

/** 판 위의 기물을 대기석으로 내린다. */
export function toBench(game: ChessGame, seat: Seat, uid: string): ChessResult {
  const player = game.players[seat];
  const index = player.board.findIndex((u) => u.uid === uid);
  if (index < 0) return fail("unit_not_found");
  const slot = player.bench.findIndex((u) => u === null);
  if (slot < 0) return fail("bench_full");
  const [unit] = player.board.splice(index, 1);
  player.bench[slot] = { uid: unit!.uid, defId: unit!.defId, star: unit!.star, ...(unit!.weapon ? { weapon: unit!.weapon } : {}) };
  return { ok: true };
}

// ---- 자원 시스템의 행동 ----

/** 광물 시장에서 재료를 산다. 한 라운드에 한 개. */
export function buyMaterial(game: ChessGame, seat: Seat, slot: number): ChessResult {
  const player = game.players[seat];
  if (!game.resources) return fail("no_resources");
  if (!Number.isInteger(slot) || slot < 0 || slot >= game.market.length) return fail("invalid_slot");
  if (player.marketBought) return fail("market_sold");
  const material = materialDef(game.market[slot]!);
  const price = material ? MARKET_PRICE[material.rarity] : null;
  if (!material || price === null) return fail("market_empty");
  if (player.gold < price) return fail("not_enough_gold");
  player.gold -= price;
  player.marketBought = true;
  player.materials[material.id] = (player.materials[material.id] ?? 0) + 1;
  return { ok: true };
}

/** 재료를 재련대에 넣는다. 다음 라운드 시작에 같은 이름의 무기가 나온다. */
export function smelt(game: ChessGame, seat: Seat, materialId: string): ChessResult {
  const player = game.players[seat];
  if (!game.resources) return fail("no_resources");
  const material = materialDef(materialId);
  if (!material || (player.materials[materialId] ?? 0) <= 0) return fail("no_material");
  const slot = player.smelters.findIndex((w) => w === null);
  if (slot < 0) return fail("no_free_smelter");
  player.materials[materialId] = (player.materials[materialId] ?? 0) - 1;
  player.smelters[slot] = material.weaponId;
  return { ok: true };
}

/** 무기를 기물(대기석이나 판 위)에 낀다. 기물당 하나이고, 이미 낀 무기는 보관함으로 돌아온다. */
export function equip(game: ChessGame, seat: Seat, weaponId: string, uid: string): ChessResult {
  const player = game.players[seat];
  if (!game.resources) return fail("no_resources");
  if (!parseWeapon(weaponId) || (player.weapons[weaponId] ?? 0) <= 0) return fail("no_weapon");
  const found = findUnit(player, uid);
  if (!found) return fail("unit_not_found");
  const old = found.unit.weapon;
  if (old) player.weapons[old] = (player.weapons[old] ?? 0) + 1;
  player.weapons[weaponId] = (player.weapons[weaponId] ?? 0) - 1;
  found.unit.weapon = weaponId;
  return { ok: true };
}

/**
 * 재료와 무기를 서로 합쳐 새 재료나 무기를 만든다. 합친 둘은 사라지고 결과가 보관함에 들어온다. (재련처럼 기다리지 않는다)
 * 규칙은 crafting.ts: 재료+재료(같은 희귀도, 다른 재료) -> 상위 재료, 무기+무기(같으면 ★2, 다르면 융합), 무기+원재료 -> ★2.
 */
export function combineItems(game: ChessGame, seat: Seat, a: ItemRef, b: ItemRef): ChessResult {
  const player = game.players[seat];
  if (!game.resources) return fail("no_resources");
  const stock = (item: ItemRef): number => (item.kind === "material" ? player.materials[item.id] : player.weapons[item.id]) ?? 0;
  const sameItem = a.kind === b.kind && a.id === b.id;
  for (const item of [a, b]) {
    if (stock(item) < (sameItem ? 2 : 1)) return fail(item.kind === "material" ? "no_material" : "no_weapon");
  }
  const result = combine(a, b);
  if (!result) return fail("invalid_recipe");
  for (const item of [a, b]) {
    const bag = item.kind === "material" ? player.materials : player.weapons;
    bag[item.id] = (bag[item.id] ?? 0) - 1;
  }
  const bag = result.kind === "material" ? player.materials : player.weapons;
  bag[result.id] = (bag[result.id] ?? 0) + 1;
  return { ok: true };
}

/** 기물에서 무기를 빼서 보관함으로 돌린다. */
export function unequip(game: ChessGame, seat: Seat, uid: string): ChessResult {
  const player = game.players[seat];
  const found = findUnit(player, uid);
  if (!found) return fail("unit_not_found");
  const old = found.unit.weapon;
  if (!old) return fail("no_weapon");
  player.weapons[old] = (player.weapons[old] ?? 0) + 1;
  delete found.unit.weapon;
  return { ok: true };
}

export function setDone(game: ChessGame, seat: Seat, done = true): void {
  game.players[seat].done = done;
}

export const bothDone = (game: ChessGame): boolean => game.players.every((p) => p.done);

// ---- 전투와 라운드 결과 ----

/** 지금 판의 배치를 전투용 배치로 바꾼다. */
export function boardPlacements(player: ChessPlayer): Placement[] {
  return player.board.map((u) => ({ defId: u.defId, star: u.star, col: u.col, row: u.row, ...(u.weapon ? { weapon: u.weapon } : {}) }));
}

/** 전투를 계산해서 기록해 둔다. 체력은 전투 단계가 끝날 때(finishRound) 깎는다. */
export function runRoundCombat(game: ChessGame): CombatRecord {
  const boards: [Placement[], Placement[]] = [boardPlacements(game.players[0]), boardPlacements(game.players[1])];
  const recording = recordCombat(boards, game.resources ? game.tiles : [], { mobius: game.mobius });
  const { winner, survivors } = recording.result;
  const damage: [number, number] = [0, 0];
  if (winner !== null) {
    const loser: Seat = winner === 0 ? 1 : 0;
    damage[loser] = survivors[winner] * 2 + game.round;
  }
  game.combat = { ...recording, boards, damage };
  return game.combat;
}

/** 전투 결과를 반영한다: 체력 감소, 라운드 승수, 게임이 끝났는지 판정. */
export function finishRound(game: ChessGame): void {
  const combat = game.combat;
  if (!combat) return;
  game.players[0].hp -= combat.damage[0];
  game.players[1].hp -= combat.damage[1];
  // 캔 재료와 무기로 번 골드를 받는다
  for (const [, tileIndex, seat] of combat.mines) {
    const material = combat.tiles[tileIndex]?.material;
    if (material) game.players[seat].materials[material] = (game.players[seat].materials[material] ?? 0) + 1;
  }
  game.players[0].gold += combat.goldBonus[0];
  game.players[1].gold += combat.goldBonus[1];
  if (combat.result.winner !== null) game.roundWins[combat.result.winner] += 1;
  game.history.push({
    round: game.round, boards: combat.boards, units: combat.units, frames: combat.frames, events: combat.events,
    tiles: combat.tiles, mines: combat.mines, winner: combat.result.winner, survivors: combat.result.survivors,
    damage: combat.damage, beats: combat.result.beats, ...(game.mobius ? { mobius: true } : {}),
  });
  game.lastRound = { round: game.round, winner: combat.result.winner, damage: combat.damage, survivors: combat.result.survivors };

  const [a, b] = [game.players[0].hp, game.players[1].hp];
  if (a <= 0 || b <= 0) {
    // 둘 다 0 이하면 체력이 더 많이 남은 쪽, 같으면 라운드 승수가 많은 쪽, 그래도 같으면 무승부
    game.over = { winner: decide(game, a, b), reason: "hp" };
  } else if (game.round >= rules().maxRounds) {
    game.over = { winner: decide(game, a, b), reason: "rounds" };
  }
}

function decide(game: ChessGame, a: number, b: number): Seat | null {
  if (a !== b) return a > b ? 0 : 1;
  if (game.roundWins[0] !== game.roundWins[1]) return game.roundWins[0] > game.roundWins[1] ? 0 : 1;
  return null;
}

/** 항복이나 기권패: 상대가 바로 이긴다. */
export function concedeGame(game: ChessGame, loser: Seat, reason: "surrender" | "forfeit"): void {
  if (game.over) return;
  game.over = { winner: loser === 0 ? 1 : 0, reason };
}

/** 게임이 끝났을 때 각자가 쓴 캐릭터(중복 없이). 전적에 남긴다. */
export function finalRoster(player: ChessPlayer): string[] {
  const ids = [...player.board.map((u) => u.defId), ...player.bench.filter((u): u is OwnedUnit => u !== null).map((u) => u.defId)];
  return [...new Set(ids)];
}
