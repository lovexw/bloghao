import type { SettingsMap } from '../types'
import { commentsHtml, esc, fmtDate, likesBtn, pagerHtml, tagLink, type HomePostView } from '../render'
import css from './minimal.css'

const id = 'minimal'

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
  const nav = d.hotTags
    .slice(0, 6)
    .map((t) => `<a class="mn-nav-link${t === d.tag ? ' is-active' : ''}" href="${tagLink(t)}">${esc(t)}</a>`)
    .join('')
  return `<div class="mn-wrap">
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav">
      ${nav}
      <a class="mn-nav-link" href="/about">关于</a>
    </nav>
  </header>
  <p class="mn-intro">${esc(s.siteDescription)}</p>
  <main class="mn-list">
    ${items || '<p class="mn-empty">Nothing here yet. Start writing.</p>'}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
  <footer class="mn-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
  const p = d.post
  const related = d.related.length
    ? `<aside class="mn-related"><h2>继续读</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}">${esc(r.title)}</a>`)
        .join('')}</aside>`
    : ''
  return `<div class="mn-wrap">
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
      <div class="mn-tags">${p.tags.map((t) => `<a href="${tagLink(t)}">${esc(t)}</a>`).join('')}</div>
    </div>
    ${related}
    ${d.comments.html}
  </article>
  <footer class="mn-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/admin">管理</a><a href="/rss.xml">RSS</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string }): string {
  return `<div class="mn-wrap">
  <header class="mn-header"><a class="mn-logo" href="/">← ${esc(d.settings.siteName)}</a></header>
  <article class="mn-article">
    <h1 class="mn-title">关于</h1>
    <div class="rich">${d.contentHtml}</div>
  </article>
  <footer class="mn-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/">Home</a><a href="/admin">管理</a></span></footer>
</div>`
}

export { id, css }
