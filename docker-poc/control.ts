/**
 * xwblog 自托管控制面（多租户管理面板）——docker-poc 独立模块，不碰仓库主代码。
 *
 * 职责：在 CONTROL_HOST 域名下提供网页化的租户运维：开通（含 DNS 自动记录）、
 * 停用/启用、彻底删除、重置站点管理员密码、操作日志、系统概览。
 *
 * 安全模型（自托管单管理员场景，刻意从简）：
 *  - 主密码走 CONTROL_PASSWORD 环境变量，常时比较；登录限流复用 src/auth.ts rateLimit
 *  - 会话 = 进程内随机 token + HttpOnly Cookie，重启即全失效；Cookie 不设 Domain，
 *    仅 CONTROL_HOST 下生效，Secure 随请求 scheme（Caddy TLS 反代下自动带上）
 *  - 所有写操作 POST + 同源 Origin 校验（与 api.ts 同一口径），纯表单无 JS 无内联事件
 *  - 未设 CONTROL_HOST / CONTROL_PASSWORD 时整个控制面不存在（server.ts 不会分流进来）
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomToken, hashPassword, safeEqual, rateLimit } from '../src/auth'

const CONTROL_PASSWORD = process.env.CONTROL_PASSWORD || ''
const SESSION_TTL_MS = 12 * 60 * 60_000 // 12 小时
const SESSION_COOKIE = 'xw_control_session'

/** DNS 自动化（可选）：容器注入 CF_API_TOKEN + CF_ZONE_ID 后，开站自动建记录（橙云） */
const CF_API_TOKEN = process.env.CF_API_TOKEN || ''
const CF_ZONE_ID = process.env.CF_ZONE_ID || ''

interface Tenant {
  host: string
  env: Record<string, unknown>
}

interface TenantConfig {
  demo?: boolean
  storage?: string
  disabled?: boolean
}

interface ControlDeps {
  req: import('node:http').IncomingMessage
  res: import('node:http').ServerResponse
  url: URL
  host: string
  tenants: Map<string, Tenant>
  readTenantsConfig(): { r2?: Record<string, string>; tenants: Record<string, TenantConfig> }
  writeTenantsConfig(cfg: { r2?: Record<string, string>; tenants: Record<string, TenantConfig> }): void
  createTenantFor(host: string, cfg: TenantConfig, r2Shared?: Record<string, string>): Promise<Tenant>
  log(msg: string): void
}

// ── 会话 ─────────────────────────────────────────────────────────────────
const sessions = new Map<string, number>() // token → 过期时刻

function sessionOk(req: import('node:http').IncomingMessage): boolean {
  const cookie = req.headers.cookie || ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9]+)`))
  if (!m) return false
  const exp = sessions.get(m[1])
  if (!exp || exp < Date.now()) {
    sessions.delete(m[1])
    return false
  }
  return true
}

function issueSession(): string {
  const token = randomToken(24)
  sessions.set(token, Date.now() + SESSION_TTL_MS)
  // 容量护栏：会话桶异常膨胀（正常单管理员到不了）时丢最旧的
  if (sessions.size > 100) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) sessions.delete(oldest[0])
  }
  return token
}

// ── 操作日志（JSONL，append-only）─────────────────────────────────────────
const OPS_LOG = process.env.OPS_LOG_PATH || path.join(process.env.TENANTS_DIR || 'data/tenants', '..', 'ops.log')

function opsLog(action: string, detail: string): void {
  try {
    fs.appendFileSync(OPS_LOG, JSON.stringify({ ts: new Date().toISOString(), action, detail }) + '\n')
  } catch {
    /* 日志失败不阻塞主流程 */
  }
}

function readOpsLog(limit = 20): { ts: string; action: string; detail: string }[] {
  try {
    return fs
      .readFileSync(OPS_LOG, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l))
      .reverse()
  } catch {
    return []
  }
}

// ── DNS 自动化（Cloudflare）──────────────────────────────────────────────
async function cfApi(method: string, path: string, body?: unknown): Promise<{ ok: boolean; errors: string; data?: { id?: string } }> {
  if (!CF_API_TOKEN || !CF_ZONE_ID) return { ok: false, errors: '未配置 CF_API_TOKEN / CF_ZONE_ID' }
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}${path}`, {
      method,
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = (await res.json()) as { success: boolean; errors?: { message: string }[]; result?: { id?: string } }
    return { ok: json.success === true, errors: (json.errors || []).map((e) => e.message).join('; '), data: json.result }
  } catch (e) {
    return { ok: false, errors: String(e) }
  }
}

