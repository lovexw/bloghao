#!/usr/bin/env node
/**
 * 下载 memos.json 中全部附件到 data/files/{uid}/{filename}，并校验字节数与 API size 字段一致。
 * 用法：node download.mjs
 * 产出：data/files/**、data/download_report.json
 * 幂等：已存在且大小一致的文件跳过。
 */
import { writeFileSync, mkdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = 'https://wb.xiaowuleyi.com'
const DATA = fileURLToPath(new URL('./data/', import.meta.url))
const memos = JSON.parse(readFileSync(join(DATA, 'memos.json'), 'utf8'))

const attachments = []
for (const m of memos) for (const a of m.attachments ?? []) attachments.push({ memo: m.name, ...a })

mkdirSync(join(DATA, 'files'), { recursive: true })
const report = { total: attachments.length, ok: 0, skipped: 0, failed: [] }

async function downloadOne(a, idx) {
  const uid = a.name.replace('attachments/', '')
  const dir = join(DATA, 'files', uid)
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, a.filename)
  const expect = Number(a.size)
  if (existsSync(dest)) {
    const sz = statSync(dest).size
    if (sz === expect) {
      report.skipped++
      return
    }
  }
  const url = `${BASE}/file/attachments/${uid}/${encodeURIComponent(a.filename)}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length !== expect) throw new Error(`size mismatch: got ${buf.length}, expect ${expect}`)
      writeFileSync(dest, buf)
      report.ok++
      return
    } catch (e) {
      if (attempt === 3) report.failed.push({ name: a.name, filename: a.filename, url, error: String(e) })
      else await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
}

// 并发 4
let idx = 0
async function worker() {
  while (idx < attachments.length) {
    const i = idx++
    const a = attachments[i]
    process.stdout.write(`\r[${i + 1}/${attachments.length}] ${a.filename.slice(0, 40)}      `)
    await downloadOne(a, i)
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
console.log()

writeFileSync(join(DATA, 'download_report.json'), JSON.stringify(report, null, 2))
console.log(`完成: ok=${report.ok} skipped=${report.skipped} failed=${report.failed.length}`)
if (report.failed.length) console.log(JSON.stringify(report.failed, null, 2))
