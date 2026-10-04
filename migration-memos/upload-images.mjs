#!/usr/bin/env node
/**
 * 阶段二：把 107 张图片从本地上传到 R2（xwblog-images），生成 URL 替换 SQL。
 * 数据来源：data/image_manifest.json（transform.mjs 产出，含 107 张图 + 旧外链）。
 *
 * 两种模式（二选一）：
 *   A. Cloudflare API Token（需 R2 写权限）：
 *        CLOUDFLARE_API_TOKEN=xxx node upload-images.mjs
 *      直传 R2（PUT /accounts/{aid}/r2/buckets/xwblog-images/objects/{key}）。
 *   B. 博客管理员账号（走 /api/admin/upload）：
 *        node upload-images.mjs --blog https://<博客域名> --user <用户名> --pass <密码>
 *
 * 产出：
 *   - R2 对象，key 沿用线上规则 u/{memo年月}/{base36时间戳}{随机}.{ext}
 *   - data/replace_urls.sql —— 先登记 uploads 表，再把 weibo.images/content 里的旧外链替换成 /images/{key}
 *   执行替换：wrangler d1 execute xwblog-db --remote --file=data/replace_urls.sql
 *
 * 幂等：R2 上传前 GET 对象存在则跳过；SQL 重新生成。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const DATA = fileURLToPath(new URL('./data/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(DATA, 'image_manifest.json'), 'utf8'))
const BUCKET = 'xwblog-images'
const ACCOUNT_ID = 'edbcf0ec7c3ee185334d13d9077ef6e9'

const args = process.argv.slice(2)
function arg(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const BLOG = arg('--blog')
const USER = arg('--user')
const PASS = arg('--pass')
if (!CF_TOKEN && !(BLOG && USER && PASS)) {
  console.error('用法：CLOUDFLARE_API_TOKEN=xxx node upload-images.mjs\n      node upload-images.mjs --blog https://域名 --user 用户名 --pass 密码')
  process.exit(1)
}

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/* key 生成：与 src/api.ts /admin/upload 同规则，月份取 memo 原始发布时间 */
function makeKey(item) {
  const d = new Date(item.memoTime)
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  const ext = EXT_BY_MIME[item.mime] || item.filename.split('.').pop().toLowerCase()
  const stamp = BigInt(Date.parse(item.memoTime)).toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `u/${ym}/${stamp}${rand}.${ext}`
}

async function r2Exists(key, token) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, range: 'bytes=0-0' },
  })
  return res.status === 200
}
async function r2Put(key, buf, mime, token) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': mime },
    body: buf,
  })
  if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status} ${await res.text()}`)
}

let sessionCookie = null
async function blogLogin(base) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (!res.ok) throw new Error(`登录失败: ${res.status} ${await res.text()}`)
  const set = res.headers.get('set-cookie') || ''
  sessionCookie = set.split(';')[0]
  if (!sessionCookie) throw new Error('未取到 session cookie')
}
async function blogUpload(base, buf, filename, mime) {
  const form = new FormData()
  form.append('file', new Blob([buf], { type: mime }), filename)
  const res = await fetch(`${base}/api/admin/upload`, {
    method: 'POST',
    headers: { cookie: sessionCookie },
    body: form,
  })
  if (!res.ok) throw new Error(`上传 ${filename}: ${res.status} ${await res.text()}`)
  return res.json() // { ok, url: '/images/u/...', key }
}

const mappingPath = join(DATA, 'upload_mapping.json')
/* 断点续传：mapping 持久化，重跑时跳过已上传的旧链（SQL 始终按完整 mapping 生成） */
let mapping = []
if (existsSync(mappingPath)) {
  try {
    mapping = JSON.parse(readFileSync(mappingPath, 'utf8'))
  } catch {}
}
const doneOld = new Set(mapping.map((m) => m.oldUrl))
let ok = 0
let skip = doneOld.size
const failed = []

let lastUploadAt = 0
async function throttleBlog() {
  // 后台上传接口限 60 次/分钟，保持 <1 次/1.1s
  const wait = lastUploadAt + 1100 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastUploadAt = Date.now()
}

for (const item of manifest) {
  if (doneOld.has(item.oldUrl)) continue
  const local = join(DATA, 'files', item.uid, item.filename)
  if (!existsSync(local)) {
    failed.push({ uid: item.uid, error: '本地文件缺失，先跑 download.mjs' })
    continue
  }
  const buf = readFileSync(local)
  if (buf.length !== item.size) {
    failed.push({ uid: item.uid, error: `本地大小 ${buf.length} 与清单 ${item.size} 不符` })
    continue
  }
  const key = makeKey(item)
  try {
    if (CF_TOKEN) {
      if (await r2Exists(key, CF_TOKEN)) skip++
      else {
        await r2Put(key, buf, item.mime, CF_TOKEN)
        ok++
      }
    } else {
      await throttleBlog()
      if (!sessionCookie) await blogLogin(BLOG)
      const r = await blogUpload(BLOG, buf, item.filename, item.mime)
      mapping.push({ oldUrl: item.oldUrl, newUrl: r.url, key: r.key, ...item })
      writeFileSync(mappingPath, JSON.stringify(mapping, null, 2))
      ok++
      continue
    }
    mapping.push({ oldUrl: item.oldUrl, newUrl: `/images/${key}`, key, ...item })
  } catch (e) {
    failed.push({ uid: item.uid, filename: item.filename, error: String(e) })
  }
  process.stdout.write(`\r[${mapping.length + failed.length}/${manifest.length}] ok=${ok} skip=${skip} fail=${failed.length}   `)
}
console.log()

/* 生成替换 SQL：uploads 登记 + weibo.images 与正文外链替换 */
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}
const lines = [
  '-- 阶段二：图片落 R2 后的 URL 替换（upload-images.mjs 生成）',
  '-- 回滚：把下面的 REPLACE 反向执行一次即可（newUrl → oldUrl）',
  '',
]
for (const m of mapping) {
  const createdAt = Date.parse(m.memoTime)
  lines.push(
    `INSERT INTO uploads (key, name, mime, size, created_at) VALUES (${q(m.key)}, ${q(m.filename.slice(0, 120))}, ${q(m.mime)}, ${m.size}, ${createdAt}) ON CONFLICT(key) DO NOTHING;`,
  )
  lines.push(`UPDATE weibo SET images = REPLACE(images, ${q(m.oldUrl)}, ${q(m.newUrl)});`)
  lines.push(`UPDATE weibo SET content = REPLACE(content, ${q(m.oldUrl)}, ${q(m.newUrl)});`)
}
writeFileSync(join(DATA, 'replace_urls.sql'), lines.join('\n') + '\n')

mkdirSync(DATA, { recursive: true })
writeFileSync(join(DATA, 'upload_report.json'), JSON.stringify({ ok, skip, failed, mappingCount: mapping.length }, null, 2))
console.log(`上传完成: ok=${ok} skip=${skip} fail=${failed.length}`)
console.log(`替换 SQL: ${mapping.length} 组 → data/replace_urls.sql`)
console.log('下一步: wrangler d1 execute xwblog-db --remote --file=migration-memos/data/replace_urls.sql')
if (failed.length) console.log('失败清单:', JSON.stringify(failed, null, 2))
