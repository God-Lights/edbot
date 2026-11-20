-- 전적과 랭킹. 방(Durable Object)은 판 안의 상태만 갖고, 남겨야 하는 데이터는 여기에 둔다.

CREATE TABLE players (
  user_id    TEXT PRIMARY KEY,           -- GL Account 사용자 id (UUID)
  nickname   TEXT NOT NULL,              -- 마지막으로 판을 한 때의 닉네임
  rating     INTEGER NOT NULL DEFAULT 1000,
  games      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL            -- ms
);
CREATE INDEX idx_players_rating ON players (rating DESC);

CREATE TABLE matches (
  id            TEXT PRIMARY KEY,        -- 방 코드와 시작 시각. 같은 판을 두 번 저장하지 않으려는 키
  room_code     TEXT NOT NULL,
  started_at    INTEGER NOT NULL,        -- ms
  ended_at      INTEGER NOT NULL,        -- ms
  user0         TEXT NOT NULL,           -- seat 0의 GL 사용자 id
  user1         TEXT NOT NULL,
  winner_seat   INTEGER,                 -- 0, 1 또는 NULL(무승부)
  reason        TEXT NOT NULL,           -- towers | time | deathmatch | deathmatchTime
  score0        INTEGER NOT NULL,
  score1        INTEGER NOT NULL,
  kills0        INTEGER NOT NULL,
  kills1        INTEGER NOT NULL,
  picks0        TEXT NOT NULL,           -- JSON: seat 0이 뽑은 캐릭터 id 배열
  picks1        TEXT NOT NULL,
  rating0_before INTEGER NOT NULL,
  rating1_before INTEGER NOT NULL,
  rating0_after  INTEGER NOT NULL,
  rating1_after  INTEGER NOT NULL
);
CREATE INDEX idx_matches_user0 ON matches (user0, ended_at DESC);
CREATE INDEX idx_matches_user1 ON matches (user1, ended_at DESC);
