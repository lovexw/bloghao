import type { SettingsMap } from '../types'
import {
  categoryLink,
  commentsHtml,
  esc,
  fmtDate,
  fmtDateCN,
  likesBtn,
  pagerHtml,
  siteNav,
  tagLink,
  type CategoryLink,
  type HomePostView,
} from '../render'
import css from './wechat.css'

const id = 'wechat'

function avatar(name: string): string {
  const ch = (name || '博').trim().charAt(0) || '博'
  return `<span class="wx-avatar" aria-hidden="true">${esc(ch)}</span>`
}

/** 刊头下的文字导航：全部 / 热门标签（分类、搜索走顶部站点导航） */
function mastheadNav(activeTag: string | undefined, tags: string[]): string {
  if (!activeTag && !tags.length) return ''
  const link = (href: string, label: string, active = false) =>
    `<a class="wx-nav-link${active ? ' is-active' : ''}" href="${href}">${esc(label)}</a>`
  const links = [
    link('/', '全部', !activeTag),
    ...tags.slice(0, 5).map((t) => link(tagLink(t), t, t === activeTag)),
  ]
  return `<nav class="wx-nav">${links.join('')}</nav>`
}

export function home(d: {
  settings: SettingsMap
  posts: HomePostView[]
  page: number
  totalPages: number
  total: number
  tag?: string
  hotTags: string[]
  categories: CategoryLink[]
  navActive?: string
  notice?: string
  emptyText?: string
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
  ${siteNav({ cls: 'wx-snav', categories: d.categories, active: d.navActive })}
  <header class="wx-masthead">
    ${avatar(s.siteName)}
    <h1 class="wx-masthead-name">${esc(s.siteName)}</h1>
    ${s.siteDescription ? `<p class="wx-masthead-desc">${esc(s.siteDescription)}</p>` : ''}
    ${mastheadNav(d.tag, d.hotTags)}
  </header>
  ${d.notice ? `<div class="wx-notice">${d.notice}</div>` : ''}
  <main class="wx-feed">
    ${items || `<p class="wx-empty">${d.emptyText || '还没有文章，快去后台写下第一篇吧。'}</p>`}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/about">关于</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
  ${siteNav({ cls: 'wx-snav', categories: d.categories })}
  <h1 class="wx-title">${esc(p.title)}</h1>
  <div class="wx-meta">
    <a class="wx-meta-avatar" href="/" aria-label="返回首页">${avatar(s.siteName)}</a>
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
  <footer class="wx-footer">${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/about">关于</a><a href="/admin">管理</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string; categories: CategoryLink[] }): string {
  return `<div class="wx-article">
  ${siteNav({ cls: 'wx-snav', categories: d.categories })}
  <h1 class="wx-title">关于</h1>
  <div class="wx-meta"><a class="wx-meta-avatar" href="/" aria-label="返回首页">${avatar(d.settings.siteName)}</a>
    <div class="wx-meta-main"><a class="wx-account" href="/">${esc(d.settings.siteName)}</a></div>
  </div>
  <article class="rich">${d.contentHtml}</article>
  <footer class="wx-footer">${esc(d.settings.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/admin">管理</a></span></footer>
</div>`
}

export { id, css }
