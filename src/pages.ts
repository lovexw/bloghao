import type { Context } from 'hono'
import { clientIp, getSessionUser } from './auth'
import {
  getCategoryBySlug,
  getPostBySlug,
  getPostCategoryId,
  getSettings,
  listAllPublishedArchives,
  listApprovedComments,
  listCategories,
  listFriendLinks,
  listGuestbookComments,
  listOnThisDay,
  listPosts,
  listPublishedTags,
  listWeibo,
  listWeiboTopics,
  parseTags,
  relatedPosts,
  weiboCommentCountMap,
  weiboImageList,
  type PostSort,
} from './db'
import {
  archiveGroups,
  commentsHtml,
  friendLinkApply,
  friendLinkCards,
  HOME_SORTS,
  homeListBase,
  homeSortBar,
  onThisDayCard,
  page,
  pagerHtml,
  toHomePost,
  stripCoverDuplicate,
  weiboCards,
  weiboPager,
  type CategoryLink,
  type WeiboItemView,
} from './render'
import { extractOgImage, sanitizeHtml } from './sanitize'
import { getTheme, THEMES } from './themes/registry'
import type { Env, PostRow, SessionUser, SettingsMap } from './types'
import { clampInt, esc, excerpt, readingMinutes } from './utils'

type C = Context<{ Bindings: Env; Variables: { user: SessionUser | null } }>

const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http:; media-src 'self' https:; script-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'"

function baseHeaders(c: C) {
  c.header('Content-Security-Policy', CSP)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'SAMEORIGIN')
}

// 浏览量去重：同一 IP 对同一篇文章 1 小时内只计 1 次（进程内缓存，尽力而为），
// 否则每次刷新/爬虫抓取都会 +1
const viewSeen = new Map<string, number>()
function shouldCountView(ip: string, postId: number): boolean {
  const now = Date.now()
  const key = `${ip}:${postId}`
  const last = viewSeen.get(key)
  if (last && now - last < 3600_000) return false
  viewSeen.set(key, now)
  if (viewSeen.size > 5000) {
    for (const [k, t] of viewSeen) if (now - t > 3600_000) viewSeen.delete(k)
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

export async function renderHome(c: C): Promise<Response> {
  return renderList(c, { mode: 'home' })
}

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
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60)
  const categorySlug = opts.mode === 'category' ? c.req.param('slug') || '' : ''
  const pageNum = clampInt(url.searchParams.get('page'), 1, 100000, 1)
  const perPage = clampInt(settings.postsPerPage, 1, 50, 10)
  // 列表排序：最新（默认，置顶优先）/ 最多阅读 / 最多点赞 / 最多留言 / 随机
  const sortParam = (url.searchParams.get('sort') || '').trim()
  const sort: PostSort = HOME_SORTS.some((s) => s.key === sortParam) ? (sortParam as PostSort) : 'latest'
  // 随机排序用 seed 稳住一组顺序：URL 没带就现生成一个，翻页链接会带上它
  const seed =
    sort === 'random' ? clampInt(url.searchParams.get('seed'), 1, 999999999, 0) || 1 + Math.floor(Math.random() * 999999998) : 0

  // 搜索模式不分页，直接取前 50 条
  const [r, tags, categories, category, wb, otd] = await Promise.all([    listPosts(c.env.DB, {
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
    categorySlug ? getCategoryBySlug(c.env.DB, categorySlug) : Promise.resolve(null),
    // 首页微博入口卡：最新两条随手记
    opts.mode === 'home'
      ? listWeibo(c.env.DB, { status: 'published', page: 1, limit: 2 })
      : Promise.resolve(null),
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

  const posts = await Promise.all(
    r.items.map(async (p) => toHomePost(p, parseTags(p), await commentCount(c, p.id), readingMinutes(p.content)))
  )

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
    onThisDay: otd,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title,
      description: settings.siteDescription,
      path: opts.mode === 'home' ? '/' : url.pathname,
      origin: url.origin,
      noindex: opts.mode === 'search',
      body: html,
    })
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

  const [comments, related, categories, categoryId, user, tags] = await Promise.all([
    listApprovedComments(c.env.DB, row.id),
    relatedPosts(c.env.DB, row),
    navCategories(c),
    getPostCategoryId(c.env.DB, row.id),
    getSessionUser(c.env.DB, c.req.raw),
    navTags(c),
  ])
  const categoryRow = categoryId ? await c.env.DB.prepare('SELECT name, slug FROM categories WHERE id = ?').bind(categoryId).first<{ name: string; slug: string }>() : null

  if (row.status === 'published' && shouldCountView(clientIp(c.req.raw), row.id)) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').bind(row.id).run()
    )
  }

  const commentsBlock = commentsHtml({
    comments,
    slug: row.slug,
    allowComments: settings.allowComments === '1' && row.status === 'published',
    count: comments.length,
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
    comments: { html: commentsBlock, count: comments.length },
    related: related.map((p) => toHomePost(p, parseTags(p))),
  })
  c.header('Cache-Control', 'no-cache')
  // 分享卡图优先：编辑器生成的 OG 卡图 > 封面图
  const ogImage = extractOgImage(sanitizeHtml(row.content)) || row.cover || undefined
  return c.html(
    page({
      settings,
      css: theme.css,
      title: row.title,
      description: row.summary || excerpt(row.content, 120),
      ogImage,
      path: `/post/${row.slug}`,
      origin: url.origin,
      noindex: isPreview,
      body: html,
      preview: isPreview,
    })
  )
}

