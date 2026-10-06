import type { Context } from 'hono'
import { clientIp, getSessionUser } from './auth'
import {
  getCategoryBySlug,
  getPage,
  getPostBySlug,
  getPostCategoryId,
  getSettings,
  listAllPublishedArchives,
  listApprovedComments,
  listCategories,
  listFriendLinks,
  listGuestbookComments,
  listOnThisDay,
  listPages,
  listPosts,
  listPublishedTags,
  listWeibo,
  listWeiboTopics,
  locateWeiboPage,
  parseTags,
  postCommentCountMap,
  relatedPosts,
  weiboCommentCountMap,
  weiboImageList,
  type PostSort,
} from './db'
import {
  articleJsonLd,
  archiveGroups,
  commentsHtml,
  HOME_SORTS,
  page,
  siteBase,
  siteMode,
  toHomePost,
  stripCoverDuplicate,
  type CategoryLink,
  type NavPage,
  type WeiboItemView,
} from './render'
import { extractOgImage, sanitizeHtml } from './sanitize'
import { getTheme, THEMES } from './themes/registry'
import type { Env, PostRow, SessionUser, SettingsMap } from './types'
import { packMatrix, qrMatrix } from './qrcode'
import { clampInt, esc, excerpt, isDemo, readingMinutes } from './utils'

type C = Context<{ Bindings: Env; Variables: { user: SessionUser | null } }>

/** 演示站包装：所有公开页强制 noindex（内容是每两小时重置的种子数据，不该进搜索引擎索引）；生产模式原样透传 */
function pageOpts(c: C, o: Parameters<typeof page>[0]): Parameters<typeof page>[0] {
  return isDemo(c.env) ? { ...o, noindex: true } : o
}

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: blob:; media-src 'self' https:; script-src 'self'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; object-src 'none'"

function baseHeaders(c: C) {
  c.header('Content-Security-Policy', CSP)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'SAMEORIGIN')
}

// 浏览量去重：同一 IP 对同一篇文章 1 小时内只计 1 次（进程内缓存，尽力而为），
// 否则每次刷新/爬虫抓取都会 +1
const viewSeen = new Map<string, number>()
const VIEW_SEEN_MAX = 5000
function shouldCountView(ip: string, postId: number): boolean {
  const now = Date.now()
  const key = `${ip}:${postId}`
  const last = viewSeen.get(key)
  if (last && now - last < 3600_000) return false
  viewSeen.set(key, now)
  // 淘汰在插入时执行（与 auth.rateLimit 同款）：先清过期项，仍超容量丢最旧的，保证 Map 有界
  if (viewSeen.size > VIEW_SEEN_MAX) {
    for (const [k, t] of viewSeen) if (now - t > 3600_000) viewSeen.delete(k)
    while (viewSeen.size > VIEW_SEEN_MAX) {
      const oldest = viewSeen.keys().next().value
      if (oldest === undefined) break
      viewSeen.delete(oldest)
    }
  }
  return true
}

/** 顶部导航「分类话题」菜单用：已发布文章的标签（按使用次数排序，计数展示） */
async function navTags(c: C): Promise<{ name: string; count: number }[]> {
  return listPublishedTags(c.env.DB)
}

async function commentCount(c: C, postId: number): Promise<number> {
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND status = 'approved'")
    .bind(postId)
    .first<{ n: number }>()
  return r?.n ?? 0
}

/** 顶部导航用的分类列表（每个公开页面都要带） */
async function navCategories(c: C): Promise<CategoryLink[]> {
  const rows = await listCategories(c.env.DB)
  return rows.map((r) => ({ name: r.name, slug: r.slug }))
}

/** 顶部导航里的自建页面项（已发布 + 勾选显示在导航；about 有专属导航位，排除避免重复） */
async function navPages(c: C): Promise<NavPage[]> {
  const rows = await listPages(c.env.DB, { status: 'published' })
  return rows
    .filter((r) => r.show_in_nav === 1 && r.slug !== 'about')
    .map((r) => ({ title: r.title, href: `/page/${encodeURIComponent(r.slug)}`, key: `p:${r.slug}` }))
}

