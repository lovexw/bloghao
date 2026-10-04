import type { SettingsMap } from '../types'
import {
  categoryLink,
  commentsHtml,
  esc,
  fmtDate,
  likesBtn,
  pagerHtml,
  siteNav,
  tagLink,
  weiboCards,
  weiboPager,
  type CategoryLink,
  type HomePostView,
  type WeiboItemView,
} from '../render'
import css from './midnight.css'

const id = 'midnight'

/** 站点头像：设置过 avatarUrl 用图片，否则退回呼吸圆点 */
function logoMark(s: SettingsMap): string {
  return s.avatarUrl
    ? `<img class="md-logo-avatar" src="${esc(s.avatarUrl)}" alt="${esc(s.siteName)}">`
    : '<span class="md-logo-dot"></span>'
}

/** 搜索框：hero 之内、正文列表之上 */
function searchForm(q: string | undefined): string {
  return `<form class="md-search" action="/search" method="get" role="search">
  <svg class="md-search-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>
  <input class="md-search-input" type="search" name="q" value="${esc(q || '')}" placeholder="grep 站内文章…" maxlength="60" aria-label="搜索文章">
  <button class="md-search-btn" type="submit">搜索</button>
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
  hotTags: string[]
  categories: CategoryLink[]
  navActive?: string
  notice?: string
  emptyText?: string
}): string {
  const s = d.settings
  const items = d.posts
    .map(
      (p) => `<a class="md-card" href="/post/${esc(p.slug)}">
  ${p.cover ? `<div class="md-card-cover"><img src="${esc(p.cover)}" loading="lazy" alt=""></div>` : ''}
  <div class="md-card-body">
    <h2 class="md-card-title">${esc(p.title)}${p.pinned ? '<span class="md-pin">PINNED</span>' : ''}</h2>
    <p class="md-card-abs">${esc(p.summary)}</p>
    <div class="md-card-meta"><time>${fmtDate(p.published_at)}</time><span>·</span><span>${p.views} 阅读</span>${p.tags.slice(0, 2).map((t) => `<span class="md-chip">${esc(t)}</span>`).join('')}</div>
  </div>
</a>`
    )
    .join('\n')
  const nav = d.hotTags
    .slice(0, 6)
    .map((t) => `<a class="md-nav-link${t === d.tag ? ' is-active' : ''}" href="${tagLink(t)}">${esc(t)}</a>`)
    .join('')
  return `<div class="md-wrap">
  ${siteNav({ cls: 'md-snav', categories: d.categories, active: d.navActive })}
  <header class="md-header">
    <a class="md-logo" href="/">${logoMark(s)}${esc(s.siteName)}</a>
    <nav class="md-nav">${nav}<a class="md-nav-link" href="/about">关于</a></nav>
  </header>
  <section class="md-hero">
    <h1>${esc(s.siteName)}</h1>
    <p>${esc(s.siteDescription)}</p>
    ${searchForm(d.q)}
  </section>
  ${d.notice ? `<div class="md-notice">${d.notice}</div>` : ''}
  <main class="md-list">
    ${items || `<p class="md-empty">${d.emptyText || '夜航日志还是空的。'}</p>`}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
  <footer class="md-footer">
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
  comments: { html: string; count: number }
  related: HomePostView[]
}): string {
  const p = d.post
  const related = d.related.length
    ? `<aside class="md-related"><h2>// 继续航行</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}"><span>${esc(r.title)}</span><time>${fmtDate(r.published_at)}</time></a>`)
        .join('')}</aside>`
    : ''
  return `<div class="md-wrap">
  ${siteNav({ cls: 'md-snav', categories: d.categories })}
  <header class="md-header">
    <a class="md-logo" href="/"><span class="md-logo-dot"></span>${esc(d.settings.siteName)}</a>
  </header>
  <article class="md-article">
    <div class="md-crumb"><time>${fmtDate(p.published_at)}</time><span>·</span><span>${p.readingMinutes} 分钟</span><span>·</span><span>${p.views} 阅读</span></div>
    <h1 class="md-title">${esc(p.title)}</h1>
    ${p.cover ? `<div class="md-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
    <div class="rich">${p.contentHtml}</div>
    <div class="md-foot">
      ${likesBtn(p.slug, p.likes)}
      <div class="md-tags">${d.category ? `<a class="md-chip" href="${categoryLink(d.category)}">${esc(d.category.name)}</a>` : ''}${p.tags.map((t) => `<a class="md-chip" href="${tagLink(t)}">${esc(t)}</a>`).join('')}</div>
    </div>
    ${related}
    ${d.comments.html}
  </article>
  <footer class="md-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/weibo">微博</a><a href="/admin">管理</a><a href="/rss.xml">RSS</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string; categories: CategoryLink[] }): string {
  return `<div class="md-wrap">
  ${siteNav({ cls: 'md-snav', categories: d.categories })}
  <header class="md-header"><a class="md-logo" href="/">${logoMark(d.settings)}${esc(d.settings.siteName)}</a></header>
  <article class="md-article">
    <h1 class="md-title">关于</h1>
    <div class="rich">${d.contentHtml}</div>
  </article>
  <footer class="md-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/">Home</a><a href="/weibo">微博</a><a href="/admin">管理</a></span></footer>
</div>`
}

/** 微博页：随手记时间线 */
export function weibo(d: {
  settings: SettingsMap
  categories: CategoryLink[]
  items: WeiboItemView[]
  page: number
  totalPages: number
  total: number
  allowComments: boolean
}): string {
  const s = d.settings
  const cards = weiboCards({ settings: s, items: d.items, avatarHtml: logoMark(s), allowComments: d.allowComments })
  return `<div class="md-wrap">
  ${siteNav({ cls: 'md-snav', categories: d.categories, active: 'weibo' })}
  <header class="md-header">
    <a class="md-logo" href="/">${logoMark(s)}${esc(s.siteName)}</a>
    <nav class="md-nav"><a class="md-nav-link is-active" href="/weibo">weibo</a><a class="md-nav-link" href="/about">关于</a></nav>
  </header>
  <section class="md-hero md-hero-slim">
    <h1>微博</h1>
    <p>${d.total > 0 ? `随手记 · 共 ${d.total} 条` : '随手记，想写就写'}</p>
  </section>
  <main class="md-list wb-list">
    ${cards || '<p class="md-empty wb-empty">夜航微博还是空的。</p>'}
  </main>
  ${weiboPager(d.page, d.totalPages)}
  <footer class="md-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
  </footer>
</div>`
}

export { id, css }
