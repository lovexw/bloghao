import { Hono } from 'hono'
import {
  clearSessionCookie,
  clientIp,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  rateLimit,
  safeEqual,
  sessionCookie,
} from './auth'
import {
  countUsers,
  createCategory,
  categoryNameMap,
  DEFAULT_SETTINGS,
  getCategoryById,
  getPostById,
  getPostBySlug,
  getPostCategoryId,
  getSettings,
  getWeiboById,
  listApprovedComments,
  listCategories,
  listPosts,
  listWeibo,
  parseTags,
  parseWeiboImages,
  saveSettings,
  seedWelcomePost,
  setPostCategory,
  uniqueCategorySlug,
  uniqueSlug,
  weiboCommentCountMap,
  weiboImageList,
} from './db'
import { mdToHtml } from './markdown'
import { toHomePost } from './render'
import { sanitizeHtml } from './sanitize'
import { THEMES } from './themes/registry'
import type { CommentRow, Env, PostRow, SessionUser } from './types'
import { clampInt, excerpt, slugify } from './utils'

type AppEnv = { Bindings: Env; Variables: { user: SessionUser } }

const MAX_CONTENT_BYTES = 1_000_000 // 正文 ~1MB
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const IMAGE_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  // favicon 用；不放行 SVG——同源直接打开 SVG 可执行脚本，有存储 XSS 风险
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}
const VIDEO_MIMES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

export const api = new Hono<AppEnv>()

/* ---------------- 全局：同源校验（防 CSRF） ---------------- */
api.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin')
    if (origin && origin !== new URL(c.req.url).origin) {
      return jsonError('跨站请求被拒绝', 403)
    }
  }
  await next()
})

api.get('/health', (c) => c.json({ ok: true, time: Date.now() }))

/* ---------------- 认证 ---------------- */
api.get('/auth/state', async (c) => {
  const [user, n] = await Promise.all([getSessionUser(c.env.DB, c.req.raw), countUsers(c.env.DB)])
  return c.json({ needsSetup: n === 0, user })
})

api.post('/auth/setup', async (c) => {
  if ((await countUsers(c.env.DB)) > 0) return jsonError('管理员已存在', 403)
  if (!rateLimit(`setup:${clientIp(c.req.raw)}`, 5, 10 * 60_000)) return jsonError('请求过于频繁，请稍后再试', 429)
  const body = await c.req.json<{ username?: string; password?: string; displayName?: string }>().catch(() => null)
  const username = (body?.username || '').trim()
  const password = body?.password || ''
  if (!/^[a-zA-Z0-9_-]{2,24}$/.test(username)) return jsonError('用户名需为 2-24 位字母、数字、_ 或 -')
  if (password.length < 8 || password.length > 64) return jsonError('密码长度需为 8-64 位')
  const { hash, salt } = await hashPassword(password)
  const now = Date.now()
  const res = await c.env.DB.prepare(
    'INSERT INTO users (username, password_hash, salt, display_name, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(username, hash, salt, (body?.displayName || username).slice(0, 32), '', now, now)
    .run()
  const userId = Number(res.meta.last_row_id)
  await seedWelcomePost(c.env.DB, userId)
  const token = await createSession(c.env.DB, userId)
  c.header('Set-Cookie', sessionCookie(token))
  return c.json({ ok: true, user: { id: userId, username, display_name: body?.displayName || username, avatar: '' } })
})

api.post('/auth/login', async (c) => {
  const ip = clientIp(c.req.raw)
  if (!rateLimit(`login:${ip}`, 10, 10 * 60_000)) return jsonError('尝试次数过多，请 10 分钟后再试', 429)
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => null)
  const username = (body?.username || '').trim()
  const password = body?.password || ''
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<{
    id: number
    username: string
    password_hash: string
    salt: string
    display_name: string
    avatar: string
  }>()
  if (user) {
    const { hash } = await hashPassword(password, user.salt)
    if (safeEqual(hash, user.password_hash)) {
      const token = await createSession(c.env.DB, user.id)
      c.header('Set-Cookie', sessionCookie(token))
      return c.json({
        ok: true,
        user: { id: user.id, username: user.username, display_name: user.display_name, avatar: user.avatar },
      })
    }
  }
  return jsonError('用户名或密码错误', 401)
})

