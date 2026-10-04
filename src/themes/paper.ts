import type { SettingsMap } from '../types'
import type { PostSort } from '../db'
import {
  categoryLink,
  esc,
  fmtDate,
  friendLinkApply,
  friendLinkCards,
  homeListBase,
  homeSortBar,
  likesBtn,
  pagerHtml,
  siteNav,
  tagLink,
  weiboCards,
  weiboHomeEntry,
  weiboPager,
  weiboTopicBar,
  type CategoryLink,
  type FriendLinkView,
  type HomePostView,
  type TagCount,
  type WeiboItemView,
} from '../render'
import css from './paper.css'

const id = 'paper'

/** 印章位头像：设置过 avatarUrl 用图片，否则退回站名首字印章 */
function seal(s: SettingsMap): string {
  if (s.avatarUrl) {
    return `<img class="pp-seal pp-seal-img" src="${esc(s.avatarUrl)}" alt="${esc(s.siteName)}">`
  }
  const ch = (s.siteName || '墨').trim().charAt(0) || '墨'
  return `<span class="pp-seal" aria-hidden="true">${esc(ch)}</span>`
}

/** 搜索框：微博卡与文章列表之间 */
function searchForm(q: string | undefined): string {
  return `<form class="pp-search" action="/search" method="get" role="search">
  <input class="pp-search-input" type="search" name="q" value="${esc(q || '')}" placeholder="检索站内文章…" maxlength="60" aria-label="搜索文章">
  <button class="pp-search-btn" type="submit">检索</button>
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

  return `<div class="pp-page">
  ${siteNav({ cls: 'pp-snav', categories: d.categories, tags: d.tags, active: d.navActive })}
  <header class="pp-masthead">
    ${seal(s)}
    <h1 class="pp-site-name">${esc(s.siteName)}</h1>
    <p class="pp-site-desc">${esc(s.siteDescription)}</p>
  </header>
  ${d.notice ? `<div class="pp-notice">${d.notice}</div>` : ''}
  ${d.weibo ? weiboHomeEntry(d.weibo) : ''}
  ${searchForm(d.q)}
  ${homeSortBar({ sort: d.sort, seed: d.seed, tag: d.tag, categorySlug: d.categorySlug, q: d.q })}
  <main class="pp-list">
    ${items || `<p class="pp-empty">${d.emptyText || '纸上还无字，正是落笔时。'}</p>`}
  </main>
  ${pagerHtml({
    page: d.page,
    totalPages: d.totalPages,
    base: homeListBase({ sort: d.sort, seed: d.seed, tag: d.tag, categorySlug: d.categorySlug, q: d.q }),
  })}
  <footer class="pp-footer">
    ${esc(s.footerText || '')}<span class="pp-footer-links"><a href="/weibo">微博</a><a href="/about">关于</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span>
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
    ? `<section class="pp-related"><h2>延伸阅读</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}">${esc(r.title)}<time>${fmtDate(r.published_at)}</time></a>`)
        .join('')}</section>`
    : ''
  return `<div class="pp-page">
  ${siteNav({ cls: 'pp-snav', categories: d.categories, tags: d.tags })}
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
      ${d.category ? `<a class="pp-tag pp-cat" href="${categoryLink(d.category)}">${esc(d.category.name)}</a>` : ''}
      ${p.tags.map((t) => `<a class="pp-tag" href="${tagLink(t)}">${esc(t)}</a>`).join('')}
    </div>
    ${related}
    ${d.comments.html}
  </article>
  <footer class="pp-footer">${esc(d.settings.footerText || '')}<span class="pp-footer-links"><a href="/about">关于</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span></footer>
</div>`
}

export function about(d: { settings: SettingsMap; contentHtml: string; categories: CategoryLink[]; tags?: TagCount[] }): string {
  return `<div class="pp-page">
  ${siteNav({ cls: 'pp-snav', categories: d.categories, tags: d.tags })}
  <article class="pp-article">
    <h1 class="pp-title">关于</h1>
    <div class="pp-body rich">${d.contentHtml}</div>
  </article>
  <footer class="pp-footer">${esc(d.settings.footerText || '')}<span class="pp-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/admin">管理</a></span></footer>
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
    avatarHtml: seal(s),
    allowComments: d.allowComments,
    adminName: d.adminName,
  })
  return `<div class="pp-page">
  ${siteNav({ cls: 'pp-snav', categories: d.categories, tags: d.tags, active: 'weibo' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">微博</h1>
    <p class="wb-page-sub">${d.topic ? `话题 #${esc(d.topic)} · 共 ${d.total} 则` : d.total > 0 ? `随手记 · 共 ${d.total} 则` : '随手记，想写就写'}</p>
  </header>
  ${topicBar}
  <main class="wb-list">
    ${cards || '<p class="wb-empty">纸上还无微博，正是落笔时。</p>'}
  </main>
  ${weiboPager(d.page, d.totalPages)}
  <footer class="pp-footer">${esc(s.footerText || '')}<span class="pp-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span></footer>
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
  return `<div class="pp-page">
  ${siteNav({ cls: 'pp-snav', categories: d.categories, tags: d.tags, active: 'links' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">友情链接</h1>
    <p class="wb-page-sub">${d.total > 0 ? `朋友站点 · 共 ${d.total} 个` : '和朋友交换链接的地方'}</p>
  </header>
  <main class="fl-grid">
    ${friendLinkCards(d.items) || '<p class="wb-empty">纸上暂无友链，去后台添加，或在下方申请收录。</p>'}
  </main>
  ${friendLinkApply()}
  <footer class="pp-footer">${esc(s.footerText || '')}<span class="pp-footer-links"><a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a></span></footer>
</div>`
}

export { id, css }
