/**
 * 博客号广场 hub —— 独立 Worker（与博客主仓库部署无关，见 plaza/README.md）。
 *
 * 职责：收各博客号 push 上来的文章/微博（HMAC 签名 ingest），RSS pull 补漏，
 * 混排后给官网 bloghao.com/plaza 输出 feed。收发两端协议见 docs/PLAZA.md。
 *
 * 形态延续内核预算：hono 单文件 + core.ts 纯函数，零额外依赖；注册/认证/权重是
 * hub 站长的管理面，用最简单的 Bearer Token（PLAZA_ADMIN_TOKEN secret），
 * v1 不做自助注册——站长逐站审核发 token，与「博客号目录」人工收录同一信任模型。
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import {
  generatePlazaToken,
  parseRssItems,
  rssDateToMs,
  scoreFeed,
  validateIngest,
  verifyPlazaSignature,
  type PlazaFeedEntry,
  type PlazaItem,
} from './core'

interface Env {
  DB: D1Database
  PLAZA_ADMIN_TOKEN: string
}

/** 站点行（sites 表） */
interface SiteRow {
  id: number
  site_url: string
  site_name: string
  token: string
  verified: number
  weight: number
  disabled: number
  pull_enabled: number
  last_seen_at: number
  created_at: number
}

const app = new Hono<{ Bindings: Env }>()

/** 公开 API 统一 CORS：官网前台 fetch 用（无 Cookie 面开放 CORS 无风险；管理端点不在此列） */
app.use('/api/feed', cors())
app.use('/api/sites', cors())

/** 管理面鉴权：Bearer PLAZA_ADMIN_TOKEN（hub 站长单管理员，与目录人工审核同一信任模型） */
async function adminAuth(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  const auth = c.req.header('authorization') || ''
  if (!c.env.PLAZA_ADMIN_TOKEN || auth !== `Bearer ${c.env.PLAZA_ADMIN_TOKEN}`) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  await ensureSchemaExtras(c.env.DB) // admin 写路径（如 PATCH avatar）同样要求列已迁移
  await next()
}
app.use('/api/admin/*', adminAuth)

/* ---------------- 公开面 ---------------- */

/** feed：混排出参。candidates 取最近 300 条（量纲按社区几百站设计，够用很久） */
app.get('/api/feed', async (c) => {
  await ensureSchemaExtras(c.env.DB)
  const limit = Math.max(1, Math.min(100, Number(c.req.query('limit')) || 30))
  const kind = c.req.query('kind')
  const kindFilter = kind === 'post' || kind === 'weibo' ? kind : null
  const sql = `
    SELECT i.kind, i.ref, i.title, i.summary, i.url, i.image, i.published_at AS publishedAt,
           s.id AS siteId, s.site_name AS siteName, s.site_url AS siteUrl,
           s.avatar AS siteAvatar, s.verified AS siteVerified, s.weight AS siteWeight
    FROM items i JOIN sites s ON s.id = i.site_id
    WHERE s.disabled = 0 AND i.hidden = 0 ${kindFilter ? 'AND i.kind = ?' : ''}
    ORDER BY i.published_at DESC LIMIT 300`
  const { results } = await c.env.DB.prepare(sql)
    .bind(...(kindFilter ? [kindFilter] : []))
    .all<{
      kind: PlazaItem['kind']
      ref: string
      title: string
      summary: string
      url: string
      image: string
      publishedAt: number
      siteId: number
      siteName: string
      siteUrl: string
      siteVerified: number
      siteWeight: number
    }>()
  const feed: PlazaFeedEntry[] = scoreFeed(
    (results ?? []).map((r) => ({
      // scoreFeed 的入参是 { item, siteId, … } 包裹形状，SQL 扁平行要按契约组装
      item: {
        kind: r.kind,
        ref: r.ref,
        title: r.title,
        summary: r.summary,
        url: r.url,
        image: r.image,
        publishedAt: r.publishedAt,
      },
      siteId: r.siteId,
      siteName: r.siteName,
      siteUrl: r.siteUrl,
      siteAvatar: r.siteAvatar || '',
      siteVerified: r.siteVerified === 1,
      siteWeight: r.siteWeight,
    })),
    limit
  )
  return c.json({ feed })
})

