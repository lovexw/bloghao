import type { SettingsMap } from '../types'
import type { PostSort } from '../db'
import {
  archiveListHtml,
  categoryLink,
  esc,
  fmtDate,
  fmtDateCN,
  friendLinkApply,
  friendLinkCards,
  homeListBase,
  homeSortBar,
  likesBtn,
  pagerHtml,
  siteNav,
  tagLink,
  weiboCards,
  weiboComposer,
  weiboHomeEntry,
  weiboPager,
  weiboTopicBar,
  type ArchiveYearGroup,
  type CategoryLink,
  type FriendLinkView,
  type HomePostView,
  type TagCount,
  type WeiboItemView,
} from '../render'
import css from './wechat.css'

const id = 'wechat'

/** 站点头像：设置过 avatarUrl 用图片，否则退回站名首字 */
function avatar(s: SettingsMap): string {
  if (s.avatarUrl) {
    return `<img class="wx-avatar wx-avatar-img" src="${esc(s.avatarUrl)}" alt="${esc(s.siteName)}">`
  }
  const ch = (s.siteName || '博').trim().charAt(0) || '博'
  return `<span class="wx-avatar" aria-hidden="true">${esc(ch)}</span>`
}

/** 刊头搜索框：微博卡与文章列表之间（分类、话题收进顶部导航的折叠菜单） */
function searchForm(q: string | undefined): string {
  return `<form class="wx-search" action="/search" method="get" role="search">
  <svg class="wx-search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
  <input class="wx-search-input" type="search" name="q" value="${esc(q || '')}" placeholder="搜一搜站内的文章…" maxlength="60" aria-label="搜索文章">
  <button class="wx-search-btn" type="submit">搜索</button>
</form>`
}

