// 체스판 좌표와 기물별 이동·공격 모양. 규칙: docs/DESIGN-autochess.md 5장.

import { BOARD_SIZE, DEPLOY_ROWS } from "./types";
import type { CombatState, CombatUnit, Face, Seat } from "./types";

export const DIRS_ORTHO: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIRS_DIAG: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const DIRS_ALL: ReadonlyArray<readonly [number, number]> = [...DIRS_ORTHO, ...DIRS_DIAG];
export const KNIGHT_JUMPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

/** 퀸, 룩, 비숍이 한 박자에 움직이는 최대 칸 수와 공격이 닿는 최대 칸 수 */
export const SLIDE_MOVE = 3;
export const SLIDE_ATTACK = 4;

export const inBounds = (x: number, y: number): boolean => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;

/** 판 위의 한 칸. 뫼비우스 규칙에서는 앞면(0)·밑면(1)이 있고, 일반 규칙에서는 face가 늘 0이다. */
export interface Cell {
  x: number;
  y: number;
  face: Face;
}

/**
 * (dx, dy) 한 칸을 간다. 세로 가장자리를 넘으면 없다. 가로 가장자리를 넘으면, 뫼비우스 규칙에서만
 * 이음매를 지나 반대편 열로 가고 랭크가 뒤집히고(y -> 7-y) 면이 바뀐다. 이어서 같은 방향으로 가려면 dy도 뒤집힌다.
 */
export function stepCell(state: CombatState, cell: Cell, dx: number, dy: number): (Cell & { dx: number; dy: number; crossed: boolean }) | undefined {
  const nx = cell.x + dx;
  const ny = cell.y + dy;
  if (ny < 0 || ny >= BOARD_SIZE) return undefined;
  if (nx >= 0 && nx < BOARD_SIZE) return { x: nx, y: ny, face: cell.face, dx, dy, crossed: false };
  if (!state.mobius) return undefined;
  return { x: (nx + BOARD_SIZE) % BOARD_SIZE, y: BOARD_SIZE - 1 - ny, face: cell.face === 0 ? 1 : 0, dx, dy: -dy, crossed: true };
}

/** 앞쪽(상대 쪽)의 y 방향. seat 0은 아래에서 위로, seat 1은 위에서 아래로 간다. */
export const forward = (seat: Seat): 1 | -1 => (seat === 0 ? -1 : 1);

/** 내 쪽 시점의 배치(col 0~7, row 0~3, row 0이 앞줄)를 판의 절대 좌표로. seat 1은 판을 180도 돌려서 본다. */
export function absolutePosition(seat: Seat, col: number, row: number): { x: number; y: number } {
  return seat === 0
    ? { x: col, y: BOARD_SIZE - DEPLOY_ROWS + row }
    : { x: BOARD_SIZE - 1 - col, y: DEPLOY_ROWS - 1 - row };
}

export const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * 두 기물 사이의 거리(칸 수). 같은 면이면 그냥 체비쇼프 거리고, 면이 다르면 이음매를 한 번 지나가야 만날 수 있어서
 * 이음매를 지나는 거리(가로는 가장자리를 돌아서, 세로는 랭크가 뒤집힌 쪽)다. 일반 규칙에서는 늘 같은 면이다.
 */
export function distanceBetween(a: Cell, b: Cell): number {
  if (a.face === b.face) return chebyshev(a, b);
  const around = Math.min(a.x + 1 + (BOARD_SIZE - 1 - b.x), BOARD_SIZE - 1 - a.x + 1 + b.x);
  return Math.max(around, Math.abs(a.y - (BOARD_SIZE - 1 - b.y)));
}

/** 같은 면의 같은 칸에 있는 기물. (다른 면의 기물은 같은 칸에 겹쳐 있어도 없는 것과 같다) */
export function unitAt(state: CombatState, x: number, y: number, face: Face = 0): CombatUnit | undefined {
  return state.units.find((u) => u.alive && u.x === x && u.y === y && u.face === face);
}

/** 같은 면에 있는 적. 다른 팀이고 같은 면일 때만 서로 닿는다. */
export function enemiesOf(state: CombatState, unit: CombatUnit): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.team !== unit.team && u.face === unit.face);
}

/** 모든 면의 적. 이동 방향을 정할 때 다른 면의 적도 봐야 해서 쓴다. */
export function allEnemiesOf(state: CombatState, unit: CombatUnit): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.team !== unit.team);
}

export function alliesOf(state: CombatState, unit: CombatUnit, includeSelf = false): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.team === unit.team && u.face === unit.face && (includeSelf || u.id !== unit.id));
}

