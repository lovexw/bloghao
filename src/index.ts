import { Hono } from 'hono'
import { api } from './api'
import { ensureSchema, getSettings, listPosts } from './db'
import { renderAbout, renderCategory, renderHome, renderNotFound, renderPost, renderSearch, renderWeibo } from './pages'
import { buildRss, buildSitemap } from './rss'
import type { Env, SessionUser } from './types'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser | null } }>()

// 老库缺列自动补齐（幂等），每个 isolate 只执行一次
let schemaReady: Promise<void> | null = null
app.use('*', async (c, next) => {
  if (!schemaReady) {
    schemaReady = ensureSchema(c.env.DB).catch((err) => {
      schemaReady = null
      throw err
    })
  }
  await schemaReady
  await next()
})

app.route('/api', api)

/* ---------------- 公开页面（SSR + 主题渲染） ---------------- */
app.get('/', renderHome)
app.get('/tag/:tag', renderHome)
app.get('/category/:slug', renderCategory)
app.get('/post/:slug', renderPost)
app.get('/about', renderAbout)
app.get('/weibo', renderWeibo)
app.get('/search', renderSearch)

// 随机来一篇：从已发布文章里随机挑一篇跳过去
app.get('/random', async (c) => {
  const row = await c.env.DB.prepare("SELECT slug FROM posts WHERE status = 'published' ORDER BY RANDOM() LIMIT 1").first<{
    slug: string
  }>()
  if (!row) return renderNotFound(c)
  return c.redirect(`/post/${encodeURIComponent(row.slug)}`)
})

app.get('/rss.xml', async (c) => {
  const settings = await getSettings(c.env.DB)
  const { items } = await listPosts(c.env.DB, { status: 'published', limit: 50 })
  const siteUrl = (settings.siteUrl || new URL(c.req.url).origin).replace(/\/+$/, '')
  c.header('Content-Type', 'application/rss+xml; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=600')
  return c.body(buildRss(settings, items, siteUrl))
})

app.get('/sitemap.xml', async (c) => {
  const settings = await getSettings(c.env.DB)
  const { items } = await listPosts(c.env.DB, { status: 'published', limit: 1000 })
  const siteUrl = (settings.siteUrl || new URL(c.req.url).origin).replace(/\/+$/, '')
  c.header('Content-Type', 'application/xml; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=600')
  return c.body(buildSitemap(settings, items, siteUrl))
})

app.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`)
)

/* ---------------- R2 图床 ---------------- */
app.get('/images/*', async (c) => {
  const raw = c.req.path.slice('/images/'.length)
  let key = raw
  try {
    key = decodeURIComponent(raw)
  } catch {
    /* 保持原样 */
  }
  if (!key.startsWith('u/')) return c.text('Not found', 404)
  const obj = await c.env.IMAGES.get(key)
  if (!obj) return c.text('Not found', 404)
  if (obj.httpEtag && c.req.header('If-None-Match') === obj.httpEtag) {
    return new Response(null, { status: 304, headers: { ETag: obj.httpEtag } })
  }
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream')
  headers.set('ETag', obj.httpEtag)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return new Response(obj.body, { headers })
})

/* ---------------- 后台入口 ---------------- */
app.get('/admin', (c) => c.redirect('/admin/'))

/* ---------------- 404 / 500 ---------------- */
app.notFound((c) => renderNotFound(c))

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.text('服务开小差了，请稍后再试。', 500)
})

export default app