/** 主题 page() 的运行时兜底：第三方主题未实现第 8 个渲染函数时渲染通用版（正文壳 + 返回首页） */
function themePageHtml(theme: ReturnType<typeof getTheme>, d: Parameters<typeof theme.page>[0]): string {
  if (typeof theme.page === 'function') return theme.page(d)
  return `<div style="max-width:760px;margin:0 auto;padding:32px 20px 60px;">
  <h1 style="margin-bottom:18px;">${esc(d.title)}</h1>
  <div class="rich">${d.contentHtml}</div>
  <p style="margin-top:32px;"><a href="/">← 返回首页</a></p>
</div>`
}

export async function renderHome(c: C): Promise<Response> {
  return renderList(c, { mode: 'home' })
}

/** 微博+博客模式：首页微博流直出的条数（更早的进 /weibo，首页不堆全部） */
const HOME_WEIBO_FEED_LIMIT = 8

/** 分类归档页（/category/:slug），列表结构与首页一致 */
export async function renderCategory(c: C): Promise<Response> {
  return renderList(c, { mode: 'category' })
}

/** 站内搜索页（/search?q=），结果复用首页列表模板 */
export async function renderSearch(c: C): Promise<Response> {
  return renderList(c, { mode: 'search' })
}

async function renderList(
  c: C,
  opts: { mode: 'home' | 'category' | 'search' }
): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const url = new URL(c.req.url)
  const tag = c.req.param('tag') || url.searchParams.get('tag') || undefined
  const mode = siteMode(settings)
  // 纯微博：打开首页就是微博时间线（文章数据不动，/post/ 直链仍可访问）；/tag/:tag 属博客概念照旧渲染
  if (opts.mode === 'home' && mode === 'weibo' && !tag) return renderWeibo(c, true)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60)
  const categorySlug = opts.mode === 'category' ? c.req.param('slug') || '' : ''
  const pageNum = clampInt(url.searchParams.get('page'), 1, 1000, 1)
  const perPage = clampInt(settings.postsPerPage, 1, 50, 10)
  // 列表排序：最新（默认，置顶优先）/ 最多阅读 / 最多点赞 / 最多留言 / 随机
  const sortParam = (url.searchParams.get('sort') || '').trim()
  const sort: PostSort = HOME_SORTS.some((s) => s.key === sortParam) ? (sortParam as PostSort) : 'latest'
  // 随机排序用 seed 稳住一组顺序：URL 没带就现生成一个，翻页链接会带上它
  const seed =
    sort === 'random' ? clampInt(url.searchParams.get('seed'), 1, 999999999, 0) || 1 + Math.floor(Math.random() * 999999998) : 0

  // 搜索模式不分页，直接取前 50 条
  const [r, tags, categories, pages, category, wb, wbFeedRaw, feedUser, otd] = await Promise.all([    listPosts(c.env.DB, {
      status: 'published',
      tag: opts.mode === 'home' ? tag : undefined,
      q: opts.mode === 'search' ? q || undefined : undefined,
      categorySlug: categorySlug || undefined,
      page: opts.mode === 'search' ? 1 : pageNum,
      limit: opts.mode === 'search' ? 50 : perPage,
      sort,
      seed,
    }),
    navTags(c),
    navCategories(c),
    navPages(c),
    categorySlug ? getCategoryBySlug(c.env.DB, categorySlug) : Promise.resolve(null),
    // 首页微博入口卡（博客+微博模式）：最新两条随手记摘要
    opts.mode === 'home' && mode === 'blog-weibo'
      ? listWeibo(c.env.DB, { status: 'published', page: 1, limit: 2 })
      : Promise.resolve(null),
    // 首页微博流（微博+博客模式）：完整卡片先行，管理员键与评论照常可用
    opts.mode === 'home' && mode === 'weibo-blog'
      ? listWeibo(c.env.DB, { status: 'published', page: 1, limit: HOME_WEIBO_FEED_LIMIT, pinnedFirst: true })
      : Promise.resolve(null),
    opts.mode === 'home' && mode === 'weibo-blog' ? getSessionUser(c.env.DB, c.req.raw) : Promise.resolve(null),
    // 历史上的今天：仅首页第一页且未带筛选时查（有内部按天缓存）
    opts.mode === 'home' && pageNum === 1 && !tag && !q ? listOnThisDay(c.env.DB) : Promise.resolve(null),
  ])
  if (opts.mode === 'category' && !category) return renderNotFound(c)
  // 页码跳转可能输入越界，回到最后一页重新取一次
  if (opts.mode !== 'search' && r.page > r.totalPages && r.total > 0) {
    const fixed = await listPosts(c.env.DB, {
      status: 'published',
      tag: opts.mode === 'home' ? tag : undefined,
      categorySlug: categorySlug || undefined,
      page: r.totalPages,
      limit: perPage,
      sort,
      seed,
    })
    Object.assign(r, fixed)
  }

  const countMap = await postCommentCountMap(
    c.env.DB,
    r.items.map((p) => p.id)
  )
  const posts = r.items.map((p) => toHomePost(p, parseTags(p), countMap.get(p.id) ?? 0, readingMinutes(p.content)))

  const weibo = wb
    ? {
        total: wb.total,
        items: wb.items.map((w) => ({
          id: w.id,
          content: w.content,
          images: weiboImageList(w),
          created_at: w.published_at ?? w.created_at,
          likes: w.likes,
          commentCount: 0,
        })),
      }
    : null

  // 首页微博流（微博+博客模式）：补评论数与管理员身份，卡片交互与 /weibo 页同款
  let weiboFeed: { items: WeiboItemView[]; total: number; allowComments: boolean; adminName?: string } | null = null
  if (wbFeedRaw) {
    const cmt = await weiboCommentCountMap(
      c.env.DB,
      wbFeedRaw.items.map((w) => w.id)
    )
    weiboFeed = {
      items: wbFeedRaw.items.map((w) => ({
        id: w.id,
        content: w.content,
        images: weiboImageList(w),
        created_at: w.published_at ?? w.created_at,
        likes: w.likes,
        commentCount: cmt.get(w.id) || 0,
        pinned: !!w.pinned,
      })),
      total: wbFeedRaw.total,
      allowComments: settings.allowComments === '1',
      adminName: feedUser ? (feedUser.display_name || feedUser.username || '').slice(0, 24) : undefined,
    }
  }

  let notice = ''
  let emptyText = ''
  let title = ''
  if (opts.mode === 'search') {
    // 搜索框已移到刊头标签上方，这里只展示结果信息；结果封顶 50 条，超限要说清楚
    notice = q
      ? r.total > 50
        ? `<p class="search-meta">找到 ${r.total} 篇与「${esc(q)}」相关的文章，仅显示前 50 条，试试更具体的关键词</p>`
        : `<p class="search-meta">找到 ${r.total} 篇与「${esc(q)}」相关的文章</p>`
      : '<p class="search-meta">输入关键词，回车或点「搜索」</p>'
    emptyText = q ? `没有找到与「${esc(q)}」相关的文章，换个关键词试试。` : ''
    title = q ? `搜索：${q}` : '搜索'
  } else if (opts.mode === 'category' && category) {
    notice = `<p class="search-meta">分类「${esc(category.name)}」下共 ${r.total} 篇文章</p>`
    emptyText = '这个分类下还没有文章。'
    title = `分类：${category.name}`
  } else if (tag) {
    title = `${tag} 主题的文章`
  }

  const html = theme.home({
    settings,
    posts,
    page: opts.mode === 'search' ? 1 : r.page,
    totalPages: opts.mode === 'search' ? 1 : r.totalPages,
    total: r.total,
    tag: opts.mode === 'home' ? tag : undefined,
    q: opts.mode === 'search' ? q : undefined,
    sort,
    seed,
    categorySlug: categorySlug || undefined,
    tags,
    categories,
    pages,
    weibo,
    navActive:
      opts.mode === 'home'
        ? tag
          ? `tag:${tag}`
          : 'home'
        : opts.mode === 'category'
          ? categorySlug
          : 'search',
    notice,
    emptyText,
    weiboFeed,
    // 纯博客模式：历史上的今天只保留文章条目（微博模块已隐藏）
    onThisDay: mode === 'blog' && otd ? otd.filter((i) => i.kind === 'post') : otd,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title,
      description: settings.siteDescription,
      path: opts.mode === 'home' ? '/' : url.pathname,
      origin: url.origin,
      noindex: opts.mode === 'search',
      body: html,
    }))
  )
}

