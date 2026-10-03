import type { Context } from 'hono'
import { getSessionUser } from './auth'
import { getPostBySlug, getSettings, listApprovedComments, listPosts, parseTags, relatedPosts } from './db'
import { commentsHtml, page, pagerHtml, toHomePost } from './render'
import { sanitizeHtml } from './sanitize'
import { getTheme, THEMES } from './themes/registry'
import type { Env, PostRow, SessionUser, SettingsMap } from './types'
import { clampInt, excerpt, readingMinutes } from './utils'

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

export async function renderHome(c: C): Promise<Response> {
  baseHeaders(c)
  const settings = await getSettings(c.env.DB)
  const theme = getTheme(settings.theme)
  const url = new URL(c.req.url)
  const tag = c.req.param('tag') || url.searchParams.get('tag') || undefined
  const pageNum = clampInt(url.searchParams.get('page'), 1, 100000, 1)
  const perPage = clampInt(settings.postsPerPage, 1, 50, 10)
  const [r, tags] = await Promise.all([listPosts(c.env.DB, { status: 'published', tag, page: pageNum, limit: perPage }), hotTags(c)])
  const posts = await Promise.all(
    r.items.map(async (p) => toHomePost(p, parseTags(p), await commentCount(c, p.id)))
  )
  const html = theme.home({
    settings,
    posts,
    page: r.page,
    totalPages: r.totalPages,
    total: r.total,
    tag,
    hotTags: tags,
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({
      settings,
      css: theme.css,
      title: tag ? `${tag} 主题的文章` : '',
      description: settings.siteDescription,
      path: '/',
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

  const [comments, related] = await Promise.all([
    listApprovedComments(c.env.DB, row.id),
    relatedPosts(c.env.DB, row),
  ])

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
  })

  const html = theme.post({
    settings,
    post: {
      slug: row.slug,
      title: row.title,
      contentHtml: sanitizeHtml(row.content),
      summary: row.summary,
      cover: row.cover,
      tags: parseTags(row),
      published_at: row.published_at,
      views: row.views,
      likes: row.likes,
      readingMinutes: readingMinutes(row.content),
    },
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
  const html = theme.about({
    settings,
    contentHtml: sanitizeHtml(settings.about || '<p>作者很懒，什么都没写。</p>'),
  })
  c.header('Cache-Control', 'no-cache')
  return c.html(
    page({ settings, css: theme.css, title: '关于', description: `关于 ${settings.siteName}`, path: '/about', body: html })
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
