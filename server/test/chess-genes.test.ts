// 제노사우로스 유전 갈래 (설계 33장): ★2 제노사우로스를 레피드·루산디아(전설, 언제든) / 데도키온·포더모어(초전설, 4라운드부터)로 바꾼다.
import { describe, expect, it } from "vitest";
import { buy, chooseGene, createChessGame, sell, startRound } from "../src/chess/game";
import type { ChessGame, OwnedUnit } from "../src/chess/game";
import { GENES, unitDef } from "../src/chess/roster";
import { castAbility } from "../src/chess/abilities";
import { createCombat } from "../src/chess/sim";
import { parseClientMessage } from "../src/protocol";
import { runChessBot } from "../src/bot";
import { createRoom, joinRoom, playerChess, setReady } from "../src/room-state";
import type { Placement } from "../src/chess/types";

const newGame = (seed = 5): ChessGame => {
  const g = createChessGame(seed);
  startRound(g);
  return g;
};

const give = (g: ChessGame, defId: string, n = 1) => {
  const p = g.players[0];
  for (let i = 0; i < n; i++) {
    p.gold = 99;
    const old = p.shop[0];
    if (old) g.pool[old] = (g.pool[old] ?? 0) + 1;
    p.shop[0] = defId;
    g.pool[defId] = (g.pool[defId] ?? 0) - 1;
    expect(buy(g, 0, 0)).toEqual({ ok: true });
  }
};

const owned = (g: ChessGame): OwnedUnit[] => [...g.players[0].board, ...g.players[0].bench.filter((u): u is OwnedUnit => u !== null)];
const xeno2 = (g: ChessGame) => owned(g).find((u) => u.defId === "xenosaurs" && u.star === 2)!;

describe("제노사우로스 유전 갈래", () => {
  it("갈래 넷은 모두 상점에 없고, 제노사우로스는 상점에 있다", () => {
    const g = createChessGame(1);
    for (const o of GENES.options) {
      expect(unitDef(o.to)?.evolveOnly, o.to).toBe(true);
      expect(g.pool[o.to], o.to).toBeUndefined();
    }
    expect(g.pool["xenosaurs"]).toBeGreaterThan(0);
    expect(GENES.options.map((o) => o.gen).sort()).toEqual(["M", "X", "Y", "Z"]);
  });

  it("제노사우로스 3장은 먼저 ★2가 되고, 전설 갈래는 바로 고를 수 있다 (무기·자리 유지)", () => {
    const g = newGame();
    give(g, "xenosaurs", 3);
    const unit = xeno2(g);
    unit.weapon = "bit-dagger";
    expect(chooseGene(g, 0, unit.uid, "lepid")).toEqual({ ok: true });
    const lepid = owned(g).find((u) => u.uid === unit.uid)!;
    expect(lepid.defId).toBe("lepid");
    expect(lepid.star).toBe(1);
    expect(lepid.weapon).toBe("bit-dagger");
  });

  it("초전설 갈래(데도키온·포더모어)는 4라운드부터", () => {
    const g = newGame();
    give(g, "xenosaurs", 3);
    const unit = xeno2(g);
    g.round = 3;
    expect(chooseGene(g, 0, unit.uid, "dedokion")).toEqual({ ok: false, code: "gene_locked" });
    expect(chooseGene(g, 0, unit.uid, "for-the-more")).toEqual({ ok: false, code: "gene_locked" });
    g.round = 4;
    expect(chooseGene(g, 0, unit.uid, "for-the-more")).toEqual({ ok: true });
    expect(owned(g).find((u) => u.uid === unit.uid)!.defId).toBe("for-the-more");
  });

  it("★1 제노사우로스나 다른 캐릭터, 없는 갈래는 안 된다", () => {
    const g = newGame();
    give(g, "xenosaurs", 1);
    const one = owned(g).find((u) => u.defId === "xenosaurs")!;
    expect(chooseGene(g, 0, one.uid, "lepid")).toEqual({ ok: false, code: "not_gene_ready" });
    give(g, "xenosaurs", 2);
    expect(chooseGene(g, 0, xeno2(g).uid, "toka-loga")).toEqual({ ok: false, code: "invalid_gene" });
    expect(chooseGene(g, 0, "nope", "lepid")).toEqual({ ok: false, code: "unit_not_found" });
  });

  it("갈래 캐릭터를 팔면 제노사우로스 3장이 풀로 돌아간다", () => {
    const g = newGame();
    const before = g.pool["xenosaurs"]!;
    give(g, "xenosaurs", 3);
    const unit = xeno2(g);
    expect(chooseGene(g, 0, unit.uid, "lusandia")).toEqual({ ok: true });
    expect(sell(g, 0, unit.uid)).toEqual({ ok: true });
    expect(g.pool["xenosaurs"]).toBe(before);
    expect(g.pool["lusandia"]).toBeUndefined();
  });

  it("같은 갈래가 3장 모이면 그 캐릭터의 ★2가 된다", () => {
    const g = newGame();
    for (let i = 0; i < 3; i++) {
      give(g, "xenosaurs", 3);
      expect(chooseGene(g, 0, xeno2(g).uid, "lepid")).toEqual({ ok: true });
    }
    expect(owned(g).filter((u) => u.defId === "lepid").map((u) => u.star)).toEqual([2]);
  });

  it("메시지 gene 이 서버 행동으로 이어진다", () => {
    expect(parseClientMessage(JSON.stringify({ t: "gene", uid: "i3", to: "lepid" }))).toEqual({ t: "gene", uid: "i3", to: "lepid" });
    expect(parseClientMessage(JSON.stringify({ t: "gene", uid: "i3" }))).toBeNull();
  });
});

