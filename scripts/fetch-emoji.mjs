#!/usr/bin/env node
/**
 * 下载微信默认表情映射表用到的 Twemoji PNG 到 public/emoji/。
 * 用法：node scripts/fetch-emoji.mjs
 * 表的单一来源在 src/emoji.ts（WECHAT_EMOJI）；改表后重跑本脚本补齐资产。
 * 资产来源：jdecked/twemoji v15.1.0（社区维护的 twemoji 续命版），CC-BY 4.0——
 * 归属声明见 public/emoji/README.md。
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const OUT = join(ROOT, '..', 'public', 'emoji')
const CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72'

// 直接读 TS 源里的映射表（无构建链，用正则抽取键值对，避免引入 TS 运行时）。
// 键是中文/字母/数字混排（部分不加引号），只抽值——文件里唯一的 hex 码点就是表值
const src = readFileSync(join(ROOT, '..', 'src', 'emoji.ts'), 'utf8')
const codepoints = [...src.matchAll(/: '([0-9a-f-]+)'/g)].map((m) => m[1])
if (codepoints.length < 100) throw new Error('映射表解析过少，抽取正则可能失效')
const uniq = [...new Set(codepoints)]

mkdirSync(OUT, { recursive: true })
let ok = 0
const missing = []
for (const cp of uniq) {
  const file = join(OUT, `${cp}.png`)
  if (existsSync(file) && readFileSync(file).length > 0) {
    ok++
    continue
  }
  const res = await fetch(`${CDN}/${cp}.png`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    missing.push(cp)
    console.error(`  ✗ ${cp}: HTTP ${res.status}`)
    continue
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  ok++
}
console.log(`表情资产：${ok}/${uniq.length} 就绪（public/emoji/）`)
if (missing.length) {
  console.error(`缺失码点：${missing.join(', ')}——检查映射表或稍后重跑`)
  process.exit(1)
}