export async function renderPost(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const slug = c.req.param('slug') ?? ''
  const row = await getPostBySlug(c.env.DB, slug)
  if (!row) return renderNotFound(c)
  const url = new URL(c.req.url)
  const isPreview = url.searchParams.get('preview') === '1'
  if (row.status !== 'published') {
    // 草稿只允许作者本人带 preview=1 预览
    const user = await getSessionUser(c.env.DB, c.req.raw)
    if (!isPreview || !user) return renderNotFound(c)
  }

  const [comments, related, categories, categoryId, user, tags, pages, commentTotal] = await Promise.all([
    listApprovedComments(c.env.DB, row.id),
    relatedPosts(c.env.DB, row),
    navCategories(c),
    getPostCategoryId(c.env.DB, row.id),
    getSessionUser(c.env.DB, c.req.raw),
    navTags(c),
    navPages(c),
    // 计数独立取（列表 LIMIT 500，超限后 length 会少报，JSON-LD commentCount 同口径）
    commentCount(c, row.id),
  ])
  const categoryRow = categoryId ? await c.env.DB.prepare('SELECT name, slug FROM categories WHERE id = ?').bind(categoryId).first<{ name: string; slug: string }>() : null

  // 分享按钮数据：canonical 绝对链接（后台站点链接优先，回退请求 origin）+ 链接的 QR 矩阵位串
  const share = { url: `${siteBase(settings, url.origin)}/post/${row.slug}`, qr: '' }
  const shareQr = qrMatrix(share.url)
  if (shareQr) share.qr = packMatrix(shareQr)

  if (row.status === 'published' && shouldCountView(clientIp(c.req.raw), row.id)) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').bind(row.id).run()
    )
  }

  const commentsBlock = commentsHtml({
    comments,
    slug: row.slug,
    allowComments: settings.allowComments === '1' && row.status === 'published',
    count: commentTotal,
    isAdmin: !!user,
    // 管理员登录：表单免填昵称，以作者身份发言
    adminName: user ? (user.display_name || user.username || '').slice(0, 24) : undefined,
    tip: settings.moderateComments === '1' && !user ? '提交后审核通过即展示' : undefined,
  })

  const html = theme.post({
    settings,
    post: {
      slug: row.slug,
      title: row.title,
      // 封面图与正文首图重复时渲染正文去掉首图，避免一图两现
      contentHtml: stripCoverDuplicate(sanitizeHtml(row.content), row.cover),
      summary: row.summary,
      cover: row.cover,
      tags: parseTags(row),
      published_at: row.published_at,
      views: row.views,
      likes: row.likes,
      readingMinutes: readingMinutes(row.content),
    },
    category: categoryRow ? { name: categoryRow.name, slug: categoryRow.slug } : null,
    categories,
    tags,
    pages,
    comments: { html: commentsBlock, count: commentTotal },
    related: related.map((p) => toHomePost(p, parseTags(p))),
    share,
  })
  c.header('Cache-Control', 'no-cache')
  // 分享卡图优先：编辑器生成的 OG 卡图 > 封面图
  const ogImage = extractOgImage(sanitizeHtml(row.content)) || row.cover || undefined
  const base = siteBase(settings, url.origin)
  // 结构化数据（roadmap A3）：schema.org BlogPosting，与 og:image / canonical 同口径；草稿预览（noindex）不出
  const jsonLd = isPreview
    ? undefined
    : articleJsonLd({
        settings,
        title: row.title,
        description: row.summary || excerpt(row.content, 120),
        image: ogImage,
        url: `${base}/post/${row.slug}`,
        base,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
        tags: parseTags(row),
        commentCount: commentTotal,
      })
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: row.title,
      description: row.summary || excerpt(row.content, 120),
      ogImage,
      path: `/post/${row.slug}`,
      origin: url.origin,
      noindex: isPreview,
      jsonLd,
      body: html,
      preview: isPreview,
    }))
  )
}

