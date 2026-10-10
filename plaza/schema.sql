-- 博客号广场 hub —— D1 schema（独立于博客主库，plaza/wrangler.jsonc 绑定自己的 plaza-db）
-- 部署：npx wrangler d1 execute DB --remote --file schema.sql

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_url TEXT NOT NULL,             -- 站点绝对地址（去尾斜杠，唯一）
  site_name TEXT NOT NULL DEFAULT '', -- 展示名（feed 与名录出参）
  avatar TEXT NOT NULL DEFAULT '',    -- 站点头像 https 地址（ingest 上报 / 管理端设置，广场卡主视觉）
  token TEXT NOT NULL,                -- push ingest 凭据（32 hex，明文只在创建返回一次）
  verified INTEGER NOT NULL DEFAULT 0,-- 认证徽标（B18 雏形：所有权验证通过后管理员打开）
  weight INTEGER NOT NULL DEFAULT 1,  -- 混排权重 0-10（管理员定，默认 1）
  disabled INTEGER NOT NULL DEFAULT 0,-- 停用（违规/180 天无心跳自动休眠）
  pull_enabled INTEGER NOT NULL DEFAULT 1, -- RSS pull 补漏开关（push 为主，pull 只兜底）
  last_seen_at INTEGER NOT NULL DEFAULT 0, -- 最近一次成功 ingest 心跳
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_token ON sites(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_url ON sites(site_url);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                 -- 'post' | 'weibo'
  ref TEXT NOT NULL,                  -- 站内唯一引用：文章 slug / 微博 id
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',   -- 入库前已截断（push 500 / pull 500 字符）
  url TEXT NOT NULL,                  -- 站内原文绝对地址（校验只收 https）
  image TEXT NOT NULL DEFAULT '',     -- 封面图 https 地址（可空）
  published_at INTEGER NOT NULL,      -- 站内发布时间（毫秒）
  source TEXT NOT NULL DEFAULT 'push',-- 'push' | 'pull'——pull 不得覆盖 push 数据（ON CONFLICT WHERE 守卫）
  hidden INTEGER NOT NULL DEFAULT 0,  -- 管理员下架位
  synced_at INTEGER NOT NULL,
  UNIQUE(site_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_items_site ON items(site_id);
CREATE INDEX IF NOT EXISTS idx_items_pub ON items(published_at);
