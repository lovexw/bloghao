import { test } from 'node:test'
import assert from 'node:assert/strict'
import { htmlToMd } from '../src/html-md.ts'

// 转换口径与编辑器版 htmlToMd（public/admin/editor.js）一致；输入均为 sanitizeHtml 白名单输出形态

test('标题 / 段落 / 行内修饰', () => {
  assert.equal(htmlToMd('<h2>标题</h2><p>正文 <strong>加粗</strong> 与 <em>斜体</em></p>'), '## 标题\n\n正文 **加粗** 与 *斜体*')
  assert.equal(htmlToMd('<h1>大标题</h1><h3>H3</h3><p><del>删除</del><code>x = 1</code></p>'), '# 大标题\n\n### H3\n\n~~删除~~`x = 1`')
})

test('链接与图片（站内地址保留原样，由 rewriteImageLinks 改写）', () => {
  assert.equal(htmlToMd('<p><a href="https://example.com">官网</a></p>'), '[官网](https://example.com)')
  assert.equal(htmlToMd('<p><img src="/images/u/202510/a.png" alt="图一"></p>'), '![图一](/images/u/202510/a.png)')
  assert.equal(htmlToMd('<img src="/images/u/a.png">'), '![](/images/u/a.png)')
})

test('引用 / 代码块 / 列表 / 分割线', () => {
  assert.equal(htmlToMd('<blockquote><p>引文一行</p></blockquote>'), '> 引文一行')
  assert.equal(htmlToMd('<pre><code>const a = 1;\nif (a) {\n  go();\n}</code></pre>'), '```\nconst a = 1;\nif (a) {\n  go();\n}\n```')
  assert.equal(htmlToMd('<ul><li>甲</li><li>乙</li></ul>'), '- 甲\n\n- 乙')
  assert.equal(htmlToMd('<ol><li>first</li><li>second</li></ol>'), '1. first\n\n2. second')
  assert.equal(htmlToMd('<p>上</p><hr><p>下</p>'), '上\n\n---\n\n下')
})

test('ol 计数在多列表间独立，br 换行保留', () => {
  const html = '<ol><li>一</li><li>二</li></ol><ul><li>散</li></ul>'
  assert.equal(htmlToMd(html), '1. 一\n\n2. 二\n\n- 散')
  assert.equal(htmlToMd('<p>第一行<br>第二行</p>'), '第一行\n第二行')
})

test('表格转管道表（紧凑成单换行，首行后补分隔线）', () => {
  const md = htmlToMd('<table><tr><th>名称</th><th>数量</th></tr><tr><td>苹果</td><td>3</td></tr></table>')
  assert.equal(md, '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |')
})

test('未知标签剥壳保留内文，script/style 类内容已被净化器剔除', () => {
  assert.equal(htmlToMd('<p><span class="x">保留我</span></p>'), '保留我')
  assert.equal(htmlToMd('<p>a</p><!-- 注释 -->'), 'a')
})

test('实体解码与空白折叠', () => {
  assert.equal(htmlToMd('<p>A &amp; B &lt;C&gt;</p>'), 'A & B <C>')
  assert.equal(htmlToMd('<p>多   空格\t折叠</p>'), '多 空格 折叠')
})
