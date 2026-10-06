import type { CommentRow, PostRow, SettingsMap } from './types'
import type { PostSort } from './db'
import { renderFooterHtml } from './hooks'
import { cstDate, esc, excerpt, extractWeiboTopics, fmtDate, fmtDateCN, fmtDateTime, isoDate } from './utils'

export interface ThemePageOptions {
  settings: SettingsMap
  css: string
  title: string
  description?: string
  ogImage?: string
  path: string
  body: string
  preview?: boolean
  /** 请求源（new URL(c.req.url).origin）：canonical / og:url 绝对化的兜底，未配置 siteUrl 时也能产出绝对地址 */
  origin?: string
  /** 工具型页面（搜索、草稿预览）：要求搜索引擎不收录 */
  noindex?: boolean
  /** 结构化数据（JSON-LD）：对象序列化进 <script type="application/ld+json">，文章页传 articleJsonLd() 的产物 */
  jsonLd?: Record<string, unknown>
}

/** og:image 三级兜底：文章专属卡图（编辑器 OG 标记 > 封面）→ 后台设置的默认卡图 → 内置品牌卡图。
 *  og:image 绝不缺位：社交平台抓不到图时会退化为灰色占位小图标 */
export function resolveOgImage(ogImage: string | undefined, settings: SettingsMap): string {
  return ogImage || settings.ogImageDefault || '/og-default.png'
}

/** 站点绝对地址前缀：后台「站点链接」优先，未配置时回退请求 origin；去尾部斜杠 */
export function siteBase(settings: SettingsMap, origin?: string): string {
  return ((settings.siteUrl || origin || '') as string).replace(/\/+$/, '')
}

/** HTML 骨架：meta/OG/JSON-LD/内联主题 CSS/站点脚本，所有主题共用 */
export function page(o: ThemePageOptions): string {
  const siteName = o.settings.siteName || 'BlogHao'
  const desc = (o.description || o.settings.siteDescription || '').slice(0, 160)
  const base = siteBase(o.settings, o.origin)
  const title = o.title ? `${o.title} - ${siteName}` : siteName
  const ogType = o.path.startsWith('/post/') ? 'article' : 'website'
  const ogImage = resolveOgImage(o.ogImage, o.settings)
  // JSON-LD 里的 < 必须转成 \u003c（仍是合法 JSON）：防正文标题带 </script> 提前闭合脚本标签
  const jsonLdHtml = o.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(o.jsonLd).replace(/</g, '\\u003c')}</script>`
    : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${o.noindex ? '<meta name="robots" content="noindex">' : ''}
${o.settings.statsEnabled === '0' ? '<meta name="xw-stats" content="off">' : ''}
${base ? `<link rel="canonical" href="${esc(base + o.path)}">` : ''}
<meta property="og:title" content="${esc(o.title || siteName)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(siteName)}">
${base ? `<meta property="og:url" content="${esc(base + o.path)}">` : ''}
<meta property="og:image" content="${esc(absUrl(base, ogImage))}">
<meta property="og:image:alt" content="${esc(o.title || siteName)}">
<meta name="twitter:card" content="summary_large_image">
${jsonLdHtml}
${o.settings.faviconUrl ? `<link rel="icon" href="${esc(absUrl(base, o.settings.faviconUrl))}">` : `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`}
${base ? `<link rel="alternate" type="application/rss+xml" title="${esc(siteName)}" href="${esc(base)}/rss.xml">` : ''}
<style>${o.css}</style>
${grayscaleStyle(o.settings)}
</head>
<body${o.preview ? ' data-preview="1"' : ''}>
${o.body}
<script src="/site.js" defer></script>
${renderFooterHtml(o.settings)}
</body>
</html>`
}

function absUrl(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return siteUrl ? siteUrl + path : path
}

/** 一键灰度（哀悼/纪念模式）：settings.siteGrayscale 开启时全站去色。
 *  放在 <html> 上才能覆盖背景色；注：filter 会让 fixed 后代改挂 html 定位基准——
 *  五套主题目前都没有 fixed 元素（sticky 不受影响），新主题引入固定定位时记得复查 */
function grayscaleStyle(settings: SettingsMap): string {
  return settings.siteGrayscale === '1' ? '<style>html{filter:grayscale(100%)}</style>' : ''
}

/** 闭站页（settings.siteClosed 开启时对匿名访客返回）：脱离主题的极简独立页。
 *  状态码必须 503 + Retry-After——搜索引擎据此暂时保留收录，而不是把站点当 404 摘掉 */
