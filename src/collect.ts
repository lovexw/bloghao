/**
 * 公众号采集插件（服务端）
 *
 * POST /api/admin/collect/wechat { url }
 * 抓取 mp.weixin.qq.com 单篇图文 → 解析正文/标题/发布时间 →
 * 配图与封面转存 R2 图床 → 生成一篇保留原发布时间的草稿。
 * 编辑器里的「采集公众号文章」插件（public/plugins/wechat-collect.js）调用，
 * 草稿建好后由用户在编辑器中核对、修改，再手动发布。
 */
import { Hono } from 'hono'
import { clientIp, rateLimit } from './auth'
import { getPostById, uniqueSlug } from './db'
import { sanitizeHtml } from './sanitize'
import type { Env, SessionUser } from './types'
import { esc, excerpt, slugify } from './utils'

type CollectEnv = { Bindings: Env; Variables: { user: SessionUser } }

export const collectRoutes = new Hono<CollectEnv>()

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 与手动上传一致
const MAX_IMAGES = 30 // Workers 免费档单请求 50 个子请求，预留余量
const MAX_HTML_BYTES = 900_000 // 文章接口上限 1MB，留余量
const FETCH_TIMEOUT_MS = 15_000 // 单次抓取（页面/图片）超时
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ldquo: '\u201c',
  rdquo: '\u201d',
  lsquo: '\u2018',
  rsquo: '\u2019',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  amp: '&', // 必须最后处理，避免二次解码
}

function decodeEntities(s: string): string {
  let out = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => {
    const code = parseInt(h, 16)
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  })
  out = out.replace(/&#(\d+);/g, (_, d) => {
    const code = parseInt(d, 10)
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
  })
  return out.replace(/&([a-z]+);/gi, (m, name: string) => {
    const v = NAMED_ENTITIES[name.toLowerCase()]
    return v === undefined ? m : v
  })
}

function match1(html: string, re: RegExp): string {
  const m = re.exec(html)
  return m && m[1] ? m[1] : ''
}

/** 去标签取纯文本 */
function tagText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ''))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

/** 从 startIdx 处的 <div 开始，返回其内部 HTML（配对闭合） */
function innerHtmlOfDiv(html: string, divStart: number): string | null {
  const openEnd = html.indexOf('>', divStart)
  if (openEnd === -1) return null
  const re = /<div\b|<\/div>/g
  re.lastIndex = openEnd + 1
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(openEnd + 1, m.index)
  }
  return null
}

/**
 * 定位正文容器 js_content。
 * 页面里同一内容可能出现多份（DOM + 内嵌 JS 数据），逐个候选，
 * 取「去标签后长度 > 60」的第一份。
 */
function findArticleBody(html: string): string | null {
  let from = 0
  for (let i = 0; i < 5; i++) {
    const idx = html.indexOf('id="js_content"', from)
    if (idx === -1) return null
    const divStart = html.lastIndexOf('<div', idx)
    if (divStart === -1) return null
    const body = innerHtmlOfDiv(html, divStart)
    if (body && tagText(body).length > 60) return body
    from = idx + 1
  }
  return null
}

interface ArticleMeta {
  title: string
  account: string
  cover: string
  publishedAt: number | null
}

