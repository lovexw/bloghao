-- 博客号 BlogHao 数据库结构（D1 / SQLite）
-- 幂等：可以重复执行，用于首次初始化与升级
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  salt          TEXT    NOT NULL,
  display_name  TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  content      TEXT    NOT NULL DEFAULT '',
  summary      TEXT    NOT NULL DEFAULT '',
  cover        TEXT    NOT NULL DEFAULT '',
  tags         TEXT    NOT NULL DEFAULT '[]', -- JSON 数组，如 ["生活","Cloudflare"]
  status       TEXT    NOT NULL DEFAULT 'draft', -- draft | published
  pinned       INTEGER NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  likes        INTEGER NOT NULL DEFAULT 0,
  author_id    INTEGER,
  published_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status, pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_updated ON posts (updated_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL,
  nickname   TEXT    NOT NULL,
  email      TEXT    NOT NULL DEFAULT '',
  website    TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'approved', -- approved | pending
  ip         TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS uploads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL DEFAULT '',
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
