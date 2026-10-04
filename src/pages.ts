import type { Context } from 'hono'
import { getSessionUser } from './auth'
import {
  getCategoryBySlug,
  getPostBySlug,
  getPostCategoryId,
  getSettings,
  listApprovedComments,
  listCategories,
  listPosts,
  listWeibo,
  parseTags,
  relatedPosts,
  weiboCommentCountMap,
  weiboImageList,
} from './db'
import {
  commentsHtml,
  page,
  pagerHtml,
  toHomePost,
  stripCoverDuplicate,
  weiboCards,
  weiboPager,
  type CategoryLink,
  type WeiboItemView,
} from './render'
import { sanitizeHtml } from './sanitize'
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

/** 已发布文章的聚热门标签（首页导航用） */
async function hotTags(c: C): Promise<string[]> {
  const { results } = await c.env.DB.prepare(
    "SELECT tags FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 200"
  ).all<{ tags: string }>()
  const count = new Map<string, number>()
  for (const r of results ?? []) {
    for (const t of parseTags({ tags: r.tags } as PostRow)) count.set(t, (count.get(t) || 0) + 1)
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)
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

  // 搜索模式不分页，直接取前 50 条
  const [r, tags, categories, category] = await Promise.all([
    listPosts(c.env.DB, {
      status: 'published',
      tag: opts.mode === 'home' ? tag : undefined,
      q: opts.mode === 'search' ? q || undefined : undefined,
      categorySlug: categorySlug || undefined,
      page: opts.mode === 'search' ? 1 : pageNum,
      limit: opts.mode === 'search' ? 50 : perPage,
    }),
    hotTags(c),
    navCategories(c),
    categorySlug ? getCategoryBySlug(c.env.DB, categorySlug) : Promise.resolve(null),
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
    })
    Object.assign(r, fixed)
  }

  const posts = await Promise.all(
    r.items.map(async (p) => toHomePost(p, parseTags(p), await commentCount(c, p.id), readingMinutes(p.content)))
  )

  let notice = ''
  let emptyText = ''
  let title = ''
  if (opts.mode === 'search') {
    // 搜索框已移到刊头标签上方，这里只展示结果信息
    notice = q
      ? `<p class="search-meta">找到 ${r.total} 篇与「${esc(q)}」相关的文章</p>`
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
    hotTags: tags,
    categories,
    navActive:
      opts.mode === 'home' ? (tag ? '' : 'home') : opts.mode === 'category' ? categorySlug : 'search',
    notice,
    emptyText,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title,
      description: settings.siteDescription,
      path: opts.mode === 'home' ? '/' : url.pathname,
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

  const [comments, related, categories, categoryId, user] = await Promise.all([
    listApprovedComments(c.env.DB, row.id),
    relatedPosts(c.env.DB, row),
    navCategories(c),
    getPostCategoryId(c.env.DB, row.id),
    getSessionUser(c.env.DB, c.req.raw),
  ])
  const categoryRow = categoryId ? await c.env.DB.prepare('SELECT name, slug FROM categories WHERE id = ?').bind(categoryId).first<{ name: string; slug: string }>() : null

  if (row.status === 'published') {
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
    tip: settings.moderateComments === '1' ? '提交后审核通过即展示' : undefined,
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
    comments: { html: commentsBlock, count: comments.length },
    related: related.map((p) => toHomePost(p, parseTags(p))),
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title: row.title,
      description: row.summary || excerpt(row.content, 120),
      ogImage: row.cover || undefined,
      path: `/post/${row.slug}`,
      body: html,
      preview: isPreview,
    })
  )
}

export async function renderAbout(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const categories = await navCategories(c)
  const html = theme.about({
    settings,
    contentHtml: sanitizeHtml(settings.about || '<p>作者很懒，什么都没写。</p>'),
    categories,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({ settings, css: theme.css, title: '关于', description: `关于 ${settings.siteName}`, path: '/about', body: html })
  )
}

/** 微博页（/weibo）：随手记时间线，复用主题的页面骨架与站点导航 */
export async function renderWeibo(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const url = new URL(c.req.url)
  const perPage = 15
  const [r, categories] = await Promise.all([
    listWeibo(c.env.DB, { status: 'published', page: clampInt(url.searchParams.get('page'), 1, 100000, 1), limit: perPage }),
    navCategories(c),
  ])
  // 页码越界时回到最后一页重取一次
  if (r.page > r.totalPages && r.total > 0) {
    Object.assign(r, await listWeibo(c.env.DB, { status: 'published', page: r.totalPages, limit: perPage }))
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
  }))
  const html = theme.weibo({
    settings,
    categories,
    items,
    page: r.page,
    totalPages: r.totalPages,
    total: r.total,
    allowComments: settings.allowComments === '1',
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({ settings, css: theme.css, title: '微博', description: `${settings.siteName}的随手记`, path: '/weibo', body: html })
  )
}

export async function renderNotFound(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const t = THEMES[settings.theme]
  const themeCss = t ? t.css : getTheme('wechat').css
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: themeCss,
      title: '404',
      description: '页面不存在',
      path: '/404',
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
