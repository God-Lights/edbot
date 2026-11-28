// 공통 도구: DOM 만들기, 문구, 색, 상수. 설계: docs/DESIGN-autochess.md

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const BOARD = 8;
export const DEPLOY_ROWS = 4;
export const START_HP = 30;
/** 이 클라이언트가 아는 메시지 형식 버전. 서버(/api/server)가 더 높으면 업데이트를 안내한다. */
export const PROTOCOL_VERSION = 1;
/** 밑면에서 이만큼 박자를 보내면 웜홀이 열린다. (서버 sim.ts의 WORMHOLE_BEATS와 같게) */
export const WORMHOLE_BEATS = 4;
/** 돌발 사망이 시작되는 박자 (서버 sim.ts와 같게) */
export const SUDDEN_BEAT = 20;
export const MOBIUS_SUDDEN_BEAT = 28;

export const PIECE_COLOR = { king: "#f2c74d", queen: "#e661d9", rook: "#e08061", bishop: "#59ccbf", knight: "#73b3ff", pawn: "#b8b8c7" };
export const PIECE_NAME = { king: "킹", queen: "퀸", rook: "룩", bishop: "비숍", knight: "나이트", pawn: "폰" };
/** 가격별 색 (롤토체스처럼): 1 회색 · 2 초록 · 3 파랑 · 4 보라 · 5 금색 */
export const COST_COLOR = { 1: "#9ea3b3", 2: "#2fbf6b", 3: "#338ff2", 4: "#b852f2", 5: "#f7ba38" };
/** 능력을 쓰는 데 필요한 마나 (서버 roster.ts 의 BASE.energy) */
export const ENERGY_MAX = { 1: 60, 2: 80, 3: 100, 4: 120 };
export const RARITY_COLOR = { common: "#b8b8b8", uncommon: "#6bd98c", rare: "#6194ff", legendary: "#f2c74d" };
export const RARITY_NAME = { common: "흔함", uncommon: "보통", rare: "희귀", legendary: "전설" };
export let MINE = "#6194ff";
export let THEIRS = "#ff7566";
/** 리소스 팩이 편 색을 바꾼다 (없으면 기본으로) */
export function setTeamColors(mine, theirs) {
  MINE = mine || "#6194ff";
  THEIRS = theirs || "#ff7566";
}

export const PHASE_NAME = { lobby: "로비", prep: "준비", combat: "전투", result: "결과" };

const ERRORS = {
  room_full: "방이 가득 찼어요.",
  game_in_progress: "이미 게임이 진행 중인 방이에요.",
  room_not_found: "방을 찾을 수 없어요. 코드를 확인해 보세요.",
  not_in_lobby: "로비에서만 할 수 있어요.",
  wrong_phase: "지금 단계에서는 할 수 없어요.",
  unauthorized: "로그인이 필요해요.",
  shop_empty: "이미 산 칸이에요.",
  not_enough_gold: "골드가 부족해요.",
  invalid_slot: "없는 상점 칸이에요.",
  bench_full: "대기석이 가득 찼어요. 팔거나 판에 올려 주세요.",
  unit_not_found: "그 기물이 없어요.",
  invalid_cell: "놓을 수 없는 칸이에요.",
  deploy_full: "판에 올릴 수 있는 기물 수를 넘었어요.",
  no_resources: "이 판에는 자원 시스템이 없어요.",
  market_empty: "살 수 없는 재료예요.",
  market_sold: "이번 라운드에는 이미 시장에서 샀어요.",
  no_material: "그 재료가 없어요.",
  no_free_smelter: "빈 재련대가 없어요. 다음 라운드에 무기가 나와요.",
  no_weapon: "그 무기가 없어요.",
  room_closed: "방이 닫혔어요.",
  invalid_recipe: "그 둘은 합칠 수 없어요. (조합 도감을 확인해 보세요)",
  spectate_unavailable: "이 방은 관전할 수 없어요. (연습·전체 대전 방이거나 없는 방이에요)",
};
export const errorText = (code, fallback) => ERRORS[code] ?? fallback ?? code;
/** 다시 시도해도 소용없는 오류 */
export const FATAL = new Set(["room_full", "room_not_found", "unauthorized", "game_in_progress", "spectate_unavailable", "room_closed"]);

export const REASON_TEXT = {
  wins: "먼저 5승",
  rounds: "정규 라운드 종료 (승수)",
  deathmatch: "데스매치에서 결판",
  hp: "상대의 체력을 모두 깎았어요",
  surrender: "항복",
  forfeit: "접속이 끊겨 기권패",
};

export const sellValue = (cost, star) => cost * (star >= 2 ? 3 : 1);
export const starText = (star) => (star >= 2 ? "★★" : "★");

/** 남은 시간 문구 (올림) */
export const countdown = (ms) => (ms == null ? "-" : `${Math.ceil(ms / 1000)}초`);
