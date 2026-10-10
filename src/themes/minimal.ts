import type { SettingsMap } from '../types'
import type { AboutData, ArchivesData, GuestbookData, HomeData, LinksData, MemberData, PageData, PostData, RankData, WeiboData } from './registry'
import {
  archiveListHtml,
  categoryLink,
  esc,
  footLinks,
  fmtDate,
  friendLinkApply,
  friendLinkCards,
  homeListBase,
  homeSortBar,
  likesBtn,
  memberAuthHtml,
  memberCardHtml,
  onThisDayCard,
  pagerHtml,
  paywallHtml,
  rankListHtml,
  shareBtn,
  siteMode,
  siteNav,
  tagLink,
  weiboCards,
  weiboComposer,
  weiboHomeEntry,
  weiboHomeFeed,
  weiboSearchResults,
  weiboPager,
  weiboTopicBar,
} from '../render'
import css from './minimal.css'

const id = 'minimal'

/** 页脚公共件：八个页面只差链接组，结构统一在这里 */
function foot(s: SettingsMap, links: string): string {
  return `<footer class="mn-footer"><span>${esc(s.footerText || '')}</span><span>${footLinks(s, links)}</span></footer>`
}
const FOOT_LINKS = {
  home: '<a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a>',
  article: '<a href="/weibo">微博</a><a href="/admin">管理</a><a href="/rss.xml">RSS</a>',
  about: '<a href="/">Home</a><a href="/weibo">微博</a><a href="/admin">管理</a>',
}

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

export function home(d: HomeData): string {
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
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: d.navActive })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${avatar(s)}${esc(s.siteName)}</a>
    <nav class="mn-nav">
      <a class="mn-nav-link" href="/about">关于我</a>
    </nav>
  </header>
  <p class="mn-intro">${esc(s.siteDescription)}</p>
  ${d.notice ? `<div class="mn-notice">${d.notice}</div>` : ''}
  ${d.weiboFeed ? weiboHomeFeed({ settings: s, items: d.weiboFeed.items, total: d.weiboFeed.total, avatarHtml: avatar(s), allowComments: d.weiboFeed.allowComments, adminName: d.weiboFeed.adminName, memberName: d.weiboFeed.memberName }) : ''}
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
  ${d.searchWeibo ? weiboSearchResults({ settings: s, items: d.searchWeibo.items, total: d.searchWeibo.total, avatarHtml: avatar(s) }) : ''}
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

export function post(d: PostData): string {
  const p = d.post
  const related = d.related.length
    ? `<aside class="mn-related"><h2>继续读</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}">${esc(r.title)}</a>`)
        .join('')}</aside>`
    : ''
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages })}
  <header class="mn-header">
    <a class="mn-logo" href="/">← ${esc(d.settings.siteName)}</a>
  </header>
  <article class="mn-article">
    <h1 class="mn-title">${esc(p.title)}</h1>
    <div class="mn-meta"><time>${fmtDate(p.published_at)}</time><span>·</span><span>${p.readingMinutes} min</span><span>·</span><span>${p.views} views</span></div>
    ${p.cover ? `<div class="mn-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
    <div class="rich">${p.contentHtml}</div>
    ${p.locked ? paywallHtml(p.minTier) : ''}
    <div class="mn-foot">
      ${likesBtn(p.slug, p.likes)}
      ${d.share ? shareBtn(d.share.url, d.share.qr) : ''}
      <div class="mn-tags">${d.category ? `<a href="${categoryLink(d.category)}">${esc(d.category.name)}</a>` : ''}${p.tags.map((t) => `<a href="${tagLink(t)}">${esc(t)}</a>`).join('')}</div>
    </div>
    ${related}
    ${d.comments.html}
  </article>
  ${foot(d.settings, FOOT_LINKS.article)}
</div>`
}

export function about(d: AboutData): string {
  return page({ ...d, title: '关于我' })
}

/** 独立页面页（/page/:slug，slug='about' 时渲染 /about）：结构同关于我，标题由页面数据决定 */
export function page(d: PageData): string {
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: d.navActive })}
  <header class="mn-header"><a class="mn-logo" href="/">← ${esc(d.settings.siteName)}</a></header>
  <article class="mn-article">
    <h1 class="mn-title">${esc(d.title)}</h1>
    <div class="rich">${d.contentHtml}</div>
  </article>
  ${foot(d.settings, FOOT_LINKS.about)}
</div>`
}

