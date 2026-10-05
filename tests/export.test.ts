import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectImageKeysFromHtml, frontMatter, rewriteImageLinks } from '../src/export.ts'

// ── front-matter：值双引号包裹、内部引号转义、可选项缺省不输出 ──
test('frontMatter 组装与转义', () => {
  const fm = frontMatter({
    title: '我的"第一篇"文章',
    slug: 'hello-world',
    date: '2026-10-05 12:00:00',
    status: 'published',
    tags: ['生活', 'Cloudflare'],
    category: '随笔',
    cover: '/images/u/202510/x.png',
    summary: '含\\反斜杠的摘要',
  })
  assert.ok(fm.startsWith('---\n') && fm.endsWith('\n---'))
  assert.ok(fm.includes('title: "我的\\"第一篇\\"文章"'))
  assert.ok(fm.includes('tags: ["生活", "Cloudflare"]'))
  assert.ok(fm.includes('cover: "images/u/202510/x.png"'))
  assert.ok(fm.includes('summary: "含\\\\反斜杠的摘要"'))
  const minimal = frontMatter({ title: 'T', slug: 't', date: '', status: 'draft', tags: [] })
  assert.ok(!minimal.includes('category:'), '无分类不输出该行')
})

// ── 正文图片链接改写为包内相对路径，外链不动 ──
test('rewriteImageLinks 只改写站内 /images/ 前缀', () => {
  const md = '![a](/images/u/202510/a.png) ![b](https://cdn.example.com/b.png) [文](/page/about)'
  assert.equal(
    rewriteImageLinks(md),
    '![a](images/u/202510/a.png) ![b](https://cdn.example.com/b.png) [文](/page/about)'
  )
})

// ── 图片 key 收集：img src + OG 卡图 meta；外链/非法一律排除 ──
test('collectImageKeysFromHtml 收集站内图与 OG 卡图', () => {
  const html =
    '<p><img src="/images/u/202510/a.png" alt="a"></p><img src="https://example.com/out.jpg"><meta data-og-image="/images/og/x.png">'
  assert.deepEqual(collectImageKeysFromHtml(html), ['u/202510/a.png', 'og/x.png'])
  assert.deepEqual(collectImageKeysFromHtml('<p>没有图</p>'), [])
})
