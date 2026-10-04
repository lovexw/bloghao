import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRss, buildSitemap } from '../src/rss.ts'
import type { SettingsMap } from '../src/types.ts'

const settings = {
  siteName: '测试站',
  siteDescription: '描述',
  rssFullText: '1',
} as SettingsMap

// ── sitemap（回归：文章上限曾被 listPosts clamp 到 100；分类/标签页缺失；中文 slug 未编码）──
test('sitemap 包含分类/标签页且中文做百分号编码', () => {
  const out = buildSitemap(
    settings,
    [{ slug: 'hello-world', updated_at: Date.UTC(2026, 0, 2) }],
    'https://blog.example.com',
    [{ slug: 'life-notes', name: '生活' }],
    [{ name: '生活随笔', count: 3 }]
  )
  assert.ok(out.includes('<loc>https://blog.example.com/category/life-notes</loc>'), out)
  assert.ok(out.includes('<loc>https://blog.example.com/tag/' + encodeURIComponent('生活随笔') + '</loc>'), out)
  assert.ok(out.includes('<loc>https://blog.example.com/post/hello-world</loc>'), out)
  assert.ok(out.includes('<lastmod>2026-01-02</lastmod>'), out)
})

test('sitemap 文章 slug 里的特殊字符被编码', () => {
  const out = buildSitemap(settings, [{ slug: 'a b', updated_at: 0 }], 'https://x.com')
  assert.ok(out.includes('/post/a%20b'), out)
  assert.ok(!out.includes('/post/a b'), out)
})

// ── RSS（回归防改坏：CDATA 防 ]]> 逃逸、全文开关、绝对链接）──
test('RSS 全文 CDATA 正确处理 ]]>，摘要关闭全文', () => {
  const posts = [
    { slug: 'a', title: 'T', content: '<p>x ]]> y</p>', summary: '摘要', published_at: Date.UTC(2026, 0, 1), updated_at: 0 } as never,
  ]
  const full = buildRss(settings, posts, 'https://x.com')
  assert.ok(full.includes('<content:encoded>'), '全文输出')
  assert.ok(full.includes(']]]]><![CDATA[>'), ']]> 必须被拆分')
  assert.ok(full.includes('<link>https://x.com/post/a</link>'))

  const summaryOnly = buildRss({ ...settings, rssFullText: '0' }, posts, 'https://x.com')
  assert.ok(!summaryOnly.includes('<content:encoded>'))
})