/** 关于我页（/about）：2026-10 起由页面系统承载（pages 表 slug='about'，后台「页面」维护），
 *  查不到对应页面时回退 legacy 的 settings.about 渲染（兜底，正常不会再走到） */
export async function renderAbout(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const aboutRow = await getPage(c.env.DB, 'about')
  if (aboutRow && aboutRow.status === 'published') {
    const [categories, tags, pages] = await Promise.all([navCategories(c), navTags(c), navPages(c)])
    const html = themePageHtml(theme, {
      settings,
      title: aboutRow.title,
      contentHtml: sanitizeHtml(aboutRow.content),
      categories,
      tags,
      pages,
      navActive: 'about',
    })
    c.header('Cache-Control', 'no-cache')
    return c.html(
      page(pageOpts(c, {
        settings,
        css: theme.css,
        title: aboutRow.title,
        description: `关于 ${settings.siteName} 与这里的故事`,
        path: '/about',
        origin: new URL(c.req.url).origin,
        body: html,
      }))
    )
  }
  const [categories, tags, pages] = await Promise.all([navCategories(c), navTags(c), navPages(c)])
  const html = theme.about({
    settings,
    contentHtml: sanitizeHtml(settings.about || '<p>作者很懒，什么都没写。</p>'),
    categories,
    tags,
    pages,
    navActive: 'about',
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: '关于我',
      description: `关于 ${settings.siteName} 与这里的故事`,
      path: '/about',
      origin: new URL(c.req.url).origin,
      body: html,
    }))
  )
}