/** 关于我页（/about）：内容在后台「设置 → 关于我」维护，导航高亮 about */
export async function renderAbout(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [categories, tags] = await Promise.all([navCategories(c), navTags(c)])
  const html = theme.about({
    settings,
    contentHtml: sanitizeHtml(settings.about || '<p>作者很懒，什么都没写。</p>'),
    categories,
    tags,
    navActive: 'about',
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title: '关于我',
      description: `关于 ${settings.siteName} 与这里的故事`,
      path: '/about',
      origin: new URL(c.req.url).origin,
      body: html,
    })
  )
}

/** 文章归档页（/archives）：全部已发布文章按年分组，独立页面便于搜索引擎收录 */
export async function renderArchive(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [rows, categories, tags] = await Promise.all([listAllPublishedArchives(c.env.DB), navCategories(c), navTags(c)])
  const html = theme.archives({
    settings,
    categories,
    tags,
    total: rows.length,
    groups: archiveGroups(rows),
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title: '文章归档',
      description: `${settings.siteName}的全部文章归档，共 ${rows.length} 篇，按年份回顾每一个阶段的写作`,
      path: '/archives',
      origin: new URL(c.req.url).origin,
      body: html,
    })
  )
}

/** 留言板页（/guestbook）：独立留言墙，留言存进 comments（post_id 与 weibo_id 均为 0） */
export async function renderGuestbook(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [comments, categories, tags, user] = await Promise.all([
    listGuestbookComments(c.env.DB),
    navCategories(c),
    navTags(c),
    getSessionUser(c.env.DB, c.req.raw),
  ])
  const html = theme.guestbook({
    settings,
    categories,
    tags,
    count: comments.length,
    html: commentsHtml({
      comments,
      slug: '',
      allowComments: settings.allowComments === '1',
      count: comments.length,
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
    page({
      settings,
      css: theme.css,
      title: '留言板',
      description: `${settings.siteName}的留言板，想对作者说点什么，就在这里写下来`,
      path: '/guestbook',
      origin: new URL(c.req.url).origin,
      body: html,
    })
  )
}

/** 微博页（/weibo）：随手记时间线，复用主题的页面骨架与站点导航；?topic= 按话题筛选 */
export async function renderWeibo(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const url = new URL(c.req.url)
  const perPage = 15
  const topic = (url.searchParams.get('topic') || '').trim().slice(0, 24)
  const [r, categories, topics, user, tags] = await Promise.all([
    listWeibo(c.env.DB, {
      status: 'published',
      page: clampInt(url.searchParams.get('page'), 1, 100000, 1),
      limit: perPage,
      topic: topic || undefined,
      pinnedFirst: true,
    }),
    navCategories(c),
    // 话题条只在按话题筛选时显示，未筛选时不必查话题统计
    topic ? listWeiboTopics(c.env.DB) : Promise.resolve([]),
    getSessionUser(c.env.DB, c.req.raw),
    navTags(c),
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
    page({
      settings,
      css: theme.css,
      title: '微博',
      description: `${settings.siteName}的随手记`,
      path: '/weibo',
      origin: url.origin,
      body: html,
    })
  )
}

/** 友情链接页（/links）：已收录的友链卡片 + 访客申请收录表单 */
export async function renderLinks(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const [links, categories, tags] = await Promise.all([
    listFriendLinks(c.env.DB, { status: 'approved' }),
    navCategories(c),
    navTags(c),
  ])
  const html = theme.links({
    settings,
    categories,
    tags,
    items: links.items.map((l) => ({ name: l.name, url: l.url, description: l.description, icon: l.icon })),
    total: links.total,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title: '友情链接',
      description: `${settings.siteName}的朋友站点，也欢迎申请收录`,
      path: '/links',
      origin: new URL(c.req.url).origin,
      body: html,
    })
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
    page({
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
    }),
    404
  )
}

export { pagerHtml }
