import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weiboCards, type WeiboItemView } from '../src/render.ts'
import { DEFAULT_SETTINGS } from '../src/db.ts'

// ── 前台微博卡管理（编辑/置顶/删除）：按钮只在管理员登录时渲染（weiboCards 的 adminName 参数）──
const item: WeiboItemView = {
  id: 42,
  content: '随手记一条',
  images: [],
  created_at: 1759651200000,
  likes: 3,
  commentCount: 1,
}
const base = { settings: DEFAULT_SETTINGS, items: [item], avatarHtml: '<i class="ava"></i>' }

test('访客（不传 adminName）不渲染任何管理按钮', () => {
  const html = weiboCards(base)
  assert.ok(!html.includes('wb-admin'))
  assert.ok(!html.includes('data-wb-act'))
  assert.ok(!html.includes('>编辑<'))
  assert.ok(!html.includes('>删除<'))
})

test('管理员（传 adminName）渲染管理操作：data-wb-admin 带微博 id，编辑/置顶/删除三键', () => {
  const html = weiboCards({ ...base, adminName: '站长' })
  assert.match(html, /data-wb-admin="42"/)
  assert.match(html, /data-wb-act="edit"[\s\S]*?>编辑</)
  assert.match(html, /data-wb-act="pin"[\s\S]*?>置顶</)
  assert.match(html, /data-wb-act="del"[\s\S]*?>删除</)
  // 管理操作仍保留点赞与评论（同一底栏）
  assert.match(html, /like-btn/)
  assert.match(html, /wb-cmt-toggle/)
})

test('已置顶卡片：is-pinned 类 + 「置顶」标签 + 按钮文案为「取消置顶」', () => {
  const html = weiboCards({ ...base, items: [{ ...item, pinned: true }], adminName: '站长' })
  assert.match(html, /wb-card is-pinned/)
  assert.match(html, /<span class="wb-pin">置顶<\/span>/)
  assert.match(html, /data-wb-act="pin"[\s\S]*?>取消置顶</)
})

test('管理按钮的删除键带 is-danger 标记（主题 CSS 据此上危险色）', () => {
  const html = weiboCards({ ...base, adminName: '站长' })
  assert.match(html, /wb-admin-btn is-danger/)
})

test('卡片正文与 id 均经转义：正文 HTML 不逃逸、不破坏 data-wb-admin 属性', () => {
  const html = weiboCards({
    ...base,
    items: [{ ...item, id: 7, content: '<script>alert(1)</script> #" onclick="#' }],
    adminName: '站长',
  })
  assert.ok(!html.includes('<script>'))
  assert.match(html, /data-wb-admin="7"/)
})
