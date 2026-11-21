// 체스판 좌표와 기물별 이동·공격 모양. 규칙: docs/DESIGN-autochess.md 5장.

import { BOARD_SIZE, DEPLOY_ROWS } from "./types";
import type { CombatState, CombatUnit, Seat } from "./types";

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

export function unitAt(state: CombatState, x: number, y: number): CombatUnit | undefined {
  return state.units.find((u) => u.alive && u.x === x && u.y === y);
}

export function enemiesOf(state: CombatState, unit: CombatUnit): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.seat !== unit.seat);
}

export function alliesOf(state: CombatState, unit: CombatUnit, includeSelf = false): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.seat === unit.seat && (includeSelf || u.id !== unit.id));
}

/** 이 기물이 갈 수 있는 빈 칸. (이동 규칙) */
export function moveDestinations(state: CombatState, unit: CombatUnit): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  const free = (x: number, y: number) => inBounds(x, y) && !unitAt(state, x, y);
  const slide = (dirs: ReadonlyArray<readonly [number, number]>) => {
    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= SLIDE_MOVE; step++) {
        const x = unit.x + dx * step;
        const y = unit.y + dy * step;
        if (!free(x, y)) break; // 막히면 그 너머로 못 간다
        out.push({ x, y });
      }
    }
  };
  switch (unit.piece) {
    case "king":
      for (const [dx, dy] of DIRS_ALL) if (free(unit.x + dx, unit.y + dy)) out.push({ x: unit.x + dx, y: unit.y + dy });
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
      for (const [dx, dy] of KNIGHT_JUMPS) if (free(unit.x + dx, unit.y + dy)) out.push({ x: unit.x + dx, y: unit.y + dy });
      break;
    case "pawn": {
      const y = unit.y + forward(unit.seat);
      if (free(unit.x, y)) out.push({ x: unit.x, y });
      break;
    }
  }
  return out;
}

/** 이 기물의 공격이 닿는 적. (공격 규칙) 슬라이딩 기물은 가장 가까운 기물에서 막힌다. */
export function attackableEnemies(state: CombatState, unit: CombatUnit): CombatUnit[] {
  const out: CombatUnit[] = [];
  const hit = (x: number, y: number) => {
    if (!inBounds(x, y)) return false;
    const other = unitAt(state, x, y);
    if (other && other.seat !== unit.seat) out.push(other);
    return other !== undefined;
  };
  const slide = (dirs: ReadonlyArray<readonly [number, number]>) => {
    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= SLIDE_ATTACK; step++) {
        if (!inBounds(unit.x + dx * step, unit.y + dy * step)) break;
        if (hit(unit.x + dx * step, unit.y + dy * step)) break; // 맞았거나 아군에 막혔다
      }
    }
  };
  switch (unit.piece) {
    case "king":
      for (const [dx, dy] of DIRS_ALL) hit(unit.x + dx, unit.y + dy);
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
      for (const [dx, dy] of KNIGHT_JUMPS) hit(unit.x + dx, unit.y + dy);
      break;
    case "pawn": {
      const f = forward(unit.seat);
      hit(unit.x, unit.y + f);
      hit(unit.x - 1, unit.y + f);
      hit(unit.x + 1, unit.y + f);
      break;
    }
  }
  return out;
}

/**
 * 주어진 칸에 인접한(8방향) 빈 칸 하나. 같은 입력이면 같은 칸이 나오게 정해진 순서로 찾는다.
 * seat 1이면 방향 순서를 뒤집어서(판을 180도 돌려서 본 것처럼) 어느 쪽도 유리하지 않게 한다.
 */
export function freeAdjacent(state: CombatState, x: number, y: number, seat: Seat = 0): { x: number; y: number } | undefined {
  const sign = seat === 0 ? 1 : -1;
  for (const [dx, dy] of DIRS_ALL) {
    const nx = x + dx * sign;
    const ny = y + dy * sign;
    if (inBounds(nx, ny) && !unitAt(state, nx, ny)) return { x: nx, y: ny };
  }
  return undefined;
}

export function adjacentUnits(state: CombatState, unit: CombatUnit): CombatUnit[] {
  return state.units.filter((u) => u.alive && u.id !== unit.id && chebyshev(u, unit) === 1);
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
