/**
 * xwblog 自托管 POC —— 单进程多租户入口（docker-poc/ 独立目录，不影响仓库主代码）。
 *
 * 职责：
 *  1. Node http ↔ fetch(Request/Response) 适配（waitUntil 注入、Set-Cookie 多值、
 *     会话 cookie 的 Secure 按有无 TLS 反代自动摘除）
 *  2. Host → 租户路由：每个域名一套独立的 node:sqlite 库 + 磁盘图床目录，互不可见
 *  3. 静态资源直出 public/（对齐 wrangler assets「文件优先、其余进 Worker」的行为）
 *  4. cron：每分钟扫定时发布；北京时间 00:30（UTC 16:30）触发备份/清理/回收站滚动
 *
 * 业务代码零改动：直接 import src/index.ts 的默认导出（fetch + scheduled）。
 * 运行方式见同目录 README.md / package.json。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

import xwblog from '../src/index'
import { ensureSchema } from '../src/db'
import { createD1 } from './shims/d1'
import { createR2Disk } from './shims/r2disk'
import { createR2S3, signAuthorization } from './shims/r2s3'
// D1 的建表靠部署时 `wrangler d1 execute schema.sql`，ensureSchema 只管增量补列——
// 租户库是全新文件，这里要自己先跑一遍 schema.sql（官方幂等设计，可重复执行），
// 与演示站 src/demo.ts 的 ensureTables 同款思路
import SCHEMA_SQL from '../schema.sql'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
// 默认值按「打包产物在 docker-poc/dist/server.js」的层级推导：dist/../.. = 仓库根、
// dist/.. = docker-poc/；Docker 里保持同样层级，仅 TENANTS_DIR 用环境变量指到挂载卷
const PUBLIC_ROOT = path.resolve(process.env.PUBLIC_ROOT || path.resolve(__dirname, '../../public'))
const TENANTS_DIR = path.resolve(process.env.TENANTS_DIR || path.resolve(__dirname, '../data/tenants'))
const TENANTS_CONFIG = path.resolve(process.env.TENANTS_CONFIG || path.resolve(__dirname, '../tenants.json'))

interface Tenant {
  host: string
  env: Record<string, unknown>
}

const HOST_RE = /^[a-z0-9][a-z0-9.-]*$/

interface R2SharedConfig {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** 读 tenants.json，两种格式兼容：
 *  旧：{ "域名": { demo } } 平铺
 *  新：{ r2: { accountId, bucket, accessKeyId, secretAccessKey }, tenants: { "域名": { demo, storage: "local"|"r2" } } }
 *  新格式里多个租户共享一个 R2 桶，shim 用 <域名>/ 前缀做租户隔离 */
function readTenantsConfig(): { r2?: R2SharedConfig; tenants: Record<string, { demo?: boolean; storage?: string }> } {
  const raw = JSON.parse(fs.readFileSync(TENANTS_CONFIG, 'utf8'))
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.tenants) {
    return { r2: raw.r2, tenants: raw.tenants }
  }
  return { tenants: raw }
}

/** 按租户配置初始化存储：storage 缺省/"local" = 本地磁盘目录；"r2" = 共享桶 + 域名前缀 */
function createTenantImages(host: string, cfg: { storage?: string }, r2Shared?: R2SharedConfig): { images: unknown; label: string } {
  if (cfg.storage === 'r2') {
    if (!r2Shared) {
      throw new Error(`租户 ${host} 配置了 storage:"r2"，但 tenants.json 缺少顶层 r2 共享配置（accountId/bucket/accessKeyId/secretAccessKey）`)
    }
    return { images: createR2S3({ ...r2Shared, prefix: host }), label: `R2 桶 ${r2Shared.bucket}（前缀 ${host}/）` }
  }
  return { images: createR2Disk(path.join(TENANTS_DIR, host, 'uploads')), label: '本地磁盘' }
}

