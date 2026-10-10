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
import css from './paper.css'

const id = 'paper'

/** 页脚公共件：八个页面只差链接组，结构统一在这里 */
function foot(s: SettingsMap, links: string): string {
  return `<footer class="pp-footer">${esc(s.footerText || '')}<span class="pp-footer-links">${footLinks(s, links)}</span></footer>`
}
const FOOT_LINKS = {
  home: '<a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a>',
  post: '<a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a>',
  archive: '<a href="/">回主页</a><a href="/weibo">微博</a><a href="/about">关于我</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a>',
  weibo: '<a href="/">回主页</a><a href="/weibo">微博</a><a href="/rss.xml">RSS</a><a href="/admin">管理</a>',
  about: '<a href="/">回主页</a><a href="/weibo">微博</a><a href="/guestbook">留言板</a><a href="/admin">管理</a>',
}

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

export function home(d: HomeData): string {
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
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: d.navActive })}
  <header class="pp-masthead">
    ${seal(s)}
    <h1 class="pp-site-name">${esc(s.siteName)}</h1>
    <p class="pp-site-desc">${esc(s.siteDescription)}</p>
  </header>
  ${d.notice ? `<div class="pp-notice">${d.notice}</div>` : ''}
  ${d.weiboFeed ? weiboHomeFeed({ settings: s, items: d.weiboFeed.items, total: d.weiboFeed.total, avatarHtml: seal(s), allowComments: d.weiboFeed.allowComments, adminName: d.weiboFeed.adminName, memberName: d.weiboFeed.memberName }) : ''}
  ${d.weibo ? weiboHomeEntry(d.weibo) : ''}
  ${onThisDayCard(d.onThisDay)}
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
  ${d.searchWeibo ? weiboSearchResults({ settings: s, items: d.searchWeibo.items, total: d.searchWeibo.total, avatarHtml: seal(s) }) : ''}
  ${foot(s, FOOT_LINKS.home)}
</div>`
}

export function post(d: PostData): string {
  const p = d.post
  const related = d.related.length
    ? `<section class="pp-related"><h2>延伸阅读</h2>${d.related
        .map((r) => `<a href="/post/${esc(r.slug)}">${esc(r.title)}<time>${fmtDate(r.published_at)}</time></a>`)
        .join('')}</section>`
    : ''
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages })}
  <article class="pp-article">
    <h1 class="pp-title">${esc(p.title)}</h1>
    <div class="pp-meta"><time>${fmtDate(p.published_at)}</time><span>·</span><span>${p.readingMinutes} 分钟读完</span><span>·</span><span>${p.views} 次阅读</span></div>
    ${p.cover ? `<div class="pp-cover"><img src="${esc(p.cover)}" alt=""></div>` : ''}
    <div class="pp-body rich">${p.contentHtml}</div>
    ${p.locked ? paywallHtml(p.minTier) : ''}
    <div class="pp-end">
      <span class="pp-end-line"></span><span class="pp-end-word">终</span><span class="pp-end-line"></span>
    </div>
    <div class="pp-actions">
      ${likesBtn(p.slug, p.likes)}
      ${d.share ? shareBtn(d.share.url, d.share.qr) : ''}
      ${d.category ? `<a class="pp-tag pp-cat" href="${categoryLink(d.category)}">${esc(d.category.name)}</a>` : ''}
      ${p.tags.map((t) => `<a class="pp-tag" href="${tagLink(t)}">${esc(t)}</a>`).join('')}
    </div>
    ${related}
    ${d.comments.html}
  </article>
  ${foot(d.settings, FOOT_LINKS.post)}
</div>`
}

export function about(d: AboutData): string {
  return page({ ...d, title: '关于我' })
}

/** 独立页面页（/page/:slug，slug='about' 时渲染 /about）：结构同关于我，标题由页面数据决定 */
export function page(d: PageData): string {
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: d.navActive })}
  <article class="pp-article">
    <h1 class="pp-title">${esc(d.title)}</h1>
    <div class="pp-body rich">${d.contentHtml}</div>
  </article>
  ${foot(d.settings, FOOT_LINKS.about)}
