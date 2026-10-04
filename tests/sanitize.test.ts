import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeHtml } from '../src/sanitize.ts'

// ── 危险协议拦截（回归：jav\tascript: 混淆曾绕过前缀正则）──
test('javascript: href 被剥除', () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), '<a>x</a>')
})

test('tab 混淆的 javascript: 被剥除（URL 解析器会忽略 tab）', () => {
  assert.equal(sanitizeHtml('<a href="java\tscript:alert(1)">y</a>'), '<a>y</a>')
})

test('数字实体混淆被双重转义，浏览器解码后是字面文本而非 tab', () => {
  // &#9; 若被放行成原始 tab，浏览器 URL 解析时会剥掉它变成 javascript:；
  // 这里 escAttr 把 & 再转义成 &amp;#9;，浏览器属性解码一轮后只是字面文本「&#9;」，URL 为相对路径
  const out = sanitizeHtml('<a href="java&#9;script:alert(1)">z</a>')
  assert.ok(out.includes('&amp;#9;'), `& 必须被再次转义，实际: ${out}`)
  assert.ok(!out.includes('\t'), '输出中不得存在原始 tab')
  assert.equal(sanitizeHtml('<a href="java&#x9;script:alert(1)">z</a>').includes('&amp;#x9;'), true)
})

test('data:/vbscript: 等协议一律拒绝，http(s) 保留并带 rel', () => {
  assert.equal(sanitizeHtml('<a href="data:text/html,<b>">x</a>'), '<a>x</a>')
  assert.equal(sanitizeHtml('<a href="vbscript:msgbox(1)">x</a>'), '<a>x</a>')
  assert.equal(
    sanitizeHtml('<a href="https://example.com">ok</a>'),
    '<a href="https://example.com" rel="noopener noreferrer">ok</a>'
  )
})

// ── id 剥除（回归：全局放行 id 曾可 DOM clobbering 打瘫评论区）──
test('id 属性一律剥除，class 保留', () => {
  assert.equal(sanitizeHtml('<p id="comment-form" class="keep">x</p>'), '<p class="keep">x</p>')
  assert.equal(sanitizeHtml('<img id="like-btn" src="/images/u/a.png">'), '<img src="/images/u/a.png">')
})

// ── 危险标签（回归：script 内容曾可能被保留）──
test('script 连同内容整体丢弃', () => {
  assert.equal(sanitizeHtml('前<script>alert(1)</script>后'), '前后')
})

test('事件属性剥除、未知标签剥壳留字', () => {
  assert.equal(sanitizeHtml('<p onclick="alert(1)">x</p>'), '<p>x</p>')
  assert.equal(sanitizeHtml('<custom-tag>内容</custom-tag>'), '内容')
})

// ── OG 卡图例外（回归：文档曾未说明，测试防误删该功能）──
test('meta data-og-image 站内路径原样保留', () => {
  const tag = '<meta data-og-image="/images/og/abc.png" content="/images/og/abc.png">'
  assert.equal(sanitizeHtml(tag), '<meta data-og-image="/images/og/abc.png" content="/images/og/abc.png">')
})

test('meta 无 data-og-image 仍被丢弃', () => {
  assert.equal(sanitizeHtml('<meta charset="utf-8">'), '')
})
