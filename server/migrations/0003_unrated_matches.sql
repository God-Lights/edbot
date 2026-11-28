-- 봇과 한 판도 "게임 기록"으로 남긴다 (레이팅·승패 수에는 넣지 않는다).
-- rated 0 인 판은 matches 에만 있고 players 는 바뀌지 않는다. 봇은 players 에 없으니 닉네임을 판에 같이 적는다.
ALTER TABLE matches ADD COLUMN rated INTEGER NOT NULL DEFAULT 1;
ALTER TABLE matches ADD COLUMN nickname0 TEXT;
ALTER TABLE matches ADD COLUMN nickname1 TEXT;
