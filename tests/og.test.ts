import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page } from '../src/render.ts'
import { DEFAULT_SETTINGS } from '../src/db.ts'

// ── 分享卡图三级兜底：文章专属卡图 > 后台默认卡图 > 内置 /og-default.png ──
const base = { settings: { ...DEFAULT_SETTINGS, siteUrl: 'https://blog.example.com' }, css: '', title: '文', path: '/post/a', body: '' }

test('og:image 优先用文章专属卡图（ogImage 参数）', () => {
  const html = page({ ...base, ogImage: '/images/u/a.jpg' })
  assert.match(html, /<meta property="og:image" content="https:\/\/blog\.example\.com\/images\/u\/a\.jpg">/)
})

test('og:image 其次用后台设置的默认卡图（ogImageDefault）', () => {
  const html = page({ ...base, settings: { ...base.settings, ogImageDefault: '/images/u/b.png' } })
  assert.match(html, /<meta property="og:image" content="https:\/\/blog\.example\.com\/images\/u\/b\.png">/)
})

test('og:image 最后兜底内置品牌卡图，且绝不缺位（无图的页面分享不再是灰图标）', () => {
  const html = page({ ...base })
  assert.match(html, /<meta property="og:image" content="https:\/\/blog\.example\.com\/og-default\.png">/)
  const noSite = page({ ...base, settings: { ...DEFAULT_SETTINGS }, origin: 'https://fallback.example.com' })
  assert.match(noSite, /<meta property="og:image" content="https:\/\/fallback\.example\.com\/og-default\.png">/)
})

test('og:image 支持绝对地址外链（不做二次拼接）', () => {
  const html = page({ ...base, ogImage: 'https://cdn.example.com/card.jpg' })
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn\.example\.com\/card\.jpg">/)
})

// ── twitter:card 与辅助标签 ──
test('twitter:card 恒为 summary_large_image（X 大卡片）', () => {
  assert.match(page({ ...base }), /<meta name="twitter:card" content="summary_large_image">/)
})

test('og:site_name 与 og:image:alt 输出，og:image:alt 用页面标题', () => {
  const html = page({ ...base, title: '深度好文', settings: { ...DEFAULT_SETTINGS, siteName: '示例站', siteUrl: 'https://blog.example.com' } })
  assert.match(html, /<meta property="og:site_name" content="示例站">/)
  assert.match(html, /<meta property="og:image:alt" content="深度好文">/)
})

test('og:image:alt 与 og:title 均经 esc 转义，标题带引号不破坏属性', () => {
  const html = page({ ...base, title: '说"你好"', settings: { ...DEFAULT_SETTINGS, siteUrl: 'https://blog.example.com' } })
  assert.match(html, /<meta property="og:image:alt" content="说&quot;你好&quot;">/)
  assert.match(html, /<meta property="og:title" content="说&quot;你好&quot;">/)
})

test('文章页 og:type=article，其他页面 website', () => {
  assert.match(page({ ...base }), /<meta property="og:type" content="article">/)
  assert.match(page({ ...base, path: '/' }), /<meta property="og:type" content="website">/)
})
