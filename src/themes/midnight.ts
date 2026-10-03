import type { SettingsMap } from '../types'
import { commentsHtml, esc, fmtDate, likesBtn, pagerHtml, tagLink, type HomePostView } from '../render'
import css from './midnight.css'

const id = 'midnight'

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
  <header class="md-header">
    <a class="md-logo" href="/"><span class="md-logo-dot"></span>${esc(s.siteName)}</a>
    <nav class="md-nav">${nav}<a class="md-nav-link" href="/about">关于</a></nav>
  </header>
  <section class="md-hero">
    <h1>${esc(s.siteName)}</h1>
    <p>${esc(s.siteDescription)}</p>
  </section>
  <main class="md-list">
    ${items || '<p class="md-empty">夜航日志还是空的。</p>'}
  </main>
  ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: d.tag ? `/?tag=${encodeURIComponent(d.tag)}&` : '/?' })}
  <footer class="md-footer">
    <span>${esc(s.footerText || '')}</span>
    <span><a href="/rss.xml">RSS</a></span>
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
    ? `<aside class="md-related"><h2>// 继续航行</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}"><span>${esc(r.title)}</span><time>${fmtDate(r.published_at)}</time></a>`)
        .join('')}</aside>`
    : ''
  return `<div class="md-wrap">
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
      <div class="md-tags">${p.tags.map((t) => `<a class="md-chip" href="${tagLink(t)}">${esc(t)}</a>`).join('')}</div>
    </div>
    ${related}
    ${d.comments.html}
  </article>
  <footer class="md-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/rss.xml">RSS</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string }): string {
  return `<div class="md-wrap">
  <header class="md-header"><a class="md-logo" href="/"><span class="md-logo-dot"></span>${esc(d.settings.siteName)}</a></header>
  <article class="md-article">
    <h1 class="md-title">关于</h1>
    <div class="rich">${d.contentHtml}</div>
  </article>
  <footer class="md-footer"><span>${esc(d.settings.footerText || '')}</span><span><a href="/">Home</a></span></footer>
</div>`
}

export { id, css }
