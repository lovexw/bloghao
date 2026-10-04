#!/usr/bin/env node
/**
 * Memos → xwblog weibo 转换器。
 * 输入：data/memos.json（export.mjs 产出）
 * 输出：
 *   data/weibo_import.json   结构化转换结果（285 条，含 image_manifest 引用）
 *   data/import_weibo.sql    D1 导入 SQL（wrangler d1 execute --remote --file）
 *   data/image_manifest.json 阶段二图片上传清单（附件→R2 key→旧外链映射）
 *
 * 转换规则见 ../migration-memos/README.md（脱敏 / markdown→纯文本 / 话题 / 时间戳）。
 * 幂等：重复执行覆盖输出文件，不触碰数据库。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const DATA = fileURLToPath(new URL('./data/', import.meta.url))
const OLD_BASE = 'https://wb.xiaowuleyi.com'
const memos = JSON.parse(readFileSync(join(DATA, 'memos.json'), 'utf8'))

/* ---------- 脱敏 ---------- */
let redactions = { telegramImages: 0, botTokens: 0, passwords: 0 }
function redact(content) {
  let c = content
  // Telegram 图片引用：bot 文件 URL 已 404（2026-10-04 验证），去掉引用并记录
  c = c.replace(/!\[[^\]]*\]\(https:\/\/api\.telegram\.org\/file\/bot[^)]+\)/g, () => {
    redactions.telegramImages++
    return ''
  })
  // 其他位置的 bot token
  c = c.replace(/bot\d{6,}:[\w-]{20,}/g, () => {
    redactions.botTokens++
    return '[已脱敏]'
  })
  // 明文密码
  c = c.replace(/(密码\s*[:：]\s*)\S+/g, (_m, p1) => {
    redactions.passwords++
    return `${p1}已隐藏`
  })
  return c
}

/* ---------- Markdown → 纯文本 ---------- */
function mdToPlain(content) {
  let c = content
  // 图片引用：本站附件提取到 images；其他外部图占位
  const extracted = []
  c = c.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, _alt, url) => {
    const m = url.match(/\/file\/attachments\/([A-Za-z0-9]+)\//)
    if (m) {
      extracted.push(m[1])
      return ''
    }
    return '（外部图片）'
  })
  // 代码块围栏（保留内部内容）
  c = c.replace(/^```[^\n]*$/gm, '')
  // 链接 → text (url)
  c = c.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
  // 行内代码
  c = c.replace(/`([^`\n]+)`/g, '$1')
  // 加粗/斜体
  c = c.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\W)\*([^*\n]+)\*/g, '$1$2')
  c = c.replace(/(^|\W)_([^_\n]+)_/g, '$1$2')
  // 待办
  c = c.replace(/^\s*[-*] \[[ xX]\]\s*/gm, (mm) => (/\[[xX]\]/.test(mm) ? '☑ ' : '☐ '))
  // 标题/引用前缀
  c = c.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  c = c.replace(/^\s{0,3}>\s?/gm, '')
  // 换行规范化：行尾空格去掉，3+ 连续空行压成 1 个空行
  c = c
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
  c = c.replace(/\n{3,}/g, '\n\n').trim()
  return { text: c, extracted }
}

