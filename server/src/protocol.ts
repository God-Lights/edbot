// 클라이언트(Unity)와 서버가 주고받는 메시지 정의.
// 모든 메시지는 JSON 문자열이고, `t` 필드로 종류를 구분한다.

export type Phase =
  | "lobby"
  | "ban"
  | "draft"
  | "placement"
  | "explore"
  | "forge"
  | "battle"
  | "deathmatch"
  // 체스판 자동 전투 (설계: docs/DESIGN-autochess.md)
  | "prep" // 준비: 상점과 배치
  | "combat" // 전투 재생
  | "result";

/** 세 레인. 킹사이드는 체스에서 킹이 서 있는 쪽이다. */
export const LANES = ["queenside", "center", "kingside"] as const;
export type Lane = (typeof LANES)[number];

export function isLane(value: unknown): value is Lane {
  return typeof value === "string" && (LANES as readonly string[]).includes(value);
}

export type Piece = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
export type Seat = 0 | 1;

export type ErrorCode =
  | "bad_message"
  | "room_not_found"
  | "room_full"
  | "game_in_progress"
  | "not_in_lobby"
  // ---- 밴, 드래프트, 배치 ----
  | "wrong_phase" // 지금 단계에서는 할 수 없는 행동
  | "unknown_character"
  | "character_unavailable" // 이미 밴되었거나 뽑힌 캐릭터
  | "not_your_turn"
  | "already_done" // 이미 밴했거나 배치를 확정함
  | "not_your_character" // 내 팀에 없는 캐릭터
  | "invalid_lane"
  // ---- 전투 ----
  | "unit_dead"
  | "unit_disabled" // 기절 등으로 행동할 수 없다
  | "not_implemented"
  | "on_cooldown"
  | "not_enough_steam"
  | "no_target"
  | "not_a_knight"
  // ---- 탐사 ----
  | "invalid_tile"
  | "no_action_gauge"
  | "tile_busy"
  | "nothing_to_gather"
  | "already_known"
  // ---- 대장간 ----
  | "not_enough_talent"
  | "not_enough_materials"
  | "no_free_smelter"
  | "unknown_weapon"
  | "no_weapon"
  | "not_in_zone"
  | "already_equipping"
  | "already_equipped"
  | "invalid_quantity"
  // ---- 체스판 자동 전투 ----
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
  | "spectate_unavailable"
  | "unauthorized"
  | "room_closed"
  | "invalid_recipe"
  | "not_gene_ready"
  | "invalid_gene"
  | "gene_locked";

export interface PublicPlayer {
  id: string;
  name: string;
  /** 0 또는 1. 먼저 들어온 사람이 0. */
  seat: Seat;
  connected: boolean;
  ready: boolean;
}

/** 한 사람의 밴 상태. */
export interface BanSnapshot {
  /** 밴을 정했다(밴 시간이 끝나면 못 한 사람도 true). */
  locked: boolean;
  /** 밴한 캐릭터. 밴 단계 중에는 내 것만 보이고 상대 것은 null, 단계가 끝나면 둘 다 보인다. */
  characterId: string | null;
}

/** 밴, 드래프트, 배치의 진행 상황. 게임이 시작되면 생기고 로비로 돌아가면 사라진다. */
export interface GameSnapshot {
  /** 드래프트에서 먼저 뽑는 사람의 seat (선공). 후공 팀은 이후 규칙에서 보정을 받는다. */
  firstPicker: Seat;
  /** seat 순서로 [seat 0, seat 1]. */
  bans: [BanSnapshot, BanSnapshot];
  /** 뽑는 순서 전체 (스네이크). 앞에서부터 pickCount개는 이미 뽑았다. */
  pickOrder: Seat[];
  /** seat 순서로, 뽑은 순서대로의 캐릭터 id. 드래프트 결과는 모두에게 공개된다. */
  picks: [string[], string[]];
  /** 드래프트 중 지금 뽑을 차례인 seat. 드래프트가 아니면 null. */
  turnSeat: Seat | null;
  /** 이번 차례가 끝나는 서버 시각(ms). 시간이 지나면 서버가 알아서 뽑는다. */
  turnEndsAt: number | null;
  /**
   * seat 순서로, 캐릭터 id -> 레인. 내 것은 항상 보이고 상대 것은 전투가 시작될 때까지 null.
   */
  lanes: [Partial<Record<string, Lane>> | null, Partial<Record<string, Lane>> | null];
  /** 배치를 확정했는지 (확정 여부는 상대에게도 보인다). */
  placementLocked: [boolean, boolean];
  /** seat 순서로, 지금까지 뽑은 캐릭터가 채운 시너지 id. (뽑은 캐릭터가 공개라서 모두에게 보인다) */
  synergies: [string[], string[]];
}