/** 文章归档页：全部文章按年份分组，日期外置的细线列表 */
export function archives(d: ArchivesData): string {
  const s = d.settings
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'archives' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/archives">归档</a><a class="mn-nav-link" href="/guestbook">留言板</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <h1 class="mn-title mn-page-title">归档</h1>
  <p class="mn-intro">${d.total > 0 ? `共 ${d.total} 篇 · 按年份倒序` : '写下的每一篇都会收进这里'}</p>
  <main class="mn-archives">${archiveListHtml(d.groups) || '<p class="mn-empty">Nothing here yet. Start writing.</p>'}</main>
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

/** 留言板页：独立留言墙（复用 .cmt-* 结构与样式） */
export function guestbook(d: GuestbookData): string {
  const s = d.settings
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'guestbook' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link" href="/archives">归档</a><a class="mn-nav-link is-active" href="/guestbook">留言板</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <h1 class="mn-title mn-page-title">留言板</h1>
  <p class="mn-intro">${d.count > 0 ? `已有 ${d.count} 条留言 · 随便聊聊` : '想说点什么，就在这里写下来'}</p>
  <main>${d.html}</main>
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

/** 微博页：随手记时间线 */
export function weibo(d: WeiboData): string {
  const s = d.settings
  const topicBar = weiboTopicBar(d.topics || [], d.topic)
  const composer = d.adminName ? weiboComposer({ adminName: d.adminName }) : ''
  const cards = weiboCards({
    settings: s,
    items: d.items,
    avatarHtml: avatar(s),
    allowComments: d.allowComments,
    adminName: d.adminName,
    memberName: d.memberName,
  })
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'weibo' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${avatar(s)}${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/weibo">微博</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  ${topicBar}
  ${composer}
  <main class="wb-list">
    ${cards || `<p class="wb-empty">${d.adminName ? 'Nothing here yet — post the first one above.' : 'Nothing here yet.'}</p>`}
  </main>
  ${weiboPager(d.page, d.totalPages, d.topic)}
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

/** 友情链接页：友链卡片 + 申请收录 */
export function links(d: LinksData): string {
  const s = d.settings
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'links' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${avatar(s)}${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/links">友链</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <main class="fl-grid">
    ${friendLinkCards(d.items) || '<p class="wb-empty">No links yet.</p>'}
  </main>
  ${friendLinkApply()}
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

/** 排行榜页（/rank）：会员积分总榜，榜单行结构共用 .rk-* */
export function rank(d: RankData): string {
  const s = d.settings
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: s.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'rank' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link is-active" href="/rank">排行榜</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <h1 class="mn-title mn-page-title">排行榜</h1>
  <p class="mn-intro">${d.total > 0 ? `共 ${d.total} 位会员 · 按积分倒序` : '还没有会员上榜。'}</p>
  <main class="mn-rank">${rankListHtml(d.entries) || '<p class="mn-empty">还没有会员上榜。</p>'}</main>
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

/** 会员中心页（/member）：未登录出登录/注册表单，已登录出会员卡（结构共用 .mem-*） */
export function member(d: MemberData): string {
  const s = d.settings
  return `<div class="mn-wrap">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: s.membersEnabled === '1', cls: 'mn-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'member' })}
  <header class="mn-header">
    <a class="mn-logo" href="/">${esc(s.siteName)}</a>
    <nav class="mn-nav"><a class="mn-nav-link" href="/rank">排行榜</a><a class="mn-nav-link" href="/about">关于我</a></nav>
  </header>
  <h1 class="mn-title mn-page-title">会员中心</h1>
  <p class="mn-intro">${d.member ? '留言、常回来，积分与专属内容都在这里' : '登录或注册，加入本站会员'}</p>
  <main class="mn-member">${d.member ? memberCardHtml(d.member) : memberAuthHtml()}</main>
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

export { id, css }