async function dnsCreate(host: string, serverIp: string): Promise<string> {
  const r = await cfApi('POST', '/dns_records', { type: 'A', name: host, content: serverIp, proxied: true })
  return r.ok ? '' : `DNS 创建失败：${r.errors}`
}

async function dnsDelete(host: string): Promise<string> {
  // 先查后删；记录不存在视作成功（幂等）
  const list = await cfApi('GET', `/dns_records?name=${encodeURIComponent(host)}&per_page=5`)
  if (!list.ok) return `DNS 查询失败：${list.errors}`
  const records = (list.data as unknown as { id: string }[]) || []
  for (const rec of Array.isArray(records) ? records : []) {
    await cfApi('DELETE', `/dns_records/${rec.id}`)
  }
  return ''
}

function cfEnabled(): boolean {
  return Boolean(CF_API_TOKEN && CF_ZONE_ID)
}

// ── 租户详情 ─────────────────────────────────────────────────────────────
function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          total += fs.statSync(p).size
        } catch {
          /* 并发删除时竞态，忽略 */
        }
      }
    }
  }
  walk(dir)
  return total
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function tenantDir(host: string): string {
  return path.join(process.env.TENANTS_DIR || 'data/tenants', host)
}

function statLine(host: string, cfg: TenantConfig, live: boolean): string {
  const size = fmtBytes(dirSize(tenantDir(host)))
  const mode = cfg.demo ? '演示种子' : '真实站'
  const storage = cfg.storage === 'r2' ? 'R2' : '本地盘'
  const created = (() => {
    try {
      return new Date(fs.statSync(tenantDir(host)).birthtime).toISOString().slice(0, 10)
    } catch {
      return '—'
    }
  })()
  const state = !live ? (cfg.disabled ? '已停用' : '未加载') : '运行中'
  return `${mode} · ${storage} · ${size} · ${created} · ${state}`
}

// ── HTML 渲染（纯表单，无 JS 无内联事件）──────────────────────────────────
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