export function home(d: {
  settings: SettingsMap
  posts: HomePostView[]
  page: number
  totalPages: number
  total: number
  tag?: string
  q?: string
  sort?: PostSort
  seed?: number
  categorySlug?: string
  tags: TagCount[]
  categories: CategoryLink[]
  navActive?: string
  notice?: string
  emptyText?: string
  weibo?: { items: WeiboItemView[]; total: number } | null
}): string {
  const s = d.settings
  const items = d.posts
    .map((p) => {
      const date = fmtDate(p.published_at)
      const meta: string[] = []
      if (p.readingMinutes) meta.push(`${p.readingMinutes} 分钟`)
      if (p.views > 0) meta.push(`${p.views} 次阅读`)
      if (p.commentCount) meta.push(`${p.commentCount} 条留言`)
      const dateHtml = date
        ? `<time class="wx-post-date" datetime="${date}">${date.replace(/-/g, '.')}</time>`
        : `<span class="wx-post-date">${fmtDateCN(p.published_at)}</span>`
      const metaHtml =
        p.pinned || meta.length
          ? `<p class="wx-post-meta">${p.pinned ? '<b class="wx-pin">置顶</b>' : ''}${
              meta.length ? `<span>${meta.join(' · ')}</span>` : ''
            }</p>`
          : ''
      return `<a class="wx-post" href="/post/${esc(p.slug)}">
  ${dateHtml}
  <div class="wx-post-main">
    <h2 class="wx-post-title">${esc(p.title)}</h2>
    ${p.summary ? `<p class="wx-post-abs">${esc(p.summary)}</p>` : ''}
    ${metaHtml}
  </div>
  ${p.cover ? `<span class="wx-post-thumb"><img src="${esc(p.cover)}" loading="lazy" alt=""></span>` : ''}
</a>`
    })
    .join('\n')

  return `<div class="wx-page">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags, active: d.navActive })}
  <header class="wx-masthead">
    ${avatar(s)}
    <h1 class="wx-masthead-name">${esc(s.siteName)}</h1>
    ${s.siteDescription ? `<p class="wx-masthead-desc">${esc(s.siteDescription)}</p>` : ''}
  </header>
  ${d.notice ? `<div class="wx-notice">${d.notice}</div>` : ''}
  ${d.weibo ? weiboHomeEntry(d.weibo) : ''}
  ${searchForm(d.q)}
  ${homeSortBar({ sort: d.sort, seed: d.seed, tag: d.tag, categorySlug: d.categorySlug, q: d.q })}
  <main class="wx-feed">
    ${items || `<p class="wx-empty">${d.emptyText || '还没有文章，快去后台写下第一篇吧。'}</p>`}
  </main>
  ${pagerHtml({
    page: d.page,
    totalPages: d.totalPages,
    base: homeListBase({ sort: d.sort, seed: d.seed, tag: d.tag, categorySlug: d.categorySlug, q: d.q }),
  })}
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

export function post(d: {
  settings: SettingsMap
  post: {
    slug: string
    title: string
    contentHtml: string
    summary: string
    cover: string
    tags: string[]
    published_at: number | null
    views: number
    likes: number
    readingMinutes: number
  }
  category: CategoryLink | null
  categories: CategoryLink[]
  tags: TagCount[]
  comments: { html: string; count: number }
  related: HomePostView[]
}): string {
  const s = d.settings
  const p = d.post
  const tagChips = p.tags
    .map((t) => `<a class="wx-tag" href="${tagLink(t)}"># ${esc(t)}</a>`)
    .join('')
  const catChip = d.category ? `<a class="wx-tag wx-cat" href="${categoryLink(d.category)}">${esc(d.category.name)}</a>` : ''
  const related = d.related.length
    ? `<section class="wx-related">
  <h2 class="wx-related-title">喜欢此内容的人还喜欢</h2>
  <div class="wx-related-grid">
    ${d.related
      .map(
        (r) => `<a class="wx-related-item" href="/post/${esc(r.slug)}">
  ${r.cover ? `<div class="wx-related-cover"><img src="${esc(r.cover)}" loading="lazy" alt=""></div>` : ''}
  <h3>${esc(r.title)}</h3><span>${fmtDateCN(r.published_at)}</span>
</a>`
      )
      .join('')}
  </div>
</section>`
    : ''

  return `<div class="wx-article">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags })}
  <h1 class="wx-title">${esc(p.title)}</h1>
  <div class="wx-meta">
    <a class="wx-meta-avatar" href="/" aria-label="返回首页">${avatar(s)}</a>
    <div class="wx-meta-main">
      <a class="wx-account" href="/">${esc(s.siteName)}</a>
      <span class="wx-date">${fmtDateCN(p.published_at)} · ${p.readingMinutes} 分钟</span>
    </div>
  </div>
  ${p.cover ? `<div class="wx-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
  <article class="rich" id="rich-content">${p.contentHtml}</article>
  ${tagChips || catChip ? `<div class="wx-tags">${catChip}${tagChips}</div>` : ''}
  <div class="wx-actions">
    ${likesBtn(p.slug, p.likes)}
    <a class="wx-action" href="#comments">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 20l1.2-3.2C3.8 15.4 3 13.5 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      留言 <b data-count>${d.comments.count}</b>
    </a>
  </div>
  ${related}
  ${d.comments.html}
  <footer class="wx-footer">${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/admin">管理</a></span></footer>
</div>`
}

export function about(d: {
  settings: SettingsMap
  contentHtml: string
  categories: CategoryLink[]
  tags?: TagCount[]
  navActive?: string
}): string {
  return `<div class="wx-article">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags, active: d.navActive })}
  <h1 class="wx-title">关于我</h1>
  <div class="wx-meta"><a class="wx-meta-avatar" href="/" aria-label="返回首页">${avatar(d.settings)}</a>
    <div class="wx-meta-main"><a class="wx-account" href="/">${esc(d.settings.siteName)}</a></div>
  </div>
  <article class="rich">${d.contentHtml}</article>
  <footer class="wx-footer">${esc(d.settings.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/guestbook">留言板</a><a href="/admin">管理</a></span></footer>
</div>`
}

/** 文章归档页：全部文章按年份分组，日期外置的细线列表 */
export function archives(d: {
  settings: SettingsMap
  categories: CategoryLink[]
  tags?: TagCount[]
  total: number
  groups: ArchiveYearGroup[]
}): string {
  const s = d.settings
  return `<div class="wx-page">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags, active: 'archives' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">文章归档</h1>
    <p class="wb-page-sub">${d.total > 0 ? `写下的每一篇 · 共 ${d.total} 篇` : '写下的每一篇都会收进这里'}</p>
  </header>
  <main class="wx-archives">${archiveListHtml(d.groups) || '<p class="wb-empty">还没有文章，去后台写下第一篇吧。</p>'}</main>
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

/** 留言板页：独立留言墙（复用 .cmt-* 结构与样式） */
export function guestbook(d: {
  settings: SettingsMap
  categories: CategoryLink[]
  tags?: TagCount[]
  html: string
  count: number
}): string {
  const s = d.settings
  return `<div class="wx-page">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags, active: 'guestbook' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">留言板</h1>
    <p class="wb-page-sub">${d.count > 0 ? `已有 ${d.count} 条留言 · 随便聊聊` : '想说点什么，就在这里写下来'}</p>
  </header>
  <main class="wx-guestbook">${d.html}</main>
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

/** 微博页：随手记时间线 */
export function weibo(d: {
  settings: SettingsMap
  categories: CategoryLink[]
  tags?: TagCount[]
  items: WeiboItemView[]
  page: number
  totalPages: number
  total: number
  allowComments: boolean
  adminName?: string
  topic?: string
  topics?: { name: string; count: number }[]
}): string {
  const s = d.settings
  const topicBar = weiboTopicBar(d.topics || [], d.topic)
  const composer = d.adminName ? weiboComposer({ adminName: d.adminName }) : ''
  const cards = weiboCards({
    settings: s,
    items: d.items,
    avatarHtml: avatar(s),
    allowComments: d.allowComments,
    adminName: d.adminName,
  })
  return `<div class="wx-page">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags, active: 'weibo' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">微博</h1>
    <p class="wb-page-sub">${d.topic ? `话题 #${esc(d.topic)} · 共 ${d.total} 条` : d.total > 0 ? `随手记 · 共 ${d.total} 条` : '随手记，想写就写'}</p>
  </header>
  ${topicBar}
  ${composer}
  <main class="wb-list">
    ${cards || `<p class="wb-empty">${d.adminName ? '还没有微博，在上面发第一条吧。' : '还没发过微博，去后台随手写一条吧。'}</p>`}
  </main>
  ${weiboPager(d.page, d.totalPages)}
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

/** 友情链接页：友链卡片 + 申请收录 */
export function links(d: {
  settings: SettingsMap
  categories: CategoryLink[]
  tags?: TagCount[]
  items: FriendLinkView[]
  total: number
}): string {
  const s = d.settings
  return `<div class="wx-page">
  ${siteNav({ cls: 'wx-snav', categories: d.categories, tags: d.tags, active: 'links' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">友情链接</h1>
    <p class="wb-page-sub">${d.total > 0 ? `朋友站点 · 共 ${d.total} 个` : '和朋友交换链接的地方'}</p>
  </header>
  <main class="fl-grid">
    ${friendLinkCards(d.items) || '<p class="wb-empty">还没有友链，去后台添加，或在下方申请收录。</p>'}
  </main>
  ${friendLinkApply()}
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

export { id, css }