/** 独立页面页（/page/:slug）：自建页面（项目页/书单页/隐私政策等）；草稿 404，slug=about 301 回专属短链 */
export async function renderPage(c: C): Promise<Response> {
  baseHeaders(c)
  const slug = c.req.param('slug') ?? ''
  if (slug === 'about') return c.redirect('/about', 301)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const row = await getPage(c.env.DB, slug)
  if (!row || row.status !== 'published') return renderNotFound(c)
  const [categories, tags, pages] = await Promise.all([navCategories(c), navTags(c), navPages(c)])
  const html = themePageHtml(theme, {
    settings,
    title: row.title,
    contentHtml: sanitizeHtml(row.content),
    categories,
    tags,
    pages,
    navActive: `p:${row.slug}`,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: row.title,
      description: excerpt(row.content, 120),
      path: `/page/${row.slug}`,
      origin: new URL(c.req.url).origin,
      body: html,
    }))
  )
}

/** 文章归档页（/archives）：全部已发布文章按年分组，独立页面便于搜索引擎收录 */
export async function renderArchive(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [rows, categories, tags, pages] = await Promise.all([
    listAllPublishedArchives(c.env.DB),
    navCategories(c),
    navTags(c),
    navPages(c),
  ])
  const html = theme.archives({
    settings,
    categories,
    tags,
    pages,
    total: rows.length,
    groups: archiveGroups(rows),
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: '文章归档',
      description: `${settings.siteName}的全部文章归档，共 ${rows.length} 篇，按年份回顾每一个阶段的写作`,
      path: '/archives',
      origin: new URL(c.req.url).origin,
      body: html,
    }))
  )
}

/** 留言板页（/guestbook）：独立留言墙，留言存进 comments（post_id 与 weibo_id 均为 0） */
export async function renderGuestbook(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [comments, categories, tags, pages, user, gbCount] = await Promise.all([
    listGuestbookComments(c.env.DB),
    navCategories(c),
    navTags(c),
    navPages(c),
    getSessionUser(c.env.DB, c.req.raw),
    // 留言总数独立取：列表 LIMIT 500，超限后 length 会少报
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE post_id = 0 AND weibo_id = 0 AND status = 'approved'").first<{ n: number }>(),
  ])
  const html = theme.guestbook({
    settings,
    categories,
    tags,
    pages,
    count: gbCount?.n ?? comments.length,
    html: commentsHtml({
      comments,
      slug: '',
      allowComments: settings.allowComments === '1',
      count: gbCount?.n ?? comments.length,
      isAdmin: !!user,
      // 管理员登录：表单免填昵称，以作者身份发言
      adminName: user ? (user.display_name || user.username || '').slice(0, 24) : undefined,
      tip: settings.moderateComments === '1' && !user ? '提交后审核通过即展示' : undefined,
      guestbook: true,
      // 页头已有「留言板」大标题，留言区标题换成「全部留言」避免重复
      title: '全部留言',
    }),
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: '留言板',
      description: `${settings.siteName}的留言板，想对作者说点什么，就在这里写下来`,
      path: '/guestbook',
      origin: new URL(c.req.url).origin,
      body: html,
    }))
  )
}

/** 微博页（/weibo）：随手记时间线，复用主题的页面骨架与站点导航；?topic= 按话题筛选。
 *  纯微博模式（siteMode=weibo）由 renderHome 以 asHome=true 复用本函数渲染在 '/'：
 *  正文结构完全一致，仅 canonical/标题换成首页口径；翻页与话题链接仍指向 /weibo（同一内容）。
 *  纯博客模式（siteMode=blog）：微博模块整体下线，本路由 302 回首页（老链接不断）。 */
