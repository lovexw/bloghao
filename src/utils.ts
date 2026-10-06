export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 去掉 HTML 标签取纯文本摘要。
 *  实体解码先处理 lt/gt/quot/apos、最后处理 amp：顺序反了会把 &amp;lt; 二次解码成裸 < */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export function excerpt(html: string, n = 80): string {
  const t = plainText(html)
  return t.length > n ? t.slice(0, n) + '…' : t
}

/* ---------------- 时间显示 ----------------
 * SSR 统一按北京时间（UTC+8）渲染：Workers 的时区是 UTC，
 * 直接 new Date(ts).getHours() 会把 0-8 点发布的内容显示成前一天。
 * 客户端（site.js）用同样的偏移口径，保证同屏时间一致。 */
export function cstDate(ts: number): Date {
  return new Date(ts + 8 * 3600_000)
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = cstDate(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = cstDate(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${fmtDate(ts)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** 中文日期，公众号风格：2026年10月3日 */
export function fmtDateCN(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = cstDate(ts)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

/** ISO 8601 机器日期，JSON-LD 等结构化数据用：2026-10-05T14:30:00+08:00。
 *  与 fmtDate 同一偏移口径（+8h 后取 UTC 分量再标 +08:00），0-8 点发布的时间不错位 */
export function isoDate(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Date(ts + 8 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+08:00')
}

export function readingMinutes(html: string): number {
  const n = plainText(html).replace(/\s/g, '').length
  return Math.max(1, Math.ceil(n / 400))
}

/** 生成 slug：中文标题回退到随机短 ID，纯 ASCII 标题转 kebab-case */
export function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (ascii.length >= 2) {
    const parts = ascii.split('-').slice(0, 6).join('-')
    if (parts.length >= 2) return parts
  }
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

/** 用户自定义 slug 的字符集清洗：空白折叠成 -，只留字母/数字/中文/_/-。
 *  不清洗的坏链：空格、%、? 等字符会让 /post/:slug 渲染出异常路由 */
export function cleanSlug(raw: string): string {
  return raw
    .trim()
    .slice(0, 80)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 插件停用列表（settings 的 pluginsDisabled，逗号分隔的 manifest id）清洗：去空白、保序去重、
 *  逐项过字符集白名单（与插件文件名/id 约定一致：字母数字_-）。
 *  含非法字符时返回 null，由调用方决定拒绝（400）还是忽略 */
export function cleanDisabledPlugins(raw: string): string | null {
  const ids: string[] = []
  for (const part of String(raw ?? '').split(',')) {
    const id = part.trim().slice(0, 64)
    if (!id) continue
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null
    if (!ids.includes(id)) ids.push(id)
  }
  return ids.join(',')
}

/* ---------------- 微博话题 ----------------
 * 识别正文里的 #话题#（成对井号）与独立成词的 #话题（后面跟空白或到行尾）。
 * 要求 # 前不是字母/数字/#，避免把 C# 、手机#1 之类误判成话题。
 */
const WEIBO_TOPIC_RE = /(?<![\p{L}\p{N}#])#([^\s#&<>"']{1,24})(?:#|(?=\s)|$)/gu

export const WEIBO_MAX_TOPICS = 10

/** 从微博正文提取话题（保序去重，最多 10 个） */
export function extractWeiboTopics(content: string): string[] {
  const out: string[] = []
  for (const m of content.matchAll(WEIBO_TOPIC_RE)) {
    const t = m[1].trim()
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= WEIBO_MAX_TOPICS) break
  }
  return out
}

/** 话题过滤的 LIKE 模式：带 JSON 引号做精确匹配，防「猫」命中「波斯猫」 */
export function jsonItemLikePattern(name: string): string {
  return `%${JSON.stringify(name).replace(/[%_\\]/g, (m) => '\\' + m)}%`
}

/** 搜索 LIKE 模式：\ % _ 三个字符都要转义（声明 ESCAPE '\' 后，\ 本身不转义，
 *  搜「a\b」「尾随\」时模式语义就变了）。与 jsonItemLikePattern 同口径 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`
}

/** 友链网址规整：补全 https:// 前缀，只接受 http(s)，失败返回空串 */
export function normalizeLinkUrl(input: string): string {
  let s = input.trim().slice(0, 500)
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}

/* ---------------- 演示站模式 ----------------
 * 仅 demo Worker（wrangler.demo.jsonc 注入 DEMO_MODE）为真；生产 Worker 不带此变量。
 * 门控三类行为：播种/重置（src/demo.ts，动态 import）、防搞坏守卫（改密码/闭站/外发通知）、robots 与 noindex。
 */
export function isDemo(env: { DEMO_MODE?: string } | undefined): boolean {
  return env?.DEMO_MODE === '1' || env?.DEMO_MODE === 'true'
}

/** 字节流的 SHA-256 十六进制指纹：媒体「体检」查重复文件用（uploads.hash，见 src/audit.ts）。
 *  Workers 与 Node 18+ 都内置 webcrypto */
export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
