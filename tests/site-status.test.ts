import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, renderClosedPage } from '../src/render.ts'
import { closedBypassPath, siteClosedResponse } from '../src/closed.ts'
import { DEFAULT_SETTINGS } from '../src/db.ts'

// ── 一键灰度（哀悼/纪念模式）：settings.siteGrayscale = '1' 时全站去色 ──
const base = { settings: { ...DEFAULT_SETTINGS, siteUrl: 'https://blog.example.com' }, css: '', title: '文', path: '/post/a', body: '' }

test('灰度模式开启时，页面 <head> 输出全站去色样式', () => {
  const html = page({ ...base, settings: { ...base.settings, siteGrayscale: '1' } })
  assert.match(html, /<style>html\{filter:grayscale\(100%\)\}<\/style>/)
})

test("灰度模式关闭（'0' 或缺省）时不输出去色样式", () => {
  assert.doesNotMatch(page({ ...base }), /grayscale/)
  assert.doesNotMatch(page({ ...base, settings: { ...base.settings, siteGrayscale: '0' } }), /grayscale/)
})

// ── 闭站页：脱离主题的极简独立页，503 语义（noindex + Retry-After 由中间件补） ──
test('闭站页：默认文案 + 站名 + noindex', () => {
  const html = renderClosedPage({ ...DEFAULT_SETTINGS, siteName: '示例站' })
  assert.match(html, /<title>站点暂时关闭 - 示例站<\/title>/)
  assert.match(html, /本站暂时关闭，请稍后再来。/)
  assert.match(html, /<meta name="robots" content="noindex">/)
})

test('闭站页：后台自定义文案生效，换行原样保留', () => {
  const html = renderClosedPage({ ...DEFAULT_SETTINGS, siteClosedMessage: '致哀三日\n百日后再见。' })
  assert.match(html, /致哀三日\n百日后再见。/)
  assert.doesNotMatch(html, /本站暂时关闭，请稍后再来。/)
})

test('闭站页：自定义文案经 esc 转义，HTML/脚本注入无效', () => {
  const html = renderClosedPage({ ...DEFAULT_SETTINGS, siteClosedMessage: '<script>alert(1)</script>&"测试' })
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;&quot;测试/)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
})

// ── 闭站白名单：后台/登录/主题元数据/健康检查/图床放行，公开面（页面、RSS、sitemap、公开 API）拦截 ──
test('闭站白名单：放行路径全表', () => {
  for (const p of [
    '/admin',
    '/admin/',
    '/admin/assets/app.css',
    '/api/admin',
    '/api/admin/settings',
    '/api/auth/login',
    '/api/auth/state',
    '/api/meta/themes',
    '/api/health',
    '/images/u/a.jpg',
    '/images/og/b.png',
  ]) {
    assert.equal(closedBypassPath(p), true, p)
  }
})

test('闭站白名单：前缀相似的路径不得误放行', () => {
  for (const p of ['/administrator', '/adminx', '/api/adminx', '/api/authx', '/imagesx/a.jpg', '/api/healthcheck']) {
    assert.equal(closedBypassPath(p), false, p)
  }
})

test('闭站白名单：公开页面与公开 API 一律拦截', () => {
  for (const p of ['/', '/post/x', '/archives', '/guestbook', '/random', '/rss.xml', '/sitemap.xml', '/robots.txt', '/api/public/track', '/api/public/comments']) {
    assert.equal(closedBypassPath(p), false, p)
  }
})

// ── 拦截行为：siteClosedResponse 返回 null = 放行，否则 503 ──
/** 极简 D1 桩：settings 查询返回给定键值，sessions 查询按 hasSession 决定是否命中管理员会话 */
function fakeDb(settings: Record<string, string>, hasSession: boolean): D1Database {
  return {
    prepare(sql: string) {
      if (sql.includes('FROM settings')) {
        return {
          all: async () => ({ results: Object.entries(settings).map(([key, value]) => ({ key, value })) }),
        }
      }
      return {
        bind: () => ({
          first: async () => (hasSession ? { id: 1, username: 'admin', display_name: '管理员', avatar: '' } : null),
        }),
      }
    },
  } as unknown as D1Database
}

const req = (cookie?: string) =>
  new Request('https://blog.example.com/', cookie ? { headers: { cookie } } : {})
const SESSION_COOKIE = 'bloghao_session=tok'

test('未闭站：任何路径都放行（返回 null）', async () => {
  const db = fakeDb({ siteClosed: '0' }, false)
  assert.equal(await siteClosedResponse(db, req(), '/'), null)
  assert.equal(await siteClosedResponse(db, req(), '/post/x'), null)
  assert.equal(await siteClosedResponse(db, req(), '/api/public/comments'), null)
})

test('闭站后：匿名访客拿到 503 闭站页（HTML + Retry-After + 不缓存）', async () => {
  const db = fakeDb({ siteClosed: '1', siteName: '示例站' }, false)
  const res = await siteClosedResponse(db, req(), '/')
  assert.ok(res)
  assert.equal(res.status, 503)
  assert.equal(res.headers.get('Retry-After'), '3600')
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.match(await res.text(), /站点暂时关闭/)
})

test('闭站后：公开 API 返回 503 JSON（评论/点赞/打点连写入一起关死）', async () => {
  const db = fakeDb({ siteClosed: '1' }, false)
  for (const p of ['/api/public/track', '/api/public/comments']) {
    const res = await siteClosedResponse(db, req(), p)
    assert.ok(res)
    assert.equal(res.status, 503)
    assert.match(res.headers.get('Content-Type') || '', /application\/json/)
    assert.match(await res.text(), /站点已关闭/)
  }
})

test('闭站后：RSS / sitemap / 文章页同样 503', async () => {
  const db = fakeDb({ siteClosed: '1' }, false)
  for (const p of ['/rss.xml', '/sitemap.xml', '/post/x', '/guestbook']) {
    const res = await siteClosedResponse(db, req(), p)
    assert.ok(res, p)
    assert.equal(res.status, 503, p)
  }
})

test('闭站后：已登录管理员放行（预览模式），白名单路径不做任何拦截', async () => {
  const db = fakeDb({ siteClosed: '1' }, true)
  assert.equal(await siteClosedResponse(db, req(SESSION_COOKIE), '/'), null)
  assert.equal(await siteClosedResponse(db, req(SESSION_COOKIE), '/post/x'), null)
  // 白名单路径即便带无效会话也放行（交给各自的鉴权逻辑）
  assert.equal(await siteClosedResponse(fakeDb({ siteClosed: '1' }, false), req(), '/admin/'), null)
  assert.equal(await siteClosedResponse(fakeDb({ siteClosed: '1' }, false), req(), '/api/admin/settings'), null)
})
