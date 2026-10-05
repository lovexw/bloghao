import type { CategoryRow, CommentRow, FriendLinkRow, PostRow, SettingsMap, WeiboRow } from './types'
import { clampInt, excerpt, jsonItemLikePattern, WEIBO_MAX_TOPICS } from './utils'

export const DEFAULT_SETTINGS: Record<string, string> = {
  siteName: '博客号 BlogHao',
  siteDescription: '微信有公众号，你有博客号。想写就写，一切都归你。',
  theme: 'wechat',
  siteUrl: '',
  footerText: '由 博客号 驱动 · 住在 Cloudflare 上',
  allowComments: '1',
  moderateComments: '0',
  postsPerPage: '10',
  about: '<p>在这里写下关于你的故事。</p>',
  faviconUrl: '',
  avatarUrl: '',
  // 分享到社交平台的默认卡图（og:image 兜底；文章未设封面/卡图时使用，空则回退内置 /og-default.png）
  ogImageDefault: '',
  // 外部发布（见 src/external.ts）：空 Token = 开放接口关闭
  externalToken: '',
  telegramBotToken: '',
  telegramAllowFrom: '',
  telegramWebhookSecret: '',
  // 有新留言/评论时推送到 Telegram（目标为白名单第一个 Chat ID）
  notifyNewComment: '1',
  // RSS 输出全文（关闭则只输出摘要）
  rssFullText: '1',
  // 每晚凌晨自动备份 D1 到 R2 的 backups/ 目录
  backupEnabled: '1',
  // 访客统计采集开关（后台「统计」页；关闭后前台不打点，见 src/stats.ts）
  statsEnabled: '1',
  // 编辑器插件停用名单（后台「插件」页；逗号分隔的 manifest id，空 = 全部启用）
  pluginsDisabled: '',
}

export async function getSettings(db: D1Database): Promise<SettingsMap> {
  const { results } = await db
    .prepare('SELECT key, value FROM settings')
    .all<{ key: string; value: string }>()
  const s: SettingsMap = { ...DEFAULT_SETTINGS }
  for (const r of results ?? []) s[r.key] = r.value
  return s
}

export async function saveSettings(db: D1Database, patch: SettingsMap): Promise<void> {
  const entries = Object.entries(patch)
  if (!entries.length) return
  const stmts = entries.map(([k, v]) =>
    db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .bind(k, String(v ?? ''))
  )
  await db.batch(stmts)
}

export function parseTags(row: Pick<PostRow, 'tags'>): string[] {
  try {
    const a = JSON.parse(row.tags || '[]')
    return Array.isArray(a)
      ? a.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, 8)
      : []
  } catch {
    return []
  }
}

export type PostSort = 'latest' | 'views' | 'likes' | 'comments' | 'random'

export interface ListPostsOptions {
  status?: 'published' | 'draft' | 'scheduled' | 'all'
  q?: string
  tag?: string
  categorySlug?: string
  page?: number
  limit?: number
  /** 前台列表排序：latest 置顶优先最新在前；random 需配 seed 保证翻页不重洗 */
  sort?: PostSort
  seed?: number
}

export interface ListPostsResult {
  items: PostRow[]
  total: number
  page: number
  totalPages: number
}

