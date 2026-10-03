#!/usr/bin/env node
/**
 * emlog Pro SQL 备份 → xwblog D1 迁移工具
 *
 * 用法：
 *   node scripts/emlog-migrate/migrate.mjs parse  <emlog.sql>   # 解析 SQL 备份 → data.json + 统计报告
 *   node scripts/emlog-migrate/migrate.mjs convert            # data.json → import.sql + images.json
 *
 * 转换规则：
 *   - emlog_blog：hide='y' → 草稿，其余发布；views/likes(like_count)/置顶(top) 保留；date 秒 → 毫秒
 *   - content：含 HTML 标签的走 sanitizeHtml（与后台保存一致），纯文本/Markdown 走站内 mdToHtml
 *   - 图片：/content/uploadfile/YYYYMM/xx → /images/u/YYYYMM/xx（R2），老站内链 post-N.html → /post/<slug>
 *   - 分类（emlog 无对应表）→ 转为文章的第一个标签保留可达性
 *   - slug：优先 emlog 别名，否则 ASCII 标题，否则 post-<gid>，保证唯一
 *   - 评论：扁平化（回复加「回复 @某人：」前缀），hide='y' → pending
 *   - 附件表 → images.json 下载清单（后续传 R2 + 写 uploads 表）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mdToHtml } from './md.ts'
import { sanitizeHtml } from '../../src/sanitize.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_JSON = join(HERE, 'data.json')
const IMPORT_SQL = join(HERE, 'import.sql')
const IMAGES_JSON = join(HERE, 'images.json')
const OLD_HOST = 'blog.xiaowuleyi.com'

/* ---------------- SQL 解析 ---------------- */

function splitStatements(sql) {
  const stmts = []
  let cur = []
  let inStr = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (inStr) {
      cur.push(ch)
      if (ch === '\\') { i++; cur.push(sql[i] ?? ''); continue }
      if (ch === "'") inStr = false
      continue
    }
    if (ch === "'") { inStr = true; cur.push(ch); continue }
    if (ch === ';') { stmts.push(cur.join('').trim()); cur = []; continue }
    cur.push(ch)
  }
  if (cur.join('').trim()) stmts.push(cur.join('').trim())
  return stmts
}

function unescChar(c) {
  switch (c) {
    case '0': return '\0'
    case 'n': return '\n'
    case 'r': return '\r'
    case 't': return '\t'
    case 'b': return '\b'
    case 'Z': return '\x1a'
    default: return c // \' \" \\ \% \_ 等
  }
}

/** 解析 VALUES 后面的元组串（MySQL 转义 + '' 转义） */
function parseTuples(s) {
  const rows = []
  let i = 0
  const n = s.length
  while (i < n) {
    while (i < n && /[\s,]/.test(s[i])) i++
    if (i >= n) break
    if (s[i] !== '(') throw new Error(`期望 (，实际 ${JSON.stringify(s.slice(i, i + 20))}`)
    i++
    const vals = []
    for (;;) {
      while (i < n && /\s/.test(s[i])) i++
      if (i >= n) throw new Error('元组未闭合')
      if (s[i] === ')' ) { i++; break }
      if (s[i] === ',') { i++; continue }
      if (s[i] === "'") {
        i++
        let buf = ''
        for (;;) {
          if (i >= n) throw new Error('字符串未闭合')
          const ch = s[i]
          if (ch === '\\') { buf += unescChar(s[i + 1] ?? ''); i += 2; continue }
          if (ch === "'") {
            if (s[i + 1] === "'") { buf += "'"; i += 2; continue }
            i++
            break
          }
          buf += ch; i++
        }
        vals.push(buf)
      } else {
        let j = i
        while (j < n && !/[,)]/.test(s[j])) j++
        const tok = s.slice(i, j).trim()
        vals.push(/^NULL$/i.test(tok) ? null : Number(tok))
        i = j
      }
    }
    rows.push(vals)
  }
  return rows
}