export interface UnitSnapshot {
  id: string;
  characterId: string;
  seat: Seat;
  lane: Lane;
  /** 레인 위의 위치 0~100. seat 0의 본진이 0, seat 1의 본진이 100. */
  pos: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** 죽어 있다면 되살아날 때까지 남은 틱. */
  respawnInTicks: number | null;
  shield: number;
  promoted: boolean;
  summon: boolean;
  /** 걸려 있는 효과 이름들 (stun, slow, dot ...). */
  effects: string[];
  /** 끼고 있는 무기. 내 유닛은 항상 보이고, 상대 유닛은 맞붙어 있을 때만 보인다. */
  weapon: string | null;
  /** 궁극기를 다시 쓸 수 있게 되는 틱. 내 유닛에게만 들어 있다. */
  ultReadyTick: number | null;
  /** 나이트의 레인 이동을 다시 쓸 수 있게 되는 틱. 내 유닛에게만 들어 있다. */
  laneMoveReadyTick: number | null;
}

export interface TowerSnapshot {
  id: string;
  seat: Seat;
  lane: Lane;
  kind: "guard" | "main";
  pos: number;
  hp: number;
  maxHp: number;
  alive: boolean;
}

export interface BattleEventSnapshot {
  seq: number;
  tick: number;
  type: string;
  seat: Seat | null;
  unitId: string | null;
  targetId: string | null;
  text: string | null;
}

export interface BattleSnapshot {
  mode: "battle" | "deathmatch";
  /** 전투 시작부터 센 틱. 1초 = 10틱. */
  tick: number;
  ticksPerSecond: number;
  score: [number, number];
  kills: [number, number];
  /** 내 스팀포스. 구경꾼이면 null. 상대의 스팀포스는 보이지 않는다. */
  steam: number | null;
  towers: TowerSnapshot[];
  units: UnitSnapshot[];
  /** 성채 같은 벽, 샘 같은 구역의 위치. */
  walls: Array<{ lane: Lane; pos: number; seat: Seat }>;
  wells: Array<{ lane: Lane; pos: number; seat: Seat }>;
  /** 최근 이벤트. seq가 이미 본 것보다 큰 것만 처리하면 된다. */
  events: BattleEventSnapshot[];
}

export interface ExploreTileSnapshot {
  index: number;
  /** 이 칸의 정체를 아는가. 안개 칸은 정찰하거나 채집하기 전에는 모른다. */
  known: boolean;
  /** tree | rock | ore | chest | empty. 모르면 null. */
  kind: string | null;
  /** 자원이 지금 없다 (채집됨). 아는 칸만. */
  depleted: boolean;
  respawnInTicks: number | null;
  /** 내가 이 칸을 채집하는 중이면 끝날 때까지 남은 틱. */
  myGatherInTicks: number | null;
  /** 내가 이 칸에 매복 중이면 끝날 때까지 남은 틱. */
  myAmbushInTicks: number | null;
  /** 정찰해서 상대의 매복을 알아냈다. */
  enemyAmbush: boolean;
}

export interface ExploreEventSnapshot {
  seq: number;
  tick: number;
  type: string;
  tile: number;
  gain: Partial<Record<"talent" | "branch" | "stone" | "ore" | "ironIngot" | "rare" | "blueprints", number>> | null;
  detail: string | null;
}

/** 탐사 상태. 내 자원과 내 행동만 들어 있고 상대 것은 없다. */
export interface ExploreSnapshot {
  tick: number;
  ticksPerSecond: number;
  gauge: number;
  gaugeMax: number;
  gaugeNextInTicks: number | null;
  tiles: ExploreTileSnapshot[];
  resources: Record<"talent" | "branch" | "stone" | "ore" | "ironIngot" | "rare" | "blueprints", number> | null;
  events: ExploreEventSnapshot[];
}