/** 이 기물이 갈 수 있는 빈 칸. (이동 규칙) 뫼비우스 규칙에서는 이음매를 지나면 면이 바뀐 칸이 나온다. */
export function moveDestinations(state: CombatState, unit: CombatUnit): Cell[] {
  const out: Cell[] = [];
  const from: Cell = { x: unit.x, y: unit.y, face: unit.face };
  const free = (c: Cell) => !unitAt(state, c.x, c.y, c.face);
  const slide = (dirs: ReadonlyArray<readonly [number, number]>) => {
    for (const [sx, sy] of dirs) {
      let cell: Cell = from;
      let dx = sx;
      let dy = sy;
      for (let step = 1; step <= SLIDE_MOVE; step++) {
        const next = stepCell(state, cell, dx, dy);
        if (!next || !free(next)) break; // 막히면 그 너머로 못 간다
        out.push({ x: next.x, y: next.y, face: next.face });
        cell = next;
        dx = next.dx;
        dy = next.dy;
      }
    }
  };
  const jump = (dx: number, dy: number) => {
    const next = stepCell(state, from, dx, dy);
    if (next && free(next)) out.push({ x: next.x, y: next.y, face: next.face });
  };
  switch (unit.piece) {
    case "king":
      for (const [dx, dy] of DIRS_ALL) jump(dx, dy);
      break;
    case "queen":
      slide(DIRS_ALL);
      break;
    case "rook":
      slide(DIRS_ORTHO);
      break;
    case "bishop":
      slide(DIRS_DIAG);
      break;
    case "knight":
      for (const [dx, dy] of KNIGHT_JUMPS) jump(dx, dy);
      break;
    case "pawn": {
      // 폰은 앞으로만 한 칸. 이음매를 지나지 않는다. (세로 가장자리에서는 U턴을 하느라 이동 칸이 없다)
      const next = stepCell(state, from, 0, unit.dir);
      if (next && free(next)) out.push({ x: next.x, y: next.y, face: next.face });
      break;
    }
  }
  return out;
}

/** 이 기물의 공격이 닿는 적. (공격 규칙) 슬라이딩 기물은 가장 가까운 기물에서 막힌다. 석화한 기물은 공격하지 못한다. */
export function attackableEnemies(state: CombatState, unit: CombatUnit): CombatUnit[] {
  const out: CombatUnit[] = [];
  if (unit.stoned) return out;
  const from: Cell = { x: unit.x, y: unit.y, face: unit.face };
  const hit = (c: Cell) => {
    const other = unitAt(state, c.x, c.y, c.face);
    if (other && other.team !== unit.team) out.push(other);
    return other !== undefined;
  };
  const slide = (dirs: ReadonlyArray<readonly [number, number]>) => {
    for (const [sx, sy] of dirs) {
      let cell: Cell = from;
      let dx = sx;
      let dy = sy;
      for (let step = 1; step <= SLIDE_ATTACK; step++) {
        const next = stepCell(state, cell, dx, dy);
        if (!next) break;
        if (hit(next)) break; // 맞았거나 아군에 막혔다
        cell = next;
        dx = next.dx;
        dy = next.dy;
      }
    }
  };
  const poke = (dx: number, dy: number) => {
    const next = stepCell(state, from, dx, dy);
    if (next) hit(next);
  };
  switch (unit.piece) {
    case "king":
      for (const [dx, dy] of DIRS_ALL) poke(dx, dy);
      break;
    case "queen":
      slide(DIRS_ALL);
      break;
    case "rook":
      slide(DIRS_ORTHO);
      break;
    case "bishop":
      slide(DIRS_DIAG);
      break;
    case "knight":
      for (const [dx, dy] of KNIGHT_JUMPS) poke(dx, dy);
      break;
    case "pawn":
      poke(0, unit.dir);
      poke(-1, unit.dir);
      poke(1, unit.dir);
      break;
  }
  return out;
}

/**
 * 주어진 칸에 인접한(8방향) 빈 칸 하나. 같은 입력이면 같은 칸이 나오게 정해진 순서로 찾는다.
 * seat 1이면 방향 순서를 뒤집어서(판을 180도 돌려서 본 것처럼) 어느 쪽도 유리하지 않게 한다.
 * (이음매는 지나지 않는다. 같은 면의 칸만 본다.)
 */
export function freeAdjacent(state: CombatState, x: number, y: number, seat: Seat = 0, face: Face = 0): { x: number; y: number } | undefined {
  const sign = seat === 0 ? 1 : -1;
  for (const [dx, dy] of DIRS_ALL) {
    const nx = x + dx * sign;
    const ny = y + dy * sign;
    if (inBounds(nx, ny) && !unitAt(state, nx, ny, face)) return { x: nx, y: ny };
  }
  return undefined;
}

export function adjacentUnits(state: CombatState, unit: CombatUnit): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.face === unit.face && u.id !== unit.id && chebyshev(u, unit) === 1);
}

/**
 * 기준 기물(actor)의 시점에서 본 좌표. seat 1이면 판을 180도 돌려서 본 값이다.
 * 같은 조건에서 대상을 고를 때 이 좌표로 순서를 정하면, 두 팀의 자리를 바꿔도 선택이 거울처럼 같아져서
 * 한쪽 seat가 유리해지지 않는다.
 */
export function perspective(actor: { seat: Seat }, pos: { x: number; y: number }): { x: number; y: number } {
  return actor.seat === 0 ? { x: pos.x, y: pos.y } : { x: BOARD_SIZE - 1 - pos.x, y: BOARD_SIZE - 1 - pos.y };
}

/** actor 시점의 좌표로 두 기물을 비교한다(x, 그다음 y). 마지막 동점은 id. */
export function comparePerspective(actor: { seat: Seat }) {
  return (a: { x: number; y: number; id: string }, b: { x: number; y: number; id: string }): number => {
    const pa = perspective(actor, a);
    const pb = perspective(actor, b);
    return pa.x - pb.x || pa.y - pb.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
}
