import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOnThisDayItems, ON_THIS_DAY_MAX, type OnThisDayRow } from '../src/db.ts'
import { onThisDayCard } from '../src/render.ts'

// ── buildOnThisDayItems：文章 + 微博合并口径（回归：以前只取最新 4 条，当天历史再多也被挤丢）──

// 查询时刻固定为北京 2026-10-05 12:00（UTC 04:00），用例不随真实日期漂移
const NOW = Date.UTC(2026, 9, 5, 4, 0)
const yearTs = (y: number, hour = 4) => Date.UTC(y, 9, 5, hour)
const row = (over: Partial<OnThisDayRow>): OnThisDayRow => ({
  key: 'k',
  title: '',
  content: '',
  images: '',
  ts: NOW,
  ...over,
})

test('合并文章与微博，跨年份按时间倒序，yearsAgo 按北京年份计', () => {
  const items = buildOnThisDayItems(
    [row({ key: 'p1', title: '去年的文章', ts: yearTs(2025) })],
    [
      row({ key: '11', content: '五年前的微博', ts: yearTs(2021) }),
      row({ key: '22', content: '三年前的微博', ts: yearTs(2023) }),
    ],
    NOW
  )
  assert.deepEqual(
    items.map((i) => [i.kind, i.yearsAgo]),
    [
      ['post', 1],
      ['weibo', 3],
      ['weibo', 5],
    ]
  )
  assert.equal(items[0].href, '/post/p1')
  assert.equal(items[1].href, '/weibo?wb=22#wb-22')
})

test('微博文案：纯图提示「发了 N 张图」，无文字无图的剔除，长文截到 64 字', () => {
  const items = buildOnThisDayItems(
    [],
    [
      row({ key: '1', images: '["/images/a.jpg","/images/b.jpg","/images/c.jpg"]' }),
      row({ key: '2', content: '   ', images: '' }),
      row({ key: '3', content: '今'.repeat(100), ts: yearTs(2024) }),
    ],
    NOW
  )
  assert.equal(items.length, 2)
  assert.equal(items[0].text, '发了 3 张图')
  assert.ok(items[1].text.length <= 65, '64 字 + 省略号')
  assert.ok(items[1].text.endsWith('…'))
})

test('封顶 ON_THIS_DAY_MAX 条，保留最新的那段', () => {
  const rows = Array.from({ length: ON_THIS_DAY_MAX + 5 }, (_, i) =>
    row({ key: String(i), content: `微博 ${i}`, ts: NOW - i * 1000 })
  )
  const items = buildOnThisDayItems([], rows, NOW)
  assert.equal(items.length, ON_THIS_DAY_MAX)
  assert.equal(items[0].text, '微博 0')
})

// ── onThisDayCard：前 4 条直出，其余进原生 <details> 折叠区（无 JS，CSP 安全）──

const item = (n: number) => ({ kind: 'weibo' as const, href: `/weibo?wb=${n}#wb-${n}`, text: `条目 ${n}`, ts: NOW - n * 1000, yearsAgo: 1 })

test('不足 4 条（含空/null）不渲染折叠区，空数据不渲染卡片', () => {
  for (const items of [null, undefined, [], [item(1)], [item(1), item(2), item(3)]]) {
    const out = onThisDayCard(items)
    assert.equal(out.includes('<details'), false)
    assert.equal(out.includes('otd-fold'), false)
  }
  assert.equal(onThisDayCard(null), '')
  const three = onThisDayCard([item(1), item(2), item(3)])
  assert.equal((three.match(/class="otd-item"/g) || []).length, 3)
})

test('4 条整不折叠；12 条（如去年同日 8 微博 + 4 文章）全部渲染，摘要报「展开其余 8 条」', () => {
  const four = onThisDayCard([item(1), item(2), item(3), item(4)])
  assert.equal(four.includes('<details'), false)
  assert.equal((four.match(/class="otd-item"/g) || []).length, 4)

  const twelve = onThisDayCard(Array.from({ length: 12 }, (_, i) => item(i + 1)))
  assert.equal((twelve.match(/class="otd-item"/g) || []).length, 12, '12 条都在，一条不丢')
  assert.ok(twelve.includes('<details class="otd-more">'))
  assert.ok(twelve.includes('展开其余 8 条'))
  assert.ok(twelve.includes('otd-fold-more') && twelve.includes('otd-fold-less'), '开/合两态文案齐备')
  // 直出的是最新的 4 条，其余按时间倒序进折叠区
  assert.ok(twelve.indexOf('条目 4') < twelve.indexOf('<details'))
  assert.ok(twelve.indexOf('条目 5') > twelve.indexOf('<details'))
  assert.ok(twelve.indexOf('条目 5') < twelve.indexOf('条目 12'))
})

test('条目文本经实体转义，防微博正文夹带标签', () => {
  const out = onThisDayCard([
    { kind: 'weibo', href: '/weibo?wb=1#wb-1', text: '<img src=x onerror=alert(1)>你好', ts: yearTs(2025), yearsAgo: 1 },
  ])
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;你好'))
  assert.ok(!out.includes('<img src=x'))
})
