import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mdToHtml } from '../src/markdown.ts'

// ── 行内转义只做一次（回归：escAttr 二次转义曾把含 & 的 URL 打成坏链）──
test('链接 URL 含 & 单次转义，不再出现 &amp;amp;', () => {
  const out = mdToHtml('[x](https://e.com/?a=1&b=2)')
  assert.ok(out.includes('href="https://e.com/?a=1&amp;b=2"'), out)
  assert.ok(!out.includes('&amp;amp;'), out)
})

test('图片 URL 带参数同样单次转义', () => {
  const out = mdToHtml('![图](https://e.com/i.png?v=1&w=2)')
  assert.ok(out.includes('src="https://e.com/i.png?v=1&amp;w=2"'), out)
})

test('行内代码里的 & 正常显示', () => {
  assert.ok(mdToHtml('`a & b`').includes('<code>a &amp; b</code>'))
})

test('标题里的 < 被转义', () => {
  assert.ok(mdToHtml('# a < b').includes('<h1>a &lt; b</h1>'))
})

// ── 危险协议（回归：jav\tascript: 混淆曾绕过）──
test('tab 混淆的 javascript: 链接不生成锚点', () => {
  const out = mdToHtml('[点我](java\tscript:alert(1))')
  assert.ok(!out.includes('<a '), out)
})

test('javascript: 链接不生成锚点，https 正常', () => {
  assert.ok(!mdToHtml('[点我](javascript:alert(1))').includes('<a '))
  assert.ok(mdToHtml('[点我](https://e.com)').includes('rel="noopener noreferrer"'))
})

// ── 基础结构（防改坏渲染主链路）──
test('标题/加粗/代码块基础渲染', () => {
  const out = mdToHtml('## 标题\n\n**粗体** 普通文本\n\n```js\nconst a = "<b>";\n```')
  assert.ok(out.includes('<h2>标题</h2>'))
  assert.ok(out.includes('<strong>粗体</strong>'))
  assert.ok(out.includes('&lt;b&gt;'), '代码块内容转义')
})
