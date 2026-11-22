// wrangler가 만드는 worker-configuration.d.ts 에 없는 선택 항목. (로컬 서버가 꽂아 준다)
interface Env {
  /** 전적·랭킹 저장소. 없으면 D1(DB)을 쓴다. */
  STORE?: import("./ranking/store").RankingStore;
  /** "true"면 GL 계정이 없는 플레이어도 이름으로 전적을 남긴다. (로컬 서버용) */
  RECORD_ANONYMOUS?: string;
}
