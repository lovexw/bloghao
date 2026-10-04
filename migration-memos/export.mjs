#!/usr/bin/env node
/**
 * Memos 全量导出：https://wb.xiaowuleyi.com/api/v1/memos 分页拉取全部 PUBLIC memo。
 * 用法：node export.mjs
 * 产出：data/memos.json（按 createTime 升序排列的 memo 数组）
 * 幂等：可重复执行，覆盖上次结果。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BASE = 'https://wb.xiaowuleyi.com'
const PAGE_SIZE = 50
const OUT = fileURLToPath(new URL('./data/memos.json', import.meta.url))

async function fetchPage(pageToken = '') {
  const url = new URL('/api/v1/memos', BASE)
  url.searchParams.set('pageSize', String(PAGE_SIZE))
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

const all = []
let pageToken = ''
let pages = 0
do {
  const d = await fetchPage(pageToken)
  const memos = d.memos ?? []
  all.push(...memos)
  pages++
  console.log(`page ${pages}: +${memos.length} (累计 ${all.length}), nextPageToken=${JSON.stringify(d.nextPageToken ?? '')}`)
  pageToken = d.nextPageToken ?? ''
  if (pageToken) await new Promise((r) => setTimeout(r, 400))
} while (pageToken)

// 时间升序（旧→新），与微博时间线语义一致
all.sort((a, b) => a.createTime.localeCompare(b.createTime))

mkdirSync(fileURLToPath(new URL("./data/", import.meta.url)), { recursive: true })
writeFileSync(OUT, JSON.stringify(all, null, 2))

// 统计
const stats = {
  total: all.length,
  pages,
  first: all[0]?.createTime,
  last: all[all.length - 1]?.createTime,
  visibility: {},
  withAttachments: 0,
  attachments: 0,
  attachmentTypes: {},
  externalLinks: 0,
  mdImageRefs: 0,
  tags: {},
  states: {},
}
for (const m of all) {
  stats.visibility[m.visibility] = (stats.visibility[m.visibility] ?? 0) + 1
  stats.states[m.state] = (stats.states[m.state] ?? 0) + 1
  if (m.attachments?.length) stats.withAttachments++
  stats.attachments += m.attachments?.length ?? 0
  for (const a of m.attachments ?? []) stats.attachmentTypes[a.type] = (stats.attachmentTypes[a.type] ?? 0) + 1
  for (const t of m.tags ?? []) stats.tags[t] = (stats.tags[t] ?? 0) + 1
  stats.externalLinks += (m.content.match(/!?\[[^\]]*\]\(/g) ?? []).length
  stats.mdImageRefs += (m.content.match(/!\[[^\]]*\]\(/g) ?? []).length
}
console.log('\n===== 统计 =====')
console.log(JSON.stringify(stats, null, 2))
console.log(`\n已写出 ${OUT}`)