/** 站点名录：官网「收录了哪些博客号」与广场页侧栏共用 */
app.get('/api/sites', async (c) => {
  await ensureSchemaExtras(c.env.DB)
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.site_url AS url, s.site_name AS name, s.avatar, s.verified,
            s.created_at AS createdAt,
            (SELECT COUNT(*) FROM items i WHERE i.site_id = s.id) AS items
     FROM sites s WHERE s.disabled = 0 ORDER BY s.verified DESC, s.created_at ASC LIMIT 200`
  ).all()
  return c.json({ sites: results ?? [] })
})

app.get('/', (c) =>
  c.html(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>博客号广场 hub</title></head>
<body><p>博客号广场数据服务。<a href="https://bloghao.com/plaza/">去官网看广场 →</a>　<a href="https://github.com/lovexw/bloghao-xwblog/blob/main/docs/PLAZA.md">接入文档</a></p></body></html>`
  )
)

/* ---------------- push ingest（博客端「广场同步」插件上报） ---------------- */

app.post('/api/ingest', async (c) => {
  const token = (c.req.header('X-Plaza-Token') || '').trim()
  const ts = c.req.header('X-Plaza-Timestamp') || ''
  const sig = c.req.header('X-Plaza-Signature') || ''
  if (!/^[0-9a-f]{32}$/.test(token)) return c.json({ error: 'bad token' }, 401)
  const site = await c.env.DB.prepare('SELECT id, disabled FROM sites WHERE token = ?')
    .bind(token)
    .first<{ id: number; disabled: number }>()
  // token 即身份：查无此站 / 已停用一律同一句 401，不区分原因不透露存在性
  if (!site || site.disabled) return c.json({ error: 'unauthorized' }, 401)
  const rawBody = await c.req.text()
  // 防爆库：超 256KB 的签名请求直接拒（合法上报 50 条封顶远用不满）
  if (rawBody.length > 256 * 1024) return c.json({ error: 'payload too large' }, 413)
  if (!(await verifyPlazaSignature(token, ts, sig, rawBody))) {
    return c.json({ error: 'bad signature' }, 401)
  }
  const { items, deleted, avatar } = validateIngest(JSON.parse(rawBody || '{}'))
  if (avatar) {
    await c.env.DB.prepare('UPDATE sites SET avatar = ? WHERE id = ?').bind(avatar, site.id).run()
  }
  let accepted = 0
  for (const it of items) {
    // 站内 ref 唯一：重发同一篇 = 更新（编辑标题/摘要后重推即生效），幂等；
    // push 永远盖 pull（source 置回 push），pull 只是存在性兜底
    await c.env.DB.prepare(
      `INSERT INTO items (site_id, kind, ref, title, summary, url, image, published_at, source, hidden, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'push', 0, ?)
       ON CONFLICT(site_id, kind, ref) DO UPDATE SET
         title = excluded.title, summary = excluded.summary, url = excluded.url,
         image = excluded.image, published_at = excluded.published_at,
         source = 'push', hidden = 0, synced_at = excluded.synced_at`
    )
      .bind(site.id, it.kind, it.ref, it.title, it.summary, it.url, it.image, it.publishedAt, Date.now())
      .run()
    accepted++
  }
  for (const d of deleted) {
    await c.env.DB.prepare('DELETE FROM items WHERE site_id = ? AND kind = ? AND ref = ?')
      .bind(site.id, d.kind, d.ref)
      .run()
  }
  // 活跃心跳：后台站点列表按它看「谁还在推」；180 天无心跳 cron 自动休眠
  await c.env.DB.prepare('UPDATE sites SET last_seen_at = ? WHERE id = ?').bind(Date.now(), site.id).run()
  return c.json({ ok: true, accepted })
})

/* ---------------- 老库迁移 ---------------- */

let schemaExtrasDone = false