export function renderClosedPage(settings: SettingsMap): string {
  const siteName = settings.siteName || 'BlogHao'
  const message = settings.siteClosedMessage || '本站暂时关闭，请稍后再来。'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>站点暂时关闭 - ${esc(siteName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{color-scheme:light dark}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI','Microsoft YaHei',sans-serif;
  background:#f4f4f5;color:#52525b}
.card{max-width:460px;text-align:center}
.badge{width:44px;height:44px;margin:0 auto;border:1.5px solid #a1a1aa;border-radius:50%;
  display:flex;align-items:center;justify-content:center;color:#a1a1aa}
h1{font-size:20px;font-weight:600;margin:20px 0 12px;color:inherit}
.msg{font-size:15px;line-height:1.8;white-space:pre-wrap;word-break:break-word}
.site{margin-top:32px;font-size:13px;color:#a1a1aa}
@media (prefers-color-scheme:dark){body{background:#18181b}.badge{border-color:#3f3f46;color:#3f3f46}.site{color:#52525b}}
</style>
</head>
<body>
<div class="card">
<div class="badge" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/></svg></div>
<h1>站点暂时关闭</h1>
<p class="msg">${esc(message)}</p>
<div class="site">${esc(siteName)}</div>
</div>
</body>
</html>`
}

export interface ArticleJsonLdOptions {
  settings: SettingsMap
  /** 文章标题（headline，不带站名后缀） */
  title: string
  description: string
  /** 文章专属卡图或封面（可相对路径）：内部走 resolveOgImage 兜底，与 og:image 恒一致 */
  image?: string
  /** 文章 canonical 地址：与 page() 的 canonical 同源拼接（base + /post/:slug） */
  url: string
  base: string
  /** 发布时间（毫秒），缺失回退 updatedAt */
  publishedAt?: number | null
  /** 最后更新时间（毫秒） */
  updatedAt: number
  tags?: string[]
  commentCount?: number
}

/**
 * 文章页 JSON-LD 结构化数据（schema.org BlogPosting，SEO 基本盘，roadmap A3）。
 * 时间统一北京时间 +08:00（isoDate，与全站时间口径一致）；dateModified 取发布/更新中较晚者——
 * 定时发布场景 updated_at 会早于 published_at，直接用会造成「修改时间早于发布时间」的矛盾数据。
 */
export function articleJsonLd(o: ArticleJsonLdOptions): Record<string, unknown> {
  const siteName = o.settings.siteName || 'BlogHao'
  const publishedTs = o.publishedAt || o.updatedAt
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': o.url },
    // Google 建议 headline 控制在 110 字符内，超长截断
    headline: o.title.slice(0, 110),
    description: o.description,
    image: absUrl(o.base, resolveOgImage(o.image, o.settings)),
    datePublished: isoDate(publishedTs),
    dateModified: isoDate(Math.max(publishedTs, o.updatedAt)),
    author: { '@type': 'Person', name: siteName },
    publisher: {
      '@type': 'Organization',
      name: siteName,
      logo: { '@type': 'ImageObject', url: absUrl(o.base, o.settings.faviconUrl || '/favicon.svg') },
    },
    inLanguage: 'zh-CN',
  }
  if (o.tags?.length) data.keywords = o.tags.join(', ')
  if (o.commentCount != null) data.commentCount = o.commentCount
  return data
}

export interface HomePostView {
  slug: string
  title: string
  summary: string
  cover: string
  tags: string[]
  published_at: number | null
  views: number
  likes: number
  pinned: boolean
  commentCount?: number
  readingMinutes?: number
}

/** 前台导航/文章页用的分类轻量视图 */
export interface CategoryLink {
  name: string
  slug: string
}

export function categoryLink(c: CategoryLink): string {
  return `/category/${encodeURIComponent(c.slug)}`
}

/** 顶部导航「分类话题」菜单用的标签视图（带使用计数） */
export interface TagCount {
  name: string
  count: number
}

/** 顶部导航里的自建页面项（独立页面系统，key 用于高亮匹配：'p:<slug>'） */
export interface NavPage {
  title: string
  href: string
  key: string
}

/**
 * 全站顶部导航：首页 + 微博 + 归档 + 留言板 + 分类话题（details 折叠菜单）+ 友情链接 + 自建页面 + 关于我 + 随机。
 * cls 传主题前缀（如 wx-snav），结构统一、样式交由主题 CSS 塑形。
 * 分类与标签收进同一折叠菜单（标签可能很多，菜单内部滚动），
 * active 传 'home' / 'weibo' / 'archives' / 'guestbook' / 'links' / 'about' / 分类 slug / 'tag:标签名' / 'p:页面slug'。
 */
export function siteNav(o: {
  cls: string
  categories: CategoryLink[]
  tags?: TagCount[]
  pages?: NavPage[]
  active?: string
}): string {
  const item = (href: string, label: string, active = false) =>
    `<a class="${o.cls}-link${active ? ' is-active' : ''}" href="${href}">${esc(label)}</a>`
  const chip = (href: string, label: string, count: number | undefined, active = false) =>
    `<a class="${o.cls}-chip${active ? ' is-active' : ''}" href="${href}">${esc(label)}${
      count != null ? `<i>${count}</i>` : ''
    }</a>`
  const cats = o.categories.map((c) => chip(categoryLink(c), c.name, undefined, o.active === c.slug))
  const tags = (o.tags || []).map((t) => chip(tagLink(t.name), t.name, t.count, o.active === `tag:${t.name}`))
  const menu =
    cats.length || tags.length
      ? `<div class="${o.cls}-menu">
  ${cats.length ? `<div class="${o.cls}-group"><span class="${o.cls}-label">分类</span><div class="${o.cls}-chips">${cats.join('')}</div></div>` : ''}
  ${tags.length ? `<div class="${o.cls}-group"><span class="${o.cls}-label">话题</span><div class="${o.cls}-chips">${tags.join('')}</div></div>` : ''}
</div>`
      : ''
  const drop = menu
    ? `<details class="${o.cls}-dd snav-dd">
  <summary class="${o.cls}-link">分类话题<svg class="${o.cls}-caret" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
  ${menu}
</details>`
    : ''
  return `<nav class="${o.cls}" aria-label="站点导航">
  ${item('/', '首页', o.active === 'home')}
  ${item('/weibo', '微博', o.active === 'weibo')}
  ${item('/archives', '归档', o.active === 'archives')}
  ${item('/guestbook', '留言板', o.active === 'guestbook')}
  ${drop}
  ${item('/links', '友情链接', o.active === 'links')}
  ${(o.pages || []).map((p) => item(p.href, p.title, o.active === p.key)).join('')}
  ${item('/about', '关于我', o.active === 'about')}
  ${item('/random', '随机')}
</nav>`
}

/* ---------------- 文章归档（共享构建器） ----------------
 * 年份小节 + 日期外置的细线列表，结构全主题共用（语义化 .ar-* class），视觉由主题 CSS 塑形。
 */
export interface ArchiveItemView {
  slug: string
  title: string
  /** 发文时间（published_at 缺失回退 created_at），用于分组与展示 */
  ts: number
}

export interface ArchiveYearGroup {
  year: number
  count: number
  items: ArchiveItemView[]
}

/** 按年分组：年份倒序，组内按时间倒序 */
export function archiveGroups(posts: ArchiveItemView[]): ArchiveYearGroup[] {
  const map = new Map<number, ArchiveItemView[]>()
  for (const p of posts) {
    // 与 fmtDate 同口径：按北京时间的年份分组，避免 0-8 点发布的文章归错年
    const year = cstDate(p.ts).getUTCFullYear()
    const list = map.get(year) || []
    list.push(p)
    map.set(year, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({
      year,
      count: items.length,
      items: items.sort((a, b) => b.ts - a.ts),
    }))
}

/** 归档列表 HTML：每篇一行的 <time> + 标题链接（纯静态超链接，利于搜索引擎收录） */
export function archiveListHtml(groups: ArchiveYearGroup[]): string {
  return groups
    .map(
      (g) => `<section class="ar-group">
  <h2 class="ar-year">${g.year}<i>${g.count} 篇</i></h2>
  <ul class="ar-list">${g.items
    .map(
      (p) => `<li class="ar-item">
  <a class="ar-link" href="/post/${esc(p.slug)}">
    <time class="ar-date" datetime="${fmtDate(p.ts)}">${fmtDate(p.ts).replace(/-/g, '.')}</time>
    <span class="ar-title">${esc(p.title)}</span>
  </a>
</li>`
    )
    .join('\n')}</ul>
</section>`
    )
    .join('\n')
}

/* ---------------- 友情链接（共享构建器） ----------------
 * 卡片 / 申请收录表单结构全主题共用（语义化 .fl-* class），视觉由主题 CSS 塑形。
 */
export interface FriendLinkView {
  name: string
  url: string
  description: string
  /** 图标地址（站内 /images/ 或外链），空则退回站名首字图标 */
  icon: string
}

/** 机器可读时间戳：<time datetime> 用。无效时间戳（备份恢复/导入的脏数据）兜成空串，
 *  直接 toISOString() 会抛 RangeError 让整页 500 */
function safeIso(ts: number): string {
  const d = new Date(ts)
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}

/** 友链卡片：有图标用图标，没有用站名首字。url/icon 渲染前过 scheme 白名单——
 *  写侧已拦 javascript: 等协议，这里兜底防备份恢复/导入路径的脏数据流进 href/src */
export function friendLinkCards(items: FriendLinkView[]): string {
  const safeUrl = (u: string): string => (/^(https?:\/\/|\/)/i.test(u) ? u : '')
  return items
    .map((l) => {
      const url = safeUrl(l.url)
      const icon = safeUrl(l.icon)
      const ico = icon
        ? `<span class="fl-ico"><img src="${esc(icon)}" loading="lazy" alt=""></span>`
        : `<span class="fl-ico fl-ico-letter" aria-hidden="true">${esc((l.name || '链').trim().charAt(0))}</span>`
      const main = `<span class="fl-main">
    <span class="fl-name">${esc(l.name)}</span>
    ${l.description ? `<span class="fl-desc">${esc(l.description)}</span>` : ''}
  </span>`
      // url 非法时退化为无链接卡片（内容照常展示，不输出可疑 href）
      return url
        ? `<a class="fl-card" href="${esc(url)}" target="_blank" rel="noopener">
  ${ico}
  ${main}
</a>`
        : `<span class="fl-card">
  ${ico}
  ${main}
</span>`
    })
    .join('\n')
}

/** 申请收录表单：提交交给 site.js（POST /api/public/links/apply，进待审核） */
export function friendLinkApply(): string {
  return `<section class="fl-apply" id="fl-apply">
  <h2 class="fl-apply-title">申请收录</h2>
  <p class="fl-apply-sub">想和本站交个朋友？留下你的站点，审核通过后就会出现在上面。</p>
  <form class="fl-form">
    <div class="fl-form-row">
      <input class="fl-input" name="name" maxlength="40" placeholder="站点名称" required aria-label="站点名称">
      <input class="fl-input" name="url" type="url" inputmode="url" maxlength="500" placeholder="https:// 你的网址" required aria-label="站点网址">
    </div>
    <textarea class="fl-textarea" name="description" maxlength="120" rows="2" placeholder="一两句介绍你的网站（可选）" aria-label="站点介绍"></textarea>
    <input class="cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="fl-form-foot">
      <span class="fl-tip">提交后由站长审核</span>
      <button class="fl-submit" type="submit">提交申请</button>
    </div>
  </form>
</section>`
}

/**
 * 文章页去重：封面图常取自正文首图，渲染正文时把与封面相同的第一张图删掉
 * （连同因此变空的 <p>），列表页缩略图不受影响。
 */
export function stripCoverDuplicate(contentHtml: string, cover: string): string {
  if (!cover) return contentHtml
  const img = contentHtml.match(/<img\b[^>]*>/i)
  if (!img) return contentHtml
  const src = img[0].match(/\bsrc\s*=\s*"([^"]*)"/i)
  if (!src) return contentHtml
  const norm = (u: string) => u.replace(/&amp;/g, '&').trim()
  if (norm(src[1]) !== norm(cover)) return contentHtml
  const imgRe = img[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutP = contentHtml.replace(new RegExp(`<p>\\s*${imgRe}\\s*</p>`), '')
  return withoutP !== contentHtml ? withoutP : contentHtml.replace(img[0], '')
}

export function toHomePost(row: PostRow, tags: string[], commentCount?: number, readingMinutes?: number): HomePostView {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    cover: row.cover,
    tags,
    published_at: row.published_at,
    views: row.views,
    likes: row.likes,
    pinned: !!row.pinned,
    commentCount,
    readingMinutes,
  }
}

/* ---------------- 微博（随手记）共享构建器 ----------------
 * HTML 结构各主题共用（语义化 .wb-* class），视觉由主题 CSS 塑形。
 */
export interface WeiboItemView {
  id: number
  content: string
  images: string[]
  created_at: number
  likes: number
  commentCount: number
  pinned?: boolean
}

/** 微博时间：今年「10月3日 14:20」，往年带年份（北京时间口径，与 utils 时间函数一致） */
export function weiboTime(ts: number): string {
  const d = cstDate(ts)
  const now = cstDate(Date.now())
  const p = (x: number) => String(x).padStart(2, '0')
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  return d.getUTCFullYear() === now.getUTCFullYear()
    ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hm}`
    : `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

/** 微博图片网格：1 张大图，2/4 张两列，其余三列（微博式） */
export function weiboImageGrid(images: string[]): string {
  const n = images.length
  if (!n) return ''
  const cls = n === 1 ? 'wb-imgs-1' : n === 2 || n === 4 ? 'wb-imgs-2' : 'wb-imgs-3'
  const imgs = images.map((u) => `<img src="${esc(u)}" loading="lazy" alt="">`).join('')
  return `<div class="wb-imgs ${cls}">${imgs}</div>`
}

/** 微博正文：转义后把 #话题# 渲染成指向 /weibo?topic= 的链接 */
export function weiboTextHtml(content: string): string {
  return esc(content).replace(/(?<![\p{L}\p{N}#])#[^\s#&<>"']{1,24}(?:#|(?=\s)|$)/gu, (m) => {
    const name = extractWeiboTopics(m)[0]
    if (!name) return esc(m)
    return `<a class="wb-topic" href="/weibo?topic=${encodeURIComponent(name)}">${esc(m)}</a>`
  })
}

/** 微博话题条：默认不显示（避免标签堆满页头）；仅从正文 #话题# 链接进入筛选时，显示「全部 + 当前话题」方便退出筛选 */
export function weiboTopicBar(topics: { name: string; count: number }[], active?: string): string {
  if (!active) return ''
  const hit = topics.find((t) => t.name === active)
  const chip = (name: string, label: string, count?: number) =>
    `<a class="wb-topic-chip${name === (active || '') ? ' is-active' : ''}" href="/weibo${
      name ? `?topic=${encodeURIComponent(name)}` : ''
    }">${esc(label)}${count != null ? `<i>${count}</i>` : ''}</a>`
  return `<nav class="wb-topics" aria-label="微博话题">${chip('', '全部')}${chip(active, '#' + active, hit?.count)}</nav>`
}

/** 卡片底栏右侧管理操作（仅管理员登录时渲染，访客 HTML 里不存在；交互在 site.js） */
function weiboAdminBar(w: WeiboItemView): string {
  return `<div class="wb-admin" data-wb-admin="${w.id}">
  <button class="wb-admin-btn" type="button" data-wb-act="edit">编辑</button>
  <button class="wb-admin-btn" type="button" data-wb-act="pin">${w.pinned ? '取消置顶' : '置顶'}</button>
  <button class="wb-admin-btn is-danger" type="button" data-wb-act="del">删除</button>
</div>`
}

/** 心形（点赞）图标：微博底栏 16 与文章页 18 两种规格共用同一 path */
function heartSvg(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 21s-7.5-4.9-10-9.3C.5 8.4 2.3 4.9 5.7 4.5c2-.2 3.9.8 5 2.5a5.7 5.7 0 0 1 5-2.5c3.4.4 5.2 3.9 3.7 7.2C19.5 16.1 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`
}

/** 微博卡片底栏：点赞（同文章 like-btn，data-type=weibo）+ 评论数（点开卡片内折叠评论区） */
export function weiboCardFoot(w: WeiboItemView, isAdmin?: boolean): string {
  const like = `<button class="wb-action like-btn" type="button" data-type="weibo" data-id="${w.id}" data-likes="${w.likes}" aria-label="点赞">
  ${heartSvg(16)}
  <b class="like-count" data-count>${w.likes}</b>
</button>`
  const cmt = `<button class="wb-action wb-cmt-toggle" type="button" data-wb="${w.id}" aria-label="评论" aria-expanded="false">
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 20l1.2-3.2C3.8 15.4 3 13.5 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
  <b class="wb-cmt-count" data-count>${w.commentCount}</b>
</button>`
  return `<footer class="wb-foot">${like}${cmt}${isAdmin ? weiboAdminBar(w) : ''}</footer>`
}

/** 管理员登录时的发言身份行（文章/微博评论表单共用，免填昵称） */
function adminIdentity(name: string): string {
  return `<p class="cmt-as">以作者 <b>${esc(name)}</b> 的身份发言</p><input class="cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">`
}

/** 卡片内折叠评论区骨架：列表与表单内容由 site.js 按需填充；adminName 传入时表单免填昵称 */
export function weiboCommentPanel(w: WeiboItemView, allowComments: boolean, adminName?: string): string {
  return `<div class="wb-cmt" data-wb-cmt="${w.id}" hidden>
  <div class="wb-cmt-list" data-role="list"><p class="wb-cmt-loading">加载中…</p></div>
  ${
    allowComments
      ? `<form class="wb-cmt-form${adminName ? ' is-admin' : ''}" data-role="form">
  ${
    adminName
      ? adminIdentity(adminName)
      : `<div class="wb-cmt-row">
    <input class="wb-cmt-input" name="nickname" maxlength="24" placeholder="昵称" required>
    <input class="cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">
  </div>`
  }
  <textarea class="wb-cmt-textarea" name="content" maxlength="1000" rows="2" placeholder="说点什么…" required></textarea>
  <div class="wb-cmt-foot"><span class="wb-cmt-tip"></span><button class="wb-cmt-submit" type="submit">发送</button></div>
</form>`
      : ''
  }
</div>`
}

export function weiboCards(o: {
  settings: SettingsMap
  items: WeiboItemView[]
  avatarHtml: string
  allowComments?: boolean
  /** 登录管理员昵称：评论表单免填昵称，以作者身份发言；传入即在卡片上渲染管理操作（编辑/置顶/删除） */
  adminName?: string
}): string {
  const name = o.settings.siteName || '微博'
  const allowComments = o.allowComments !== false
  const isAdmin = !!o.adminName
  return o.items
    .map((w) => {
      const foot = weiboCardFoot(w, isAdmin)
      const panel = weiboCommentPanel(w, allowComments, o.adminName)
      return `<article class="wb-card${w.pinned ? ' is-pinned' : ''}" id="wb-${w.id}">
  <header class="wb-head">
    <span class="wb-avatar">${o.avatarHtml}</span>
    <div class="wb-who">
      <span class="wb-name">${esc(name)}</span>
      <time class="wb-time" datetime="${safeIso(w.created_at)}">${weiboTime(w.created_at)}</time>
    </div>
    ${w.pinned ? '<span class="wb-pin">置顶</span>' : ''}
  </header>
  ${w.content ? `<div class="wb-text">${weiboTextHtml(w.content)}</div>` : ''}
  ${weiboImageGrid(w.images)}
  ${foot}
  ${panel}
</article>`
    })
    .join('\n')
}

/** 首页微博入口卡：最新几条随手记摘要 + 总条数，整卡指向 /weibo（无已发布微博时不渲染） */
export function weiboHomeEntry(o: { items: WeiboItemView[]; total: number }): string {
  if (!o.items.length) return ''
  const items = o.items
    .map((w) => {
      // 摘要统一走 excerpt（含空白折叠），与历史上的今天等处同口径
      const text = w.content || ''
      const short = text ? excerpt(text, 64) : `发了 ${w.images.length} 张图`
      const thumb = w.images[0]
        ? `<span class="wb-home-thumb"><img src="${esc(w.images[0])}" loading="lazy" alt=""></span>`
        : ''
      return `<a class="wb-home-item" href="/weibo?wb=${w.id}#wb-${w.id}">
  <div class="wb-home-main">
    <p class="wb-home-text">${esc(short)}</p>
    <time class="wb-home-time" datetime="${safeIso(w.created_at)}">${weiboTime(w.created_at)}</time>
  </div>
  ${thumb}
</a>`
    })
    .join('\n')
  return `<section class="wb-home" aria-label="微博随手记">
  <a class="wb-home-head" href="/weibo">
    <svg class="wb-home-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    <span class="wb-home-title">微博 · 随手记</span>
    <span class="wb-home-count">共 ${o.total} 条</span>
    <span class="wb-home-more">全部 →</span>
  </a>
  ${items}
</section>`
}

/* ---------------- 历史上的今天（首页时光机卡，共享构建器） ----------------
 * 结构全主题共用（语义化 .otd-* class），视觉由主题 CSS 塑形；没有命中时不渲染。
 */
export interface OnThisDayItemView {
  kind: 'post' | 'weibo'
  href: string
  text: string
  ts: number
  yearsAgo: number
}

/** 年份标签：1 = 去年，2+ = N 年前 */
function otdYearLabel(yearsAgo: number): string {
  return yearsAgo <= 1 ? '去年' : `${yearsAgo} 年前`
}

/** 卡片直出条数，其余进「展开」折叠区——当天历史再多也不挤丢，只多占一行摘要 */
const OTD_VISIBLE = 4

function otdRow(it: OnThisDayItemView): string {
  return `<a class="otd-item" href="${esc(it.href)}">
  <span class="otd-year">${new Date(it.ts).getUTCFullYear()}<i>${otdYearLabel(it.yearsAgo)}</i></span>
  <span class="otd-text">${esc(it.text)}</span>
  <span class="otd-kind">${it.kind === 'post' ? '文章' : '微博'}</span>
</a>`
}

export function onThisDayCard(items: OnThisDayItemView[] | null | undefined): string {
  if (!items?.length) return ''
  const rest = items.slice(OTD_VISIBLE)
  // 原生 <details> 折叠：无 JS 可用（CSP 禁内联脚本），开关文案由 CSS 按 open 态切换
  const more = rest.length
    ? `<details class="otd-more">
  <summary><span class="otd-fold-more">展开其余 ${rest.length} 条 ▾</span><span class="otd-fold-less">收起 ▴</span></summary>
  ${rest.map(otdRow).join('\n')}
</details>`
    : ''
  return `<section class="otd-card" aria-label="历史上的今天">
  <header class="otd-head">
    <svg class="otd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
    <span class="otd-title">历史上的今天</span>
    <span class="otd-sub">时间经过的地方，总会留下点什么</span>
  </header>
  ${items.slice(0, OTD_VISIBLE).map(otdRow).join('\n')}
  ${more}
</section>`
}

/** 前台微博页发布框：管理员登录时由主题渲染在时间线顶部（访客不可见），交互在 site.js，与后台发布器同款能力 */
export function weiboComposer(o: { adminName: string }): string {
  return `<form class="wb-composer" data-wb-composer>
  <p class="wb-composer-as">以作者 <b>${esc(o.adminName)}</b> 的身份发布</p>
  <textarea class="wb-composer-textarea" name="content" maxlength="5000" rows="3" placeholder="有什么新鲜事？正文里写 #话题# 可归类"></textarea>
  <div class="wb-composer-tiles" hidden></div>
  <div class="wb-composer-foot">
    <button class="wb-composer-add" type="button">加图（0/9）</button>
    <span class="wb-composer-count" data-count>0 / 5000</span>
    <span class="wb-composer-tip" data-tip aria-live="polite"></span>
    <span class="wb-composer-actions">
      <button class="wb-composer-draft" type="button">存草稿</button>
      <button class="wb-composer-publish" type="button">发布</button>
    </span>
  </div>
</form>`
}

/** 微博页翻页：上一页 / 下一页（页数少，无需页码跳转）；按话题筛选时翻页要带上 topic */
export function weiboPager(page: number, totalPages: number, topic?: string): string {
  if (totalPages <= 1) return ''
  const href = (p: number) => `/weibo?page=${p}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`
  const prev =
    page > 1
      ? `<a class="wb-pager-btn" href="${href(page - 1)}">← 新一条</a>`
      : '<span class="wb-pager-btn is-disabled">← 新一条</span>'
  const next =
    page < totalPages
      ? `<a class="wb-pager-btn" href="${href(page + 1)}">更早的 →</a>`
      : '<span class="wb-pager-btn is-disabled">更早的 →</span>'
  return `<nav class="wb-pager">${prev}<span class="wb-pager-info">${page} / ${totalPages}</span>${next}</nav>`
}

export interface PagerContext {
  page: number
  totalPages: number
  /** 形如 "/" 或 "/?tag=生活&" —— 会拼接 page=N */
  base: string
}

export function pagerHtml(c: PagerContext): string {
  if (c.totalPages <= 1) return ''
  const link = (p: number, label: string, cls: string, disabled = false) =>
    disabled
      ? `<span class="pager-btn ${cls} is-disabled">${label}</span>`
      : `<a class="pager-btn ${cls}" href="${esc(c.base)}page=${p}">${label}</a>`
  let nums = ''
  const start = Math.max(1, c.page - 2)
  const end = Math.min(c.totalPages, start + 4)
  for (let p = start; p <= end; p++) {
    nums += link(p, String(p), `pager-num${p === c.page ? ' is-current' : ''}`)
  }
  // 页码跳转：纯 HTML GET 表单（CSP 禁内联脚本），base 里的参数（tag/sort/seed…）原样带回
  const baseQs = c.base.replace(/^[^?]*\?/, '').replace(/&+$/, '')
  const hidden = [...new URLSearchParams(baseQs).entries()]
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')
  const jump = `<form class="pager-jump" action="${esc(c.base.split('?')[0] || '/')}" method="get">${hidden}<span class="pager-jump-text">跳至</span><input class="pager-input" type="number" name="page" min="1" max="${c.totalPages}" value="${c.page}" aria-label="页码">页<span class="pager-jump-text">/ 共 ${c.totalPages} 页</span><button class="pager-go" type="submit">跳转</button></form>`
  return `<nav class="pager">${link(c.page - 1, '← 上一页', 'pager-prev', c.page <= 1)}${nums}${link(
    c.page + 1,
    '下一页 →',
    'pager-next',
    c.page >= c.totalPages
  )}</nav>${jump}`
}

/** 留言区（评论列表 + 表单），语义化 class 交给主题 CSS 塑形
 * - 楼中楼：parent_id 指向顶层评论的回复缩进展示，作者发言带「作者」徽标
 * - isAdmin：当前访客为管理员，渲染每条留言的「回复」按钮（site.js 接管交互）
 * - guestbook：留言板页（/guestbook）复用同一套结构，表单提交到 /api/public/guestbook
 */
export function commentsHtml(o: {
  comments: CommentRow[]
  slug: string
  allowComments: boolean
  count: number
  isAdmin?: boolean
  /** 登录管理员昵称：表单免填昵称，以作者身份发言 */
  adminName?: string
  title?: string
  tip?: string
  /** 留言板模式：区块与表单换成 guestbook 专用 id，提交目标不同 */
  guestbook?: boolean
}): string {
  const tops = o.comments.filter((c) => !c.parent_id)
  const children = new Map<number, CommentRow[]>()
  for (const c of o.comments) {
    if (!c.parent_id) continue
    const list = children.get(c.parent_id) || []
    list.push(c)
    children.set(c.parent_id, list)
  }

  // 孤儿回复（父评论被删）：按顶层展示，避免消失（先建 id 集合，免得逐条平方级扫全量评论）
  const commentIds = new Set(o.comments.map((c) => c.id))
  const orphans = o.comments.filter((c) => c.parent_id && !commentIds.has(c.parent_id))
  for (const c of orphans) tops.push({ ...c, parent_id: 0 })

  const renderItem = (c: CommentRow): string => {
    const badge = c.is_admin ? '<span class="cmt-badge">作者</span>' : ''
    const replyBtn = o.isAdmin
      ? `<button class="cmt-reply-btn" type="button" data-reply="${c.id}" data-name="${esc(c.nickname)}">回复</button>`
      : ''
    const kids = children.get(c.id) || []
    return `<li class="cmt-item" id="cmt-${c.id}">
  <div class="cmt-head">
    <span class="cmt-name">${esc(c.nickname)}${badge}</span>
    <span class="cmt-time">${fmtDateTime(c.created_at)}</span>
    ${replyBtn}
  </div>
  <div class="cmt-body">${esc(c.content)}</div>
  ${kids.length ? `<ul class="cmt-children">${kids.map(renderItem).join('')}</ul>` : ''}
</li>`
  }

  const list = tops.map(renderItem).join('\n')

  const formInner = `
  <input type="hidden" name="parentId" value="">
  ${
    o.adminName
      ? adminIdentity(o.adminName)
      : `<div class="cmt-form-row">
    <input class="cmt-input" name="nickname" maxlength="24" placeholder="昵称" required>
    <input class="cmt-input cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">
  </div>`
  }
  <textarea class="cmt-textarea" name="content" maxlength="1000" rows="3" placeholder="${o.guestbook ? '想对作者说点什么…' : '写下你的想法…'}" required></textarea>
  <div class="cmt-form-foot">
    <span class="cmt-tip">${esc(o.tip || '留言即刻展示，请友善交流')}</span>
    <button class="cmt-submit" type="submit">发送</button>
  </div>
`
  const form = o.allowComments
    ? o.guestbook
      ? `<form id="guestbook-form" class="cmt-form${o.adminName ? ' is-admin' : ''}" data-guestbook="1">${formInner}</form>`
      : `<form id="comment-form" class="cmt-form${o.adminName ? ' is-admin' : ''}" data-slug="${esc(o.slug)}">${formInner}</form>`
    : `<p class="cmt-closed">作者已关闭留言。</p>`

  return `<section class="cmt-section${o.guestbook ? ' gb-section' : ''}" id="${o.guestbook ? 'guestbook' : 'comments'}">
  <h2 class="cmt-title">${esc(o.title || (o.guestbook ? '留言板' : '留言'))} <span class="cmt-count">${o.count}</span></h2>
  ${o.comments.length ? `<ul class="cmt-list">${list}</ul>` : `<p class="cmt-empty">${o.guestbook ? '还没有人留言，来坐个沙发，说点什么吧～' : '还没有留言，来抢沙发～'}</p>`}
  ${form}
</section>`
}

export function likesBtn(slug: string, likes: number): string {
  return `<button class="like-btn" data-slug="${esc(slug)}" data-likes="${likes}" type="button">
  ${heartSvg(18)}
  <span class="like-label">赞</span>
  <b class="like-count" data-count>${likes}</b>
</button>`
}

export function tagLink(name: string): string {
  return `/tag/${encodeURIComponent(name)}`
}

/* ---------------- 首页列表排序筛选（共享构建器） ----------------
 * 结构全主题共用（语义化 .fs-* class），视觉由主题 CSS 塑形。
 * 随机排序：点「随机」不带 seed，服务端每次生成新 seed 洗一组；
 * 翻页链接带 seed，保证同一组随机顺序不重洗。
 */

/** 列表页排序可选项与文案 */
export const HOME_SORTS: { key: PostSort; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'views', label: '最多阅读' },
  { key: 'likes', label: '最多点赞' },
  { key: 'comments', label: '最多留言' },
  { key: 'random', label: '随机' },
]

export interface ListPageContext {
  sort?: PostSort
  seed?: number
  tag?: string
  categorySlug?: string
  q?: string
}

/** 列表地址共用的查询串：tag/q/sort/seed 四件套 */
function listQuery(o: ListPageContext): string {
  const params = new URLSearchParams()
  if (o.tag) params.set('tag', o.tag)
  if (o.q) params.set('q', o.q)
  if (o.sort && o.sort !== 'latest') params.set('sort', o.sort)
  if (o.sort === 'random' && o.seed) params.set('seed', String(o.seed))
  return params.toString()
}

/** 排序条/翻页共用的列表地址：分类页、搜索页留在原路径，首页/标签页用 /?tag= */
export function listPageUrl(o: ListPageContext): string {
  const qs = listQuery(o)
  if (o.categorySlug) return `/category/${encodeURIComponent(o.categorySlug)}${qs ? `?${qs}` : ''}`
  if (o.q) return `/search${qs ? `?${qs}` : ''}`
  return '/' + (qs ? `?${qs}` : '')
}

/** 排序筛选条：一排 chips，当前排序高亮；点「随机」永远洗新一组 */
export function homeSortBar(o: ListPageContext): string {
  const chips = HOME_SORTS.map(
    (s) =>
      `<a class="fs-chip${s.key === (o.sort || 'latest') ? ' is-active' : ''}" href="${esc(
        listPageUrl({ ...o, sort: s.key, seed: undefined })
      )}">${s.label}</a>`
  ).join('')
  return `<nav class="fs-bar" aria-label="文章排序"><span class="fs-label">排序</span>${chips}</nav>`
}

/** 翻页链接前缀（形如 "/?tag=x&sort=random&seed=5&"），随机时带 seed 稳住顺序 */
export function homeListBase(o: ListPageContext): string {
  const qs = listQuery(o)
  const head = o.categorySlug
    ? `/category/${encodeURIComponent(o.categorySlug)}?`
    : o.q
      ? '/search?'
      : '/?'
  return head + (qs ? qs + '&' : '')
}

export function fmtViews(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w' : String(n)
}

export { esc, fmtDate, fmtDateCN }
