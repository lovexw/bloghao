import type { SettingsMap } from '../types'
import {
  commentsHtml,
  esc,
  fmtDateCN,
  likesBtn,
  pagerHtml,
  tagLink,
  type HomePostView,
} from '../render'
import css from './wechat.css'

const id = 'wechat'

function avatar(name: string): string {
  const ch = (name || '博').trim().charAt(0) || '博'
  return `<span class="wx-avatar" aria-hidden="true">${esc(ch)}</span>`
}

function tabs(settings: SettingsMap, activeTag?: string, tags: string[] = []): string {
  const t = tags
    .slice(0, 6)
    .map(
      (tag) =>
        `<a class="wx-tab${tag === activeTag ? ' is-active' : ''}" href="${tagLink(tag)}">${esc(tag)}</a>`
    )
    .join('')
  return `<nav class="wx-tabs">
  <a class="wx-tab${!activeTag ? ' is-active' : ''}" href="/">全部</a>
  ${t}
</nav>`
}

export function home(d: {
  settings: SettingsMap
  posts: HomePostView[]
  page: number
  totalPages: number
  total: number
  tag?: string
  hotTags: string[]
}): string {
  const s = d.settings
  const items = d.posts
    .map((p) => {
      const meta: string[] = [fmtDateCN(p.published_at)]
      if (p.views > 0) meta.push(`${p.views} 次阅读`)
      if (p.commentCount) meta.push(`${p.commentCount} 条留言`)
      return `<a class="wx-item" href="/post/${esc(p.slug)}">
  <div class="wx-item-main">
    <h2 class="wx-item-title">${esc(p.title)}</h2>
    <p class="wx-item-abs">${esc(p.summary)}</p>
    <div class="wx-item-meta"><span>${meta.join(' · ')}</span>${p.pinned ? '<b class="wx-pin">置顶</b>' : ''}</div>
  </div>
  ${p.cover ? `<div class="wx-thumb"><img src="${esc(p.cover)}" loading="lazy" alt=""></div>` : ''}
</a>`
    })
    .join('\n')

  return `<div class="wx-page">
  <header class="wx-profile">
    ${avatar(s.siteName)}
    <div class="wx-profile-main">
      <h1 class="wx-name">${esc(s.siteName)}</h1>
      <p class="wx-desc">${esc(s.siteDescription)}</p>
    </div>
  </header>
  ${tabs(s, d.tag, d.hotTags)}
  <main class="wx-feed">
    ${items || '<p class="wx-empty">还没有文章，快去后台写下第一篇吧。</p>'}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
  <footer class="wx-footer">
    ${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/about">关于</a><a href="/rss.xml">RSS</a></span>
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
  comments: { html: string; count: number }
  related: HomePostView[]
}): string {
  const s = d.settings
  const p = d.post
  const tagChips = p.tags
    .map((t) => `<a class="wx-tag" href="${tagLink(t)}"># ${esc(t)}</a>`)
    .join('')
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
  <h1 class="wx-title">${esc(p.title)}</h1>
  <div class="wx-meta">
    ${avatar(s.siteName)}
    <div class="wx-meta-main">
      <span class="wx-account">${esc(s.siteName)}</span>
      <span class="wx-date">${fmtDateCN(p.published_at)} · ${p.readingMinutes} 分钟</span>
    </div>
  </div>
  ${p.cover ? `<div class="wx-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
  <article class="rich" id="rich-content">${p.contentHtml}</article>
  ${tagChips ? `<div class="wx-tags">${tagChips}</div>` : ''}
  <div class="wx-actions">
    ${likesBtn(p.slug, p.likes)}
    <a class="wx-action" href="#comments">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 20l1.2-3.2C3.8 15.4 3 13.5 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      留言 <b data-count>${d.comments.count}</b>
    </a>
  </div>
  ${related}
  ${d.comments.html}
  <footer class="wx-footer">${esc(s.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a><a href="/about">关于</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string }): string {
  return `<div class="wx-article">
  <h1 class="wx-title">关于</h1>
  <div class="wx-meta">${avatar(d.settings.siteName)}
    <div class="wx-meta-main"><span class="wx-account">${esc(d.settings.siteName)}</span></div>
  </div>
  <article class="rich">${d.contentHtml}</article>
  <footer class="wx-footer">${esc(d.settings.footerText || '')}<span class="wx-footer-links"><a href="/">回主页</a></span></footer>
</div>`
}

export { id, css }