export async function listPosts(db: D1Database, opts: ListPostsOptions = {}): Promise<ListPostsResult> {
  const page = clampInt(opts.page, 1, 100000, 1)
  const limit = clampInt(opts.limit, 1, 100, 10)
  const where: string[] = []
  const binds: unknown[] = []

  if (opts.status && opts.status !== 'all') {
    where.push('status = ?')
    binds.push(opts.status)
  }
  if (opts.q) {
    // \% 和 \_ 是字面转义，必须声明 ESCAPE '\' 才生效，否则搜「100%」这类词恒为空
    where.push("(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')")
    const like = `%${opts.q.replace(/[%_]/g, (m) => '\\' + m)}%`
    binds.push(like, like, like)
  }
  if (opts.tag) {
    where.push("tags LIKE ? ESCAPE '\\'")
    binds.push(jsonItemLikePattern(opts.tag))
  }
  if (opts.categorySlug) {
    where.push('id IN (SELECT post_id FROM post_categories WHERE category_id IN (SELECT id FROM categories WHERE slug = ?))')
    binds.push(opts.categorySlug)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const recency = 'COALESCE(published_at, created_at) DESC'
  // 随机排序用 (id+seed) 乘法散列：同一 seed 下全站顺序固定，翻页不重洗；换 seed 即换一组
  const orderSql =
    opts.status === 'draft'
      ? 'ORDER BY updated_at DESC'
      : opts.sort === 'views'
        ? `ORDER BY views DESC, ${recency}`
        : opts.sort === 'likes'
          ? `ORDER BY likes DESC, ${recency}`
          : opts.sort === 'comments'
            ? `ORDER BY (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = posts.id AND cm.status = 'approved') DESC, ${recency}`
            : opts.sort === 'random'
              ? `ORDER BY ((posts.id + ${clampInt(opts.seed, 1, 999999999, 1)}) * 2654435761) % 4294967296 ASC, posts.id ASC`
              : `ORDER BY pinned DESC, ${recency}`

  const [itemsRes, countRes] = await Promise.all([
    db
      .prepare(`SELECT * FROM posts ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
      .bind(...binds, limit, (page - 1) * limit)
      .all<PostRow>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM posts ${whereSql}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ])
  const total = countRes?.n ?? 0
  return { items: itemsRes.results ?? [], total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

export async function getPostBySlug(db: D1Database, slug: string): Promise<PostRow | null> {
  return db.prepare('SELECT * FROM posts WHERE slug = ?').bind(slug).first<PostRow>()
}

export async function getPostById(db: D1Database, id: number): Promise<PostRow | null> {
  return db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>()
}

export async function uniqueSlug(db: D1Database, base: string, excludeId?: number): Promise<string> {
  let slug = base
  for (let i = 2; i < 100; i++) {
    const row = await db.prepare('SELECT id FROM posts WHERE slug = ?').bind(slug).first<{ id: number }>()
    if (!row || row.id === excludeId) return slug
    slug = `${base}-${i}`
  }
  return `${base}-${Date.now().toString(36)}`
}

export async function listApprovedComments(db: D1Database, postId: number): Promise<CommentRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM comments WHERE post_id = ? AND status = ? ORDER BY created_at ASC LIMIT 500')
    .bind(postId, 'approved')
    .all<CommentRow>()
  return results ?? []
}

/** 留言板（/guestbook）：post_id 与 weibo_id 都为 0 的评论即留言板留言 */
export async function listGuestbookComments(db: D1Database): Promise<CommentRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM comments WHERE post_id = 0 AND weibo_id = 0 AND status = 'approved' ORDER BY created_at ASC LIMIT 500")
    .all<CommentRow>()
  return results ?? []
}

/** 文章归档（/archives）：全部已发布文章的标题与时间，按时间倒序（上限 2000 篇） */
export async function listAllPublishedArchives(db: D1Database): Promise<{ slug: string; title: string; ts: number }[]> {
  const { results } = await db
    .prepare(
      "SELECT slug, title, COALESCE(published_at, created_at) AS ts FROM posts WHERE status = 'published' ORDER BY ts DESC LIMIT 2000"
    )
    .all<{ slug: string; title: string; ts: number }>()
  return results ?? []
}

/** sitemap 用的轻量列表：slug + updated_at（不走 listPosts——它的 limit 被 clamp 到 100） */
export async function listSitemapPosts(db: D1Database): Promise<{ slug: string; updated_at: number }[]> {
  const { results } = await db
    .prepare("SELECT slug, updated_at FROM posts WHERE status = 'published' ORDER BY updated_at DESC LIMIT 2000")
    .all<{ slug: string; updated_at: number }>()
  return results ?? []
}

/** 已发布文章用到的标签聚合（导航菜单/sitemap 用），按使用次数倒序 */
export async function listPublishedTags(db: D1Database): Promise<{ name: string; count: number }[]> {
  const { results } = await db
    .prepare("SELECT tags FROM posts WHERE status = 'published' LIMIT 1000")
    .all<{ tags: string }>()
  const count = new Map<string, number>()
  for (const r of results ?? []) {
    for (const t of parseTags({ tags: r.tags } as PostRow)) count.set(t, (count.get(t) || 0) + 1)
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 100)
    .map(([name, count]) => ({ name, count }))
}

/* ---------------- 历史上的今天（首页时光机卡） ---------------- */

export interface OnThisDayItem {
  kind: 'post' | 'weibo'
  /** 跳转地址：/post/:slug 或 /weibo?wb=:id#wb-:id（?wb= 让 /weibo 定位到所在页） */
  href: string
  /** 展示文本：文章标题 / 微博正文摘要 */
  text: string
  /** 往年今日的整年时间戳 */
  ts: number
  /** 距今几年（1 = 去年） */
  yearsAgo: number
}

export interface OnThisDayRow {
  key: string
  title: string
  content: string
  images: string
  ts: number
}

/** 把毫秒时间戳按北京时间的口径取月-日/年（+8h 与前台展示一致，0-8 点发布不跨天） */
const ON_THIS_DAY_MD = "strftime('%m-%d', COALESCE(published_at, created_at) / 1000 + 28800, 'unixepoch')"
const ON_THIS_DAY_Y = "CAST(strftime('%Y', COALESCE(published_at, created_at) / 1000 + 28800, 'unixepoch') AS INTEGER)"

/** 单侧候选上限：防异常数据（如整包导入的同日内容）拖爆返回集，合并后还会再截 ON_THIS_DAY_MAX */
const ON_THIS_DAY_SOURCE_LIMIT = 200
/** 最终保留条数上限：卡片直出前几条，其余进「展开」折叠区 */
export const ON_THIS_DAY_MAX = 100

/**
 * 纯函数：两路查询结果 → 剔空、合并、按时间倒序、封顶。
 * 与 SQL 拆开以便单测覆盖合并口径；nowTs 传查询时刻（毫秒），用于算 yearsAgo。
 */
export function buildOnThisDayItems(postRows: OnThisDayRow[], weiboRows: OnThisDayRow[], nowTs: number): OnThisDayItem[] {
  const thisYear = new Date(nowTs + 8 * 3600_000).getUTCFullYear()
  const items: OnThisDayItem[] = []
  for (const r of postRows) {
    items.push({ kind: 'post', href: `/post/${r.key}`, text: r.title, ts: r.ts, yearsAgo: thisYear - new Date(r.ts + 8 * 3600_000).getUTCFullYear() })
  }
  for (const r of weiboRows) {
    const imgs = weiboImageList(r)
    const text = r.content.trim() || (imgs.length ? `发了 ${imgs.length} 张图` : '')
    if (!text) continue
    items.push({ kind: 'weibo', href: `/weibo?wb=${r.key}#wb-${r.key}`, text: excerpt(text, 64), ts: r.ts, yearsAgo: thisYear - new Date(r.ts + 8 * 3600_000).getUTCFullYear() })
  }
  return items.sort((a, b) => b.ts - a.ts).slice(0, ON_THIS_DAY_MAX)
}

/**
 * 往年今日已发布的内容：文章 + 微博合并，时间倒序全量返回（封顶 ON_THIS_DAY_MAX）。
 * 只匹配更早的年份（今年的今天不算），没有命中返回空数组；卡片折叠区负责承载多条目。
 * 结果按天做进程内缓存：首页每次渲染不必重复全表扫（数据变了最多延迟 10 分钟）。
 */
export async function listOnThisDay(db: D1Database): Promise<OnThisDayItem[]> {
  // 缓存 key 也按北京时间的日期翻日
  const dayKey = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
  if (otdCache && otdCache.day === dayKey && Date.now() - otdCache.at < 10 * 60_000) return otdCache.items
  // 两侧比较基准都要 +28800 对齐北京时间：'now' 是 UTC 墙钟，直接比会让北京 0-8 点匹配到「昨天」的历史
  const [postsRes, weiboRes] = await db.batch([
    db
      .prepare(
        `SELECT slug AS key, title, '' AS content, '' AS images, COALESCE(published_at, created_at) AS ts
         FROM posts
         WHERE status = 'published' AND ${ON_THIS_DAY_MD} = strftime('%m-%d', 'now', '28800 seconds') AND ${ON_THIS_DAY_Y} < CAST(strftime('%Y', 'now', '28800 seconds') AS INTEGER)
         ORDER BY ts DESC LIMIT ${ON_THIS_DAY_SOURCE_LIMIT}`
      ),
    db
      .prepare(
        `SELECT id AS key, '' AS title, content, images, COALESCE(published_at, created_at) AS ts
         FROM weibo
         WHERE status = 'published' AND ${ON_THIS_DAY_MD} = strftime('%m-%d', 'now', '28800 seconds') AND ${ON_THIS_DAY_Y} < CAST(strftime('%Y', 'now', '28800 seconds') AS INTEGER)
         ORDER BY ts DESC LIMIT ${ON_THIS_DAY_SOURCE_LIMIT}`
      ),
  ])
  const items = buildOnThisDayItems(
    (postsRes.results ?? []) as unknown as OnThisDayRow[],
    (weiboRes.results ?? []) as unknown as OnThisDayRow[],
    Date.now()
  )
  otdCache = { day: dayKey, at: Date.now(), items }
  return items
}
let otdCache: { day: string; at: number; items: OnThisDayItem[] } | null = null


export async function relatedPosts(db: D1Database, post: PostRow, limit = 3): Promise<PostRow[]> {
  const tags = parseTags(post)
  if (tags.length) {
    // 与 listPosts 的标签过滤同口径：带 JSON 引号精确匹配 + ESCAPE，防「猫」命中「波斯猫」/通配符注入
    // 注意必须 join(' OR ')：数组直接内插会以逗号连接，(a,b) 构成 row value，D1 直接报 row value misused
    const likeBinds = tags.map(() => "tags LIKE ? ESCAPE '\\'").join(' OR ')
    const { results } = await db
      .prepare(
        `SELECT * FROM posts WHERE id != ? AND status = 'published' AND (${likeBinds}) ORDER BY views DESC LIMIT ?`
      )
      .bind(post.id, ...tags.map((t) => jsonItemLikePattern(t)), limit)
      .all<PostRow>()
    if ((results?.length ?? 0) > 0) return results ?? []
  }
  const { results } = await db
    .prepare("SELECT * FROM posts WHERE id != ? AND status = 'published' ORDER BY published_at DESC LIMIT ?")
    .bind(post.id, limit)
    .all<PostRow>()
  return results ?? []
}

/* ---------------- 分类 ---------------- */

export async function listCategories(db: D1Database, opts: { withCount?: boolean } = {}): Promise<(CategoryRow & { post_count?: number })[]> {
  if (opts.withCount) {
    const { results } = await db
      .prepare(
        `SELECT c.*, COUNT(pc.post_id) AS post_count
         FROM categories c LEFT JOIN post_categories pc ON pc.category_id = c.id
         GROUP BY c.id ORDER BY c.sort ASC, c.id ASC`
      )
      .all<CategoryRow & { post_count: number }>()
    return results ?? []
  }
  const { results } = await db.prepare('SELECT * FROM categories ORDER BY sort ASC, id ASC').all<CategoryRow>()
  return results ?? []
}

export async function getCategoryBySlug(db: D1Database, slug: string): Promise<CategoryRow | null> {
  return db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first<CategoryRow>()
}

export async function getCategoryById(db: D1Database, id: number): Promise<CategoryRow | null> {
  return db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<CategoryRow>()
}

export async function uniqueCategorySlug(db: D1Database, base: string, excludeId?: number): Promise<string> {
  let slug = base
  for (let i = 2; i < 100; i++) {
    const row = await db.prepare('SELECT id FROM categories WHERE slug = ?').bind(slug).first<{ id: number }>()
    if (!row || row.id === excludeId) return slug
    slug = `${base}-${i}`
  }
  return `${base}-${Date.now().toString(36)}`
}

export async function createCategory(db: D1Database, name: string, slug: string, sort = 0): Promise<CategoryRow> {
  const res = await db
    .prepare('INSERT INTO categories (name, slug, sort, created_at) VALUES (?, ?, ?, ?)')
    .bind(name, slug, sort, Date.now())
    .run()
  const row = await getCategoryById(db, Number(res.meta.last_row_id))
  if (!row) throw new Error('分类创建失败')
  return row
}

export async function setPostCategory(db: D1Database, postId: number, categoryId: number | null): Promise<void> {
  if (categoryId == null) {
    await db.prepare('DELETE FROM post_categories WHERE post_id = ?').bind(postId).run()
    return
  }
  await db
    .prepare('INSERT INTO post_categories (post_id, category_id) VALUES (?, ?) ON CONFLICT(post_id) DO UPDATE SET category_id = excluded.category_id')
    .bind(postId, categoryId)
    .run()
}

export async function getPostCategoryId(db: D1Database, postId: number): Promise<number | null> {
  const row = await db
    .prepare('SELECT category_id FROM post_categories WHERE post_id = ?')
    .bind(postId)
    .first<{ category_id: number }>()
  return row?.category_id ?? null
}

/** 批量取一组文章的分类名（后台列表展示用）：{postId: name} */
export async function categoryNameMap(db: D1Database, postIds: number[]): Promise<Map<number, string>> {
  if (!postIds.length) return new Map()
  const ph = postIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(
      `SELECT pc.post_id, c.name FROM post_categories pc JOIN categories c ON c.id = pc.category_id WHERE pc.post_id IN (${ph})`
    )
    .bind(...postIds)
    .all<{ post_id: number; name: string }>()
  const m = new Map<number, string>()
  for (const r of results ?? []) m.set(r.post_id, r.name)
  return m
}

/* ---------------- 微博（随手记） ---------------- */

export const WEIBO_MAX_IMAGES = 9

/** 校验并规整微博图片数组：只接受站内 /images/ 与 http(s) 外链，最多 9 张 */
export function parseWeiboImages(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('/images/') || /^https?:\/\//i.test(s))
    .slice(0, WEIBO_MAX_IMAGES)
}

export function weiboImageList(row: Pick<WeiboRow, 'images'>): string[] {
  try {
    const a = JSON.parse(row.images || '[]')
    return Array.isArray(a) ? a.filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, WEIBO_MAX_IMAGES) : []
  } catch {
    return []
  }
}

export function weiboTopicList(row: Pick<WeiboRow, 'topics'>): string[] {
  try {
    const a = JSON.parse(row.topics || '[]')
    return Array.isArray(a) ? a.filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, WEIBO_MAX_TOPICS) : []
  } catch {
    return []
  }
}

/** 已发布微博的话题聚合（前台话题条用）：按出现次数倒序，取前 20 个 */
export async function listWeiboTopics(db: D1Database): Promise<{ name: string; count: number }[]> {
  const { results } = await db
    .prepare("SELECT topics FROM weibo WHERE status = 'published' LIMIT 1000")
    .all<{ topics: string }>()
  const count = new Map<string, number>()
  for (const r of results ?? []) {
    for (const t of weiboTopicList({ topics: r.topics })) count.set(t, (count.get(t) || 0) + 1)
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([name, count]) => ({ name, count }))
}

export interface ListWeiboResult {
  items: WeiboRow[]
  total: number
  page: number
  totalPages: number
}

/** listWeibo / locateWeiboPage 共用的过滤条件（status + 话题），保证深链定位与列表分页的口径一致 */
function weiboConditions(opts: { status?: 'published' | 'draft' | 'all'; topic?: string }): { conds: string[]; binds: unknown[] } {
  const conds: string[] = []
  const binds: unknown[] = []
  if (opts.status && opts.status !== 'all') {
    conds.push('status = ?')
    binds.push(opts.status)
  }
  if (opts.topic) {
    conds.push("topics LIKE ? ESCAPE '\\'")
    binds.push(jsonItemLikePattern(opts.topic))
  }
  return { conds, binds }
}

export async function listWeibo(
  db: D1Database,
  opts: {
    status?: 'published' | 'draft' | 'all'
    page?: number
    limit?: number
    topic?: string
    pinnedFirst?: boolean
  } = {}
): Promise<ListWeiboResult> {
  const page = clampInt(opts.page, 1, 100000, 1)
  const limit = clampInt(opts.limit, 1, 100, 15)
  const { conds, binds } = weiboConditions(opts)
  const whereSql = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const order = opts.pinnedFirst
    ? 'ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC, id DESC'
    : 'ORDER BY COALESCE(published_at, created_at) DESC, id DESC'
  const [itemsRes, countRes] = await Promise.all([
    db
      .prepare(`SELECT * FROM weibo ${whereSql} ${order} LIMIT ? OFFSET ?`)
      .bind(...binds, limit, (page - 1) * limit)
      .all<WeiboRow>(),
    db.prepare(`SELECT COUNT(*) AS n FROM weibo ${whereSql}`).bind(...binds).first<{ n: number }>(),
  ])
  const total = countRes?.n ?? 0
  return { items: itemsRes.results ?? [], total, page, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

/**
 * 深链定位：算出某条已发布微博在时间线中的页码（1 起）。
 * /weibo 每页只渲染 15 条，而历史上的今天、首页入口卡、TG 通知等入口都链到 /weibo?wb=<id>#wb-<id>，
 * 目标条目多半不在第 1 页——服务端先定位页码再渲染那一页，浏览器原生锚点滚动才落得到。
 * 排序口径与 listWeibo 的 pinnedFirst（置顶优先 + 时间倒序 + id 兜底）一致，status/topic 过滤同步生效；
 * 目标不存在 / 非已发布 / 不在 topic 筛选范围内时返回 null，调用方回退常规分页。
 */
export async function locateWeiboPage(db: D1Database, id: number, opts: { limit?: number; topic?: string } = {}): Promise<number | null> {
  const limit = clampInt(opts.limit, 1, 100, 15)
  const { conds, binds } = weiboConditions({ status: 'published', topic: opts.topic })
  const target = conds.length ? `id = ? AND ${conds.join(' AND ')}` : 'id = ?'
  const x = await db
    .prepare(`SELECT id, pinned, COALESCE(published_at, created_at) AS ts FROM weibo WHERE ${target}`)
    .bind(id, ...binds)
    .first<{ id: number; pinned: number; ts: number }>()
  if (!x) return null
  // 统计按同一排序排在它前面的行数：页码 = floor(前数 / limit) + 1
  const front = conds.length ? conds.join(' AND ') + ' AND ' : ''
  const rank = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM weibo WHERE ${front}
       (pinned > ?
        OR (pinned = ? AND COALESCE(published_at, created_at) > ?)
        OR (pinned = ? AND COALESCE(published_at, created_at) = ? AND id > ?))`
    )
    .bind(...binds, x.pinned, x.pinned, x.ts, x.pinned, x.ts, x.id)
    .first<{ n: number }>()
  return Math.floor((rank?.n ?? 0) / limit) + 1
}

export async function getWeiboById(db: D1Database, id: number): Promise<WeiboRow | null> {
  return db.prepare('SELECT * FROM weibo WHERE id = ?').bind(id).first<WeiboRow>()
}

/** 批量取一组微博的已审核评论数：{weiboId: count} */
export async function weiboCommentCountMap(db: D1Database, weiboIds: number[]): Promise<Map<number, number>> {
  if (!weiboIds.length) return new Map()
  const ph = weiboIds.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT weibo_id, COUNT(*) AS n FROM comments WHERE weibo_id IN (${ph}) AND status = 'approved' GROUP BY weibo_id`)
    .bind(...weiboIds)
    .all<{ weibo_id: number; n: number }>()
  const m = new Map<number, number>()
  for (const r of results ?? []) m.set(r.weibo_id, r.n)
  return m
}

/* ---------------- 友情链接 ---------------- */

export interface ListFriendLinksResult {
  items: FriendLinkRow[]
  total: number
  pending: number
}

/** 友链列表：sort 升序、同序号按创建先后；pending 为待审核数（后台角标用） */
export async function listFriendLinks(db: D1Database, opts: { status?: 'approved' | 'pending' | 'all' } = {}): Promise<ListFriendLinksResult> {
  const where = opts.status && opts.status !== 'all' ? 'WHERE status = ?' : ''
  const [listRes, pendingRes] = await Promise.all([
    db
      .prepare(`SELECT * FROM friend_links ${where} ORDER BY sort ASC, id ASC LIMIT 500`)
      .bind(...(where ? [opts.status] : []))
      .all<FriendLinkRow>(),
    db.prepare("SELECT COUNT(*) AS n FROM friend_links WHERE status = 'pending'").first<{ n: number }>(),
  ])
  const items = listRes.results ?? []
  return { items, total: items.length, pending: pendingRes?.n ?? 0 }
}

export async function getFriendLinkById(db: D1Database, id: number): Promise<FriendLinkRow | null> {
  return db.prepare('SELECT * FROM friend_links WHERE id = ?').bind(id).first<FriendLinkRow>()
}

/* ---------------- 轻量迁移 ----------------
 * schema.sql 只对全新库生效（CREATE TABLE IF NOT EXISTS 不会补列），
 * 老库升级靠这里：启动时检查缺列，自动 ALTER TABLE 补齐（每个 isolate 只跑一次）。
 */
const SCHEMA_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'posts', column: 'publish_at', ddl: 'ALTER TABLE posts ADD COLUMN publish_at INTEGER' },
  { table: 'weibo', column: 'likes', ddl: 'ALTER TABLE weibo ADD COLUMN likes INTEGER NOT NULL DEFAULT 0' },
  { table: 'weibo', column: 'topics', ddl: "ALTER TABLE weibo ADD COLUMN topics TEXT NOT NULL DEFAULT '[]'" },
  { table: 'weibo', column: 'pinned', ddl: 'ALTER TABLE weibo ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0' },
  { table: 'comments', column: 'weibo_id', ddl: 'ALTER TABLE comments ADD COLUMN weibo_id INTEGER NOT NULL DEFAULT 0' },
  { table: 'comments', column: 'parent_id', ddl: 'ALTER TABLE comments ADD COLUMN parent_id INTEGER NOT NULL DEFAULT 0' },
  { table: 'comments', column: 'is_admin', ddl: 'ALTER TABLE comments ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0' },
]
const SCHEMA_TABLES = [
  // Telegram 相册缓冲（src/external.ts）：多选拆成的多条消息先落这里，几秒后合并成一条微博
  `CREATE TABLE IF NOT EXISTS tg_buffer (
    media_group_id TEXT PRIMARY KEY,
    content        TEXT NOT NULL DEFAULT '',
    images         TEXT NOT NULL DEFAULT '[]',
    status         TEXT NOT NULL DEFAULT 'published',
    chat_id        TEXT NOT NULL DEFAULT '',
    updated_at     INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS friend_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    icon        TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'pending',
    sort        INTEGER NOT NULL DEFAULT 0,
    source      TEXT    NOT NULL DEFAULT 'admin',
    ip          TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  )`,
  // 访客统计日志（src/stats.ts）：只存匿名 vid 与来源域名，不进备份，保留 180 天
  `CREATE TABLE IF NOT EXISTS visit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    ts      INTEGER NOT NULL,
    day     TEXT    NOT NULL,
    vid     TEXT    NOT NULL DEFAULT '',
    path    TEXT    NOT NULL DEFAULT '',
    title   TEXT    NOT NULL DEFAULT '',
    ref     TEXT    NOT NULL DEFAULT '',
    dev     TEXT    NOT NULL DEFAULT '',
    br      TEXT    NOT NULL DEFAULT '',
    country TEXT    NOT NULL DEFAULT ''
  )`,
]
const SCHEMA_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_comments_weibo ON comments (weibo_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_friend_links_status ON friend_links (status, sort, id)',
  'CREATE INDEX IF NOT EXISTS idx_visit_day ON visit_log (day, ts)',
]

