#!/usr/bin/env node
/** 按 images.json 清单下载老站图片到 staging/，并生成上传结果 download-results.json */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const STAGING = join(HERE, 'staging')
const images = JSON.parse(readFileSync(join(HERE, 'images.json'), 'utf8'))
mkdirSync(STAGING, { recursive: true })

const CONCURRENCY = 4
const results = []
let cursor = 0

async function fetchOne(img) {
  const dest = join(STAGING, img.key)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(img.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) xwblog-migration/1.0' },
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) throw new Error('空文件')
      const { writeFile } = await import('node:fs/promises')
      await mkdirSync(dirname(dest), { recursive: true })
      await writeFile(dest, buf)
      results.push({ key: img.key, url: img.url, ok: true, bytes: buf.length, mime: img.mime || res.headers.get('content-type') || '' })
      return
    } catch (e) {
      if (attempt === 3) {
        results.push({ key: img.key, url: img.url, ok: false, error: String(e.message || e) })
        return
      }
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
}

async function pool() {
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < images.length) {
      const img = images[cursor++]
      await fetchOne(img)
      const done = results.length
      if (done % 10 === 0) console.log(`进度 ${done}/${images.length}`)
    }
  })
  await Promise.all(workers)
}

await pool()
results.sort((a, b) => a.key.localeCompare(b.key))
writeFileSync(join(HERE, 'download-results.json'), JSON.stringify(results, null, 2))
const ok = results.filter((r) => r.ok)
const fail = results.filter((r) => !r.ok)
console.log(`完成：成功 ${ok.length}，失败 ${fail.length}，总字节 ${ok.reduce((s, r) => s + r.bytes, 0)}`)
for (const f of fail) console.log('失败:', f.key, f.url, f.error)
