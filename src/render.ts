import type { CommentRow, PostRow, SettingsMap } from './types'
import { esc, fmtDate, fmtDateCN, fmtDateTime } from './utils'

export interface ThemePageOptions {
  settings: SettingsMap
  css: string
  title: string
  description?: string
  ogImage?: string
  path: string
  body: string
  preview?: boolean
}

/** HTML 骨架：meta/OG/内联主题 CSS/站点脚本，所有主题共用 */
export function page(o: ThemePageOptions): string {
  const siteName = o.settings.siteName || 'BlogHao'
  const desc = (o.description || o.settings.siteDescription || '').slice(0, 160)
  const siteUrl = (o.settings.siteUrl || '').replace(/\/+$/, '')
  const title = o.title ? `${o.title} - ${siteName}` : siteName
  const ogType = o.path.startsWith('/post/') ? 'article' : 'website'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(o.title || siteName)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="${ogType}">
${siteUrl ? `<meta property="og:url" content="${esc(siteUrl + o.path)}">` : ''}
${o.ogImage ? `<meta property="og:image" content="${esc(absUrl(siteUrl, o.ogImage))}">` : ''}
${o.settings.faviconUrl ? `<link rel="icon" href="${esc(absUrl(siteUrl, o.settings.faviconUrl))}">` : `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`}
${siteUrl ? `<link rel="alternate" type="application/rss+xml" title="${esc(siteName)}" href="${esc(siteUrl)}/rss.xml">` : ''}
<style>${o.css}</style>
</head>
<body${o.preview ? ' data-preview="1"' : ''}>
${o.body}
<script src="/site.js" defer></script>
</body>
</html>`
}

function absUrl(siteUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return siteUrl ? siteUrl + path : path
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

/**
 * 全站顶部导航：首页 + 分类 + 搜索 + 随机。
 * cls 传主题前缀（如 wx-snav），结构统一、样式交由主题 CSS 塑形。
 */
export function siteNav(o: { cls: string; categories: CategoryLink[]; active?: string }): string {
  const item = (href: string, label: string, active = false) =>
    `<a class="${o.cls}-link${active ? ' is-active' : ''}" href="${href}">${esc(label)}</a>`
  const links = [
    item('/', '首页', o.active === 'home'),
    item('/weibo', '微博', o.active === 'weibo'),
    ...o.categories.map((cat) => item(categoryLink(cat), cat.name, o.active === cat.slug)),
    item('/search', '搜索', o.active === 'search'),
    item('/random', '随机', false),
  ]
  return `<nav class="${o.cls}" aria-label="站点导航">${links.join('')}</nav>`
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
}

/** 微博时间：今年「10月3日 14:20」，往年带年份 */
export function weiboTime(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const now = new Date()
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/** 微博图片网格：1 张大图，2/4 张两列，其余三列（微博式） */
export function weiboImageGrid(images: string[]): string {
  const n = images.length
  if (!n) return ''
  const cls = n === 1 ? 'wb-imgs-1' : n === 2 || n === 4 ? 'wb-imgs-2' : 'wb-imgs-3'
  const imgs = images.map((u) => `<img src="${esc(u)}" loading="lazy" alt="">`).join('')
  return `<div class="wb-imgs ${cls}">${imgs}</div>`
}

/** 微博卡片底栏：点赞（同文章 like-btn，data-type=weibo）+ 评论数（点开卡片内折叠评论区） */
export function weiboCardFoot(w: WeiboItemView): string {
  const like = `<button class="wb-action like-btn" type="button" data-type="weibo" data-id="${w.id}" data-likes="${w.likes}" aria-label="点赞">
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 21s-7.5-4.9-10-9.3C.5 8.4 2.3 4.9 5.7 4.5c2-.2 3.9.8 5 2.5a5.7 5.7 0 0 1 5-2.5c3.4.4 5.2 3.9 3.7 7.2C19.5 16.1 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
  <b class="like-count" data-count>${w.likes}</b>
</button>`
  const cmt = `<button class="wb-action wb-cmt-toggle" type="button" data-wb="${w.id}" aria-label="评论" aria-expanded="false">
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 20l1.2-3.2C3.8 15.4 3 13.5 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
  <b class="wb-cmt-count" data-count>${w.commentCount}</b>
</button>`
  return `<footer class="wb-foot">${like}${cmt}</footer>`
}

/** 卡片内折叠评论区骨架：列表与表单内容由 site.js 按需填充 */
export function weiboCommentPanel(w: WeiboItemView, allowComments: boolean): string {
  return `<div class="wb-cmt" data-wb-cmt="${w.id}" hidden>
  <div class="wb-cmt-list" data-role="list"><p class="wb-cmt-loading">加载中…</p></div>
  ${
    allowComments
      ? `<form class="wb-cmt-form" data-role="form">
  <div class="wb-cmt-row">
    <input class="wb-cmt-input" name="nickname" maxlength="24" placeholder="昵称" required>
    <input class="cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">
  </div>
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
}): string {
  const name = o.settings.siteName || '微博'
  const allowComments = o.allowComments !== false
  return o.items
    .map((w) => {
      const foot = weiboCardFoot(w)
      const panel = weiboCommentPanel(w, allowComments)
      return `<article class="wb-card" id="wb-${w.id}">
  <header class="wb-head">
    <span class="wb-avatar">${o.avatarHtml}</span>
    <div class="wb-who">
      <span class="wb-name">${esc(name)}</span>
      <time class="wb-time" datetime="${new Date(w.created_at).toISOString()}">${weiboTime(w.created_at)}</time>
    </div>
  </header>
  ${w.content ? `<div class="wb-text">${esc(w.content)}</div>` : ''}
  ${weiboImageGrid(w.images)}
  ${foot}
  ${panel}
</article>`
    })
    .join('\n')
}

/** 微博页翻页：上一页 / 下一页（页数少，无需页码跳转） */
export function weiboPager(page: number, totalPages: number): string {
  if (totalPages <= 1) return ''
  const prev =
    page > 1
      ? `<a class="wb-pager-btn" href="/weibo?page=${page - 1}">← 新一条</a>`
      : '<span class="wb-pager-btn is-disabled">← 新一条</span>'
  const next =
    page < totalPages
      ? `<a class="wb-pager-btn" href="/weibo?page=${page + 1}">更早的 →</a>`
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
  // 页码跳转：纯 HTML GET 表单（CSP 禁内联脚本），tag 参数从 base 还原
  const tagInBase = c.base.match(/^\/\?tag=([^&]*)&$/)
  const hidden = tagInBase
    ? `<input type="hidden" name="tag" value="${esc(decodeURIComponent(tagInBase[1]))}">`
    : ''
  const jump = `<form class="pager-jump" action="/" method="get">${hidden}<span class="pager-jump-text">跳至</span><input class="pager-input" type="number" name="page" min="1" max="${c.totalPages}" value="${c.page}" aria-label="页码">页<span class="pager-jump-text">/ 共 ${c.totalPages} 页</span><button class="pager-go" type="submit">跳转</button></form>`
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
 */
export function commentsHtml(o: {
  comments: CommentRow[]
  slug: string
  allowComments: boolean
  count: number
  isAdmin?: boolean
  title?: string
  tip?: string
}): string {
  const tops = o.comments.filter((c) => !c.parent_id)
  const children = new Map<number, CommentRow[]>()
  for (const c of o.comments) {
    if (!c.parent_id) continue
    const list = children.get(c.parent_id) || []
    list.push(c)
    children.set(c.parent_id, list)
  }

  // 孤儿回复（父评论被删）：按顶层展示，避免消失
  const orphans = o.comments.filter((c) => c.parent_id && !o.comments.some((p) => p.id === c.parent_id))
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

  const form = o.allowComments
    ? `<form id="comment-form" class="cmt-form" data-slug="${esc(o.slug)}">
  <input type="hidden" name="parentId" value="">
  <div class="cmt-form-row">
    <input class="cmt-input" name="nickname" maxlength="24" placeholder="昵称" required>
    <input class="cmt-input cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">
  </div>
  <textarea class="cmt-textarea" name="content" maxlength="1000" rows="3" placeholder="写下你的想法…" required></textarea>
  <div class="cmt-form-foot">
    <span class="cmt-tip">${esc(o.tip || '留言即刻展示，请友善交流')}</span>
    <button class="cmt-submit" type="submit">发送</button>
  </div>
</form>`
    : `<p class="cmt-closed">作者已关闭留言。</p>`

  return `<section class="cmt-section" id="comments">
  <h2 class="cmt-title">${esc(o.title || '留言')} <span class="cmt-count">${o.count}</span></h2>
  ${o.comments.length ? `<ul class="cmt-list">${list}</ul>` : `<p class="cmt-empty">还没有留言，来抢沙发～</p>`}
  ${form}
</section>`
}

export function likesBtn(slug: string, likes: number): string {
  return `<button class="like-btn" data-slug="${esc(slug)}" data-likes="${likes}" type="button">
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s-7.5-4.9-10-9.3C.5 8.4 2.3 4.9 5.7 4.5c2-.2 3.9.8 5 2.5a5.7 5.7 0 0 1 5-2.5c3.4.4 5.2 3.9 3.7 7.2C19.5 16.1 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
  <span class="like-label">赞</span>
  <b class="like-count" data-count>${likes}</b>
</button>`
}

export function tagLink(name: string): string {
  return `/tag/${encodeURIComponent(name)}`
}

export function fmtViews(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w' : String(n)
}

export { esc, fmtDate, fmtDateCN }