api.post('/auth/logout', async (c) => {
  await destroySession(c.env.DB, c.req.raw)
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

/* ---------------- 需要登录的 /admin/* ---------------- */
api.use('/admin/*', async (c, next) => {
  const user = await getSessionUser(c.env.DB, c.req.raw)
  if (!user) return jsonError('请先登录', 401)
  c.set('user', user)
  await next()
})

api.get('/admin/stats', async (c) => {
  const db = c.env.DB
  const [pub, drafts, pending, uploads, recent] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(views),0) AS v, COALESCE(SUM(likes),0) AS l FROM posts WHERE status = 'published'")
      .first<{ n: number; v: number; l: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'draft'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS s FROM uploads').first<{ n: number; s: number }>(),
    db.prepare("SELECT * FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 5").all<PostRow>(),
  ])
  return c.json({
    posts: pub?.n ?? 0,
    views: pub?.v ?? 0,
    likes: pub?.l ?? 0,
    drafts: drafts?.n ?? 0,
    pendingComments: pending?.n ?? 0,
    uploads: { count: uploads?.n ?? 0, bytes: uploads?.s ?? 0 },
    recent: (recent.results ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      views: r.views,
      published_at: r.published_at,
    })),
  })
})

/* ---------------- 文章管理 ---------------- */
const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS)

async function readPostPayload(c: { req: { json: () => Promise<unknown> } }) {
  const raw = await c.req.json().catch(() => null)
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const title = String(b.title ?? '').slice(0, 150).trim()
  const content = String(b.content ?? '')
  if (content.length > MAX_CONTENT_BYTES) return { tooBig: true as const }
  const status = b.status === 'published' ? 'published' : 'draft'
  const tags = Array.isArray(b.tags)
    ? b.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().slice(0, 20))
        .filter(Boolean)
        .slice(0, 8)
    : []
  const cover = String(b.cover ?? '').slice(0, 500)
  const rawCategoryId = b.categoryId
  const categoryId =
    rawCategoryId == null || rawCategoryId === '' ? null : Number.isFinite(Number(rawCategoryId)) ? Number(rawCategoryId) : null
  return {
    title,
    content,
    summary: String(b.summary ?? '').slice(0, 500),
    cover: cover.startsWith('/') || /^https?:\/\//i.test(cover) ? cover : '',
    tags,
    status,
    pinned: b.pinned ? 1 : 0,
    slug: String(b.slug ?? '').trim().slice(0, 80),
    categoryId,
  }
}

api.get('/admin/posts', async (c) => {
  const statusParam = c.req.query('status')
  const status = statusParam === 'published' || statusParam === 'draft' ? statusParam : 'all'
  const r = await listPosts(c.env.DB, {
    status,
    q: c.req.query('q') || undefined,
    page: clampInt(c.req.query('page'), 1, 100000, 1),
    limit: clampInt(c.req.query('limit'), 1, 100, 20),
  })
  const catNames = await categoryNameMap(c.env.DB, r.items.map((p) => p.id))
  return c.json({
    items: r.items.map((p) => ({
      ...p,
      content: undefined,
      tagList: parseTags(p),
      categoryName: catNames.get(p.id) || '',
    })),
    total: r.total,
    page: r.page,
    totalPages: r.totalPages,
  })
})

