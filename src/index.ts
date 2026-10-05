import { Hono } from 'hono'
import { scheduledBackup } from './backup'
import { runScheduledPublish } from './scheduler'
import { api } from './api'
import { siteClosedResponse } from './closed'
import { ensureSchema, getSettings, listCategories, listPublishedTags, listPosts, listSitemapPages, listSitemapPosts } from './db'
import { renderAbout, renderArchive, renderCategory, renderGuestbook, renderHome, renderLinks, renderNotFound, renderPage, renderPost, renderSearch, renderWeibo } from './pages'
import { buildRss, buildSitemap } from './rss'
import { siteBase } from './render'
import { purgeVisits } from './stats'
import type { Env, SessionUser } from './types'
import { isDemo } from './utils'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser | null } }>()

// 老库缺列自动补齐（幂等），每个 isolate 只执行一次
let schemaReady: Promise<void> | null = null
function ensureSchemaOnce(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureSchema(db).catch((err) => {
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}
app.use('*', async (c, next) => {
  // 演示站：先幂等建表再自播种（空库冷启动要抢在 ensureSchema 之前——ensureSchema 是增量
  // 迁移层，基础表不存在时自己会先炸）；播种期间并发请求短暂等待
  if (isDemo(c.env)) {
    const demo = await import('./demo')
    await demo.demoEnsureSeeded(c.env)
  }
  await ensureSchemaOnce(c.env.DB)
  await next()
})

// 一键闭站（后台「设置 → 站点状态」，逻辑在 src/closed.ts）
app.use('*', async (c, next) => {
  const res = await siteClosedResponse(c.env.DB, c.req.raw, c.req.path)
  if (res) return res
  await next()
})

app.route('/api', api)

/* ---------------- 公开页面（SSR + 主题渲染） ---------------- */
app.get('/', renderHome)
app.get('/tag/:tag', renderHome)
app.get('/category/:slug', renderCategory)
app.get('/post/:slug', renderPost)
app.get('/page/:slug', renderPage)
app.get('/about', renderAbout)
app.get('/archives', renderArchive)
app.get('/guestbook', renderGuestbook)
app.get('/weibo', renderWeibo)
app.get('/links', renderLinks)
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
  const siteUrl = siteBase(settings, new URL(c.req.url).origin)
  c.header('Content-Type', 'application/rss+xml; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=600')
  return c.body(buildRss(settings, items, siteUrl))
})

app.get('/sitemap.xml', async (c) => {
  const settings = await getSettings(c.env.DB)
  const [posts, categories, tags, pages] = await Promise.all([
    listSitemapPosts(c.env.DB),
    listCategories(c.env.DB),
    listPublishedTags(c.env.DB),
    listSitemapPages(c.env.DB),
  ])
  const siteUrl = siteBase(settings, new URL(c.req.url).origin)
  c.header('Content-Type', 'application/xml; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=600')
  return c.body(buildSitemap(settings, posts, siteUrl, categories, tags, pages))
})

app.get('/robots.txt', (c) =>
  isDemo(c.env)
    ? // 演示站：不希望被搜索引擎收录（内容是种子数据，且闭站页等状态不该进索引）
      c.text('User-agent: *\nDisallow: /\n')
    : c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`)
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
  if (!key.startsWith('u/') && !key.startsWith('og/')) return c.text('Not found', 404)
  const obj = await c.env.IMAGES.get(key)
  if (!obj) return c.text('Not found', 404)
  if (obj.httpEtag && c.req.header('If-None-Match') === obj.httpEtag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: obj.httpEtag, 'X-Content-Type-Options': 'nosniff' },
    })
  }
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream')
  headers.set('ETag', obj.httpEtag)
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  // 禁止浏览器嗅探内容类型：图床里只允许真正的图片被当图片渲染
  headers.set('X-Content-Type-Options', 'nosniff')
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

// fetch：站点与 API；scheduled：Cron Trigger——先扫定时发布（每分钟），
// 每晚备份时间点顺带跑备份（见 wrangler.jsonc triggers.crons）
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    // 备份 cron 是 "30 16 * * *"（北京时间 00:30）；其余每分钟触发只做定时发布扫描。
    // cron 可能落在从未处理过请求的 isolate：先补齐 schema，否则冷启动库上
    // 定时发布/备份会因缺列缺表而报错。
    const isBackupCron = controller.cron === '30 16 * * *'
    return ctx.waitUntil(
      (async () => {
        try {
          await ensureSchemaOnce(env.DB)
        } catch (e) {
          // 迁移失败不阻塞 cron：后续查询自会报错并走各自的兜底提醒
          console.error('ensureSchema (cron) failed:', e)
        }
        // 演示站的重置 cron（每 2 小时）优先处理：清库重灌种子数据，之后本轮到此为止
        if (isDemo(env)) {
          try {
            const demo = await import('./demo')
            if (await demo.demoScheduled(controller, env)) return
          } catch (e) {
            console.error('demo scheduled failed:', e)
          }
        }
        await runScheduledPublish(env)
        if (isBackupCron) {
          await scheduledBackup(controller, env)
          // 访客日志滚动清理：visit_log 是日志类数据不进备份，只在这里按保留期删
          await purgeVisits(env.DB).catch((e) => console.error('purgeVisits failed:', e))
        }
      })()
    )
  },
}