export interface ForgeSnapshot {
  /** 내 스팀포스. 전투가 시작되기 전에는 대장간의 것, 시작된 뒤에는 전투의 것. */
  steam: number;
  steamMax: number;
  /** 재련대 2개. 비어 있으면 null, 돌아가는 중이면 끝날 때까지 남은 틱. */
  smelters: Array<{ remainingTicks: number } | null>;
  /** 무기 id -> 개수. */
  inventory: Record<string, number>;
  /** 캐릭터 id -> 끼고 있는 무기 id. */
  equipped: Record<string, string>;
  /** 캐릭터 id -> 끼우는 중인 무기와 남은 틱. */
  equipping: Record<string, { weaponId: string; remainingTicks: number }>;
  /** 지금 광석 하나의 가격. */
  orePrice: number;
  ticksPerSecond: number;
  events: Array<{ seq: number; tick: number; type: string; detail: string | null }>;
}

export interface ChessUnitView {
  /** 이 기물을 가리키는 id (사고팔고 놓을 때 쓴다) */
  uid: string;
  defId: string;
  star: 1 | 2;
  /** 판 위에 있을 때만. col 0~7, row 0~3 (row 0이 가운데에 가장 가까운 앞줄) */
  col?: number;
  row?: number;
  /** 낀 무기 id */
  weapon?: string;
  /** 데도키온의 진화 진행도: 엔진 탑재율(%, 18.8이면 완료)과 A-C 코어(50이면 완료) */
  evo?: { engine: number; core: number };
}

export interface ChessSelfSnapshot {
  hp: number;
  gold: number;
  /** 상점 5칸의 캐릭터 id. 산 칸은 null */
  shop: Array<string | null>;
  bench: Array<ChessUnitView | null>;
  board: ChessUnitView[];
  done: boolean;
  rerollCost: number;
  /** 다음 라운드에 받을 골드(기본 + 이자) */
  nextIncome: number;
  /** 판 위의 기물로 켜진 시너지 id */
  synergies: string[];
  /** 자원: 재료 id -> 개수, 무기 id -> 개수(아직 안 낀 것), 재련 중인 무기 2칸(비면 null), 이번 라운드 시장에서 샀는가 */
  materials: Record<string, number>;
  weapons: Record<string, number>;
  smelters: Array<string | null>;
  marketBought: boolean;
  /** 이번 라운드 시작에 진화한 기물 (예: 데도키온 -> 토가로가). 없으면 빈 목록 */
  evolved?: Array<{ uid: string; from: string; to: string }>;
}

/** 광물 시장의 한 칸 */
export interface ChessMarketItem {
  material: string;
  price: number;
}

/** 이번 라운드의 자원 칸. 좌표는 판의 절대 좌표(seat 0이 아래)다. */
export interface ChessTileView {
  x: number;
  y: number;
  material: string;
}

export interface ChessOpponentSnapshot {
  hp: number;
  done: boolean;
  /** 준비 단계에서 상대의 판은 숨겨지고, 판에 올린 수만 보인다. */
  boardCount: number;
}

/** 전투 한 판의 기록. 클라이언트가 박자마다 재생한다. 좌표는 판의 절대 좌표(seat 0이 아래)다. */
export interface ChessCombatSnapshot {
  /** 두 팀이 실제로 낸 배치(각자 시점) */
  boards: [Array<{ defId: string; star: 1 | 2; col: number; row: number }>, Array<{ defId: string; star: 1 | 2; col: number; row: number }>];
  /** promotedTo/promotedMaxHp: 전투 중 다른 캐릭터로 승급한 기물 (프레임의 승급 표시(2)부터 이 캐릭터로 그린다) */
  units: Array<{ defId: string; seat: Seat; star: 1 | 2; maxHp: number; summon: boolean; weapon: string | null; promotedTo?: string; promotedMaxHp?: number }>;
  /** frames[k][i] = [x, y, hp, energy, shield, flags(1=생존, 2=승급)]. 아직 없는 소환수는 배열이 짧다. */
  frames: number[][][];
  /** [박자, 종류(attack|ability|death|promote|move|mine), 행동한 기물 번호, 대상 번호(-1 없음, mine이면 칸 번호), 능력 id(mine이면 재료 id)] */
  events: Array<[number, string, number, number, string]>;
  winner: Seat | null;
  survivors: [number, number];
  /** 이 전투로 각자 잃는 체력 */
  damage: [number, number];
  beats: number;
  /** 자원 칸과 채굴 기록 [박자, 칸 번호, seat], 무기로 번 골드 */
  tiles: ChessTileView[];
  mines: Array<[number, number, Seat]>;
  goldBonus: [number, number];
  /** 무한 모드(뫼비우스 규칙)로 싸운 전투. flags 4는 밑면(유령), 8 이상은 속성 게이지. */
  mobius?: boolean;
}

