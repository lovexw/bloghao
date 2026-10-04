import type { CommentRow, PostRow, SettingsMap } from './types'
import type { PostSort } from './db'
import { esc, extractWeiboTopics, fmtDate, fmtDateCN, fmtDateTime } from './utils'

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

/** 顶部导航「分类话题」菜单用的标签视图（带使用计数） */
export interface TagCount {
  name: string
  count: number
}

/**
 * 全站顶部导航：首页 + 微博 + 分类话题（details 折叠菜单）+ 友情链接 + 随机。
 * cls 传主题前缀（如 wx-snav），结构统一、样式交由主题 CSS 塑形。
 * 分类与标签收进同一折叠菜单（标签可能很多，菜单内部滚动），
 * active 传 'home' / 'weibo' / 'links' / 分类 slug / 'tag:标签名'。
 */
export function siteNav(o: {
  cls: string
  categories: CategoryLink[]
  tags?: TagCount[]
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
  ${drop}
  ${item('/links', '友情链接', o.active === 'links')}
  ${item('/random', '随机')}
</nav>`
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

/** 友链卡片：有图标用图标，没有用站名首字 */
export function friendLinkCards(items: FriendLinkView[]): string {
  return items
    .map((l) => {
      const ico = l.icon
        ? `<span class="fl-ico"><img src="${esc(l.icon)}" loading="lazy" alt=""></span>`
        : `<span class="fl-ico fl-ico-letter" aria-hidden="true">${esc((l.name || '链').trim().charAt(0))}</span>`
      return `<a class="fl-card" href="${esc(l.url)}" target="_blank" rel="noopener">
  ${ico}
  <span class="fl-main">
    <span class="fl-name">${esc(l.name)}</span>
    ${l.description ? `<span class="fl-desc">${esc(l.description)}</span>` : ''}
  </span>
</a>`
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
  /** 登录管理员昵称：评论表单免填昵称，以作者身份发言 */
  adminName?: string
}): string {
  const name = o.settings.siteName || '微博'
  const allowComments = o.allowComments !== false
  return o.items
    .map((w) => {
      const foot = weiboCardFoot(w)
      const panel = weiboCommentPanel(w, allowComments, o.adminName)
      return `<article class="wb-card${w.pinned ? ' is-pinned' : ''}" id="wb-${w.id}">
  <header class="wb-head">
    <span class="wb-avatar">${o.avatarHtml}</span>
    <div class="wb-who">
      <span class="wb-name">${esc(name)}</span>
      <time class="wb-time" datetime="${new Date(w.created_at).toISOString()}">${weiboTime(w.created_at)}</time>
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
      const text = (w.content || '').replace(/\s+/g, ' ').trim()
      const short = text ? (text.length > 64 ? text.slice(0, 64) + '…' : text) : `发了 ${w.images.length} 张图`
      const thumb = w.images[0]
        ? `<span class="wb-home-thumb"><img src="${esc(w.images[0])}" loading="lazy" alt=""></span>`
        : ''
      return `<a class="wb-home-item" href="/weibo#wb-${w.id}">
  <div class="wb-home-main">
    <p class="wb-home-text">${esc(short)}</p>
    <time class="wb-home-time" datetime="${new Date(w.created_at).toISOString()}">${weiboTime(w.created_at)}</time>
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
    ? `<form id="comment-form" class="cmt-form${o.adminName ? ' is-admin' : ''}" data-slug="${esc(o.slug)}">
  <input type="hidden" name="parentId" value="">
  ${
    o.adminName
      ? adminIdentity(o.adminName)
      : `<div class="cmt-form-row">
    <input class="cmt-input" name="nickname" maxlength="24" placeholder="昵称" required>
    <input class="cmt-input cmt-hp" name="link" tabindex="-1" autocomplete="off" aria-hidden="true">
  </div>`
  }
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

/** 排序条/翻页共用的列表地址：分类页、搜索页留在原路径，首页/标签页用 /?tag= */
export function listPageUrl(o: ListPageContext): string {
  const params = new URLSearchParams()
  if (o.tag) params.set('tag', o.tag)
  if (o.q) params.set('q', o.q)
  if (o.sort && o.sort !== 'latest') params.set('sort', o.sort)
  if (o.sort === 'random' && o.seed) params.set('seed', String(o.seed))
  const qs = params.toString()
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
  const params = new URLSearchParams()
  if (o.tag) params.set('tag', o.tag)
  if (o.q) params.set('q', o.q)
  if (o.sort && o.sort !== 'latest') params.set('sort', o.sort)
  if (o.sort === 'random' && o.seed) params.set('seed', String(o.seed))
  const qs = params.toString()
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
