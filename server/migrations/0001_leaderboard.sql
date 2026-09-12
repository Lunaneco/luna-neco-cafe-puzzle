CREATE TABLE scores (
  round_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 10),
  score INTEGER NOT NULL CHECK(score > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX scores_ranking ON scores(score DESC, created_at ASC, round_id ASC);
