import { test } from 'node:test'
import assert from 'node:assert/strict'
import { articleJsonLd, page } from '../src/render.ts'
import { DEFAULT_SETTINGS } from '../src/db.ts'

// ── 文章页 JSON-LD 结构化数据（roadmap A3）：schema.org BlogPosting ──
const base = {
  settings: { ...DEFAULT_SETTINGS, siteName: '示例站', siteUrl: 'https://blog.example.com' },
  title: '深度好文',
  description: '一篇文章的摘要',
  url: 'https://blog.example.com/post/hello',
  base: 'https://blog.example.com',
  publishedAt: Date.UTC(2026, 9, 5, 0, 30), // 北京 2026-10-05 08:30
  updatedAt: Date.UTC(2026, 9, 6, 2, 0), // 北京 2026-10-06 10:00
}

test('BlogPosting 基本结构：@context/@type/headline/mainEntityOfPage/inLanguage', () => {
  const d = articleJsonLd(base) as any
  assert.equal(d['@context'], 'https://schema.org')
  assert.equal(d['@type'], 'BlogPosting')
  assert.equal(d.headline, '深度好文')
  assert.deepEqual(d.mainEntityOfPage, { '@type': 'WebPage', '@id': 'https://blog.example.com/post/hello' })
  assert.equal(d.inLanguage, 'zh-CN')
  assert.equal(d.author['@type'], 'Person')
  assert.equal(d.author.name, '示例站')
  assert.equal(d.publisher['@type'], 'Organization')
  assert.equal(d.publisher.logo['@type'], 'ImageObject')
  assert.match(d.publisher.logo.url, /^https:\/\/blog\.example\.com\//)
})

test('datePublished/dateModified 统一北京时间 +08:00，dateModified 取发布/更新较晚者', () => {
  const d = articleJsonLd(base) as any
  assert.equal(d.datePublished, '2026-10-05T08:30:00+08:00')
  assert.equal(d.dateModified, '2026-10-06T10:00:00+08:00')
  // 定时发布场景：updated_at 早于 published_at，直接用会造成「修改早于发布」的矛盾数据
  const scheduled = articleJsonLd({ ...base, updatedAt: Date.UTC(2026, 9, 1, 0, 0) }) as any
  assert.equal(scheduled.dateModified, scheduled.datePublished)
  // 未发布过（publishedAt 缺失）回退 updatedAt，产出合法日期
  const never = articleJsonLd({ ...base, publishedAt: null }) as any
  assert.equal(never.datePublished, '2026-10-06T10:00:00+08:00')
})

test('image 与 og:image 同口径三级兜底：文章卡图 > 默认卡图 > 内置品牌卡，且绝对化', () => {
  const own = articleJsonLd({ ...base, image: '/images/u/a.jpg' }) as any
  assert.equal(own.image, 'https://blog.example.com/images/u/a.jpg')
  const def = articleJsonLd({ ...base, image: undefined }) as any
  assert.equal(def.image, 'https://blog.example.com/og-default.png')
  const custom = articleJsonLd({
    ...base,
    image: undefined,
    settings: { ...base.settings, ogImageDefault: '/images/u/b.png' },
  }) as any
  assert.equal(custom.image, 'https://blog.example.com/images/u/b.png')
  // 外链绝对地址不二次拼接
  const external = articleJsonLd({ ...base, image: 'https://cdn.example.com/card.jpg' }) as any
  assert.equal(external.image, 'https://cdn.example.com/card.jpg')
})

test('keywords 由 tags 逗号拼接，无标签不出；commentCount 有值才出', () => {
  const withTags = articleJsonLd({ ...base, tags: ['生活', '技术'], commentCount: 3 }) as any
  assert.equal(withTags.keywords, '生活, 技术')
  assert.equal(withTags.commentCount, 3)
  const bare = articleJsonLd(base) as any
  assert.equal('keywords' in bare, false)
  assert.equal('commentCount' in bare, false)
})

test('headline 超 110 字符截断（Google 建议）', () => {
  const d = articleJsonLd({ ...base, title: '长'.repeat(200) }) as any
  assert.equal(d.headline.length, 110)
})

// ── page() 的 JSON-LD 输出与注入防护 ──
const pageBase = { settings: base.settings, css: '', title: '文', path: '/post/hello', body: '' }

test('page() 传入 jsonLd 时输出 ld+json script，未传时不出', () => {
  const withLd = page({ ...pageBase, jsonLd: articleJsonLd(base) })
  assert.match(withLd, /<script type="application\/ld\+json">/)
  const noLd = page({ ...pageBase })
  assert.doesNotMatch(noLd, /application\/ld\+json/)
})

test('标题带 </script> 不逃逸脚本标签：JSON 内 < 转成 \\u003c，且反序列化后无损', () => {
  const evil = '</script><script>alert(1)</script>'
  const html = page({ ...pageBase, jsonLd: articleJsonLd({ ...base, title: `好文 ${evil}` }) })
  // 原始 </script><script> 相邻序列不得出现（唯一合法的 </script> 是 ld+json 标签自身的闭合）
  assert.ok(!html.includes('</script><script>alert'))
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  assert.ok(m, 'ld+json script 存在')
  const parsed = JSON.parse(m[1]) as any
  assert.equal(parsed.headline, `好文 ${evil}`)
})

test('JSON-LD 产物是合法 JSON 且与 og:image 同源（image 字段 == og:image meta）', () => {
  const jsonLd = articleJsonLd({ ...base, image: '/images/u/a.jpg' })
  const html = page({ ...pageBase, jsonLd, ogImage: '/images/u/a.jpg' })
  const ogMatch = html.match(/<meta property="og:image" content="([^"]+)">/)
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  assert.ok(ogMatch && ldMatch)
  const parsed = JSON.parse(ldMatch[1]) as any
  assert.equal(parsed.image, ogMatch[1])
})