api.post('/admin/posts', async (c) => {
  const p = await readPostPayload(c)
  if (!p) return jsonError('请求格式错误')
  if ('tooBig' in p) return jsonError('正文过长（上限约 1MB）')
  const title = p.title || '无标题'
  const base = p.slug || slugify(title)
  const slug = await uniqueSlug(c.env.DB, base)
  const now = Date.now()
  const res = await c.env.DB.prepare(
    `INSERT INTO posts (slug, title, content, summary, cover, tags, status, pinned, author_id, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      slug,
      title,
      sanitizeHtml(p.content),
      p.summary || excerpt(p.content, 80),
      p.cover,
      JSON.stringify(p.tags),
      p.status,
      p.pinned,
      c.get('user').id,
      p.status === 'published' ? now : null,
      now,
      now
    )
    .run()
  const row = await getPostById(c.env.DB, Number(res.meta.last_row_id))
  if (p.categoryId != null && row) {
    const cat = await getCategoryById(c.env.DB, p.categoryId)
    if (cat) await setPostCategory(c.env.DB, row.id, cat.id)
  }
  const categoryId = row ? await getPostCategoryId(c.env.DB, row.id) : null
  return c.json({ ok: true, post: row ? { ...row, tagList: parseTags(row), categoryId } : null })
})

api.get('/admin/posts/:id', async (c) => {
  const row = await getPostById(c.env.DB, Number(c.req.param('id')))
  if (!row) return jsonError('文章不存在', 404)
  const categoryId = await getPostCategoryId(c.env.DB, row.id)
  return c.json({ post: { ...row, tagList: parseTags(row), categoryId } })
})

api.put('/admin/posts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = await getPostById(c.env.DB, id)
  if (!existing) return jsonError('文章不存在', 404)
  const p = await readPostPayload(c)
  if (!p) return jsonError('请求格式错误')
  if ('tooBig' in p) return jsonError('正文过长（上限约 1MB）')
  const title = p.title || '无标题'
  const slug = p.slug && p.slug !== existing.slug ? await uniqueSlug(c.env.DB, p.slug, id) : existing.slug
  const publishedAt =
    p.status === 'published' ? (existing.published_at ?? Date.now()) : null
  await c.env.DB.prepare(
    `UPDATE posts SET slug = ?, title = ?, content = ?, summary = ?, cover = ?, tags = ?, status = ?, pinned = ?, published_at = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      slug,
      title,
      sanitizeHtml(p.content),
      p.summary || (p.status === 'published' ? excerpt(p.content, 80) : ''),
      p.cover,
      JSON.stringify(p.tags),
      p.status,
      p.pinned,
      publishedAt,
      Date.now(),
      id
    )
    .run()
  const row = await getPostById(c.env.DB, id)
  if (p.categoryId != null) {
    const cat = await getCategoryById(c.env.DB, p.categoryId)
    if (cat) await setPostCategory(c.env.DB, id, cat.id)
  } else {
    await setPostCategory(c.env.DB, id, null)
  }
  const categoryId = await getPostCategoryId(c.env.DB, id)
  return c.json({ ok: true, post: row ? { ...row, tagList: parseTags(row), categoryId } : null })
})

api.post('/admin/posts/:id/pin', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ pinned?: boolean }>().catch(() => null)
  await c.env.DB.prepare('UPDATE posts SET pinned = ?, updated_at = ? WHERE id = ?')
    .bind(body?.pinned ? 1 : 0, Date.now(), id)
    .run()
  return c.json({ ok: true })
})

