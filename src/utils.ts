export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escAttr(s: unknown): string {
  return esc(s)
}

/** 去掉 HTML 标签取纯文本摘要 */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function excerpt(html: string, n = 80): string {
  const t = plainText(html)
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${fmtDate(ts)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 中文日期，公众号风格：2026年10月3日 */
export function fmtDateCN(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
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

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
