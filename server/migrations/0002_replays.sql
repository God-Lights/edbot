-- 전투 다시 보기. 랭킹에 기록된 판의 라운드별 전투 기록(JSON)을 판마다 하나씩 둔다.

CREATE TABLE replays (
  id         TEXT PRIMARY KEY NOT NULL,  -- matches.id 와 같다 (방 코드:시작 시각)
  created_at INTEGER NOT NULL,           -- ms
  data       TEXT NOT NULL               -- JSON: { version, players, rounds, result }
);
