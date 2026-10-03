import type { CommentRow, PostRow, SettingsMap } from './types'
import { clampInt } from './utils'

export const DEFAULT_SETTINGS: Record<string, string> = {
  siteName: '墨博 MoBlog',
  siteDescription: '一支笔，一块云上的小院。写点东西，就当小微博。',
  theme: 'wechat',
  siteUrl: '',
  footerText: '由 MoBlog 驱动 · 住在 Cloudflare 上',
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
  const content = `<p>你好呀，我是你的博客小院的第一篇文章 👋</p><p>这个博客完全住在 <strong>Cloudflare</strong> 上：网页由 Workers 渲染，文字存进 D1，图片传到 R2 图床——全世界的访问者都很快，而且每月免费额度足够你写很多年。</p><h2>写作的感觉，是最重要的</h2><p>打开 <a href="/admin/">后台</a>，你会看到一个熟悉的界面：像写公众号一样写作。标题、正文、封面、标签，都在一屏里；截图直接 <strong>Ctrl/⌘ + V</strong> 粘贴进正文，图片会自动传到你的 R2 图床。</p><blockquote>写博客最好的状态：像发一条微博一样轻，像写一篇文章一样认真。</blockquote><h3>试试这些</h3><ul><li>粘贴一张截图，体验自动上传</li><li>点右上角「体检」，检查排版是否符合微信排版规范</li><li>在「设置」里切换四套主题：微信风 / 纸墨 / 极简 / 夜航</li></ul><p>现在，删掉这篇文章，写下你自己的第一篇吧。</p>`
  await db
    .prepare(
      `INSERT INTO posts (slug, title, content, summary, cover, tags, status, pinned, author_id, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', ?, 'published', 0, ?, ?, ?, ?)`
    )
    .bind(
      'hello-moblog',
      '你好，墨博！这是你的第一篇文章',
      content,
      '欢迎来到你的博客小院：写作像发微博一样轻，排版符合公众号规范，整站跑在 Cloudflare 上。',
      JSON.stringify(['开始使用']),
      authorId,
      now,
      now,
      now
    )
    .run()
}