/** JS 字符串字面量里的 \uXXXX 转义 */
function unescapeJs(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

/** var nickname = htmlDecode("…") / var x = '…' / var x = "…" 三种写法都兼容 */
function jsVar(html: string, name: string): string {
  return unescapeJs(
    match1(html, new RegExp(`var ${name}\\s*=\\s*htmlDecode\\("([^"]*)"\\)`)) ||
      match1(html, new RegExp(`var ${name}\\s*=\\s*'([^']*)'`)) ||
      match1(html, new RegExp(`var ${name}\\s*=\\s*"([^"]*)"`, 'i'))
  )
}

function parseMeta(html: string): ArticleMeta {
  const title =
    tagText(match1(html, /<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i)) ||
    tagText(match1(html, /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i)) ||
    tagText(jsVar(html, 'msg_title'))
  const account =
    tagText(match1(html, /<strong[^>]*id="js_name"[^>]*>([\s\S]*?)<\/strong>/i)) ||
    tagText(jsVar(html, 'nickname'))
  const cover = decodeEntities(
    match1(html, /var msg_cdn_url\s*=\s*'([^']+)'/) ||
      match1(html, /var msg_cdn_url\s*=\s*"([^"]+)"/) ||
      match1(html, /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/i)
  )
  let publishedAt: number | null = null
  const ct = match1(html, /\bct\s*=\s*"(\d{9,13})"/)
  if (ct) {
    publishedAt = ct.length > 10 ? Number(ct) : Number(ct) * 1000
  } else {
    const t = match1(html, /var createTime\s*=\s*'(\d{4}-\d{2}-\d{2} \d{2}:\d{2})'/)
    if (t) publishedAt = Date.parse(t + ':00 +08:00')
  }
  return {
    title,
    account,
    cover,
    publishedAt: publishedAt !== null && Number.isFinite(publishedAt) ? publishedAt : null,
  }
}

/* ---------------- 正文分块 ---------------- */

interface Block {
  type: 'text' | 'img'
  text?: string
  src?: string
}

/**
 * 把正文 HTML 拆成有序的段落/图片块。
 * 公众号正文是大量嵌套 <section>，按 </section>/<p> 切块；
 * 段内保留加粗/斜体（哨兵标记，最后还原），其余样式丢弃。
 */
function parseBlocks(body: string): Block[] {
  const blocks: Block[] = []
  for (const token of body.split(/(<img\b[^>]*>)/i)) {
    if (!token) continue
    if (/^<img\b/i.test(token)) {
      blocks.push({
        type: 'img',
        src: decodeEntities(match1(token, /data-src="([^"]+)"/) || match1(token, /\ssrc="([^"]+)"/)),
      })
      continue
    }
    for (const raw of token.split(/<\/(?:section|p)>/i)) {
      const text = decodeEntities(
        raw
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<(?:strong|b)\b[^>]*>/gi, '\u0001s')
          .replace(/<\/(?:strong|b)\b[^>]*>/gi, '\u0001/s')
          .replace(/<(?:em|i)\b[^>]*>/gi, '\u0001e')
          .replace(/<\/(?:em|i)\b[^>]*>/gi, '\u0001/e')
          .replace(/<[^>]+>/g, '')
      )
        // 清掉控制字符：防止 &#1; 之类数字实体还原出 \u0001 与加粗/斜体哨兵冲突
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim()
      if (text) blocks.push({ type: 'text', text })
    }
  }
  return blocks
}

/** 组装文章 HTML；转存失败的图片整块丢弃 */
function renderHtml(blocks: Block[], srcMap: Map<string, string>): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.type === 'img') {
      const local = srcMap.get(b.src || '')
      if (!local) continue
      out.push(`<p style="text-align: center"><img src="${local}" alt=""></p>`)
    } else {
      const html = esc(b.text || '')
        .replace(/\u0001s/g, '<strong>')
        .replace(/\u0001\/s/g, '</strong>')
        .replace(/\u0001e/g, '<em>')
        .replace(/\u0001\/e/g, '</em>')
        .replace(/\n/g, '<br>')
      if (html) out.push(`<p>${html}</p>`)
    }
  }
  return out.join('')
}

/* ---------------- 图片转存 ---------------- */

/** 从文件魔数识别图片真实类型；识别不出返回 null（HTML/SVG/其它一律拒收） */
function sniffImageExt(buf: ArrayBuffer): 'jpg' | 'png' | 'gif' | 'webp' | null {
  const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength))
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif' // GIF87a / GIF89a
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  )
    return 'webp'
  return null
}