/** 逐个初始化租户：域名 → 自己的 blog.db（WAL）+ 图床存储，互不可见 */
async function loadTenants(): Promise<Map<string, Tenant>> {
  const { r2: r2Shared, tenants } = readTenantsConfig()
  const map = new Map<string, Tenant>()
  let r2Used = false
  for (const [host, tc] of Object.entries(tenants)) {
    if (!HOST_RE.test(host)) throw new Error(`tenants.json 里的域名不合法: ${host}`)
    const cfg = (tc ?? {}) as { demo?: boolean; storage?: string }
    const dir = path.join(TENANTS_DIR, host)
    fs.mkdirSync(dir, { recursive: true })
    const { images, label } = createTenantImages(host, cfg, r2Shared)
    if (cfg.storage === 'r2') r2Used = true
    const env: Record<string, unknown> = {
      DB: createD1(path.join(dir, 'blog.db')),
      IMAGES: images,
      // 业务代码从不调用 ASSETS（静态资源在适配层直出），兜底防误用
      ASSETS: { fetch: async () => new Response('ASSETS binding is handled by the self-host adapter', { status: 404 }) },
    }
    if (cfg.demo) env.DEMO_MODE = '1'
    const db = env.DB as { exec: (sql: string) => Promise<unknown> }
    await db.exec(SCHEMA_SQL)
    await ensureSchema(env.DB as never)
    map.set(host, { host, env })
    console.log(`[tenant] ${host} 就绪（存储: ${label}，${cfg?.demo ? '演示种子' : '空库'}）→ ${dir}`)
  }
  // R2 自检：同一共享配置只探测一次（空前缀 LIST），凭据/桶名错误在启动时失败，好过首个请求 500
  if (r2Used && r2Shared) {
    const probe = createR2S3({ ...r2Shared, prefix: '__healthcheck__' })
    const r = await probe.list({ limit: 1 })
    console.log(`[r2] 自检通过：桶 ${r2Shared.bucket} 可达`)
    void r
  }
  return map
}

/** 存量迁移：把租户本地盘 uploads/ 逐个搬到 R2（幂等，跳过已存在的 key），用于 local → r2 切换 */
async function migrateLocalToR2(host: string): Promise<void> {
  const { r2: r2Shared } = readTenantsConfig()
  if (!r2Shared) {
    console.error('tenants.json 缺少顶层 r2 配置，无法迁移')
    process.exit(1)
  }
  const localDir = path.join(TENANTS_DIR, host, 'uploads')
  if (!fs.existsSync(localDir)) {
    console.error(`本地图床目录不存在：${localDir}`)
    process.exit(1)
  }
  const local = createR2Disk(localDir)
  const remote = createR2S3({ ...r2Shared, prefix: host })
  const { objects } = await local.list({ limit: 1_000_000 })
  let copied = 0
  let skipped = 0
  for (const o of objects) {
    if (await remote.head(o.key)) {
      skipped++
      continue
    }
    const src = await local.get(o.key)
    if (!src) continue
    await remote.put(o.key, await src.arrayBuffer(), { httpMetadata: src.httpMetadata as { contentType?: string; cacheControl?: string } })
    copied++
    if (copied % 50 === 0) console.log(`  ... 已上传 ${copied} 个`)
  }
  console.log(`[migrate] ${host}：新上传 ${copied} 个对象到 R2（前缀 ${host}/），已存在跳过 ${skipped} 个；本地目录保留作为回退，确认无误后可自行清理`)
}

