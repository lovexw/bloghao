import type { SettingsMap } from '../types'
import type { PostSort } from '../db'
import {
  archiveListHtml,
  categoryLink,
  esc,
  fmtDate,
  friendLinkApply,
  friendLinkCards,
  homeListBase,
  homeSortBar,
  likesBtn,
  onThisDayCard,
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
  type OnThisDayItemView,
  type TagCount,
  type WeiboItemView,
} from '../render'
import css from './minimal.css'

const id = 'minimal'

/** 站点头像：设置过 avatarUrl 才展示（极简主题默认不占位） */
function avatar(s: SettingsMap): string {
  return s.avatarUrl ? `<img class="mn-avatar" src="${esc(s.avatarUrl)}" alt="${esc(s.siteName)}">` : ''
}

/** 搜索框：微博卡与列表之间 */
function searchForm(q: string | undefined): string {
  return `<form class="mn-search" action="/search" method="get" role="search">
  <input class="mn-search-input" type="search" name="q" value="${esc(q || '')}" placeholder="Search…" maxlength="60" aria-label="搜索文章">
  <button class="mn-search-btn" type="submit">搜索</button>
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
  onThisDay?: OnThisDayItemView[] | null
}): string {
  const s = d.settings
  const items = d.posts
    .map(
      (p) => `<a class="mn-item" href="/post/${esc(p.slug)}">
  <div class="mn-item-main">
    <h2 class="mn-item-title">${esc(p.title)}${p.pinned ? '<sup class="mn-pin">TOP</sup>' : ''}</h2>
    <p class="mn-item-abs">${esc(p.summary)}</p>
  </div>
  ${p.cover ? `<div class="mn-thumb"><img src="${esc(p.cover)}" loading="lazy" alt=""></div>` : ''}
</a>`
    )
    .join('\n')
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags, active: d.navActive })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${avatar(s)}${esc(s.siteName)}</a>
    <nav class="mn-nav">
      <a class="mn-nav-link" href="/about">关于我</a>
    </nav>
  </header>
  <p class="mn-intro">${esc(s.siteDescription)}</p>
  ${d.notice ? `<div class="mn-notice">${d.notice}</div>` : ''}
  ${d.weibo ? weiboHomeEntry(d.weibo) : ''}
  ${onThisDayCard(d.onThisDay)}
  ${searchForm(d.q)}
  ${homeSortBar({ sort: d.sort, seed: d.seed, tag: d.tag, categorySlug: d.categorySlug, q: d.q })}
  <main class="mn-list">
    ${items || `<p class="mn-empty">${d.emptyText || 'Nothing here yet. Start writing.'}</p>`}
  </main>
  ${pagerHtml({
    page: d.page,
    totalPages: d.totalPages,
    base: homeListBase({ sort: d.sort, seed: d.seed, tag: d.tag, categorySlug: d.categorySlug, q: d.q }),
  })}
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
  tags?: TagCount[]
  comments: { html: string; count: number }
  related: HomePostView[]
}): string {
  const p = d.post
  const related = d.related.length
    ? `<aside class="mn-related"><h2>继续读</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}">${esc(r.title)}</a>`)
        .join('')}</aside>`
    : ''
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags })}
  <header class="mn-header">
    <a class="mn-logo" href="/">← ${esc(d.settings.siteName)}</a>
  </header>
  <article class="mn-article">
    <h1 class="mn-title">${esc(p.title)}</h1>
    <div class="mn-meta"><time>${fmtDate(p.published_at)}</time><span>·</span><span>${p.readingMinutes} min</span><span>·</span><span>${p.views} views</span></div>
    ${p.cover ? `<div class="mn-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
    <div class="rich">${p.contentHtml}</div>
    <div class="mn-foot">
      ${likesBtn(p.slug, p.likes)}
      <div class="mn-tags">${d.category ? `<a href="${categoryLink(d.category)}">${esc(d.category.name)}</a>` : ''}${p.tags.map((t) => `<a href="${tagLink(t)}">${esc(t)}</a>`).join('')}</div>
    </div>
    ${related}
    ${d.comments.html}
  </article>
  <footer class="mn-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/weibo">微博</a><a href="/admin">管理</a><a href="/rss.xml">RSS</a></span></footer>
</div>`
}

export function about(d: {
  settings: SettingsMap
  contentHtml: string
  categories: CategoryLink[]
  tags?: TagCount[]
  navActive?: string
}): string {
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags, active: d.navActive })}
  <header class="mn-header"><a class="mn-logo" href="/">← ${esc(d.settings.siteName)}</a></header>
  <article class="mn-article">
    <h1 class="mn-title">关于我</h1>
    <div class="rich">${d.contentHtml}</div>
  </article>
  <footer class="mn-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/">Home</a><a href="/weibo">微博</a><a href="/admin">管理</a></span></footer>
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
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags, active: 'archives' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/archives">归档</a><a class="mn-nav-link" href="/guestbook">留言板</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <h1 class="mn-title mn-page-title">归档</h1>
  <p class="mn-intro">${d.total > 0 ? `共 ${d.total} 篇 · 按年份倒序` : '写下的每一篇都会收进这里'}</p>
  <main class="mn-archives">${archiveListHtml(d.groups) || '<p class="mn-empty">Nothing here yet. Start writing.</p>'}</main>
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags, active: 'guestbook' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link" href="/archives">归档</a><a class="mn-nav-link is-active" href="/guestbook">留言板</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <h1 class="mn-title mn-page-title">留言板</h1>
  <p class="mn-intro">${d.count > 0 ? `已有 ${d.count} 条留言 · 随便聊聊` : '想说点什么，就在这里写下来'}</p>
  <main>${d.html}</main>
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags, active: 'weibo' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${avatar(s)}${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/weibo">微博</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  ${topicBar}
  ${composer}
  <main class="wb-list">
    ${cards || `<p class="wb-empty">${d.adminName ? 'Nothing here yet — post the first one above.' : 'Nothing here yet.'}</p>`}
  </main>
  ${weiboPager(d.page, d.totalPages)}
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags, active: 'links' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${avatar(s)}${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/links">友链</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <main class="fl-grid">
    ${friendLinkCards(d.items) || '<p class="wb-empty">No links yet.</p>'}
  </main>
  ${friendLinkApply()}
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

export { id, css }