/** sites.avatar 老库补列：新库 schema 已含（CREATE IF NOT EXISTS 不补老列），这里惰性 ALTER 一次。
 *  列已存在时 SQLite 报错，吞掉即幂等 */
async function ensureSchemaExtras(db: Env['DB']): Promise<void> {
  if (schemaExtrasDone) return
  schemaExtrasDone = true
  try {
    await db.prepare("ALTER TABLE sites ADD COLUMN avatar TEXT NOT NULL DEFAULT ''").run()
  } catch {
    /* 列已存在 */
  }
}

/* ---------------- 管理面 ---------------- */

/** 注册站点：token 明文只在创建返回这一次（与内核 SECRET_SETTINGS 同口径），丢了就 rotate */
app.post('/api/admin/sites', async (c) => {
  const body = await c.req.json<{ url?: string; name?: string }>().catch(() => null)
  const url = (body?.url || '').trim().replace(/\/+$/, '')
  const name = (body?.name || '').trim().slice(0, 100) || url.replace(/^https?:\/\//, '')
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(url)) return c.json({ error: '需要 https:// 开头的站点地址' }, 400)
  const token = generatePlazaToken()
  try {
    await c.env.DB.prepare(
      'INSERT INTO sites (site_url, site_name, token, verified, weight, disabled, pull_enabled, last_seen_at, created_at) VALUES (?, ?, ?, 0, 1, 0, 1, 0, ?)'
    )
      .bind(url, name, token, Date.now())
      .run()
  } catch {
    return c.json({ error: '该站点已注册（site_url 唯一），可在列表里 rotate token' }, 409)
  }
  const row = await c.env.DB.prepare('SELECT id FROM sites WHERE token = ?').bind(token).first<{ id: number }>()
  return c.json({ ok: true, id: row?.id, token })
})

