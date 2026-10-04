import type { SettingsMap } from '../types'
import {
  categoryLink,
  esc,
  fmtDate,
  likesBtn,
  pagerHtml,
  siteNav,
  tagLink,
  weiboCards,
  weiboHomeEntry,
  weiboPager,
  weiboTopicBar,
  type CategoryLink,
  type HomePostView,
  type TagCount,
  type WeiboItemView,
} from '../render'
import css from './minimal.css'

const id = 'minimal'

/** 站点头像：设置过 avatarUrl 才展示（极简主题默认不占位） */
function avatar(s: SettingsMap): string {
  return s.avatarUrl ? `<img class="mn-avatar" src="${esc(s.avatarUrl)}" alt="${esc(s.siteName)}">` : ''
}

/** 搜索框：引言与列表之间 */
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
  tags: TagCount[]
  categories: CategoryLink[]
  navActive?: string
  notice?: string
  emptyText?: string
  weibo?: { items: WeiboItemView[]; total: number } | null
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
      <a class="mn-nav-link" href="/about">关于</a>
    </nav>
  </header>
  <p class="mn-intro">${esc(s.siteDescription)}</p>
  ${searchForm(d.q)}
  ${d.notice ? `<div class="mn-notice">${d.notice}</div>` : ''}
  ${d.weibo ? weiboHomeEntry(d.weibo) : ''}
  <main class="mn-list">
    ${items || `<p class="mn-empty">${d.emptyText || 'Nothing here yet. Start writing.'}</p>`}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
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

export function about(d: { settings: SettingsMap; contentHtml: string; categories: CategoryLink[]; tags?: TagCount[] }): string {
  return `<div class="mn-wrap">
  ${siteNav({ cls: 'mn-snav', categories: d.categories, tags: d.tags })}
  <header class="mn-header"><a class="mn-logo" href="/">← ${esc(d.settings.siteName)}</a></header>
  <article class="mn-article">
    <h1 class="mn-title">关于</h1>
    <div class="rich">${d.contentHtml}</div>
  </article>
  <footer class="mn-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/">Home</a><a href="/weibo">微博</a><a href="/admin">管理</a></span></footer>
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
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/weibo">微博</a><a class="mn-nav-link" href="/about">关于</a></nav>
  </header>
  ${topicBar}
  <main class="wb-list">
    ${cards || '<p class="wb-empty">Nothing here yet.</p>'}
  </main>
  ${weiboPager(d.page, d.totalPages)}
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

export { id, css }