/** Workers ExecutionContext 的等价物：waitUntil 的异步任务失败只记日志，不炸请求 */
const execCtx = {
  waitUntil(p: Promise<unknown>) {
    Promise.resolve(p).catch((e) => console.error('[waitUntil]', e))
  },
  passThroughOnException() {},
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

/** 静态资源直出（对齐 wrangler assets：精确文件命中才返回，其余进应用） */
function serveStatic(pathname: string, search: string): Response | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null
  const file = path.resolve(PUBLIC_ROOT, `.${decoded}`)
  if (file !== PUBLIC_ROOT && !file.startsWith(PUBLIC_ROOT + path.sep)) return null
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    return null
  }
  // 目录路径不带斜杠：301 补斜杠（对齐 wrangler assets 的 auto-trailing-slash）。
  // 否则 index.html 在 /admin 下被直出，页面里的相对路径资源 ./admin.css 会解析成
  // /admin.css → 404 → 后台整页空白（甲骨文服务器实测抓出）
  if (!decoded.endsWith('/') && st.isDirectory()) {
    return new Response(null, { status: 301, headers: { Location: `${decoded}/${search}` } })
  }
  const candidates = [file, path.join(file, 'index.html')]
  for (const f of candidates) {
    let fst: fs.Stats
    try {
      fst = fs.statSync(f)
    } catch {
      continue
    }
    if (!fst.isFile()) continue
    return new Response(fs.readFileSync(f), {
      headers: {
        'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=120',
      },
    })
  }
  return null
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'expect',
  'content-length',
  'te',
  'trailer',
])

function sendToNode(req: http.IncomingMessage, res: http.ServerResponse, appRes: Response, isHttps: boolean) {
  const headers: Record<string, string | string[]> = {}
  appRes.headers.forEach((value, key) => {
    if (key !== 'set-cookie') headers[key] = value
  })
  // 会话 cookie 带 Secure：明文 http（本地冒烟 / 未挂 TLS）浏览器和 curl 都不会携带。
  // isHttps 由 resolveScheme 统一判定（CF 灵活 SSL 下 X-Forwarded-Proto 是回源段的 http，不可作数）
  const cookies = appRes.headers.getSetCookie()
  if (cookies.length) {
    headers['set-cookie'] = cookies.map((sc) =>
      isHttps ? sc : sc.split('; ').filter((p) => p !== 'Secure').join('; ')
    )
  }
  res.writeHead(appRes.status, headers)
  if (req.method === 'HEAD' || !appRes.body) {
    res.end()
    return
  }
  Readable.fromWeb(appRes.body as never).pipe(res)
}

/**
 * 浏览器侧真实 scheme。优先级：
 *  1. Origin 头（host 与请求一致时）——api.ts 的同源 CSRF 校验拿它和 c.req.url.origin 全等比较，
 *     scheme 不一致就会误判跨站（CF 灵活 SSL 实测被拒）
 *  2. CF-Visitor——Cloudflare 注入的访客侧 scheme（灵活 SSL 下也是 https，X-Forwarded-Proto 则是回源段）
 *  3. X-Forwarded-Proto（常规 TLS 反代）
 *  4. http
 */