export interface ChessRoundSummary {
  round: number;
  winner: Seat | null;
  damage: [number, number];
  survivors: [number, number];
}

export interface ChessSnapshot {
  round: number;
  maxRounds: number;
  /** 시작 체력(체력 막대의 기준). 8전 5승제부터는 winTarget 과 같다(예전 앱용). 오래된 서버면 없다. */
  startHp?: number;
  /** 이기는 데 필요한 라운드 승수 (8전 5승제: 5). 오래된 서버면 없다. */
  winTarget?: number;
  /** 데스매치(결승 라운드)면 몇 번째인지. 정규 라운드면 없다. */
  deathmatch?: number;
  /** 데스매치 라운드에 더 받는 골드 */
  deathmatchGold?: number;
  /** 지난 라운드들의 승자 (이 판의 기록) */
  roundResults?: Array<{ round: number; winner: Seat | null; deathmatch?: number }>;
  /** 지금 판에 올릴 수 있는 기물 수 */
  deployCap: number;
  /** 상점의 가격별 등장 확률(%) [1골드, 2골드, 3골드, 4골드] */
  shopOdds: [number, number, number, number];
  /** 입문 모드(쉬운 캐릭터만 나온다) */
  lite: boolean;
  /** 무한 모드(뫼비우스 규칙). 기록 프레임의 flags 4는 밑면(유령), 8 이상은 속성 게이지 g(flags>>3). */
  mobius?: boolean;
  /** seat별 남은 목숨(= winTarget - 상대 승수). 예전 앱은 체력으로 보여 준다. 관전자도 볼 수 있는 공개 정보 */
  hps: [number, number];
  me: ChessSelfSnapshot | null;
  opponent: ChessOpponentSnapshot | null;
  /** 자원 시스템을 쓰는 판이면 이번 라운드의 자원 칸과 광물 시장 */
  tiles: ChessTileView[];
  market: ChessMarketItem[];
  /** 전투 단계에만 있다. */
  combat: ChessCombatSnapshot | null;
  lastRound: ChessRoundSummary | null;
  roundWins: [number, number];
}

export interface ResultSnapshot {
  /** seat 순서로 레이팅 변화. 로그인하지 않은 판이거나 아직 저장 전이면 null. */
  ratings: Array<{ before: number; after: number } | null>;
  winner: Seat | null;
  /** 체스: wins(5승) | rounds(정규 라운드 끝, 승수) | deathmatch(결승 라운드) | surrender | forfeit. 옛 레인 게임: towers | time | deathmatch | deathmatchTime */
  reason: string;
  score: [number, number];
  kills: [number, number];
}

export interface RoomSnapshot {
  /** 내가 이 방을 만든 사람이다 (방을 닫을 수 있다) */
  isHost: boolean;
  /** 무한 모드(뫼비우스 규칙) 방 */
  mobius?: boolean;
  code: string;
  phase: Phase;
  phaseStartedAt: number;
  /** 현재 단계가 끝나는 서버 시각(ms). 로비처럼 타이머가 없으면 null. */
  phaseEndsAt: number | null;
  /** 이 스냅샷을 만든 서버 시각(ms). 클라이언트는 이 값으로 시계 차이를 보정한다. */
  serverTime: number;
  players: PublicPlayer[];
  /** 로비에서는 null. */
  game: GameSnapshot | null;
  /** 전투와 데스매치 중에만 있다. */
  battle: BattleSnapshot | null;
  /** 체스판 자동 전투 상태. 준비·전투 단계에 있다. */
  chess: ChessSnapshot | null;
  /** 탐사 단계부터 판이 끝날 때까지. */
  explore: ExploreSnapshot | null;
  /** 대장간. 탐사와 함께 시작해서 판이 끝날 때까지. */
  forge: ForgeSnapshot | null;
  /** 결과 단계에서만 있다. */
  result: ResultSnapshot | null;
}

/**
 * 클라이언트와 서버가 주고받는 메시지 형식의 버전. 형식이 호환되지 않게 바뀔 때만 올린다.
 * /api/server 가 알려 주고, 클라이언트는 자기가 아는 것보다 높으면 "앱·웹을 업데이트해 주세요"를 보여 준다.
 */
