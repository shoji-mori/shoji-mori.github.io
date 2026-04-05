PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  year INTEGER NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
  title_en TEXT NOT NULL,
  title_ja TEXT,
  authors_en TEXT NOT NULL,
  authors_ja TEXT NOT NULL,
  journal_en TEXT NOT NULL,
  journal_ja TEXT,
  publication_url TEXT,
  arxiv_url TEXT,
  ads_url TEXT,
  abstract_en TEXT,
  abstract_ja TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publications_year_sort
  ON publications (year DESC, sort_order DESC);

CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  year INTEGER NOT NULL,
  date_text TEXT NOT NULL,
  sort_date TEXT,
  title_en TEXT NOT NULL,
  title_ja TEXT,
  authors_en TEXT NOT NULL,
  authors_ja TEXT NOT NULL,
  conf_en TEXT NOT NULL,
  conf_ja TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('oral', 'poster', 'invited')),
  scope TEXT NOT NULL CHECK (scope IN ('international', 'domestic')),
  place_en TEXT,
  place_ja TEXT,
  url TEXT,
  slide_url TEXT,
  poster_url TEXT,
  video_url TEXT,
  note_en TEXT,
  note_ja TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_presentations_year_sort
  ON presentations (year DESC, sort_date DESC, sort_order DESC);

CREATE INDEX IF NOT EXISTS idx_presentations_scope_type
  ON presentations (scope, type);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_log (entity_type, entity_id, created_at DESC);