function parseDump(sqlPath) {
  const sql = readFileSync(sqlPath, 'utf8')
  const tables = { blog: [], comment: [], tag: [], sort: [], attachment: [], twitter: [] }
  for (const stmt of splitStatements(sql)) {
    const m = /^INSERT INTO `?emlog_(\w+)`?\s*\(([^)]*)\)\s*VALUES\s*/is.exec(stmt)
    if (!m || !(m[1] in tables)) continue
    const cols = m[2].split(',').map((s) => s.trim().replace(/^`|`$/g, ''))
    for (const vals of parseTuples(stmt.slice(m[0].length))) {
      if (vals.length !== cols.length) throw new Error(`列数不匹配 ${m[1]}: ${vals.length} vs ${cols.length}`)
      const row = {}
      cols.forEach((c, i) => (row[c] = vals[i]))
      tables[m[1]].push(row)
    }
  }
  return tables
}

/* ---------------- 内容转换 ---------------- */

const HTML_RE = /<(?:p|div|br|img|h[1-6]|pre|ol|ul|li|table|thead|tbody|tr|td|th|blockquote|section|figure|figcaption|span|video|audio|iframe|source|strong|em|b|i|u|s|del|hr|code|font|a)(\s[^>]*)?\/?>/i
const UPLOADFILE_RE = /(?:https?:\/\/blog\.xiaowuleyi\.com)?(\/content\/uploadfile\/(\d{6})\/([^)"'\s<>\\]+))/g
// tc 图床在线可下载；jpg 图床已失联（Cloudflare 1033），URL 原样保留
const TC_RE = /https?:\/\/tc\.xiaowuleyi\.com\/file\/([^)"'\s<>\\]+)/g
const JPG_RE = /https?:\/\/jpg\.xiaowuleyi\.com\/(xw\/[^)"'\s<>\\]+)/g
const EXT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }
const mimeByExt = (name) => EXT_MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream'

function slugifyAscii(title) {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (ascii.length >= 2) {
    const parts = ascii.split('-').slice(0, 6).join('-')
    if (parts.length >= 2) return parts.slice(0, 80)
  }
  return ''
}

function toSql(s) {
  if (s === null || s === undefined) return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

/* ---------------- 主流程 ---------------- */

function cmdParse(sqlPath) {
  const t = parseDump(sqlPath)
  const stats = {
    blog: t.blog.length,
    comment: t.comment.length,
    tag: t.tag.length,
    sort: t.sort.length,
    attachment: t.attachment.length,
    twitter: t.twitter.length,
  }
  // 文章统计
  let published = 0, drafts = 0, pages = 0, top = 0, withAlias = 0, withCover = 0, htmlBucket = 0
  const gids = []
  for (const b of t.blog) {
    gids.push(b.gid)
    if (b.type !== 'blog') { pages++; continue }
    if (b.hide === 'y') drafts++; else published++
    if (b.top === 'y') top++
    if (b.alias) withAlias++
    if (b.cover) withCover++
    if (HTML_RE.test(b.content)) htmlBucket++
  }
  stats.blog_detail = { published, drafts, pages, top, withAlias, withCover, htmlBucket, gid_min: Math.min(...gids), gid_max: Math.max(...gids) }
  // 标签引用完整性：blog.tags 里的 tid 是否都存在
  const tids = new Set(t.tag.map((x) => x.tid))
  let badTagRefs = 0
  for (const b of t.blog) {
    for (const tid of String(b.tags || '').split(',').filter(Boolean)) if (!tids.has(tid)) badTagRefs++
  }
  stats.badTagRefs = badTagRefs
  // 评论引用完整性
  const blogGids = new Set(gids)
  stats.comments_orphan = t.comment.filter((c) => !blogGids.has(c.gid)).length
  // 评论内容里是否有 HTML
  stats.comments_with_html = t.comment.filter((c) => /<[a-z]/i.test(c.comment)).length
  // 附件
  const files = new Map()
  for (const a of t.attachment) {
    const rel = String(a.filepath).replace(/^\.\./, '')
    const key = rel.replace('/content/uploadfile/', '')
    if (!files.has(key)) files.set(key, { url: `https://${OLD_HOST}${rel}`, size: a.filesize, mime: a.mimetype, name: a.filename, addtime: a.addtime })
  }
  stats.attachment_files = files.size
  stats.attachment_bytes = [...files.values()].reduce((s, f) => s + Number(f.size), 0)
  // 正文中引用但附件表没有的图片
  const referenced = new Set()
  for (const b of t.blog) {
    for (const m of b.content.matchAll(UPLOADFILE_RE)) referenced.add(`${m[2]}/${m[3]}`)
    if (b.cover) for (const m of b.cover.matchAll(UPLOADFILE_RE)) referenced.add(`${m[2]}/${m[3]}`)
  }
  stats.content_image_refs = referenced.size
  stats.content_refs_missing_from_attachments = [...referenced].filter((k) => !files.has(k)).length
  // 微语预览
  stats.twitter_sample = t.twitter.slice(0, 3).map((x) => String(x.content || '').slice(0, 50))
  writeFileSync(DATA_JSON, JSON.stringify(t))
  console.log(JSON.stringify(stats, null, 2))
}

function cmdConvert() {
  if (!existsSync(DATA_JSON)) { console.error('先运行 parse'); process.exit(1) }
  const t = JSON.parse(readFileSync(DATA_JSON, 'utf8'))

  const sortName = new Map(t.sort.map((s) => [Number(s.sid), s.sortname]))
  const tagName = new Map(t.tag.map((x) => [Number(x.tid), x.tagname]))

  // 第一遍：slug 分配（键统一用数字 gid）
  const usedSlugs = new Set()
  const slugOf = new Map() // gid(number) -> slug
  const slugSource = new Map()
  for (const b of t.blog) {
    if (b.type !== 'blog') continue
    const gid = Number(b.gid)
    let slug = ''
    let src = ''
    if (b.alias && /^[a-zA-Z0-9_-]{1,80}$/.test(b.alias)) { slug = b.alias; src = 'alias' }
    if (!slug) { slug = slugifyAscii(b.title); src = slug ? 'title' : 'post-<gid>' }
    if (!slug) slug = `post-${gid}`
    if (usedSlugs.has(slug)) { slug = `${slug}-${gid}`; src += '+gid' }
    usedSlugs.add(slug)
    slugOf.set(gid, slug)
    slugSource.set(gid, src)
  }

  // 第二遍：内容转换
  const posts = []
  const warnings = []
  const referencedImages = new Set()
  const tcImages = new Set()
  const deadJpgUrls = new Set()
  let internalLinksRewritten = 0

  /** 图片 URL 改写：uploadfile/tc → 新站 R2 路径，其余原样 */
  function rewriteImageUrls(text, { collectOnly = false } = {}) {
    text = text.replace(UPLOADFILE_RE, (_m, _full, ym, file) => {
      referencedImages.add(`${ym}/${file}`)
      return collectOnly ? _m : `/images/u/${ym}/${file}`
    })
    text = text.replace(TC_RE, (_m, path) => {
      tcImages.add(path)
      return collectOnly ? _m : `/images/u/tc/${path}`
    })
    text = text.replace(JPG_RE, (_m, path) => {
      deadJpgUrls.add(`https://jpg.xiaowuleyi.com/${path}`)
      return _m
    })
    return text
  }

  for (const b of t.blog) {
    if (b.type !== 'blog') { warnings.push(`跳过非文章 gid=${b.gid} type=${b.type}`); continue }
    let content = String(b.content ?? '')
    content = rewriteImageUrls(content)
    // 2) 老站内链 → 新站 /post/<slug>
    content = content.replace(new RegExp(`https?://${OLD_HOST.replace(/\./g, '\\.')}/post-(\\d+)(?:\\.html)?`, 'g'), (_m, gid) => {
      const s = slugOf.get(Number(gid))
      if (s) { internalLinksRewritten++; return `/post/${s}` }
      return _m
    })
    content = content.replace(new RegExp(`https?://${OLD_HOST.replace(/\./g, '\\.')}/\\?post=(\\d+)`, 'g'), (_m, gid) => {
      const s = slugOf.get(Number(gid))
      if (s) { internalLinksRewritten++; return `/post/${s}` }
      return _m
    })    // 3) 格式判定：含 HTML 标签 → 富文本净化；否则 Markdown（纯文本也按 MD 处理，单换行→<br>）
    const isHtml = HTML_RE.test(content)
    const contentHtml = isHtml ? sanitizeHtml(content) : mdToHtml(content)
    if (!isHtml && /<(?:video|audio|iframe)/i.test(content)) warnings.push(`gid=${b.gid} markdown 内容含媒体标签被转义，请人工检查`)

    // 标签：分类名放最前 + emlog 标签
    const tags = []
    const cat = sortName.get(Number(b.sortid))
    if (cat) tags.push(cat)
    for (const tid of String(b.tags || '').split(',').filter(Boolean)) {
      const name = tagName.get(Number(tid))
      if (name && !tags.includes(name)) tags.push(name)
    }

    const dateMs = Number(b.date) * 1000
    const isDraft = b.hide === 'y'
    const cover = rewriteImageUrls(String(b.cover ?? ''))
    posts.push({
      id: Number(b.gid),
      slug: slugOf.get(Number(b.gid)),
      title: String(b.title ?? ''),
      content: contentHtml,
      summary: String(b.excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
      cover,
      tags,
      status: isDraft ? 'draft' : 'published',
      pinned: b.top === 'y' ? 1 : 0,
      views: Number(b.views) || 0,
      likes: Number(b.like_count) || 0,
      author_id: 1,
      published_at: isDraft ? null : dateMs,
      created_at: dateMs,
      updated_at: dateMs,
      _fmt: isHtml ? 'html' : 'md',
      _slug_src: slugSource.get(b.gid),
    })
  }
  posts.sort((a, b) => a.id - b.id)

  // 评论（扁平化）
  const comments = []
  const byCid = new Map(t.comment.map((c) => [Number(c.cid), c]))
  for (const c of t.comment) {
    if (!slugOf.has(Number(c.gid))) { warnings.push(`评论 cid=${c.cid} 的文章 gid=${c.gid} 不存在，跳过`); continue }
    let content = String(c.comment ?? '')
    const parent = Number(c.pid) ? byCid.get(Number(c.pid)) : null
    // emlog 回复的正文里通常已带 @父昵称 前缀，避免重复叠加
    if (parent && !content.includes(`@${parent.poster}`)) {
      content = `回复 @${parent.poster}：${content}`
    }
    comments.push({
      id: Number(c.cid),
      post_id: Number(c.gid),
      nickname: String(c.poster ?? '匿名').slice(0, 24),
      email: String(c.mail ?? ''),
      website: String(c.url ?? ''),
      content,
      status: c.hide === 'y' ? 'pending' : 'approved',
      ip: String(c.ip ?? ''),
      created_at: Number(c.date) * 1000,
    })
  }

  // 附件清单（附件表 + 正文引用并集）
  const images = new Map()
  for (const a of t.attachment) {
    const rel = String(a.filepath).replace(/^\.\./, '')
    const m = /\/(\d{6})\/(.+)$/.exec(rel)
    if (!m) continue
    images.set(`${m[1]}/${m[2]}`, {
      key: `u/${m[1]}/${m[2]}`,
      url: `https://${OLD_HOST}${rel}`,
      size: Number(a.filesize) || 0,
      mime: a.mimetype || 'application/octet-stream',
      name: a.filename || m[2],
      addtime: Number(a.addtime) * 1000,
    })
  }
  for (const ref of referencedImages) {
    if (!images.has(ref)) {
      images.set(ref, {
        key: `u/${ref}`,
        url: `https://${OLD_HOST}/content/uploadfile/${ref}`,
        size: 0,
        mime: '',
        name: ref.split('/')[1],
        addtime: 0,
        _only_referenced: true,
      })
    }
  }
  // tc 图床文件（在线）：key 取文件名（时间戳前缀，天然唯一）
  for (const path of tcImages) {
    const base = path.split('/').pop()
    if ([...images.values()].some((i) => i.key === `u/tc/${base}`)) continue
    const tsM = /^(\d{13})_/.exec(base)
    images.set(`tc/${path}`, {
      key: `u/tc/${base}`,
      url: `https://tc.xiaowuleyi.com/file/${path}`,
      size: 0,
      mime: mimeByExt(base),
      name: base,
      addtime: tsM ? Number(tsM[1]) : 0,
      _only_referenced: true,
    })
  }
  if (deadJpgUrls.size) {
    warnings.push(`jpg.xiaowuleyi.com 图床已失联（Cloudflare 1033），${deadJpgUrls.size} 个图片 URL 无法搬迁，已原样保留，请后续人工处理`)
  }

  // 生成 SQL
  const sqls = ['-- emlog → xwblog 数据迁移（由 scripts/emlog-migrate/migrate.mjs 生成）']
  sqls.push('-- INSERT OR IGNORE：可重复执行，已存在的 id/key 会跳过')
  for (const p of posts) {
    sqls.push(
      `INSERT OR IGNORE INTO posts (id, slug, title, content, summary, cover, tags, status, pinned, views, likes, author_id, published_at, created_at, updated_at) VALUES (${p.id}, ${toSql(p.slug)}, ${toSql(p.title)}, ${toSql(p.content)}, ${toSql(p.summary)}, ${toSql(p.cover)}, ${toSql(JSON.stringify(p.tags))}, ${toSql(p.status)}, ${p.pinned}, ${p.views}, ${p.likes}, ${p.author_id}, ${p.published_at === null ? 'NULL' : p.published_at}, ${p.created_at}, ${p.updated_at});`
    )
  }
  for (const c of comments) {
    sqls.push(
      `INSERT OR IGNORE INTO comments (id, post_id, nickname, email, website, content, status, ip, created_at) VALUES (${c.id}, ${c.post_id}, ${toSql(c.nickname)}, ${toSql(c.email)}, ${toSql(c.website)}, ${toSql(c.content)}, ${toSql(c.status)}, ${toSql(c.ip)}, ${c.created_at});`
    )
  }
  for (const img of images.values()) {
    if (img._only_referenced) continue // 没有附件元数据的仍会上传，但 uploads 行在下载后补
    sqls.push(
      `INSERT OR IGNORE INTO uploads (key, name, mime, size, created_at) VALUES (${toSql(img.key)}, ${toSql(img.name.slice(0, 120))}, ${toSql(img.mime)}, ${img.size}, ${img.addtime || 0});`
    )
  }
  writeFileSync(IMPORT_SQL, sqls.join('\n') + '\n')
  writeFileSync(IMAGES_JSON, JSON.stringify([...images.values()], null, 2))

  const report = {
    posts: posts.length,
    posts_published: posts.filter((p) => p.status === 'published').length,
    posts_draft: posts.filter((p) => p.status === 'draft').length,
    posts_pinned: posts.filter((p) => p.pinned).length,
    comments: comments.length,
    comments_pending: comments.filter((c) => c.status === 'pending').length,
    images_to_upload: [...images.values()].filter((i) => !i._only_referenced).length,
    images_only_referenced: [...images.values()].filter((i) => i._only_referenced).length,
    images_tc_bed: tcImages.size,
    images_dead_jpg_bed: deadJpgUrls.size,
    internal_links_rewritten: internalLinksRewritten,
    slug_sources: [...slugSource.values()].reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {}),
    fmt_html: posts.filter((p) => p._fmt === 'html').length,
    fmt_md: posts.filter((p) => p._fmt === 'md').length,
    total_tags_distinct: new Set(posts.flatMap((p) => p.tags)).size,
    warnings,
  }
  writeFileSync(join(HERE, 'report.json'), JSON.stringify({ report, posts, comments }, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'parse') cmdParse(args[0])
else if (cmd === 'convert') cmdConvert()
else {
  console.error('用法: migrate.mjs parse <emlog.sql> | migrate.mjs convert')
  process.exit(1)
}