export const PROTOCOL_VERSION = 1;

// ---- 클라이언트 -> 서버 ----

export type ClientMessage =
  | { t: "ready"; ready: boolean }
  | { t: "ping"; ts: number }
  /** 밴 단계에서 캐릭터 1명을 금지한다. 한 번 하면 바꿀 수 없다. */
  | { t: "ban"; characterId: string }
  /** 드래프트에서 내 차례에 캐릭터 1명을 뽑는다. */
  | { t: "pick"; characterId: string }
  /** 배치 단계에서 내 캐릭터 한 명의 레인을 정한다. 확정하기 전에는 다시 바꿀 수 있다. */
  | { t: "place"; characterId: string; lane: Lane }
  /** 배치를 확정한다. 정하지 않은 캐릭터는 기본 레인으로 간다. 둘 다 확정하면 바로 다음 단계로 간다. */
  | { t: "lock" }
  /** 전투 중 궁극기를 쓴다. 스팀포스 5가 든다. 안키오는 갈 레인(lane)을 같이 보낸다. */
  | { t: "ultimate"; characterId: string; lane?: Lane }
  /** 전투 중 나이트가 다른 레인으로 옮겨 간다. */
  | { t: "move"; characterId: string; lane: Lane }
  /** 체스판 자동 전투 (준비 단계): 상점 칸(0~4)의 캐릭터를 산다. */
  | { t: "buy"; slot: number }
  /** 기물(uid)을 판다. */
  | { t: "sell"; uid: string }
  /** 상점을 새로 고친다. */
  | { t: "reroll" }
  /** 기물(uid)을 판의 칸에 놓는다. 이미 있는 기물과는 자리를 바꾼다. */
  | { t: "deploy"; uid: string; col: number; row: number }
  /** 판 위의 기물(uid)을 대기석으로 내린다. */
  | { t: "bench"; uid: string }
  /** 광물 시장 칸(0부터)의 재료를 산다. 한 라운드에 한 개. */
  | { t: "market"; slot: number }
  /** 재료를 재련대에 넣는다. 다음 라운드 시작에 무기가 나온다. */
  | { t: "smelt"; material: string }
  /** 재료·무기 둘을 합쳐 새 재료나 무기를 만든다. */
  | { t: "combine"; a: { kind: "material" | "weapon"; id: string }; b: { kind: "material" | "weapon"; id: string } }
  /** 무기를 기물(uid)에 낀다. */
  | { t: "equip"; weaponId: string; uid: string }
  /** 기물(uid)의 무기를 뺀다. */
  | { t: "unequip"; uid: string }
  /** ★2 제노사우로스(uid)를 유전 갈래(to: lepid·lusandia·dedokion·for-the-more)로 바꾼다. */
  | { t: "gene"; uid: string; to: string }
  /** 준비를 끝냈다. 둘 다 끝내면 바로 전투가 시작된다. */
  | { t: "done" }
  /** 전투 중 항복한다. 상대가 바로 이긴다. 데스매치에서도 할 수 있다. */
  | { t: "surrender" }
  /** 탐사: 칸(0~15, 4x4)에 채집·매복·정찰을 한다. 행동 게이지가 1 든다. */
  | { t: "explore"; action: ExploreAction; tile: number }
  /** 대장간: buy 광석 구입, smelt 재련 시작, craft 무기 조합, equip 무기 장착. */
  | ForgeCommand;

export type ForgeCommand =
  | { t: "forge"; action: "buy"; quantity: number }
  | { t: "forge"; action: "smelt" }
  | { t: "forge"; action: "craft"; weaponId: string }
  | { t: "forge"; action: "equip"; weaponId: string; characterId: string };

export type ExploreAction = "gather" | "ambush" | "scout";
export const EXPLORE_ACTIONS: readonly ExploreAction[] = ["gather", "ambush", "scout"];

// ---- 서버 -> 클라이언트 ----

export type ServerMessage =
  | {
      t: "welcome";
      playerId: string;
      /** 재접속할 때 `?token=` 으로 다시 보내는 값. 다른 사람에게 보여주면 안 된다. */
      token: string;
      room: RoomSnapshot;
    }
  | { t: "state"; room: RoomSnapshot }
  | { t: "pong"; ts: number; serverTime: number }
  | { t: "error"; code: ErrorCode; message: string };

const MAX_ID_LENGTH = 64;