</div>`
}

/** 文章归档页：全部文章按年份分组，日期外置的细线列表 */
export function archives(d: ArchivesData): string {
  const s = d.settings
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'archives' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">文章归档</h1>
    <p class="wb-page-sub">${d.total > 0 ? `字字皆岁月 · 共 ${d.total} 篇` : '写下的每一篇都会收进这里'}</p>
  </header>
  <main class="pp-archives">${archiveListHtml(d.groups) || '<p class="wb-empty">纸上还无字，正是落笔时。</p>'}</main>
  ${foot(s, FOOT_LINKS.archive)}
</div>`
}

/** 留言板页：独立留言墙（复用 .cmt-* 结构与样式） */
export function guestbook(d: GuestbookData): string {
  const s = d.settings
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'guestbook' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">留言板</h1>
    <p class="wb-page-sub">${d.count > 0 ? `已有 ${d.count} 条留言 · 随便聊聊` : '想说点什么，就在这里落笔'}</p>
  </header>
  <main class="pp-guestbook">${d.html}</main>
  ${foot(s, FOOT_LINKS.archive)}
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
    avatarHtml: seal(s),
    allowComments: d.allowComments,
    adminName: d.adminName,
    memberName: d.memberName,
  })
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'weibo' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">微博</h1>
    <p class="wb-page-sub">${d.topic ? `话题 #${esc(d.topic)} · 共 ${d.total} 则` : d.total > 0 ? `随手记 · 共 ${d.total} 则` : '随手记，想写就写'}</p>
  </header>
  ${topicBar}
  ${composer}
  <main class="wb-list">
    ${cards || `<p class="wb-empty">${d.adminName ? '纸上还无微博，就在上面落第一笔。' : '纸上还无微博，正是落笔时。'}</p>`}
  </main>
  ${weiboPager(d.page, d.totalPages, d.topic)}
  ${foot(s, FOOT_LINKS.weibo)}
</div>`
}

/** 友情链接页：友链卡片 + 申请收录 */
export function links(d: LinksData): string {
  const s = d.settings
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: d.settings.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'links' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">友情链接</h1>
    <p class="wb-page-sub">${d.total > 0 ? `朋友站点 · 共 ${d.total} 个` : '和朋友交换链接的地方'}</p>
  </header>
  <main class="fl-grid">
    ${friendLinkCards(d.items) || '<p class="wb-empty">纸上暂无友链，去后台添加，或在下方申请收录。</p>'}
  </main>
  ${friendLinkApply()}
  ${foot(s, FOOT_LINKS.archive)}
</div>`
}

/** 排行榜页（/rank）：会员积分总榜，榜单行结构共用 .rk-* */
export function rank(d: RankData): string {
  const s = d.settings
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: s.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'rank' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">排行榜</h1>
    <p class="wb-page-sub">${d.total > 0 ? `以积分为序 · 共 ${d.total} 位` : '笔墨有价，情谊无价——留言即可上榜'}</p>
  </header>
  <main class="pp-rank">${rankListHtml(d.entries) || '<p class="wb-empty">纸上暂无名录，抢个头名吧。</p>'}</main>
  ${foot(s, FOOT_LINKS.archive)}
</div>`
}

/** 会员中心页（/member）：未登录出登录/注册表单，已登录出会员卡（结构共用 .mem-*） */
export function member(d: MemberData): string {
  const s = d.settings
  return `<div class="pp-page">
  ${siteNav({ mode: siteMode(d.settings), memberEnabled: s.membersEnabled === '1', cls: 'pp-snav', categories: d.categories, tags: d.tags, pages: d.pages, active: 'member' })}
  <header class="wb-page-head">
    <h1 class="wb-page-title">会员中心</h1>
    <p class="wb-page-sub">${d.member ? '留言、常回来，积分与专属内容都在这里' : '落款留名，加入本站会员'}</p>
  </header>
  <main class="pp-member">${d.member ? memberCardHtml(d.member) : memberAuthHtml()}</main>
  ${foot(s, FOOT_LINKS.archive)}
</div>`
}

export { id, css }