/* ---------- 话题提取（与 src/utils.ts extractWeiboTopics 完全一致） ---------- */
const WEIBO_TOPIC_RE = /(?<![\p{L}\p{N}#])#([^\s#&<>"']{1,24})(?:#|(?=\s)|$)/gu
function extractTopics(content) {
  const out = []
  for (const m of content.matchAll(WEIBO_TOPIC_RE)) {
    const t = m[1].trim()
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= 10) break
  }
  return out
}

/* ---------- 附件 URL ---------- */
function attachmentUrl(a) {
  const uid = a.name.replace('attachments/', '')
  return `${OLD_BASE}/file/attachments/${uid}/${encodePath(a.filename)}`
}
function encodePath(fn) {
  return fn
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/* ---------- 主转换 ---------- */
const items = []
const imageManifest = []
const issues = []

for (const m of memos) {
  if (m.state !== 'NORMAL') {
    issues.push(`跳过非 NORMAL 状态: ${m.name} (${m.state})`)
    continue
  }
  const { text, extracted } = mdToPlain(redact(m.content))
  let body = text

  const images = []
  let video = null
  const others = []
  for (const a of m.attachments ?? []) {
    if (a.type.startsWith('image/')) images.push(attachmentUrl(a))
    else if (a.type.startsWith('video/')) video = a
    else others.push(a)
    if (a.type.startsWith('image/')) {
      imageManifest.push({
        uid: a.name.replace('attachments/', ''),
        filename: a.filename,
        mime: a.type,
        size: Number(a.size),
        oldUrl: attachmentUrl(a),
        memoName: m.name,
        memoTime: m.createTime,
      })
    }
  }
  // 正文里引用了本站附件但不在 attachments 里 → 记录问题，用外链兜底
  for (const uid of extracted) {
    if (!(m.attachments ?? []).some((a) => a.name.endsWith(uid))) {
      issues.push(`${m.name}: 正文引用附件 ${uid} 不在 attachments 中，已用外链`)
      images.push(`${OLD_BASE}/file/attachments/${uid}/`)
    }
  }

  // 视频与普通附件以文本行附在正文
  if (video) body += `${body ? '\n\n' : ''}▶ 视频：${attachmentUrl(video)}`
  for (const a of others) body += `${body ? '\n\n' : ''}📎 附件：${a.filename} ${attachmentUrl(a)}`
  // 有失效 Telegram 图且移除后无任何图片 → 补占位说明
  if (m.content.includes('api.telegram.org/file/bot') && !images.length) {
    body += `${body ? '\n\n' : ''}（原 Telegram 配图已失效）`
  }

  const ts = Date.parse(m.createTime)
  items.push({
    memoName: m.name,
    content: body,
    images,
    topics: extractTopics(body),
    status: 'published',
    pinned: 0,
    likes: 0,
    created_at: ts,
    updated_at: Date.parse(m.updateTime) || ts,
    published_at: ts,
  })
}

/* ---------- SQL ---------- */
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}
const sqlLines = [
  '-- Memos → xwblog weibo 导入（migration-memos/transform.mjs 生成）',
  '-- 回滚：导入前记录 SELECT MAX(id) FROM weibo; 之后 DELETE FROM weibo WHERE id > <max>;',
  `-- 来源 memos: ${items.length} 条，时间范围 ${new Date(items[0].created_at).toISOString()} ~ ${new Date(items[items.length - 1].created_at).toISOString()}`,
  '',
]
for (const w of items) {
  sqlLines.push(`-- ${w.memoName}`)
  sqlLines.push(
    `INSERT INTO weibo (content, images, topics, status, pinned, likes, published_at, created_at, updated_at) VALUES (${q(w.content)}, ${q(
      JSON.stringify(w.images),
    )}, ${q(JSON.stringify(w.topics))}, 'published', 0, 0, ${w.published_at}, ${w.created_at}, ${w.updated_at});`,
  )
}
const sql = sqlLines.join('\n') + '\n'

/* ---------- 输出 ---------- */
writeFileSync(join(DATA, 'weibo_import.json'), JSON.stringify(items, null, 2))
writeFileSync(join(DATA, 'import_weibo.sql'), sql)
writeFileSync(join(DATA, 'image_manifest.json'), JSON.stringify(imageManifest, null, 2))

const withImg = items.filter((w) => w.images.length).length
console.log(`转换完成: ${items.length} 条`)
console.log(`  带图片: ${withImg} 条, 图片总数 ${imageManifest.length}`)
console.log(`  脱敏: telegram 图引用 ${redactions.telegramImages} 处, bot token ${redactions.botTokens} 处, 密码 ${redactions.passwords} 处`)
console.log(`  话题总数(去重): ${new Set(items.flatMap((w) => w.topics)).size}`)
if (issues.length) {
  console.log(`\n问题清单 (${issues.length}):`)
  for (const i of issues) console.log('  -', i)
}
const sqlKB = (Buffer.byteLength(sql) / 1024).toFixed(1)
console.log(`\nimport_weibo.sql: ${sqlKB} KB`)
const overLimit = items.filter((w) => w.topics.length === 10)
if (overLimit.length) console.log(`注意: ${overLimit.length} 条话题达到 10 个上限（已截断，与线上逻辑一致）`)
