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
  status       TEXT    NOT NULL DEFAULT 'draft', -- draft | published | scheduled（定时发布）
  pinned       INTEGER NOT NULL DEFAULT 0,
  views        INTEGER NOT NULL DEFAULT 0,
  likes        INTEGER NOT NULL DEFAULT 0,
  author_id    INTEGER,
  published_at INTEGER,
  publish_at   INTEGER,                -- 定时发布时间：到点由 Cron 翻成 published（src/scheduler.ts）
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status, pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_updated ON posts (updated_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL,            -- 文章评论；微博评论固定为 0
  weibo_id   INTEGER NOT NULL DEFAULT 0,  -- 微博评论；文章评论固定为 0
  parent_id  INTEGER NOT NULL DEFAULT 0,  -- 楼中楼：父评论 id，0 = 顶层（作者回复用）
  is_admin   INTEGER NOT NULL DEFAULT 0,  -- 1 = 作者（管理员）发言，前台加徽标
  nickname   TEXT    NOT NULL,
  email      TEXT    NOT NULL DEFAULT '',
  website    TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'approved', -- approved | pending
  ip         TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at);
-- idx_comments_weibo 由 src/db.ts ensureSchema() 在运行时创建：
-- 老库执行本文件时 weibo_id 列尚不存在（ALTER 由运行时补齐），在这里建索引会报错
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  slug       TEXT    NOT NULL UNIQUE,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 单分类：一篇文章最多属于一个分类（post_id 为主键）
CREATE TABLE IF NOT EXISTS post_categories (
  post_id     INTEGER NOT NULL PRIMARY KEY,
  category_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_post_categories_cat ON post_categories (category_id);

-- 微博：随手记，短文字 + 最多 9 张图，无标题无 slug
CREATE TABLE IF NOT EXISTS weibo (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  content      TEXT    NOT NULL DEFAULT '',
  images       TEXT    NOT NULL DEFAULT '[]', -- JSON 数组，如 ["/images/u/202510/xxx.jpg"]
  topics       TEXT    NOT NULL DEFAULT '[]', -- JSON 数组，从正文 #话题# 自动提取
  status       TEXT    NOT NULL DEFAULT 'published', -- draft | published
  pinned       INTEGER NOT NULL DEFAULT 0,          -- 置顶（最多 3 条，应用层限制）
  likes        INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weibo_status ON weibo (status, published_at DESC);

-- 标签登记表：分类页可预建标签；文章用到的标签读取时自动并入展示
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL DEFAULT '',
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 友情链接：站长维护，访客也可申请收录（source=user，默认 pending 待审）
CREATE TABLE IF NOT EXISTS friend_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  url         TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT '',          -- 图标地址（站内 /images/ 或 http(s) 外链），空则前台用站名首字图标
  status      TEXT    NOT NULL DEFAULT 'pending',   -- approved | pending
  sort        INTEGER NOT NULL DEFAULT 0,           -- 数字小的靠前
  source      TEXT    NOT NULL DEFAULT 'admin',     -- admin | user
  ip          TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links (status, sort, id);

-- Telegram 相册缓冲：一次多选会拆成多条消息（同一 media_group_id），
-- 先逐条写入这里（图片已转存 R2），几秒没有新图后合并发布成一条微博并清空
CREATE TABLE IF NOT EXISTS tg_buffer (
  media_group_id TEXT PRIMARY KEY,
  content        TEXT NOT NULL DEFAULT '',
  images         TEXT NOT NULL DEFAULT '[]', -- JSON 数组，如 ["/images/u/202510/xxx.jpg"]
  status         TEXT NOT NULL DEFAULT 'published',
  chat_id        TEXT NOT NULL DEFAULT '',
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- 访客统计日志（后台「统计」页）：site.js 打点 → POST /api/public/track 落这里。
-- 只存匿名 vid 与来源域名，不存 IP / 原始 UA；day 是北京时间日期（写入时算好，聚合直接 GROUP BY）。
-- 日志类数据：不进备份（与 sessions / tg_buffer 同理），保留 180 天由每晚备份 cron 顺带清理。
CREATE TABLE IF NOT EXISTS visit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,               -- 毫秒时间戳
  day     TEXT    NOT NULL,               -- 北京时间 YYYY-MM-DD
  vid     TEXT    NOT NULL DEFAULT '',    -- 匿名访客 id（localStorage）
  path    TEXT    NOT NULL DEFAULT '',    -- 页面路径（含 query，截 300）
  title   TEXT    NOT NULL DEFAULT '',    -- document.title 截 200
  ref     TEXT    NOT NULL DEFAULT '',    -- 来源域名（站内/直接为空）
  dev     TEXT    NOT NULL DEFAULT '',    -- desktop | mobile | tablet
  br      TEXT    NOT NULL DEFAULT '',    -- wechat | chrome | edge | firefox | safari | other
  country TEXT    NOT NULL DEFAULT ''     -- CF-IPCountry 两字母码
);
CREATE INDEX IF NOT EXISTS idx_visit_day ON visit_log (day, ts);