app.get('/api/admin/sites', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, site_url AS url, site_name AS name, avatar, token, verified, weight, disabled, pull_enabled AS pullEnabled,
            last_seen_at AS lastSeenAt, created_at AS createdAt,
            (SELECT COUNT(*) FROM items i WHERE i.site_id = sites.id) AS items
     FROM sites ORDER BY created_at DESC LIMIT 500`
  ).all()
  return c.json({ sites: results ?? [] })
})

/** 局部更新：改名 / 认证徽标 / 权重 / 停用 / pull 开关 / 换 token（rotate） */
app.patch('/api/admin/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400)
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'bad body' }, 400)
  const site = await c.env.DB.prepare('SELECT id FROM sites WHERE id = ?').bind(id).first()
  if (!site) return c.json({ error: '站点不存在' }, 404)
  const patch: string[] = []
  const args: (string | number)[] = []
  if ('name' in body) {
    patch.push('site_name = ?')
    args.push(String(body.name ?? '').trim().slice(0, 100))
  }
  if ('avatar' in body) {
    // https 白名单与 ingest 上报同口径；空串 = 清除头像（回落 favicon/首字）
    patch.push('avatar = ?')
    args.push(/^https:\/\//i.test(String(body.avatar ?? '').trim()) ? String(body.avatar).trim().slice(0, 500) : '')
  }
  if ('verified' in body) {
    patch.push('verified = ?')
    args.push(body.verified ? 1 : 0)
  }
  if ('weight' in body) {
    const w = Math.round(Number(body.weight))
    patch.push('weight = ?')
    args.push(Number.isFinite(w) ? Math.min(10, Math.max(0, w)) : 1)
  }
  if ('disabled' in body) {
    patch.push('disabled = ?')
    args.push(body.disabled ? 1 : 0)
  }
  if ('pullEnabled' in body) {
    patch.push('pull_enabled = ?')
    args.push(body.pullEnabled ? 1 : 0)
  }
  if ('rotateToken' in body && body.rotateToken) {
    patch.push('token = ?')
    args.push(generatePlazaToken())
  }
  if (patch.length) {
    await c.env.DB.prepare(`UPDATE sites SET ${patch.join(', ')} WHERE id = ?`)
      .bind(...args, id)
      .run()
  }
  const row = await c.env.DB.prepare(
    'SELECT id, site_url AS url, site_name AS name, avatar, token, verified, weight, disabled, pull_enabled AS pullEnabled FROM sites WHERE id = ?'
  )
    .bind(id)
    .first()
  return c.json({ ok: true, site: row })
})

/** 删站级联清内容（子行先删再删主行，与内核回收站级联同一顺序纪律；内容无回收站——hub 是派生数据，源站永远在自己手里） */
app.delete('/api/admin/sites/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'bad id' }, 400)
  await c.env.DB.prepare('DELETE FROM items WHERE site_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

/** 单条下架/恢复（违规内容处置，不等站长自己删） */
app.patch('/api/admin/items/:kind/:ref', async (c) => {
  const kind = c.req.param('kind')
  if (kind !== 'post' && kind !== 'weibo') return c.json({ error: 'bad kind' }, 400)
  const ref = (c.req.param('ref') || '').slice(0, 200)
  const siteId = Number(c.req.query('siteId'))
  if (!Number.isInteger(siteId) || siteId <= 0 || !ref) return c.json({ error: 'bad params' }, 400)
  const body = await c.req.json<{ hidden?: boolean }>().catch(() => null)
  await c.env.DB.prepare('UPDATE items SET hidden = ? WHERE site_id = ? AND kind = ? AND ref = ?')
    .bind(body?.hidden ? 1 : 0, siteId, kind, ref)
    .run()
  return c.json({ ok: true })
})

/* ---------------- RSS pull 补漏（cron 每 6 小时） ---------------- */

/** pull 只做存在性兜底：单站单次 20 条、只灌 30 天内旧文、绝不覆盖 push 数据（source 守卫） */
async function pullSiteRss(env: Env, site: SiteRow): Promise<number> {
  const res = await fetch(`${site.site_url}/rss.xml`, {
    headers: { 'user-agent': 'BlogHaoPlaza/1.0 (+https://bloghao.com/plaza/)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return 0
  const xml = await res.text()
  const entries = parseRssItems(xml, 20)
  let n = 0
  for (const e of entries) {
    const publishedAt = rssDateToMs(e.pubDate)
    if (Date.now() - publishedAt > 30 * 86_400_000) continue
    const slug = e.link.replace(/^https?:\/\/[^/]+\/post\//, '').replace(/\/+$/, '').slice(0, 200)
    if (!slug) continue
    await env.DB.prepare(
      `INSERT INTO items (site_id, kind, ref, title, summary, url, image, published_at, source, hidden, synced_at)
       VALUES (?, 'post', ?, ?, ?, ?, '', ?, 'pull', 0, ?)
       ON CONFLICT(site_id, kind, ref) DO UPDATE SET
         title = excluded.title, summary = excluded.summary, synced_at = excluded.synced_at
       WHERE items.source = 'pull'`
    )
      .bind(site.id, slug, e.title || slug, e.description.replace(/<[^>]+>/g, '').trim().slice(0, 500), e.link, publishedAt, Date.now())
      .run()
    n++
  }
  return n
}

/** cron：pull 补漏 + 顺手把 180 天无心跳的站点自动休眠（不删站，管理员回来重新启用即可） */
export async function scheduledCron(env: Env): Promise<{ pulled: number; dormant: number }> {
  let pulled = 0
  let dormant = 0
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM sites WHERE disabled = 0 AND pull_enabled = 1 LIMIT 500'
    ).all<SiteRow>()
    for (const site of results ?? []) {
      try {
        pulled += await pullSiteRss(env, site)
      } catch {
        /* 单站失败不影响其余 */
      }
    }
    const r = await env.DB.prepare(
      'UPDATE sites SET disabled = 1 WHERE disabled = 0 AND last_seen_at > 0 AND last_seen_at < ?'
    )
      .bind(Date.now() - 180 * 86_400_000)
      .run()
    dormant = r.meta.changes ?? 0
  } catch {
    /* 库异常静默：cron 下一轮再来 */
  }
  return { pulled, dormant }
}

export default {
  fetch: app.fetch,
  scheduled: (_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) => {
    ctx.waitUntil(scheduledCron(env))
  },
}
