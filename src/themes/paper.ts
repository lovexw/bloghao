import type { SettingsMap } from '../types'
import { commentsHtml, esc, fmtDate, likesBtn, pagerHtml, tagLink, type HomePostView } from '../render'
import css from './paper.css'

const id = 'paper'

function seal(name: string): string {
  const ch = (name || '墨').trim().charAt(0) || '墨'
  return `<span class="pp-seal" aria-hidden="true">${esc(ch)}</span>`
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
    .map(
      (p) => `<a class="pp-item" href="/post/${esc(p.slug)}">
  <div class="pp-item-main">
    <h2 class="pp-item-title">${esc(p.title)}</h2>
    <p class="pp-item-abs">${esc(p.summary)}</p>
    <div class="pp-item-meta">
      <time>${fmtDate(p.published_at)}</time>
      ${p.tags.slice(0, 3).map((t) => `<span class="pp-tag">${esc(t)}</span>`).join('')}
      ${p.pinned ? '<span class="pp-pin">置顶</span>' : ''}
    </div>
  </div>
  ${p.cover ? `<div class="pp-thumb"><img src="${esc(p.cover)}" loading="lazy" alt=""></div>` : ''}
</a>`
    )
    .join('\n')

  const tags = d.hotTags
    .slice(0, 8)
    .map((t) => `<a class="pp-nav-tag${t === d.tag ? ' is-active' : ''}" href="${tagLink(t)}">${esc(t)}</a>`)
    .join('')

  return `<div class="pp-page">
  <header class="pp-masthead">
    ${seal(s.siteName)}
    <h1 class="pp-site-name">${esc(s.siteName)}</h1>
    <p class="pp-site-desc">${esc(s.siteDescription)}</p>
  </header>
  ${tags ? `<nav class="pp-nav">${tags}</nav>` : ''}
  <main class="pp-list">
    ${items || '<p class="pp-empty">纸上还无字，正是落笔时。</p>'}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
  <footer class="pp-footer">
    ${esc(s.footerText || '')}<span class="pp-footer-links"><a href="/about">关于</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
    ? `<section class="pp-related"><h2>延伸阅读</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}">${esc(r.title)}<time>${fmtDate(r.published_at)}</time></a>`)
        .join('')}</section>`
    : ''
  return `<div class="pp-page">
  <header class="pp-crumbs"><a href="/">← 回到首页</a></header>
  <article class="pp-article">
    <h1 class="pp-title">${esc(p.title)}</h1>
    <div class="pp-meta"><time>${fmtDate(p.published_at)}</time><span>·</span><span>${p.readingMinutes} 分钟读完</span><span>·</span><span>${p.views} 次阅读</span></div>
    ${p.cover ? `<div class="pp-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
    <div class="pp-body rich">${p.contentHtml}</div>
    <div class="pp-end">
      <span class="pp-end-line"></span><span class="pp-end-word">终</span><span class="pp-end-line"></span>
    </div>
    <div class="pp-actions">
      ${likesBtn(p.slug, p.likes)}
      ${p.tags.map((t) => `<a class="pp-tag" href="${tagLink(t)}">${esc(t)}</a>`).join('')}
    </div>
    ${related}
    ${d.comments.html}
  </article>
  <footer class="pp-footer">${esc(d.settings.footerText || '')}<span class="pp-footer-links"><a href="/about">关于</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string }): string {
  return `<div class="pp-page">
  <header class="pp-crumbs"><a href="/">← 回到首页</a></header>
  <article class="pp-article">
    <h1 class="pp-title">关于</h1>
    <div class="pp-body rich">${d.contentHtml}</div>
  </article>
  <footer class="pp-footer">${esc(d.settings.footerText || '')}<span class="pp-footer-links"><a href="/">回主页</a><a href="/admin">管理</a></span></footer>
</div>`
}

export { id, css }