function resolveScheme(headers: Headers, host: string): string {
  const origin = headers.get('origin')
  if (origin) {
    try {
      const o = new URL(origin)
      if (o.host === host) return o.protocol.replace(':', '')
    } catch {
      /* 非法 Origin 走兜底链 */
    }
  }
  try {
    const visitor = JSON.parse(headers.get('cf-visitor') || '{}') as { scheme?: string }
    if (visitor.scheme) return visitor.scheme
  } catch {
    /* 头损坏走兜底链 */
  }
  const xfp = (headers.get('x-forwarded-proto') || '').split(',')[0].trim()
  return xfp || 'http'
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, tenants: Map<string, Tenant>) {
  const started = Date.now()
  const hostHeader = req.headers.host || 'localhost'
  const host = hostHeader.split(':')[0].toLowerCase()
  const url = new URL(req.url || '/', `http://${hostHeader}`)

  // 1) 静态资源（/admin/ SPA、插件、favicon 等；public/ 里没有的路径自然落空）
  if (req.method === 'GET' || req.method === 'HEAD') {
    const hit = serveStatic(url.pathname, url.search)
    if (hit) {
      res.writeHead(hit.status, Object.fromEntries(hit.headers as never))
      if (req.method === 'HEAD') res.end()
      else res.end(Buffer.from(await hit.arrayBuffer()))
      console.log(`[http] ${req.method} ${host}${url.pathname} ${hit.status} ${Date.now() - started}ms (static)`)
      return
    }
  }

  // 2) 租户路由：未登记域名直接 404，不落到任何租户
  const tenant = tenants.get(host)
  if (!tenant) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`未登记的站点域名：${host}\n请在 docker-poc/tenants.json 里登记后重启。`)
    return
  }

  // 3) 组装 fetch Request 交给 Hono 应用（环境与执行上下文按租户注入）
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key) || value === undefined) continue
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else headers.set(key, value)
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  const proto = resolveScheme(headers, url.host)
  const appReq = new Request(`${proto}://${hostHeader}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as never) : undefined,
    duplex: 'half',
  } as RequestInit)
  const appRes = await xwblog.fetch(appReq, tenant.env as never, execCtx)
  sendToNode(req, res, appRes, proto === 'https')
  console.log(`[http] ${req.method} ${host}${url.pathname} ${appRes.status} ${Date.now() - started}ms`)
}

let firedBackupDay = ''
const CRON_TICK_MS = 60_000

/**
 * cron：与 wrangler triggers.crons 同口径——每分钟扫定时发布；
 * 北京时间 00:30（UTC 16:30）那一分钟换成备份 cron，备份/visit 清理/回收站滚动一起跑。
 */
function startCron(tenants: Map<string, Tenant>) {
  const timer = setInterval(async () => {
    const now = new Date()
    const backupWindow = now.getUTCHours() === 16 && now.getUTCMinutes() === 30
    const day = now.toISOString().slice(0, 10)
    if (backupWindow) {
      if (firedBackupDay === day) return // 同一天只触发一次，防 tick 漂移双发
      firedBackupDay = day
    }
    const controller = { cron: backupWindow ? '30 16 * * *' : '* * * * *', scheduledTime: now.getTime() }
    for (const t of tenants.values()) {
      try {
        await xwblog.scheduled(controller as never, t.env as never, execCtx)
      } catch (e) {
        console.error(`[cron:${t.host}]`, e)
      }
    }
  }, CRON_TICK_MS)
  timer.unref()
}

// 维护模式（不启动 HTTP 服务、不加载租户）：
//   node dist/server.js --selftest                  —— SigV4 签名对照 AWS 官方测试向量
//   node dist/server.js --copy-local-to-r2 <域名>   —— 该租户本地盘图片迁移到 R2（幂等）
const arg1 = process.argv[2]
if (arg1 === '--selftest') {
  // 向量取自 AWS S3 文档「Get Bucket (List Objects)」例子（与签名器的
  // SignedHeaders=host;x-amz-content-sha256;x-amz-date 组合一致，且覆盖查询串签名路径）：
  // GET https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J，时间 20130524T000000Z
  const got = signAuthorization(
    'GET',
    'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J',
    'AKIAIOSFODNN7EXAMPLE',
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'us-east-1',
    new Date('2013-05-24T00:00:00Z')
  )
  const want =
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7'
  const ok = got === want
  console.log(ok ? '[selftest] SigV4 签名与 AWS 官方测试向量一致 ✓' : `[selftest] 签名不符\n  got:  ${got}\n  want: ${want}`)
  process.exit(ok ? 0 : 1)
}
if (arg1 === '--copy-local-to-r2') {
  await migrateLocalToR2(process.argv[3] || '')
  process.exit(0)
}

const tenants = await loadTenants()

const server = http.createServer((req, res) => {
  handle(req, res, tenants).catch((e) => {
    console.error('[server] unhandled', e)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('服务开小差了，请稍后再试。')
  })
})

server.listen(PORT, () => {
  console.log(`\nxwblog 自托管 POC 已启动：http://127.0.0.1:${PORT}`)
  console.log(`  租户：${[...tenants.keys()].join('  ')}（*.localhost 浏览器自动解析到 127.0.0.1）`)
  console.log(`  静态根：${PUBLIC_ROOT}`)
  console.log(`  数据根：${TENANTS_DIR}\n`)
})

startCron(tenants)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n收到 ${sig}，正在退出…`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