api.delete('/admin/posts/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM comments WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM post_categories WHERE post_id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

/* ---------------- 微博管理（随手记） ---------------- */
const WEIBO_MAX_CHARS = 5000

async function readWeiboPayload(c: { req: { json: () => Promise<unknown> } }) {
  const raw = await c.req.json().catch(() => null)
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  return {
    content: String(b.content ?? '').trim().slice(0, WEIBO_MAX_CHARS),
    images: parseWeiboImages(b.images),
    status: b.status === 'published' ? 'published' : 'draft',
  }
}

api.get('/admin/weibo', async (c) => {
  const statusParam = c.req.query('status')
  const status = statusParam === 'published' || statusParam === 'draft' ? statusParam : 'all'
  const r = await listWeibo(c.env.DB, {
    status,
    page: clampInt(c.req.query('page'), 1, 100000, 1),
    limit: clampInt(c.req.query('limit'), 1, 100, 20),
  })
  const cmtCounts = await weiboCommentCountMap(c.env.DB, r.items.map((w) => w.id))
  return c.json({
    items: r.items.map((w) => ({ ...w, imageList: weiboImageList(w), commentCount: cmtCounts.get(w.id) || 0 })),
    total: r.total,
    page: r.page,
    totalPages: r.totalPages,
  })
})

api.post('/admin/weibo', async (c) => {
  const p = await readWeiboPayload(c)
  if (!p) return jsonError('请求格式错误')
  if (!p.content && !p.images.length) return jsonError('写点什么，或者配张图吧')
  const now = Date.now()
  const res = await c.env.DB.prepare(
    'INSERT INTO weibo (content, images, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(p.content, JSON.stringify(p.images), p.status, p.status === 'published' ? now : null, now, now)
    .run()
  const row = await getWeiboById(c.env.DB, Number(res.meta.last_row_id))
  return c.json({ ok: true, weibo: row ? { ...row, imageList: weiboImageList(row) } : null })
})

api.put('/admin/weibo/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = await getWeiboById(c.env.DB, id)
  if (!existing) return jsonError('这条微博不存在', 404)
  const p = await readWeiboPayload(c)
  if (!p) return jsonError('请求格式错误')
  if (!p.content && !p.images.length) return jsonError('写点什么，或者配张图吧')
  const publishedAt = p.status === 'published' ? (existing.published_at ?? Date.now()) : null
  await c.env.DB.prepare('UPDATE weibo SET content = ?, images = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?')
    .bind(p.content, JSON.stringify(p.images), p.status, publishedAt, Date.now(), id)
    .run()
  const row = await getWeiboById(c.env.DB, id)
  return c.json({ ok: true, weibo: row ? { ...row, imageList: weiboImageList(row) } : null })
})

api.delete('/admin/weibo/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // 微博删除后其下的评论一并清除
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM comments WHERE weibo_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM weibo WHERE id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

/* ---------------- 分类管理 ---------------- */

/** 校验并规整分类的 slug：留空则用名称本身（中文可作 slug，URL 会编码） */
function normalizeCategorySlug(input: string, name: string): string {
  const s = (input || name).trim().slice(0, 80)
  if (!s || /[\/\\#?%\s]/.test(s)) return ''
  return s
}

api.get('/admin/categories', async (c) => {
  const categories = await listCategories(c.env.DB, { withCount: true })
  return c.json({ categories })
})

api.post('/admin/categories', async (c) => {
  const body = await c.req.json<{ name?: string; slug?: string; sort?: number }>().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 20)
  if (!name) return jsonError('分类名称不能为空')
  const slug = normalizeCategorySlug(String(body?.slug ?? ''), name)
  if (!slug) return jsonError('分类标识只能用字母、数字、中文和短横线')
  const dup = await c.env.DB.prepare('SELECT id FROM categories WHERE name = ? OR slug = ?').bind(name, slug).first<{ id: number }>()
  if (dup) return jsonError('同名或同标识的分类已存在')
  const sort = clampInt(body?.sort, 0, 9999, 0)
  const cat = await createCategory(c.env.DB, name, slug, sort)
  return c.json({ ok: true, category: cat })
})

api.put('/admin/categories/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const existing = await getCategoryById(c.env.DB, id)
  if (!existing) return jsonError('分类不存在', 404)
  const body = await c.req.json<{ name?: string; slug?: string; sort?: number }>().catch(() => null)
  const name = String(body?.name ?? existing.name).trim().slice(0, 20)
  if (!name) return jsonError('分类名称不能为空')
  const slug = normalizeCategorySlug(String(body?.slug ?? existing.slug), name)
  if (!slug) return jsonError('分类标识只能用字母、数字、中文和短横线')
  const dup = await c.env.DB
    .prepare('SELECT id FROM categories WHERE (name = ? OR slug = ?) AND id != ?')
    .bind(name, slug, id)
    .first<{ id: number }>()
  if (dup) return jsonError('同名或同标识的分类已存在')
  const sort = clampInt(body?.sort, 0, 9999, existing.sort)
  await c.env.DB.prepare('UPDATE categories SET name = ?, slug = ?, sort = ? WHERE id = ?').bind(name, slug, sort, id).run()
  return c.json({ ok: true, category: await getCategoryById(c.env.DB, id) })
})

api.delete('/admin/categories/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // 分类删除后文章变为未分类，文章本身不受影响
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM post_categories WHERE category_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

api.get('/admin/tags', async (c) => {
  const { results } = await c.env.DB.prepare("SELECT tags FROM posts WHERE status = 'published' LIMIT 500").all<{
    tags: string
  }>()
  const count = new Map<string, number>()
  for (const r of results ?? []) {
    for (const t of parseTags({ tags: r.tags } as PostRow)) count.set(t, (count.get(t) || 0) + 1)
  }
  return c.json({
    tags: [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, n]) => ({ name, count: n })),
  })
})

/* ---------------- 媒体库（R2 图床） ---------------- */
api.post('/admin/upload', async (c) => {
  if (!rateLimit(`upload:${clientIp(c.req.raw)}`, 60, 60_000)) return jsonError('上传太频繁，请稍后再试', 429)
  const body = await c.req.parseBody().catch(() => null)
  const file = body && typeof body === 'object' ? ((body as Record<string, unknown>)['file'] as unknown) : null
  if (!(file instanceof File)) return jsonError('缺少文件字段 file')
  const mime = file.type || 'application/octet-stream'
  const ext = IMAGE_MIMES[mime] || VIDEO_MIMES[mime]
  if (!ext) return jsonError('仅支持 JPG / PNG / WebP / GIF 图片与 MP4 / WebM 视频')
  if (file.size > MAX_UPLOAD_BYTES) return jsonError('文件超过 25MB 限制')
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const key = `u/${ym}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
  await c.env.IMAGES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
  })
  await c.env.DB.prepare('INSERT INTO uploads (key, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(key, file.name.slice(0, 120), mime, file.size, Date.now())
    .run()
  return c.json({ ok: true, url: `/images/${key}`, key, mime, size: file.size })
})

api.get('/admin/uploads', async (c) => {
  const page = clampInt(c.req.query('page'), 1, 100000, 1)
  const limit = 24
  const [listRes, countRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM uploads ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(limit, (page - 1) * limit)
      .all<{ id: number; key: string; name: string; mime: string; size: number; created_at: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM uploads').first<{ n: number }>(),
  ])
  return c.json({
    items: (listRes.results ?? []).map((u) => ({ ...u, url: `/images/${u.key}` })),
    total: countRes?.n ?? 0,
    page,
  })
})

api.delete('/admin/uploads', async (c) => {
  const key = c.req.query('key') || ''
  if (!key.startsWith('u/')) return jsonError('非法的文件 Key')
  await Promise.all([
    c.env.IMAGES.delete(key),
    c.env.DB.prepare('DELETE FROM uploads WHERE key = ?').bind(key).run(),
  ])
  return c.json({ ok: true })
})

/* ---------------- 评论管理 ---------------- */
api.get('/admin/comments', async (c) => {
  const status = c.req.query('status')
  const page = clampInt(c.req.query('page'), 1, 100000, 1)
  const limit = 20
  const where = status === 'approved' || status === 'pending' ? 'WHERE c.status = ?' : ''
  const binds = where ? [status] : []
  const [listRes, countRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT c.*, p.title AS post_title, p.slug AS post_slug, pc.nickname AS parent_nickname
       FROM comments c
       LEFT JOIN posts p ON p.id = c.post_id
       LEFT JOIN comments pc ON pc.id = c.parent_id
       ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...binds, limit, (page - 1) * limit)
      .all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM comments c ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ])
  return c.json({ items: listRes.results ?? [], total: countRes?.n ?? 0, page })
})

/** 后台回复评论（文章/微博通用）：挂在同一条顶层评论下，直接展示并带「作者」徽标 */
api.post('/admin/comments/:id/replies', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ content?: string }>().catch(() => null)
  const content = String(body?.content || '').trim().slice(0, 1000)
  if (!content) return jsonError('回复内容不能为空')
  const target = await c.env.DB
    .prepare('SELECT * FROM comments WHERE id = ?')
    .bind(id)
    .first<CommentRow>()
  if (!target) return jsonError('评论不存在', 404)
  const user = c.get('user')
  await c.env.DB.prepare(
    'INSERT INTO comments (post_id, weibo_id, parent_id, is_admin, nickname, content, status, ip, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)'
  )
    .bind(
      target.post_id,
      target.weibo_id,
      target.parent_id || target.id,
      (user.display_name || user.username).slice(0, 24),
      content,
      'approved',
      '',
      Date.now()
    )
    .run()
  return c.json({ ok: true })
})

api.put('/admin/comments/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ status?: string }>().catch(() => null)
  const status = body?.status === 'pending' ? 'pending' : 'approved'
  await c.env.DB.prepare('UPDATE comments SET status = ? WHERE id = ?').bind(status, id).run()
  return c.json({ ok: true })
})

api.delete('/admin/comments/:id', async (c) => {
  const id = Number(c.req.param('id'))
  // 回复（楼中楼）一并删除
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id).run()
  return c.json({ ok: true })
})

/* ---------------- 设置 ---------------- */
api.get('/admin/settings', async (c) => c.json({ settings: await getSettings(c.env.DB) }))

api.put('/admin/settings', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('请求格式错误')
  const patch: Record<string, string> = {}
  for (const key of SETTINGS_KEYS) {
    if (!(key in body)) continue
    const v = String((body as Record<string, unknown>)[key] ?? '')
    if (key === 'theme' && !THEMES[v]) return jsonError('未知主题：' + v)
    if (key === 'postsPerPage') {
      patch[key] = String(clampInt(v, 1, 50, 10))
      continue
    }
    if (key === 'about') {
      patch[key] = sanitizeHtml(v.slice(0, 100_000))
      continue
    }
    if (key === 'faviconUrl' || key === 'avatarUrl') {
      // 只接受站内 /images/ 地址或 http(s) 外链，防止 javascript: 之类注入
      const u = v.trim().slice(0, 500)
      patch[key] = u.startsWith('/images/') || /^https?:\/\//i.test(u) ? u : ''
      continue
    }
    if (key === 'allowComments' || key === 'moderateComments') {
      patch[key] = v === '1' || v === 'true' ? '1' : '0'
      continue
    }
    patch[key] = v.slice(0, 500)
  }
  await saveSettings(c.env.DB, patch)
  return c.json({ ok: true, settings: await getSettings(c.env.DB) })
})

/* ---------------- 密码 ---------------- */
api.put('/admin/password', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ oldPassword?: string; newPassword?: string }>().catch(() => null)
  const oldPassword = body?.oldPassword || ''
  const newPassword = body?.newPassword || ''
  if (newPassword.length < 8 || newPassword.length > 64) return jsonError('新密码长度需为 8-64 位')
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<{
    password_hash: string
    salt: string
  }>()
  if (!row) return jsonError('用户不存在', 404)
  const { hash } = await hashPassword(oldPassword, row.salt)
  if (!safeEqual(hash, row.password_hash)) return jsonError('旧密码不正确')
  const { hash: newHash, salt: newSalt } = await hashPassword(newPassword)
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
    .bind(newHash, newSalt, Date.now(), user.id)
    .run()
  return c.json({ ok: true })
})

/* ---------------- 写作工具 ---------------- */
api.post('/admin/tools/md', async (c) => {
  const body = await c.req.json<{ md?: string }>().catch(() => null)
  const md = String(body?.md ?? '')
  if (md.length > MAX_CONTENT_BYTES) return jsonError('内容过长')
  return c.json({ html: mdToHtml(md) })
})

api.post('/admin/tools/sanitize', async (c) => {
  const body = await c.req.json<{ html?: string }>().catch(() => null)
  const html = String(body?.html ?? '')
  if (html.length > MAX_CONTENT_BYTES) return jsonError('内容过长')
  return c.json({ html: sanitizeHtml(html) })
})

/* ---------------- 公开接口 ---------------- */
api.get('/public/posts', async (c) => {
  const tag = c.req.query('tag') || undefined
  const r = await listPosts(c.env.DB, {
    status: 'published',
    tag,
    page: clampInt(c.req.query('page'), 1, 100000, 1),
    limit: clampInt(c.req.query('limit'), 1, 50, 10),
  })
  return c.json({
    items: r.items.map((p) => toHomePost(p, parseTags(p))),
    total: r.total,
    page: r.page,
    totalPages: r.totalPages,
  })
})

api.post('/public/comments', async (c) => {
  const settings = await getSettings(c.env.DB)
  const user = await getSessionUser(c.env.DB, c.req.raw)
  if (!user && settings.allowComments !== '1') return jsonError('作者已关闭留言', 403)
  const ip = clientIp(c.req.raw)
  // 管理员回复不受留言频率限制
  if (!user && !rateLimit(`cmt:${ip}`, 5, 10 * 60_000)) return jsonError('留言太频繁，休息一下吧', 429)
  const body = await c.req
    .json<{ slug?: string; nickname?: string; content?: string; email?: string; website?: string; parentId?: number; link?: string }>()
    .catch(() => null)
  // 蜜罐字段：正常用户不会填写，机器人会 —— 静默丢弃
  if (body?.link) return c.json({ ok: true })
  const slug = String(body?.slug || '').slice(0, 100)
  const content = String(body?.content || '').trim().slice(0, 1000)
  if (!content) return jsonError('留言内容不能为空')
  const post = await getPostBySlug(c.env.DB, slug)
  if (!post || post.status !== 'published') return jsonError('文章不存在', 404)

  const parentId = Number(body?.parentId) || 0
  if (user) {
    // 作者发言（回复或自己留言）：直接展示，带「作者」徽标
    const parent = parentId
      ? await c.env.DB.prepare('SELECT * FROM comments WHERE id = ? AND post_id = ?').bind(parentId, post.id).first<CommentRow>()
      : null
    if (parentId && !parent) return jsonError('要回复的留言不存在', 404)
    await c.env.DB.prepare(
      'INSERT INTO comments (post_id, weibo_id, parent_id, is_admin, nickname, content, status, ip, created_at) VALUES (?, 0, ?, 1, ?, ?, ?, ?, ?)'
    )
      .bind(
        post.id,
        parent ? parent.parent_id || parent.id : 0,
        (user.display_name || user.username).slice(0, 24),
        content,
        'approved',
        ip,
        Date.now()
      )
      .run()
    return c.json({ ok: true })
  }

  if (parentId) return jsonError('只有作者可以回复留言', 403)
  const nickname = String(body?.nickname || '').trim().slice(0, 24)
  if (!nickname) return jsonError('昵称和留言内容不能为空')
  const pending = settings.moderateComments === '1'
  await c.env.DB.prepare(
    'INSERT INTO comments (post_id, weibo_id, parent_id, is_admin, nickname, email, website, content, status, ip, created_at) VALUES (?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      post.id,
      nickname,
      String(body?.email || '').slice(0, 100),
      String(body?.website || '').slice(0, 200),
      content,
      pending ? 'pending' : 'approved',
      ip,
      Date.now()
    )
    .run()
  return c.json({ ok: true, pending })
})

/* ---------------- 微博互动（点赞 + 评论，公开） ---------------- */
api.post('/public/like/weibo/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return jsonError('参数错误')
  const body = await c.req.json<{ delta?: number }>().catch(() => null)
  const delta = body?.delta === -1 ? -1 : 1
  await c.env.DB.prepare(
    'UPDATE weibo SET likes = CASE WHEN likes + ? < 0 THEN 0 ELSE likes + ? END WHERE id = ? AND status = \'published\''
  )
    .bind(delta, delta, id)
    .run()
  const row = await getWeiboById(c.env.DB, id)
  return c.json({ ok: true, likes: row?.likes ?? 0 })
})

api.get('/public/weibo/:id/comments', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return jsonError('参数错误')
  const wb = await getWeiboById(c.env.DB, id)
  if (!wb || wb.status !== 'published') return jsonError('这条微博不存在', 404)
  const settings = await getSettings(c.env.DB)
  const { results } = await c.env.DB
    .prepare(
      "SELECT id, parent_id, is_admin, nickname, content, created_at FROM comments WHERE weibo_id = ? AND status = 'approved' ORDER BY created_at ASC LIMIT 200"
    )
    .bind(id)
    .all()
  return c.json({ comments: results ?? [], allowComments: settings.allowComments === '1' })
})

api.post('/public/weibo/:id/comments', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return jsonError('参数错误')
  const wb = await getWeiboById(c.env.DB, id)
  if (!wb || wb.status !== 'published') return jsonError('这条微博不存在', 404)
  const settings = await getSettings(c.env.DB)
  const user = await getSessionUser(c.env.DB, c.req.raw)
  if (!user && settings.allowComments !== '1') return jsonError('作者已关闭评论', 403)
  const ip = clientIp(c.req.raw)
  if (!user && !rateLimit(`cmt:${ip}`, 5, 10 * 60_000)) return jsonError('评论太频繁，休息一下吧', 429)
  const body = await c.req
    .json<{ nickname?: string; content?: string; parentId?: number; link?: string }>()
    .catch(() => null)
  if (body?.link) return c.json({ ok: true })
  const content = String(body?.content || '').trim().slice(0, 1000)
  if (!content) return jsonError('评论内容不能为空')

  const parentId = Number(body?.parentId) || 0
  if (user) {
    const parent = parentId
      ? await c.env.DB.prepare('SELECT * FROM comments WHERE id = ? AND weibo_id = ?').bind(parentId, id).first<CommentRow>()
      : null
    if (parentId && !parent) return jsonError('要回复的评论不存在', 404)
    await c.env.DB.prepare(
      'INSERT INTO comments (post_id, weibo_id, parent_id, is_admin, nickname, content, status, ip, created_at) VALUES (0, ?, ?, 1, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        parent ? parent.parent_id || parent.id : 0,
        (user.display_name || user.username).slice(0, 24),
        content,
        'approved',
        ip,
        Date.now()
      )
      .run()
    return c.json({ ok: true })
  }

  if (parentId) return jsonError('只有作者可以回复评论', 403)
  const nickname = String(body?.nickname || '').trim().slice(0, 24)
  if (!nickname) return jsonError('昵称和评论内容不能为空')
  const pending = settings.moderateComments === '1'
  await c.env.DB.prepare(
    'INSERT INTO comments (post_id, weibo_id, parent_id, is_admin, nickname, content, status, ip, created_at) VALUES (0, ?, 0, 0, ?, ?, ?, ?, ?)'
  )
    .bind(id, nickname, content, pending ? 'pending' : 'approved', ip, Date.now())
    .run()
  return c.json({ ok: true, pending })
})

api.post('/public/like/:slug', async (c) => {
  const slug = c.req.param('slug').slice(0, 100)
  const body = await c.req.json<{ delta?: number }>().catch(() => null)
  const delta = body?.delta === -1 ? -1 : 1
  await c.env.DB.prepare(
    `UPDATE posts SET likes = CASE WHEN likes + ? < 0 THEN 0 ELSE likes + ? END WHERE slug = ? AND status = 'published'`
  )
    .bind(delta, delta, slug)
    .run()
  const row = await getPostBySlug(c.env.DB, slug)
  return c.json({ ok: true, likes: row?.likes ?? 0 })
})

api.get('/meta/themes', (c) =>
  c.json({
    themes: Object.values(THEMES).map((t) => ({ id: t.id, name: t.name, description: t.description })),
  })
)