async function tableColumns(db: D1Database, table: string): Promise<Set<string>> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return new Set((results ?? []).map((r) => r.name))
}

export async function ensureSchema(db: D1Database): Promise<void> {
  const cols = new Map<string, Set<string>>()
  for (const { table } of SCHEMA_COLUMNS) {
    if (!cols.has(table)) cols.set(table, await tableColumns(db, table))
  }
  for (const { table, column, ddl } of SCHEMA_COLUMNS) {
    if (cols.get(table)?.has(column)) continue
    try {
      await db.prepare(ddl).run()
    } catch {
      /* 并发 isolate 已加过列，忽略 duplicate column 错误 */
    }
  }
  for (const ddl of SCHEMA_TABLES) {
    try {
      await db.prepare(ddl).run()
    } catch {
      /* 表已存在 */
    }
  }
  for (const ddl of SCHEMA_INDEXES) {
    try {
      await db.prepare(ddl).run()
    } catch {
      /* 索引已存在 */
    }
  }
}

export async function countUsers(db: D1Database): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  return r?.n ?? 0
}

export async function seedWelcomePost(db: D1Database, authorId: number): Promise<void> {
  const now = Date.now()
  const content = `<p>你好呀，这是你博客号的第一篇文章 👋</p><p>微信有<strong>公众号</strong>，你有<strong>博客号</strong>——不用申请、不用排队，注册账号的那一刻它就归你了，而且完全住在 <strong>Cloudflare</strong> 上：网页由 Workers 渲染，文字存进 D1，图片传到 R2，全世界的访客都很快，每月免费额度足够你写很多年。</p><h2>写作，就要轻松</h2><p>打开 <a href="/admin/">后台</a>，像写公众号一样写：标题、正文、封面、标签都在一屏里；截图直接 <strong>Ctrl/⌘ + V</strong> 粘贴进正文，图片自动传到你的 R2 图床。</p><blockquote>博客号，博客好。写作最好的状态：像发动态一样轻，像写文章一样认真。</blockquote><h3>试试这些</h3><ul><li>粘贴一张截图，体验自动上传</li><li>点右上角「体检」，检查排版是否符合微信排版规范</li><li>在「设置」里换一套主题：微信公众号风 / 纸墨 / 极简 / 夜航 / 手账</li></ul><p>现在，删掉这篇文章，写下属于你的第一篇吧。</p>`
  // OR IGNORE：slug 已存在（例如线上已手动播种过）时静默跳过，保证首次创建管理员永不失败
  await db
    .prepare(
      `INSERT OR IGNORE INTO posts (slug, title, content, summary, cover, tags, status, pinned, author_id, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', ?, 'published', 0, ?, ?, ?, ?)`
    )
    .bind(
      'hello-bloghao',
      '你好，博客号！这是你的第一篇文章',
      content,
      '欢迎开号：微信有公众号，你有博客号。想写就写，一切都归你。',
      JSON.stringify(['开始使用']),
      authorId,
      now,
      now,
      now
    )
    .run()
}
