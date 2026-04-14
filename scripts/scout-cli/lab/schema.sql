CREATE TABLE IF NOT EXISTS runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                 TEXT NOT NULL,
  source             TEXT NOT NULL,
  command            TEXT NOT NULL,
  tag                TEXT,
  experiment_id      TEXT,
  git_sha            TEXT,
  duration_ms        INTEGER,
  level              INTEGER,
  top_n              INTEGER,
  seed               INTEGER,
  min_frontline      INTEGER,
  min_dps            INTEGER,
  max_5cost          INTEGER,
  locked_json        TEXT,
  excluded_json      TEXT,
  locked_traits_json TEXT,
  emblems_json       TEXT,
  params_hash        TEXT NOT NULL,
  result_count       INTEGER NOT NULL,
  filtered_json      TEXT,
  notes              TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(ts);
CREATE INDEX IF NOT EXISTS idx_runs_tag ON runs(tag);
CREATE INDEX IF NOT EXISTS idx_runs_exp ON runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_runs_hash ON runs(params_hash);

CREATE TABLE IF NOT EXISTS results (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id             INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  rank               INTEGER NOT NULL,
  score              REAL NOT NULL,
  slots_used         INTEGER,
  champions_json     TEXT NOT NULL,
  active_traits_json TEXT NOT NULL,
  roles_json         TEXT,
  breakdown_json     TEXT,
  meta_match_json    TEXT
);
CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
CREATE INDEX IF NOT EXISTS idx_results_score ON results(score);

CREATE TABLE IF NOT EXISTS champion_appearances (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  api_name  TEXT NOT NULL,
  cost      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_champ_app_api ON champion_appearances(api_name);
CREATE INDEX IF NOT EXISTS idx_champ_app_run ON champion_appearances(run_id);

CREATE TABLE IF NOT EXISTS trait_appearances (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  api_name  TEXT NOT NULL,
  count     INTEGER NOT NULL,
  style     TEXT
);
CREATE INDEX IF NOT EXISTS idx_trait_app_api ON trait_appearances(api_name);
CREATE INDEX IF NOT EXISTS idx_trait_app_run ON trait_appearances(run_id);

CREATE TABLE IF NOT EXISTS breakdown_components (
  run_id    INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  rank      INTEGER NOT NULL,
  component TEXT NOT NULL,
  value     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bd_comp ON breakdown_components(component);
CREATE INDEX IF NOT EXISTS idx_bd_run ON breakdown_components(run_id);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