function characterId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null;
}

/** 들어온 문자열을 검증해서 ClientMessage로 바꾼다. 형식이 틀리면 null. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  switch (msg.t) {
    case "ready":
      return typeof msg.ready === "boolean" ? { t: "ready", ready: msg.ready } : null;
    case "ping":
      return typeof msg.ts === "number" && Number.isFinite(msg.ts)
        ? { t: "ping", ts: msg.ts }
        : null;
    case "ban":
    case "pick": {
      const id = characterId(msg.characterId);
      return id ? { t: msg.t, characterId: id } : null;
    }
    case "place": {
      const id = characterId(msg.characterId);
      return id && isLane(msg.lane) ? { t: "place", characterId: id, lane: msg.lane } : null;
    }
    case "lock":
      return { t: "lock" };
    case "ultimate": {
      const id = characterId(msg.characterId);
      if (!id) return null;
      if (msg.lane === undefined || msg.lane === null) return { t: "ultimate", characterId: id };
      return isLane(msg.lane) ? { t: "ultimate", characterId: id, lane: msg.lane } : null;
    }
    case "forge": {
      switch (msg.action) {
        case "buy": {
          const quantity = msg.quantity === undefined ? 1 : msg.quantity;
          return typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 99
            ? { t: "forge", action: "buy", quantity }
            : null;
        }
        case "smelt":
          return { t: "forge", action: "smelt" };
        case "craft": {
          const weaponId = characterId(msg.weaponId);
          return weaponId ? { t: "forge", action: "craft", weaponId } : null;
        }
        case "equip": {
          const weaponId = characterId(msg.weaponId);
          const character = characterId(msg.characterId);
          return weaponId && character ? { t: "forge", action: "equip", weaponId, characterId: character } : null;
        }
        default:
          return null;
      }
    }
    case "explore": {
      const action = (EXPLORE_ACTIONS as readonly unknown[]).includes(msg.action) ? (msg.action as ExploreAction) : null;
      const tile = msg.tile;
      if (!action || typeof tile !== "number" || !Number.isInteger(tile) || tile < 0 || tile > 15) return null;
      return { t: "explore", action, tile };
    }
    case "surrender":
      return { t: "surrender" };
    case "buy": {
      const slot = msg.slot;
      return typeof slot === "number" && Number.isInteger(slot) && slot >= 0 && slot <= 4 ? { t: "buy", slot } : null;
    }
    case "sell":
    case "bench": {
      const uid = characterId(msg.uid);
      return uid ? { t: msg.t, uid } : null;
    }
    case "reroll":
      return { t: "reroll" };
    case "market": {
      const slot = msg.slot;
      return typeof slot === "number" && Number.isInteger(slot) && slot >= 0 && slot <= 3 ? { t: "market", slot } : null;
    }
    case "smelt": {
      const material = characterId(msg.material);
      return material ? { t: "smelt", material } : null;
    }
    case "equip": {
      const weaponId = characterId(msg.weaponId);
      const uid = characterId(msg.uid);
      return weaponId && uid ? { t: "equip", weaponId, uid } : null;
    }
    case "combine": {
      const ref = (value: unknown): { kind: "material" | "weapon"; id: string } | null => {
        if (typeof value !== "object" || value === null) return null;
        const { kind, id } = value as { kind?: unknown; id?: unknown };
        const clean = characterId(id);
        return (kind === "material" || kind === "weapon") && clean ? { kind, id: clean } : null;
      };
      const a = ref(msg.a);
      const b = ref(msg.b);
      return a && b ? { t: "combine", a, b } : null;
    }
    case "unequip": {
      const uid = characterId(msg.uid);
      return uid ? { t: "unequip", uid } : null;
    }
    case "done":
      return { t: "done" };
    case "gene": {
      const uid = characterId(msg.uid);
      const to = characterId(msg.to);
      return uid && to ? { t: "gene", uid, to } : null;
    }
    case "deploy": {
      const uid = characterId(msg.uid);
      const { col, row } = msg;
      if (!uid || typeof col !== "number" || typeof row !== "number") return null;
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col > 7 || row < 0 || row > 3) return null;
      return { t: "deploy", uid, col, row };
    }
    case "move": {
      const id = characterId(msg.characterId);
      return id && isLane(msg.lane) ? { t: "move", characterId: id, lane: msg.lane } : null;
    }
    default:
      return null;
  }
}
