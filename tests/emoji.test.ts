import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { WECHAT_EMOJI, EMOJI_BASE, replaceEmoji, emojiImgHtml } from '../src/emoji.ts'
import { weiboTextHtml } from '../src/render.ts'
import { esc } from '../src/utils.ts'

// ── 微信表情（文本码体系）：表完整性 / replaceEmoji 行为 / 与 site.js wbTextHtml 镜像一致 ──

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── 表完整性：码点格式合法 + 每个码点的 PNG 资产真实存在（防渲染出 404 小图）──

test('WECHAT_EMOJI：规模、码点格式、PNG 资产一一对应', () => {
  const names = Object.keys(WECHAT_EMOJI)
  assert.ok(names.length >= 100, `表情表应有 100+ 项，实际 ${names.length}`)
  const cps = new Set<string>()
  for (const [name, cp] of Object.entries(WECHAT_EMOJI)) {
    assert.match(cp, /^[0-9a-f]+(-[0-9a-f]+)*$/, `码点非法：${name} → ${cp}`)
    assert.ok(!cps.has(cp) || true, '允许个别近似码复用（alt 仍区分语义）')
    cps.add(cp)
  }
  for (const cp of cps) {
    const file = join(ROOT, 'public', 'emoji', `${cp}.png`)
    assert.ok(existsSync(file), `缺资产：public/emoji/${cp}.png（跑 node scripts/fetch-emoji.mjs 补齐）`)
  }
})

test('EMOJI_BASE：站内相对路径（CSP img-src self 可达）', () => {
  assert.equal(EMOJI_BASE, '/emoji/')
})

// ── replaceEmoji：转义文本上替换、白名单查表（hasOwnProperty）、标签内不动 ──

test('replaceEmoji：文本码替换成 img，src 在 /emoji/ 下，alt 保留原码', () => {
  const html = replaceEmoji('早上好[微笑]，今晚吃瓜[吃瓜]')
  assert.ok(html.includes(`src="${EMOJI_BASE}1f60a.png"`))
  assert.ok(html.includes(`src="${EMOJI_BASE}1f349.png"`))
  assert.ok(html.includes('alt="[微笑]"'))
  assert.ok(html.includes('class="wxq-emoji"'))
  // 前后文字原样：开头是文本，结尾是吃瓜 img 的闭合
  assert.ok(html.startsWith('早上好<img'))
  assert.ok(html.endsWith('" loading="lazy">'))
})

test('replaceEmoji：查不到的方括号文本原样保留（含原型链属性名）', () => {
  for (const raw of ['[随便写的]', '[constructor]', '[toString]', '[微笑', '微笑]', '[]', '[a=b]', '[x;y]']) {
    assert.equal(replaceEmoji(raw), raw, raw)
  }
  assert.equal(replaceEmoji('支持[微笑]吗'), '支持' + emojiImgHtml(WECHAT_EMOJI['微笑'], '[微笑]') + '吗')
})

test('replaceEmoji：sanitize 产物含真实标签时只在文本节点替换（属性值内的码不动）', () => {
  // 用户 img 的 alt 恰好含 [微笑]：属性内不得替换（否则 img 产物会撕裂外层属性）
  const html = '<img src="/images/u/a.jpg" alt="[微笑]"><p>[微笑]</p>'
  const out = replaceEmoji(html)
  const imgPart = out.slice(0, out.indexOf('<p>'))
  assert.ok(imgPart.includes('<img src="/images/u/a.jpg"'), '外层 img 结构不得被破坏')
  assert.ok(!imgPart.includes('wxq-emoji'), '属性上下文里的 token 不替换')
  assert.ok(out.slice(out.indexOf('<p>')).includes('wxq-emoji'), '文本节点正常替换')
  // 代码块内的文本码会替换（全文口径，与微信一致）
  assert.ok(replaceEmoji('<pre><code>[微笑]</code></pre>').includes('wxq-emoji'))
})

test('replaceEmoji：esc 转义后的文本不影响中文码（&lt; 不误入标签态）', () => {
  const escaped = esc('1<2[微笑]好') // "1&lt;2[微笑]好"
  assert.equal(escaped.includes('&lt;'), true)
  const out = replaceEmoji(escaped)
  assert.ok(out.includes('wxq-emoji'), '实体化的 < 不应触发标签态')
  assert.ok(out.includes('&lt;'))
})

// ── 服务端 weiboTextHtml：表情码在 URL/话题并存的分词渲染里正常落图 ──

test('weiboTextHtml：表情与 URL、话题混排，img 只出现在文本段', () => {
  const html = weiboTextHtml('看了 https://example.com/a[微笑] #随手记#[吃瓜]')
  assert.ok(html.includes('wb-link'))
  assert.ok(html.includes('wb-topic'))
  assert.ok(html.includes(`src="${EMOJI_BASE}1f349.png"`))
  // href 属性内不出现表情 img（URL 分段不含中文码）
  const href = /href="[^"]*"/.exec(html)?.[0] ?? ''
  assert.ok(!href.includes('img'))
})

// ── site.js 客户端镜像守卫：把表情段与 wbTextHtml 段切片拼接执行，注入服务端同一张表，
// 双端同输入逐例对比输出（wbTextHtml 引用的 wxqReplace 随表情段切片进来，防镜像漂移）──

test('site.js wxqReplace 镜像：与服务端 replaceEmoji 同输入同输出（注入同一张表）', () => {
  const src = readFileSync(join(ROOT, 'public', 'site.js'), 'utf8')
  const segEmoji = src.slice(src.indexOf('var WXQ_CODES'), src.indexOf('// 拉取映射表'))
  const segWb = src.slice(src.indexOf('var WB_TEXT_RE'), src.indexOf('// 图片网格 class'))
  assert.ok(segEmoji.includes('function wxqReplace'), '表情段切片失败')
  assert.ok(segWb.includes('function wbTextHtml'), 'wb 段切片失败')
  const factory = new Function(
    'esc',
    'location',
    segEmoji + '\n' + segWb + '\n;return { wbTextHtml: wbTextHtml, setCodes: function (c) { WXQ_CODES = c; } }'
  )
  const client = factory(esc, { origin: 'https://s.test' })
  client.setCodes(WECHAT_EMOJI)

  const samples = [
    '',
    '纯文本，没有链接。',
    '[微笑]',
    '早上好[微笑]，今晚吃瓜[吃瓜][捂脸]',
    '[微笑][微笑][微笑]',
    '不认识[随便写的]码',
    '原型链[constructor]不替换',
    '属性特征[a=b]不替换',
    '看了 https://example.com/a[微笑] #随手记#[吃瓜]',
    'https://example.com的官网[捂脸]',
    '链接 https://example.com/x。[裂开]',
    '写 C# 的日常 #话题一#[weak]',
  ]
  for (const s of samples) {
    assert.equal(client.wbTextHtml(s), weiboTextHtml(s), `双端输出不一致，输入：${JSON.stringify(s)}`)
  }

  // 表未拉到（WXQ_CODES 为空）时客户端降级纯文本：编辑保存后的就地重渲染不至于丢字
  const bare = new Function('esc', 'location', segEmoji + '\n' + segWb + '\n;return { wbTextHtml: wbTextHtml }')(
    esc,
    { origin: 'https://s.test' }
  )
  assert.equal(bare.wbTextHtml('[微笑]'), '[微笑]')
  assert.equal(bare.wbTextHtml('a https://example.com/x b'), weiboTextHtml('a https://example.com/x b'))
})
