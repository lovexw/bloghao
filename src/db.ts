import type { CommentRow, PostRow, SettingsMap } from './types'
import { clampInt } from './utils'

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

export interface ListPostsOptions {
  status?: 'published' | 'draft' | 'all'
  q?: string
  tag?: string
  page?: number
  limit?: number
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
    where.push('(title LIKE ? OR summary LIKE ? OR content LIKE ?)')
    const like = `%${opts.q.replace(/[%_]/g, (m) => '\\' + m)}%`
    binds.push(like, like, like)
  }
  if (opts.tag) {
    where.push("tags LIKE ? ESCAPE '\\'")
    binds.push(`%${JSON.stringify(opts.tag).slice(1, -1).replace(/[%_\\]/g, (m) => '\\' + m)}%`)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const orderSql =
    opts.status === 'draft'
      ? 'ORDER BY updated_at DESC'
      : 'ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC'

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

export async function relatedPosts(db: D1Database, post: PostRow, limit = 3): Promise<PostRow[]> {
  const tags = parseTags(post)
  if (tags.length) {
    const likeBinds = tags.map(() => "tags LIKE ? ESCAPE '\\'").join(' OR ')
    const { results } = await db
      .prepare(
        `SELECT * FROM posts WHERE id != ? AND status = 'published' AND (${likeBinds}) ORDER BY views DESC LIMIT ?`
      )
      .bind(post.id, ...tags.map((t) => `%${JSON.stringify(t).slice(1, -1)}%`), limit)
      .all<PostRow>()
    if ((results?.length ?? 0) > 0) return results ?? []
  }
  const { results } = await db
    .prepare("SELECT * FROM posts WHERE id != ? AND status = 'published' ORDER BY published_at DESC LIMIT ?")
    .bind(post.id, limit)
    .all<PostRow>()
  return results ?? []
}

export async function countUsers(db: D1Database): Promise<number> {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  return r?.n ?? 0
}

export async function seedWelcomePost(db: D1Database, authorId: number): Promise<void> {
  const now = Date.now()
  const content = `<p>你好呀，这是你博客号的第一篇文章 👋</p><p>微信有<strong>公众号</strong>，你有<strong>博客号</strong>——不用申请、不用排队，注册账号的那一刻它就归你了，而且完全住在 <strong>Cloudflare</strong> 上：网页由 Workers 渲染，文字存进 D1，图片传到 R2，全世界的访客都很快，每月免费额度足够你写很多年。</p><h2>写作，就要轻松</h2><p>打开 <a href="/admin/">后台</a>，像写公众号一样写：标题、正文、封面、标签都在一屏里；截图直接 <strong>Ctrl/⌘ + V</strong> 粘贴进正文，图片自动传到你的 R2 图床。</p><blockquote>博客号，博客好。写作最好的状态：像发动态一样轻，像写文章一样认真。</blockquote><h3>试试这些</h3><ul><li>粘贴一张截图，体验自动上传</li><li>点右上角「体检」，检查排版是否符合微信排版规范</li><li>在「设置」里换一套主题：微信公众号风 / 纸墨 / 极简 / 夜航</li></ul><p>现在，删掉这篇文章，写下属于你的第一篇吧。</p>`
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
