import type { PostRow, SettingsMap } from './types'
import { sanitizeHtml } from './sanitize'
import { esc, fmtDate } from './utils'

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function rfc822(ts: number | null): string {
  return new Date(ts ?? Date.now()).toUTCString()
}

/** CDATA 包裹 HTML 全文：正文已过 sanitize，仅需防 ]]> 提前闭合 */
function cdata(html: string): string {
  return `<![CDATA[${html.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
}

export function buildRss(settings: SettingsMap, posts: PostRow[], siteUrl: string): string {
  const fullText = settings.rssFullText !== '0'
  const items = posts
    .map((p) => {
      // 全文走 content:encoded（标准做法：description 保持摘要轻量，订阅器优先读全文）
      const encoded =
        fullText && p.content
          ? `\n      <content:encoded>${cdata(sanitizeHtml(p.content))}</content:encoded>`
          : ''
      return `    <item>
      <title>${xmlEsc(p.title)}</title>
      <link>${xmlEsc(siteUrl)}/post/${xmlEsc(p.slug)}</link>
      <guid isPermaLink="true">${xmlEsc(siteUrl)}/post/${xmlEsc(p.slug)}</guid>
      <pubDate>${rfc822(p.published_at)}</pubDate>
      <description>${xmlEsc(p.summary)}</description>${encoded}
    </item>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${xmlEsc(settings.siteName)}</title>
    <link>${xmlEsc(siteUrl)}</link>
    <description>${xmlEsc(settings.siteDescription)}</description>
    <language>zh-CN</language>
    <atom:link href="${xmlEsc(siteUrl)}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`
}

export function buildSitemap(settings: SettingsMap, posts: PostRow[], siteUrl: string): string {
  const urls = [
    { loc: `${siteUrl}/`, lastmod: fmtDate(Date.now()) },
    { loc: `${siteUrl}/about`, lastmod: '' },
    { loc: `${siteUrl}/archives`, lastmod: fmtDate(Date.now()) },
    { loc: `${siteUrl}/guestbook`, lastmod: '' },
    { loc: `${siteUrl}/weibo`, lastmod: '' },
    { loc: `${siteUrl}/links`, lastmod: '' },
    ...posts.map((p) => ({
      loc: `${siteUrl}/post/${xmlEsc(p.slug)}`,
      lastmod: fmtDate(p.updated_at),
    })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`
  )
  .join('\n')}
</urlset>`
}