export async function renderWeibo(c: C, asHome = false): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  if (siteMode(settings) === 'blog') return c.redirect('/', 302)
  const theme = getTheme(settings.theme)
  const url = new URL(c.req.url)
  const perPage = 15
  const topic = (url.searchParams.get('topic') || '').trim().slice(0, 24)
  const pageParam = clampInt(url.searchParams.get('page'), 1, 1000, 1)
  // ?wb=<id> 深链定位：历史上的今天、首页入口卡、TG 通知都链到 /weibo?wb=x#wb-x，而目标条目常不在第 1
  // 页——服务端先算出所在页直接渲染，浏览器原生锚点才滚动得到；定位失败（已删/非已发布）回退 ?page=
  let pageNum = pageParam
  const wbParam = (url.searchParams.get('wb') || '').trim()
  if (/^\d{1,12}$/.test(wbParam)) {
    const located = await locateWeiboPage(c.env.DB, Number(wbParam), { limit: perPage, topic: topic || undefined })
    if (located) pageNum = located
  }
  const [r, categories, topics, user, tags, pages] = await Promise.all([
    listWeibo(c.env.DB, {
      status: 'published',
      page: pageNum,
      limit: perPage,
      topic: topic || undefined,
      pinnedFirst: true,
    }),
    navCategories(c),
    // 话题条只在按话题筛选时显示，未筛选时不必查话题统计
    topic ? listWeiboTopics(c.env.DB) : Promise.resolve([]),
    getSessionUser(c.env.DB, c.req.raw),
    navTags(c),
    navPages(c),
  ])
  // 页码越界时回到最后一页重取一次
  if (r.page > r.totalPages && r.total > 0) {
    Object.assign(
      r,
      await listWeibo(c.env.DB, { status: 'published', page: r.totalPages, limit: perPage, topic: topic || undefined, pinnedFirst: true })
    )
  }
  const cmtCounts = await weiboCommentCountMap(
    c.env.DB,
    r.items.map((w) => w.id)
  )
  const items: WeiboItemView[] = r.items.map((w) => ({
    id: w.id,
    content: w.content,
    images: weiboImageList(w),
    created_at: w.published_at ?? w.created_at,
    likes: w.likes,
    commentCount: cmtCounts.get(w.id) || 0,
    pinned: !!w.pinned,
  }))
  const html = theme.weibo({
    settings,
    categories,
    tags,
    pages,
    items,
    page: r.page,
    totalPages: r.totalPages,
    total: r.total,
    allowComments: settings.allowComments === '1',
    // 管理员登录：卡片内评论表单免填昵称，以作者身份发言
    adminName: user ? (user.display_name || user.username || '').slice(0, 24) : undefined,
    topic: topic || undefined,
    topics,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: asHome ? '' : '微博',
      description: asHome ? settings.siteDescription : `${settings.siteName}的随手记`,
      path: asHome ? '/' : '/weibo',
      origin: url.origin,
      body: html,
    }))
  )
}

/** 友情链接页（/links）：已收录的友链卡片 + 访客申请收录表单 */
export async function renderLinks(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [links, categories, tags, pages] = await Promise.all([
    listFriendLinks(c.env.DB, { status: 'approved' }),
    navCategories(c),
    navTags(c),
    navPages(c),
  ])
  const html = theme.links({
    settings,
    categories,
    tags,
    pages,
    items: links.items.map((l) => ({ name: l.name, url: l.url, description: l.description, icon: l.icon })),
    total: links.total,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: theme.css,
      title: '友情链接',
      description: `${settings.siteName}的朋友站点，也欢迎申请收录`,
      path: '/links',
      origin: new URL(c.req.url).origin,
      body: html,
    }))
  )
}

export async function renderNotFound(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  // hasOwnProperty 防原型链属性（constructor 等）被当成主题 id
  const t = Object.prototype.hasOwnProperty.call(THEMES, settings.theme) ? THEMES[settings.theme] : undefined
  const themeCss = t ? t.css : getTheme('wechat').css
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page(pageOpts(c, {
      settings,
      css: themeCss,
      title: '404',
      description: '页面不存在',
      path: '/404',
      origin: new URL(c.req.url).origin,
      noindex: true,
      body: `<div style="max-width:480px;margin:18vh auto 0;padding:0 24px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;">
  <div style="font-size:64px;font-weight:700;letter-spacing:.05em;">404</div>
  <p style="color:#999;margin:12px 0 28px;">这一页飘走了，回首页看看吧。</p>
  <a href="/" style="display:inline-block;padding:10px 28px;border-radius:999px;background:#b23a29;color:#fff;text-decoration:none;font-size:14px;">回首页</a>
</div>`,
    })),
    404
  )
}