function page(title: string, body: string, flash = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · 控制面</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 15px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f5f4; color: #1c1917; }
  main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #78716c; font-size: 13px; margin-bottom: 20px; }
  .card { background: #fff; border: 1px solid #e7e5e4; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f0efee; vertical-align: top; }
  th { color: #78716c; font-weight: 500; font-size: 13px; }
  td.mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  .btn { display: inline-block; border: 1px solid #d6d3d1; background: #fff; color: #1c1917; border-radius: 8px; padding: 6px 14px; font-size: 14px; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #f5f5f4; }
  .btn.primary { background: #1c1917; border-color: #1c1917; color: #fff; }
  .btn.danger { color: #b91c1c; border-color: #fecaca; }
  .btn.danger:hover { background: #fef2f2; }
  form.inline { display: inline; }
  input[type=text], input[type=password] { border: 1px solid #d6d3d1; border-radius: 8px; padding: 8px 12px; font-size: 16px; width: 100%; }
  label { display: block; font-size: 13px; color: #78716c; margin: 10px 0 4px; }
  .flash { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; word-break: break-all; }
  .flash.err { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; }
  .row > div { flex: 1; min-width: 200px; }
  .muted { color: #a8a29e; font-size: 12px; }
  .pill { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12px; }
  .pill.ok { background: #ecfdf5; color: #065f46; }
  .pill.off { background: #fef2f2; color: #991b1b; }
  .pill.demo { background: #fffbeb; color: #92400e; }
  code { background: #f5f5f4; border-radius: 6px; padding: 1px 6px; font-size: 13px; }
  @media (max-width: 640px) { th, td { padding: 6px 6px; } .hide-sm { display: none; } }
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
<p class="sub">${esc(opsSubtitle())}</p>
${flash ? `<div class="flash${flash.startsWith('✗') ? ' err' : ''}">${flash.startsWith('✓!') ? flash.slice(2) : esc(flash)}</div>` : ''}
${body}
</main>
</body>
</html>`
}

let startedAt = 0
function opsSubtitle(): string {
  const days = ((Date.now() - startedAt) / 86400_000).toFixed(1)
  const mem = process.memoryUsage().rss
  return `进程 RSS ${fmtBytes(mem)} · 已运行 ${days} 天${cfEnabled() ? ' · DNS 自动记录已启用' : ' · DNS 需手动添加'}`
}

function loginPage(msg = ''): string {
  return page(
    '控制面登录',
    `<div class="card">
  <form method="post" action="/login">
    <label for="password">主密码（CONTROL_PASSWORD）</label>
    <input type="password" id="password" name="password" autofocus autocomplete="current-password" required>
    <p><button class="btn primary" type="submit">登录</button></p>
    ${msg ? `<p class="muted">${esc(msg)}</p>` : ''}
  </form>
</div>`,
  )
}

function dashboard(deps: ControlDeps, flash = ''): string {
  return page('控制面', dashboardBody(deps), flash)
}

function dashboardBody(deps: ControlDeps): string {
  const cfgAll = deps.readTenantsConfig()
  const rows = Object.entries(cfgAll.tenants)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([host, cfg]) => {
      const live = deps.tenants.has(host)
      const info = statLine(host, cfg, live)
      const pill = live ? '<span class="pill ok">运行中</span>' : cfg.disabled ? '<span class="pill off">已停用</span>' : '<span class="pill demo">未加载</span>'
      const actions = [
        live ? `<form class="inline" method="post" action="/disable"><input type="hidden" name="host" value="${esc(host)}"><button class="btn" type="submit">停用</button></form>` : '',
        cfg.disabled ? `<form class="inline" method="post" action="/enable"><input type="hidden" name="host" value="${esc(host)}"><button class="btn" type="submit">启用</button></form>` : '',
        `<form class="inline" method="post" action="/reset"><input type="hidden" name="host" value="${esc(host)}"><button class="btn" type="submit">重置管理员密码</button></form>`,
        `<form class="inline" method="get" action="/delete"><input type="hidden" name="host" value="${esc(host)}"><button class="btn danger" type="submit">删除…</button></form>`,
      ]
        .filter(Boolean)
        .join(' ')
      return `<tr>
  <td class="mono">${esc(host)}</td>
  <td>${info}</td>
  <td>${pill}</td>
  <td>${actions}</td>
</tr>`
    })
    .join('')

  const logs = readOpsLog()
    .map((l) => `<tr><td class="mono hide-sm">${esc(l.ts.slice(0, 16).replace('T', ' '))}</td><td>${esc(l.action)}</td><td class="mono">${esc(l.detail)}</td></tr>`)
    .join('')

  const totalSize = Object.keys(cfgAll.tenants).reduce((n, h) => n + dirSize(tenantDir(h)), 0)
  let diskTotal = 0
  let diskFree = 0
  try {
    const st = fs.statfsSync(process.env.TENANTS_DIR || 'data/tenants')
    diskTotal = Number(st.blocks) * Number(st.bsize)
    diskFree = Number(st.bavail) * Number(st.bsize)
  } catch {
    /* statfs 不可用时略过 */
  }

  return `
<div class="card">
  <h2 style="font-size:16px;margin:0 0 10px">开通新网站</h2>
  <form method="post" action="/create">
    <div class="row">
      <div>
        <label for="host">域名（DNS ${cfEnabled() ? '将自动创建，橙云代理' : '需手动指向本机，Cloudflare 橙云'}）</label>
        <input type="text" id="host" name="host" placeholder="例如 someone.bloghao.com" required>
      </div>
      <div style="flex:0;min-width:120px">
        <label><input type="checkbox" name="demo" value="1" style="width:auto"> 演示种子站</label>
      </div>
      <div style="flex:0">
        <button class="btn primary" type="submit">开通</button>
      </div>
    </div>
  </form>
</div>

<div class="card">
  <h2 style="font-size:16px;margin:0 0 10px">租户（${Object.keys(cfgAll.tenants).length}）<span class="muted" style="font-weight:400">· 磁盘合计 ${fmtBytes(totalSize)}${diskTotal ? ` / 可用 ${fmtBytes(diskFree)}` : ''}</span></h2>
  <table>
    <tr><th>域名</th><th>信息</th><th>状态</th><th>操作</th></tr>
    ${rows}
  </table>
</div>

<div class="card">
  <h2 style="font-size:16px;margin:0 0 10px">操作日志</h2>
  <table>
    <tr><th class="hide-sm">时间（UTC）</th><th>动作</th><th>详情</th></tr>
    ${logs || '<tr><td colspan="3" class="muted">暂无</td></tr>'}
  </table>
</div>`
}

// ── 重置管理员密码 ────────────────────────────────────────────────────────
async function resetAdminPassword(host: string): Promise<string> {
  const cfgFile = path.join(tenantDir(host), 'blog.db')
  if (!fs.existsSync(cfgFile)) return '✗ 该租户还没有数据库（从未被访问过），无需重置'
  // 直接用 node:sqlite 打开租户库（绕过 D1 shim 的长连接缓存），PBKDF2 与 src/auth.ts 同参数
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(cfgFile)
  try {
    const row = db.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get() as { id: number; username: string } | undefined
    if (!row) return '✗ 该站点还未创建管理员（首装未完成），无需重置'
    const password = randomToken(9) // 12 位 URL 安全字符，作为一次性初始密码足够强
    const { hash, salt } = await hashPassword(password)
    db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?').run(hash, salt, Date.now(), row.id)
    db.prepare('DELETE FROM sessions').run() // 踢掉所有已登录会话
    opsLog('重置密码', `${host}（${row.username}）`)
    // '✓!' 前缀 = flash 含可信 HTML（page() 对它跳过 esc），密码本体是 randomToken 字符无需转义
    return `✓!✓ ${esc(host)} 管理员 ${esc(row.username)} 的新密码：<br><code style="font-size:18px">${password}</code><br><span class="muted">只显示这一次，请立即复制并到该站后台修改。</span>`
  } finally {
    db.close()
  }
}

// ── 请求主循环 ───────────────────────────────────────────────────────────
function sendHtml(res: import('node:http').ServerResponse, body: string, status = 200, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers })
  res.end(body)
}

function originOk(req: import('node:http').IncomingMessage, url: URL): boolean {
  const origin = req.headers.origin
  if (!origin) return true // 同源表单回退（无 CORS 的普通 POST 允许缺省 Origin）
  try {
    return new URL(origin).host === url.host
  } catch {
    return false
  }
}

async function readBody(req: import('node:http').IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

export async function controlApp(deps: ControlDeps): Promise<void> {
  const { req, res, url } = deps
  const method = (req.method || 'GET').toUpperCase()
  const path = url.pathname
  startedAt ||= Date.now() - Number(process.uptime() * 1000)

  // 登录：限流 10 次 / 10 分钟（复用 src/auth.ts 的进程内限流桶）
  if (method === 'POST' && path === '/login') {
    if (!rateLimit(`control-login:${deps.host}`, 10, 10 * 60_000)) {
      return sendHtml(res, loginPage('尝试次数过多，请 10 分钟后再试。'), 429)
    }
    const body = await readBody(req)
    if (!safeEqual(body.get('password') || '', CONTROL_PASSWORD)) {
      deps.log('登录失败')
      return sendHtml(res, loginPage('密码不对。'), 403)
    }
    const token = issueSession()
    opsLog('登录', '控制面登录成功')
    res.writeHead(303, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`,
      Location: '/',
    })
    return res.end()
  }

  // 其余一切路径都要会话；未登录一律 303 到 /（根路径渲染登录页）
  const isRoot = method === 'GET' && path === '/'
  if (!isRoot && !sessionOk(req)) {
    res.writeHead(303, { Location: '/' })
    return res.end()
  }

  if (method === 'GET' && path === '/') {
    return sendHtml(res, sessionOk(req) ? dashboard(deps) : loginPage())
  }

  if (method === 'POST' && !originOk(req, url)) {
    return sendHtml(res, page('拒绝', '<div class="card">跨站请求被拒绝。</div>'), 403)
  }

  const form = method === 'POST' ? await readBody(req) : null
  const host = (form?.get('host') || '').trim().toLowerCase()

  if (method === 'POST' && path === '/logout') {
    const cookie = req.headers.cookie || ''
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9]+)`))
    if (m) sessions.delete(m[1])
    res.writeHead(303, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`, Location: '/' })
    return res.end()
  }

  if (method === 'POST' && path === '/create') {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
      return sendHtml(res, dashboard(deps, '✗ 域名形态不合法（小写字母数字与连字符，至少两段）'))
    }
    const cfgAll = deps.readTenantsConfig()
    if (cfgAll.tenants[host]) return sendHtml(res, dashboard(deps, `✗ ${host} 已存在`))
    const demo = form?.get('demo') === '1'
    try {
      cfgAll.tenants[host] = demo ? { demo: true } : {}
      deps.writeTenantsConfig(cfgAll)
      const tenant = await deps.createTenantFor(host, cfgAll.tenants[host], cfgAll.r2)
      deps.tenants.set(host, tenant) // 热加载：免重启立即进路由
    } catch (e) {
      // 开台失败回滚配置，避免留下「配置有、路由无」的中间态
      const cfgAll2 = deps.readTenantsConfig()
      delete cfgAll2.tenants[host]
      deps.writeTenantsConfig(cfgAll2)
      return sendHtml(res, dashboard(deps, `✗ 开通失败：${String(e)}`))
    }
    let flash = `✓ ${host} 已开通`
    if (cfEnabled()) {
      const ip = process.env.SERVER_IP || ''
      const err = ip ? await dnsCreate(host, ip) : '已设置 CF_API_TOKEN 但未设 SERVER_IP（面板用它建 A 记录），请手动加 DNS'
      if (err) flash += `；${err}`
      else flash += '；DNS 已自动创建（橙云）'
    } else {
      flash += '；请手动添加 DNS：A 记录指向本机（Cloudflare 橙云）'
    }
    opsLog('开通', host + (demo ? '（演示种子）' : ''))
    return sendHtml(res, dashboard(deps, flash))
  }

  if (method === 'POST' && path === '/disable' && host) {
    const cfgAll = deps.readTenantsConfig()
    if (cfgAll.tenants[host]) {
      cfgAll.tenants[host].disabled = true
      deps.writeTenantsConfig(cfgAll)
      deps.tenants.delete(host) // 路由摘除；库与目录原样保留
      opsLog('停用', host)
    }
    return sendHtml(res, dashboard(deps, `✓ ${host} 已停用（数据保留，可随时启用）`))
  }

  if (method === 'POST' && path === '/enable' && host) {
    const cfgAll = deps.readTenantsConfig()
    const cfg = cfgAll.tenants[host]
    if (cfg) {
      delete cfg.disabled
      deps.writeTenantsConfig(cfgAll)
      deps.tenants.set(host, await deps.createTenantFor(host, cfg, cfgAll.r2))
      opsLog('启用', host)
    }
    return sendHtml(res, dashboard(deps, `✓ ${host} 已启用`))
  }

  if (method === 'POST' && path === '/delete' && host) {
    if (form?.get('confirm') !== host) {
      return sendHtml(res, dashboard(deps, '✗ 确认域名不匹配，未删除'))
    }
    const cfgAll = deps.readTenantsConfig()
    if (cfgAll.tenants[host]) {
      delete cfgAll.tenants[host]
      deps.writeTenantsConfig(cfgAll)
      deps.tenants.delete(host)
      fs.rmSync(tenantDir(host), { recursive: true, force: true })
      opsLog('删除', host)
      if (cfEnabled()) await dnsDelete(host)
    }
    return sendHtml(res, dashboard(deps, `✓ ${host} 已彻底删除（配置 + 数据目录${cfEnabled() ? ' + DNS 记录' : ''}）`))
  }

  if (method === 'POST' && path === '/reset' && host) {
    const flash = await resetAdminPassword(host)
    return sendHtml(res, dashboard(deps, flash))
  }

  // 删除确认页（dashboard 的「删除…」先到这里，输入域名二次确认才真删）
  if (method === 'GET' && path === '/delete' && url.searchParams.get('host')) {
    const target = url.searchParams.get('host') || ''
    return sendHtml(
      res,
      page(
        '删除确认',
        `<div class="card">
  <p>即将<b>彻底删除</b> <code>${esc(target)}</code> 的配置、数据库与全部图片，且不可恢复。</p>
  <form method="post" action="/delete">
    <input type="hidden" name="host" value="${esc(target)}">
    <label for="confirm">输入完整域名以确认</label>
    <input type="text" id="confirm" name="confirm" placeholder="${esc(target)}" required>
    <p><button class="btn danger" type="submit">永久删除</button> <a class="btn" href="/">取消</a></p>
  </form>
</div>`,
      ),
    )
  }

  return sendHtml(res, page('404', '<div class="card">没有这个页面。</div>'), 404)
}
