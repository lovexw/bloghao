import type { PostRow, SettingsMap } from './types'
import { siteMode } from './render'
import { sanitizeHtml } from './sanitize'
import { esc, fmtDate, teaserHtml } from './utils'
import { cdata, rfc822, xmlEsc } from './xml'

export function buildRss(settings: SettingsMap, posts: PostRow[], siteUrl: string): string {
  const fullText = settings.rssFullText !== '0'
  const items = posts
    .map((p) => {
      // 全文走 content:encoded（标准做法：description 保持摘要轻量，订阅器优先读全文）。
      // 会员专属文章（min_tier 非 all）订阅器等同游客视角：只出试读段 + 引导，防付费墙被 RSS 绕过（契约 A2 防泄漏清单）
      // 访问密码文章（password_hash 非空）更严：试读段也不出，description 只用作者自填摘要（src/protect.ts 防泄漏清单）
      const pwProtected = !!p.password_hash
      const memberLocked = !!p.min_tier && p.min_tier !== 'all'
      const encoded =
        fullText && p.content && !pwProtected
          ? `\n      <content:encoded>${cdata(
              memberLocked
                ? teaserHtml(sanitizeHtml(p.content)) +
                  '<p>—— 本文为会员专属内容，剩余部分请到站点登录会员后阅读。</p>'
                : sanitizeHtml(p.content)
            )}</content:encoded>`
          : ''
      return `    <item>
      <title>${xmlEsc(p.title)}</title>
      <link>${xmlEsc(siteUrl)}/post/${encodeURIComponent(p.slug)}</link>
      <guid isPermaLink="true">${xmlEsc(siteUrl)}/post/${encodeURIComponent(p.slug)}</guid>
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

export function buildSitemap(
  settings: SettingsMap,
  posts: { slug: string; updated_at: number }[],
  siteUrl: string,
  categories: { slug: string; name: string }[] = [],
  tags: { name: string; count: number }[] = [],
  pages: { slug: string; updated_at: number }[] = []
): string {
  const urls = [
    { loc: `${siteUrl}/`, lastmod: fmtDate(Date.now()) },
    { loc: `${siteUrl}/about`, lastmod: '' },
    { loc: `${siteUrl}/archives`, lastmod: fmtDate(Date.now()) },
    { loc: `${siteUrl}/guestbook`, lastmod: '' },
    // 纯博客模式前台隐藏了微博模块（/weibo 302 回首页），sitemap 不再收录
    ...(siteMode(settings) === 'blog' ? [] : [{ loc: `${siteUrl}/weibo`, lastmod: '' }]),
    { loc: `${siteUrl}/links`, lastmod: '' },
    // 独立页面（/page/:slug）：slug 做百分号编码（中文 slug 是非 ASCII IRI）
    ...pages.map((p) => ({
      loc: `${siteUrl}/page/${encodeURIComponent(p.slug)}`,
      lastmod: fmtDate(p.updated_at),
    })),
    // 分类/标签列表页同样可收录；slug/标签名做百分号编码（中文标签是非 ASCII IRI）
    ...categories.map((cat) => ({
      loc: `${siteUrl}/category/${encodeURIComponent(cat.slug)}`,
      lastmod: '',
    })),
    ...tags.map((t) => ({
      loc: `${siteUrl}/tag/${encodeURIComponent(t.name)}`,
      lastmod: '',
    })),
    ...posts.map((p) => ({
      loc: `${siteUrl}/post/${encodeURIComponent(p.slug)}`,
      lastmod: fmtDate(p.updated_at),
    })),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${xmlEsc(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`
  )
  .join('\n')}
</urlset>`
}
