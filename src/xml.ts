/**
 * XML 输出公共件：RSS / sitemap / WXR 导出共用。
 * 三个口径必须保持一致（AGENTS「RSS/WXR 等 XML 输出」约定）：
 * - xmlEsc / cdata 入口统一剥 XML 1.0 非法控制字符（CDATA 内同样非法）：一条脏数据曾能打挂整份 feed
 * - URL 里的 slug 由调用方 encodeURIComponent（中文 slug 是非 ASCII IRI）
 */

/** XML 1.0 禁止的控制字符（CDATA 内同样非法） */
export const XML_CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

export function xmlEsc(s: string): string {
  return String(s ?? '')
    .replace(XML_CTRL_RE, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function rfc822(ts: number | null): string {
  return new Date(ts ?? Date.now()).toUTCString()
}

/** CDATA 包裹 HTML 全文：正文已过 sanitize，仅需防 ]]> 提前闭合 */
export function cdata(html: string): string {
  return `<![CDATA[${String(html ?? '').replace(XML_CTRL_RE, '').replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}