async function saveImage(
  c: { env: Env },
  url: string,
  name: string
): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://mp.weixin.qq.com/' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_UPLOAD_BYTES) return null
    // 类型只认文件魔数，不信任源站 Content-Type / URL 的 wx_fmt：
    // 声明成图片但内容是 HTML/SVG 的响应一律拒收，存储的 Content-Type
    // 由识别出的扩展名反推，保证 /images/ 回源时永远是安全的图片类型
    const ext = sniffImageExt(buf)
    if (!ext) return null
    const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`
    const now = new Date()
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const key = `u/${ym}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
    await c.env.IMAGES.put(key, buf, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    })
    await c.env.DB.prepare('INSERT INTO uploads (key, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(key, name.slice(0, 120), contentType, buf.byteLength, Date.now())
      .run()
    return `/images/${key}`
  } catch {
    return null
  }
}

/* ---------------- 路由 ---------------- */

collectRoutes.post('/wechat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null
  const url = String(body?.url ?? '').trim()
  if (!/^https:\/\/mp\.weixin\.qq\.com\/s/i.test(url)) {
    return c.json({ error: '请输入 mp.weixin.qq.com 的公众号文章链接' }, 400)
  }
  if (!rateLimit(`collect:${clientIp(c.req.raw)}`, 10, 60_000)) {
    return c.json({ error: '采集太频繁，请稍后再试' }, 429)
  }

  let html: string
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return c.json({ error: `抓取失败（HTTP ${res.status}）` }, 502)
    html = await res.text()
  } catch {
    return c.json({ error: '网络错误，抓取失败' }, 502)
  }

  const articleBody = findArticleBody(html)
  if (!articleBody) {
    if (/环境异常|操作频繁|完成验证|安全验证/.test(html)) {
      return c.json({ error: '微信要求安全验证，请稍后再试，或换一个网络环境' }, 502)
    }
    if (/此内容因违规|已被发布者删除|已删除/.test(html)) {
      return c.json({ error: '文章已被删除或因违规无法查看' }, 404)
    }
    return c.json({ error: '没有抓到文章正文，请确认这是公众号图文链接' }, 422)
  }

  const meta = parseMeta(html)
  const blocks = parseBlocks(articleBody)

  // 配图转存（按出现顺序，去重，限量）
  const imgUrls = [
    ...new Set(
      blocks
        .filter((b) => b.type === 'img' && b.src && /^https?:\/\//i.test(b.src))
        .map((b) => b.src as string)
    ),
  ].slice(0, MAX_IMAGES)
  const srcMap = new Map<string, string>()
  let saved = 0
  for (const src of imgUrls) {
    const local = await saveImage(c, src, `公众号配图-${saved + 1}`)
    if (local) {
      srcMap.set(src, local)
      saved++
    }
  }

  // 封面转存
  let cover = ''
  if (meta.cover && /^https?:\/\//i.test(meta.cover)) {
    cover = (await saveImage(c, meta.cover, '公众号封面')) || ''
  }

  const content = sanitizeHtml(renderHtml(blocks, srcMap))
  if (!content.replace(/<[^>]+>/g, '').trim()) {
    return c.json({ error: '正文为空，无法采集' }, 422)
  }
  if (new TextEncoder().encode(content).length > MAX_HTML_BYTES) {
    return c.json({ error: '文章过长，无法采集' }, 422)
  }

  const title = (meta.title || '无标题').slice(0, 150)
  const now = Date.now()
  const slug = await uniqueSlug(c.env.DB, slugify(title) || `c-${now.toString(36)}`)
  const res = await c.env.DB.prepare(
    `INSERT INTO posts (slug, title, content, summary, cover, tags, status, pinned, author_id, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '[]', 'draft', 0, ?, ?, ?, ?)`
  )
    .bind(slug, title, content, excerpt(content, 80), cover, c.get('user').id, meta.publishedAt, now, now)
    .run()
  const post = await getPostById(c.env.DB, Number(res.meta.last_row_id))
  return c.json({ ok: true, post, account: meta.account, images: saved })
})
