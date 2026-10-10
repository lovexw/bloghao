/* ---------------- 文章访问密码（加密码） ----------------
 * 作者可为单篇文章设置访问密码：访客打开文章页只看到密码表单，输入正确后
 * 以 HMAC Cookie 记住解锁状态（30 天），此后正常阅读。
 * 独立成模块（同 src/trash.ts 的理由）：不依赖 hono / 主题，Node 测试可直接导入。
 * 防泄漏铁律（新增公开面必须过一遍，详见 AGENTS.md「文章访问密码」防线节）：
 * password_hash 不出任何后台响应；加密文章的正文不出现在 RSS 全文 / 搜索 / meta 摘要。
 */
import { hashPassword, safeEqual } from './auth'

/** Cookie 名与解锁有效期：bloghao_ 前缀与 SESSION_COOKIE 同族 */
export const PP_COOKIE = 'bloghao_pp'
export const PP_TTL_MS = 30 * 86_400_000

/** 加密文章对外展示的兜底描述（meta description / JSON-LD；作者自填摘要仍优先展示） */
export const PP_NOTICE = '本文章已加密，输入密码后可阅读全文。'

export interface ProtectableRow {
  password_hash?: string | null
}

/** 是否加密文章：password_hash 非空即加密（schema 上 NOT NULL DEFAULT ''，IS NULL 只是防御脏库） */
export function isProtected(row: ProtectableRow): boolean {
  return !!row.password_hash
}

/** 生成存储格式 `salt:hash`（复用 auth.ts 的 PBKDF2-SHA256，10 万次迭代与登录口令同强度）。
 *  单列存放：salt 是 hex 不含冒号，拆分永远安全 */
export async function hashPostPassword(password: string): Promise<string> {
  const { hash, salt } = await hashPassword(password)
  return `${salt}:${hash}`
}

/** 校验访问密码：存储格式非法 / 密码不对一律 false */
export async function verifyPostPassword(stored: string, password: string): Promise<boolean> {
  if (!stored || !password) return false
  const i = stored.indexOf(':')
  if (i <= 0) return false
  const salt = stored.slice(0, i)
  const hash = stored.slice(i + 1)
  const { hash: calc } = await hashPassword(password, salt)
  return safeEqual(calc, hash)
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * 解锁令牌：`postId.exp.hmac`，HMAC 的 key 就是该文当前的 password_hash——
 * 只有真正校验过密码的服务端能签出（密码一改，旧 Cookie 全部自动失效），无需站点级密钥。
 */
async function signUnlockToken(postId: number, passwordHash: string, now: number): Promise<string> {
  const exp = now + PP_TTL_MS
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwordHash), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${postId}.${exp}`))
  return `${postId}.${exp}.${toHex(sig)}`
}

/** 校验某篇文章的解锁 Cookie：格式 / 过期 / 签名（对当前 password_hash 重算）任一不过即未解锁 */
export async function hasValidUnlock(cookieValue: string | null, postId: number, passwordHash: string, now: number): Promise<boolean> {
  if (!cookieValue || !passwordHash) return false
  for (const entry of cookieValue.split(',')) {
    const p1 = entry.indexOf('.')
    const p2 = entry.indexOf('.', p1 + 1)
    if (p1 <= 0 || p2 <= p1) continue
    if (entry.slice(0, p1) !== String(postId)) continue
    const exp = Number(entry.slice(p1 + 1, p2))
    if (!Number.isFinite(exp) || exp <= now) continue
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwordHash), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expect = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${postId}.${exp}`))
    if (safeEqual(toHex(expect), entry.slice(p2 + 1))) return true
  }
  return false
}

/**
 * 解锁成功后的 Cookie 值：并入本次令牌、清掉过期与旧密码下的同篇令牌，
 * 上限 20 篇（约 1.8KB，Cookie 容量内）；existing 脏数据原样忽略。
 */
export async function mergeUnlockCookie(existing: string | null, postId: number, passwordHash: string, now: number): Promise<string> {
  const entries = (existing || '')
    .split(',')
    .filter((e) => {
      const p1 = e.indexOf('.')
      const p2 = e.indexOf('.', p1 + 1)
      if (p1 <= 0 || p2 <= p1) return false
      const exp = Number(e.slice(p1 + 1, p2))
      return Number.isFinite(exp) && exp > now && e.slice(0, p1) !== String(postId)
    })
  entries.push(await signUnlockToken(postId, passwordHash, now))
  return entries.slice(-20).join(',')
}

/** 加密文章在解锁前的 meta / JSON-LD 描述：作者摘要照常展示（作者主动公开的导读），否则用固定话术 */
export function protectedDescription(summary: string): string {
  return summary || PP_NOTICE
}

/** 解锁前文章页的正文替换：服务端直出的密码表单（纯 HTML form POST + 303 回跳，无 JS 依赖） */
export function passwordFormHtml(slug: string, o: { error?: 'wrong' | 'slow' } = {}): string {
  const err =
    o.error === 'slow'
      ? '<p class="pp-err">尝试次数过多，请 10 分钟后再试。</p>'
      : o.error === 'wrong'
        ? '<p class="pp-err">密码不对，再试试。</p>'
        : ''
  return `<div class="pp-box">
<form class="pp-form" method="post" action="/post/${encodeURIComponent(slug)}/unlock">
  <p class="pp-title">🔒 本文章已加密</p>
  <p class="pp-tip">作者为本篇文章设置了访问密码，输入密码即可阅读全文，解锁状态保留 30 天。</p>
  <div class="pp-row">
    <input class="pp-input" type="password" name="password" maxlength="64" required placeholder="访问密码" aria-label="访问密码" autocomplete="off">
    <button class="pp-btn" type="submit">解锁</button>
  </div>
  ${err}
</form>
</div>`
}

/** 表单样式：随主题 CSS 注入 <head>（style-src 'unsafe-inline' 已放行），currentColor 适配明暗五主题 */
export const PP_CSS = `
.pp-box{max-width:420px;margin:32px auto;padding:28px 22px;border:1px solid rgba(127,127,127,.3);border-radius:14px;text-align:center}
.pp-title{font-size:17px;font-weight:600;margin:0 0 8px}
.pp-tip{font-size:13px;opacity:.72;margin:0 0 18px;line-height:1.7}
.pp-row{display:flex;gap:8px}
.pp-input{flex:1;min-width:0;font-size:16px;padding:10px 12px;border:1px solid rgba(127,127,127,.45);border-radius:10px;background:transparent;color:inherit}
.pp-btn{font-size:15px;padding:10px 18px;border:1px solid currentColor;border-radius:10px;background:transparent;color:inherit;cursor:pointer}
.pp-btn:hover{opacity:.75}
.pp-err{font-size:13px;color:#d64545;margin:14px 0 0}
@media (max-width:480px){.pp-box{margin:20px 0;padding:22px 14px}.pp-row{flex-wrap:wrap}.pp-btn{width:100%}}
`