describe("갈래 캐릭터의 능력", () => {
  const p = (defId: string, col: number, row: number): Placement => ({ defId, star: 1, col, row });

  it("레피드: 체력이 가장 낮은 적 옆으로 돌진해 때리고 보호막", () => {
    const state = createCombat([[p("lepid", 3, 3)], [p("relic", 0, 0), p("relic", 6, 0)]]);
    const me = state.units.find((u) => u.defId === "lepid")!;
    const weak = state.units.filter((u) => u.seat === 1)[1]!;
    weak.hp = 10;
    castAbility(state, me);
    expect(Math.max(Math.abs(me.x - weak.x), Math.abs(me.y - weak.y))).toBe(1);
    expect(state.hits.some((h) => h.targetId === weak.id)).toBe(true);
    expect(me.shield).toBeGreaterThan(0);
  });

  it("루산디아: 도발과 피해 감소, 붙은 적만 친다", () => {
    const state = createCombat([[p("lusandia", 3, 0)], [p("relic", 3, 0), p("relic", 0, 3)]]);
    const me = state.units.find((u) => u.defId === "lusandia")!;
    castAbility(state, me);
    expect(me.effects.some((e) => e.type === "taunt")).toBe(true);
    expect(me.effects.some((e) => e.type === "dmgTaken")).toBe(true);
    for (const h of state.hits) {
      const t = state.units.find((u) => u.id === h.targetId)!;
      expect(Math.max(Math.abs(me.x - t.x), Math.abs(me.y - t.y))).toBeLessThanOrEqual(1);
    }
  });

  it("포더모어: 아군 전체 회복과 공격력 증가", () => {
    const state = createCombat([[p("for-the-more", 3, 3), p("relic", 2, 0)], [p("relic", 3, 0)]]);
    const me = state.units.find((u) => u.defId === "for-the-more")!;
    const ally = state.units.find((u) => u.seat === 0 && u.defId === "relic")!;
    ally.hp = ally.maxHp / 2;
    castAbility(state, me);
    expect(ally.hp).toBeGreaterThan(ally.maxHp / 2);
    expect(ally.effects.some((e) => e.type === "atkUp")).toBe(true);
  });
});

describe("봇의 유전 선택", () => {
  function botRoom(level: "easy" | "normal" | "hard") {
    let n = 0;
    const room = createRoom("GENE", 0, false, "chess", false);
    const ids: string[] = [];
    for (const name of ["가", "나"]) {
      const r = joinRoom(room, { name, userId: `u${name}` }, 0, () => `id${++n}`);
      if (!r.ok) throw new Error("join");
      ids.push(r.player.id);
    }
    for (const id of ids) setReady(room, id, true, 0, 1, () => 0.5);
    // 첫 번째 플레이어를 봇처럼 돌린다 (runChessBot 은 아무 플레이어에게나 쓸 수 있다)
    room.players.find((p) => p.id === ids[0])!.botLevel = level;
    return { room, bot: ids[0]!, human: ids[1]! };
  }
  const giveBot = ({ room, bot }: ReturnType<typeof botRoom>) => {
    const chess = room.chess!;
    const seat = room.players.find((p) => p.id === bot)!.seat;
    const me = chess.players[seat];
    me.bench[0] = { uid: "gx", defId: "xenosaurs", star: 2 };
    return me;
  };

  it("보통 봇은 바로 전설 갈래를 고른다", () => {
    const r = botRoom("normal");
    const me = giveBot(r);
    runChessBot(r.room, r.bot, 0, 1, () => 0.5);
    const unit = [...me.board, ...me.bench].find((u) => u?.uid === "gx")!;
    expect(["lepid", "lusandia"]).toContain(unit.defId);
  });

  it("어려운 봇은 4라운드까지 기다렸다가 초전설 갈래를 고른다", () => {
    const r = botRoom("hard");
    const me = giveBot(r);
    runChessBot(r.room, r.bot, 0, 1, () => 0.5);
    expect([...me.board, ...me.bench].find((u) => u?.uid === "gx")!.defId).toBe("xenosaurs");
    r.room.chess!.round = 4;
    me.done = false;
    runChessBot(r.room, r.bot, 0, 1, () => 0.5);
    expect(["dedokion", "for-the-more"]).toContain([...me.board, ...me.bench].find((u) => u?.uid === "gx")!.defId);
  });

  it("사람이 보낸 gene 은 준비 단계에서만", () => {
    const { room, human } = botRoom("normal");
    const chess = room.chess!;
    const seat = room.players.find((p) => p.id === human)!.seat;
    chess.players[seat].bench[0] = { uid: "hx", defId: "xenosaurs", star: 2 };
    expect(playerChess(room, human, { t: "gene", uid: "hx", to: "lusandia" }, 0, 1, () => 0.5).ok).toBe(true);
    expect(chess.players[seat].bench[0]!.defId).toBe("lusandia");
  });
});
