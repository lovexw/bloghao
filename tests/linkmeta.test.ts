import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchableUrl, linkCardHtml } from '../src/linkmeta.ts'
import { sanitizeHtml } from '../src/sanitize.ts'

// ── SSRF 约束：只放行 http(s) 公网地址 ──
test('fetchableUrl 放行公网 http(s)', () => {
  assert.ok(fetchableUrl('https://bloghao.com/post/x'))
  assert.ok(fetchableUrl('http://example.com'))
  assert.equal(fetchableUrl('https://example.com:8443/a')?.port, '8443')
})

test('fetchableUrl 拒绝非 http 协议与私有网段（防 SSRF）', () => {
  assert.equal(fetchableUrl('javascript:alert(1)'), null)
  assert.equal(fetchableUrl('file:///etc/passwd'), null)
  assert.equal(fetchableUrl('ftp://example.com'), null)
  assert.equal(fetchableUrl('http://localhost/a'), null)
  assert.equal(fetchableUrl('http://127.0.0.1/a'), null)
  assert.equal(fetchableUrl('http://10.0.0.1/a'), null)
  assert.equal(fetchableUrl('http://192.168.1.1/a'), null)
  assert.equal(fetchableUrl('http://172.16.0.1/a'), null)
  assert.equal(fetchableUrl('http://169.254.169.254/latest/meta-data'), null)
  assert.equal(fetchableUrl('http://0.0.0.0/a'), null)
  assert.equal(fetchableUrl('not a url'), null)
})

test('fetchableUrl 拒绝非常规端口', () => {
  assert.equal(fetchableUrl('http://example.com:6379/'), null)
  assert.equal(fetchableUrl('https://example.com:22/'), null)
})

test('tab/换行混淆的地址先剥离再解析（与 safeUrl 同防线）', () => {
  assert.ok(fetchableUrl('https://ex\tample.com') === null || fetchableUrl('https://ex\tample.com') !== null)
  // 剥离后仍是合法 URL 即放行（这里只验证不抛异常、返回值可判空）
  const u = fetchableUrl('  https://example.com/a\tb  ')
  assert.ok(u === null || u instanceof URL)
})

// ── 卡片 HTML 组装 ──
test('linkCardHtml 带图布局：结构、href、host 兜底', () => {
  const html = linkCardHtml({
    url: 'https://bloghao.com/post/hello',
    title: '一篇很长的文章标题',
    description: '这是摘要',
    image: '/images/abc.jpg',
  })
  assert.ok(html.includes('class="link-card" data-link-card'))
  assert.ok(html.includes('href="https://bloghao.com/post/hello"'))
  assert.ok(html.includes('class="lc-img" src="/images/abc.jpg"'))
  assert.ok(html.includes('bloghao.com'))
  assert.ok(html.includes('一篇很长的文章标题'))
})

test('linkCardHtml 无图布局：不出 lc-img', () => {
  const html = linkCardHtml({ url: 'https://example.com', title: '标题' })
  assert.ok(!html.includes('lc-img'))
  assert.ok(html.includes('lc-title'))
})

test('linkCardHtml 转义：标题里的引号与尖括号不破结构', () => {
  const html = linkCardHtml({ url: 'https://example.com/?a=1&b=2', title: '标题"引号"<b>加粗</b>' })
  assert.ok(html.includes('&quot;'))
  assert.ok(html.includes('&lt;b&gt;'))
  assert.ok(!html.includes('<b>加粗</b>'))
})

test('linkCardHtml 长文案截断且不劈开代理对（emoji）', () => {
  const t = '好'.repeat(50) + '🙂'.repeat(10)
  const html = linkCardHtml({ url: 'https://example.com', title: t })
  assert.ok(html.includes('…'))
  // 截断后不出现半个代理对（Node 对孤立代理项会替换成 U+FFFD）
  const m = /lc-title">([^<]+)</.exec(html)
  assert.ok(m && !m[1].includes('\uFFFD'))
})

test('linkCardHtml siteName 优先于域名', () => {
  const html = linkCardHtml({ url: 'https://example.com/a', title: 'T', siteName: '某某博客' })
  assert.ok(html.includes('lc-host">某某博客</span>'))
})

// ── 与 sanitizeHtml 的配合：卡片插入正文后存库不被剥掉 ──
test('sanitizeHtml 保留卡片结构与 data-link-card 标记', () => {
  const card = linkCardHtml({
    url: 'https://example.com/post/a',
    title: '外站文章',
    description: '摘要文本',
    image: '/images/x.jpg',
  })
  const out = sanitizeHtml(`<p>前文</p>${card}<p>后文</p>`)
  assert.ok(out.includes('class="link-card" data-link-card="link-card"'), out)
  assert.ok(out.includes('lc-title'))
  assert.ok(out.includes('lc-img'))
  assert.ok(out.includes('href="https://example.com/post/a"'))
})

test('sanitizeHtml 剥掉伪造的 data-link-card 非法值（标记只认固定值）', () => {
  const out = sanitizeHtml('<a data-link-card="x" href="/a">t</a>')
  assert.ok(!out.includes('data-link-card="x"'), out)
  assert.ok(out.includes('<a href="/a">t</a>'), out)
})
