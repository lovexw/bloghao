#!/usr/bin/env node
/**
 * 本地冒烟测试：npm run smoke
 *
 * 流程：初始化本地 D1（幂等）→ 写入夹具（幂等）→ 起 wrangler dev → 逐路由断言 → 收尾退出。
 * 其中「多标签文章页」是回归守卫：relatedPosts 的多标签 OR 拼接曾被误删 join，
 * 导致所有 2 个以上标签的文章 500（线上事故 2026-10，见 8be1c71）。
 *
 * 规矩：改过 SQL 拼接 / 渲染相关代码，提交前先跑这个；部署后再对线上同路由 curl 一遍。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 8799
const READY_TIMEOUT_MS = 90_000

const results = []
let dev = null

function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n▸ ${label}`)
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => {
      if (code === 0) {
        console.log('  ✓ 完成')
        resolve(out)
      } else {
        console.error(out.trim().split('\n').slice(-15).join('\n'))
        reject(new Error(`${label} 失败（exit ${code}）`))
      }
    })
    p.on('error', reject)
  })
}

async function startDevServer() {
  console.log(`\n▸ 启动 wrangler dev（端口 ${PORT}）`)
  const bin = path.join(ROOT, 'node_modules', '.bin', 'wrangler')
  dev = spawn(bin, ['dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  dev.stdout.on('data', (d) => (out += d))
  dev.stderr.on('data', (d) => (out += d))

  const started = Date.now()
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (dev.exitCode !== null) {
      console.error(out.trim().split('\n').slice(-15).join('\n'))
      throw new Error(`wrangler dev 提前退出（exit ${dev.exitCode}）`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(3000) })
      console.log(`  ✓ 服务已就绪（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
      void res
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  console.error(out.trim().split('\n').slice(-30).join('\n'))
  throw new Error('wrangler dev 启动超时')
}

async function check(method, url, expectStatus, expectBody, opts = {}) {
  const label = `${method} ${url}${expectBody ? '（含内容断言）' : ''}${opts.notContains ? '（不含断言）' : ''}`
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
      method,
      headers: opts.headers,
      body: opts.body,
      signal: AbortSignal.timeout(15_000),
    })
    let bodyOk = true
    const text = expectBody || opts.notContains ? await res.text() : ''
    if (expectBody) {
      bodyOk = text.includes(expectBody)
      if (!bodyOk) console.error(`  ✗ ${label}：响应中未找到「${expectBody}」`)
    }
    if (bodyOk && opts.notContains) {
      bodyOk = !text.includes(opts.notContains)
      if (!bodyOk) console.error(`  ✗ ${label}：响应中不应出现「${opts.notContains}」`)
    }
    if (res.status !== expectStatus) {
      console.error(`  ✗ ${label}：期望 ${expectStatus}，实际 ${res.status}`)
      results.push([label, false])
      return
    }
    if (!bodyOk) {
      results.push([label, false])
      return
    }
    console.log(`  ✓ ${label}`)
    results.push([label, true])
  } catch (e) {
    console.error(`  ✗ ${label}：${e.message}`)
    results.push([label, false])
  }
}

try {
  await run('npm', ['run', 'db:init:local'], '初始化本地 D1（幂等）')
  await run(
    'npx',
    ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', 'scripts/smoke.fixtures.sql'],
    '写入冒烟夹具（幂等）'
  )
  await startDevServer()

  console.log('\n▸ 路由断言')
  await check('GET', '/', 200)
  // 回归守卫：多标签文章（relatedPosts OR 拼接）与无标签文章（兜底查询）都必须 200
  await check('GET', '/post/smoke-multi-tag', 200, '冒烟测试：多标签文章')
  await check('GET', '/post/smoke-no-tag', 200)
  // 结构化数据（roadmap A3）：文章页必须输出 schema.org JSON-LD
  await check('GET', '/post/smoke-multi-tag', 200, 'application/ld+json')
  await check('GET', `/tag/${encodeURIComponent('冒烟测试')}`, 200, 'smoke-multi-tag')
  await check('GET', '/archives', 200)
  await check('GET', '/weibo', 200)
  // 前台微博卡管理（roadmap：管理员前台管理随手记）：访客 HTML 里不得出现管理按钮
  await check('GET', '/weibo', 200, undefined, { notContains: 'data-wb-admin' })
  await check('GET', '/api/admin/weibo/990101', 401)
  // 回归守卫：?wb= 深链定位——历史上的今天/首页入口卡/TG 通知链到 /weibo?wb=x#wb-x，
  // 服务端必须把目标微博所在页渲染出来（17 条夹具中 990101 最老，落在第 2 页）；无效 id 回退第 1 页
  await check('GET', '/weibo?wb=990101', 200, '微博定位目标')
  await check('GET', '/weibo?wb=999999999', 200)
  await check('GET', '/links', 200)
  await check('GET', '/guestbook', 200)
  await check('GET', '/about', 200)
  await check('GET', '/search?q=smoke', 200)
  await check('GET', '/rss.xml', 200)
  await check('GET', '/sitemap.xml', 200)
  // 分享卡图：内置默认卡必须能被社交平台抓到，页面必须输出 og:image / twitter:card（og:image 绝不缺位）
  await check('GET', '/og-default.png', 200)
  await check('GET', '/', 200, 'twitter:card')
  await check('GET', '/', 200, 'og:image')
  await check('GET', '/admin/', 200)
  // 皮肤/插件市场：编辑器插件清单与市场目录是后台「插件 / 皮肤」页的数据源，必须可访问且是合法 JSON
  await check('GET', '/plugins/manifest.json', 200, 'hello-sign')
  await check('GET', '/market/catalog.json', 200, 'themes')
  await check('GET', '/post/no-such-post-should-404', 404)
  // 访客统计：公开打点 200、后台聚合接口未登录必须 401（在 /admin/* 鉴权保护之下）
  await check('POST', '/api/public/track', 200, 'ok', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: '/post/smoke-multi-tag', r: 'https://www.google.com/', v: 'smoke-visitor-1', t: '冒烟测试' }),
  })
  await check('GET', '/api/admin/visits', 401)
  // 数据导出（roadmap A1）：登录中间件保护之下，未登录必须 401
  await check('GET', '/api/admin/export/markdown', 401)
  await check('GET', '/api/admin/export/wxr', 401)
  // 服务端插件（roadmap A5）：列表接口同样在鉴权保护之下
  await check('GET', '/api/admin/server-plugins', 401)

  // 回归守卫：打点真的落进了 visit_log（waitUntil 异步写，稍等一拍再用 d1 查）——
  // 防止「接口 200 但 INSERT 静默失败」的假绿
  await new Promise((r) => setTimeout(r, 1500))
  try {
    const out = await run(
      'npx',
      [
        'wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command',
        "SELECT COUNT(*) AS n FROM visit_log WHERE vid = 'smoke-visitor-1'",
      ],
      '校验打点已落库（visit_log）'
    )
    if (/"n"\s*:\s*[1-9]/.test(out)) {
      console.log('  ✓ visit_log 已收到打点记录')
      results.push(['visit_log 落库校验', true])
    } else {
      console.error('  ✗ visit_log 未查到 smoke 打点记录')
      results.push(['visit_log 落库校验', false])
    }
  } catch (e) {
    console.error(`  ✗ visit_log 落库校验：${e.message}`)
    results.push(['visit_log 落库校验', false])
  }

  // ── 一键闭站（设置 → 站点状态）：完整链路——登录 → 开关 → 断言 → 恢复 ──
  // 闭站必须拦得住公开页面 / RSS / 公开写入 API，同时放行后台与登录（不然自己被锁在门外）
  console.log('\n▸ 一键闭站链路')
  const BASE = `http://127.0.0.1:${PORT}`
  const raw = (method, path, opts = {}) =>
    fetch(`${BASE}${path}`, { method, signal: AbortSignal.timeout(15_000), ...opts })

  const loginRes = await raw('POST', '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'smokeadmin', password: 'smoke-pass-12345' }),
  })
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0]
  results.push([
    '闭站链路：登录夹具管理员',
    loginRes.status === 200 && cookie.startsWith('bloghao_session='),
  ])
  console.log(`  ${loginRes.status === 200 && cookie.startsWith('bloghao_session=') ? '✓' : '✗'} 闭站链路：登录夹具管理员（status ${loginRes.status}）`)

  const putSettings = (patch) =>
    raw('PUT', '/api/admin/settings', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(patch),
    })
  const closeRes = await putSettings({ siteClosed: '1', siteGrayscale: '1' })
  results.push(['闭站链路：开启闭站+灰度', closeRes.status === 200])
  console.log(`  ${closeRes.status === 200 ? '✓' : '✗'} 闭站链路：开启闭站+灰度（status ${closeRes.status}）`)

  // 匿名访客：公开页面 / RSS / sitemap / 公开写入 API 全部 503
  await check('GET', '/', 503, '站点暂时关闭')
  await check('GET', '/post/smoke-multi-tag', 503)
  await check('GET', '/rss.xml', 503)
  await check('GET', '/sitemap.xml', 503)
  await check('POST', '/api/public/track', 503, '站点已关闭', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: '/x', r: '', v: 'smoke-closed-1', t: '' }),
  })
  // 503 + Retry-After：搜索引擎据此暂时保留收录
  const closedHome = await raw('GET', '/')
  const retryAfterOk = closedHome.status === 503 && closedHome.headers.get('retry-after') === '3600'
  results.push(['闭站链路：503 + Retry-After', retryAfterOk])
  console.log(`  ${retryAfterOk ? '✓' : '✗'} 闭站链路：503 + Retry-After（retry-after: ${closedHome.headers.get('retry-after')}）`)

  // 白名单：后台 SPA、登录、健康检查、主题元数据、图床都活着（不然自己被锁在门外）
  await check('GET', '/admin/', 200)
  await check('GET', '/api/auth/state', 200)
  await check('GET', '/api/health', 200)
  await check('GET', '/api/meta/themes', 200)
  await check('GET', '/images/u/smoke-none.jpg', 404) // 404（R2 查无此图）而非 503 = 图床路由已放行
  await check('GET', '/api/admin/visits', 200, undefined, { headers: { Cookie: cookie } })
  // 已登录管理员：闭站期间仍可全站预览，且灰度样式随页面输出（两个开关一次验到）
  await check('GET', '/', 200, 'html{filter:grayscale(100%)}', { headers: { Cookie: cookie } })

  // 恢复：关站后匿名访客应重新看到正常站点，灰度也撤掉
  const reopenRes = await putSettings({ siteClosed: '0', siteGrayscale: '0' })
  results.push(['闭站链路：恢复访问', reopenRes.status === 200])
  console.log(`  ${reopenRes.status === 200 ? '✓' : '✗'} 闭站链路：恢复访问（status ${reopenRes.status}）`)
  await check('GET', '/', 200)
  const reopenedHome = await raw('GET', '/', { headers: { Cookie: cookie } })
  const reopenedText = await reopenedHome.text()
  const grayscaleOff = reopenedHome.status === 200 && !reopenedText.includes('grayscale')
  results.push(['闭站链路：灰度已随恢复撤下', grayscaleOff])
  console.log(`  ${grayscaleOff ? '✓' : '✗'} 闭站链路：灰度已随恢复撤下`)

  // ── 微博前台管理链路（登录管理员在 /weibo 页直接编辑/置顶/删除随手记）──
  // 全程用临时数据（新建→置顶→编辑→删除），不碰夹具，可重复运行
  console.log('\n▸ 微博前台管理链路')
  const adminWeiboPage = await raw('GET', '/weibo', { headers: { Cookie: cookie } })
  const adminBtnOk = adminWeiboPage.status === 200 && (await adminWeiboPage.text()).includes('data-wb-admin')
  results.push(['微博管理：登录后 /weibo 渲染管理按钮', adminBtnOk])
  console.log(`  ${adminBtnOk ? '✓' : '✗'} 微博管理：登录后 /weibo 渲染管理按钮`)

  const wbCreate = await raw('POST', '/api/admin/weibo', {
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: '冒烟管理链路临时微博 #冒烟话题#', status: 'published' }),
  })
  const wbCreated = await wbCreate.json().catch(() => null)
  const wbId = wbCreated && wbCreated.weibo && wbCreated.weibo.id
  results.push(['微博管理：发布临时微博', wbCreate.status === 200 && !!wbId])
  console.log(`  ${wbCreate.status === 200 && !!wbId ? '✓' : '✗'} 微博管理：发布临时微博（id ${wbId}）`)

  if (wbId) {
    const wbCookie = { headers: { Cookie: cookie } }
    // 单条取原稿：前台「编辑」的数据源（正文必须是未转义原文）
    await check('GET', `/api/admin/weibo/${wbId}`, 200, '冒烟管理链路临时微博', wbCookie)
    // 置顶 → 深链页渲染置顶卡 → 取消置顶
    const pinOn = await raw('POST', `/api/admin/weibo/${wbId}/pin`, {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ pinned: true }),
    })
    results.push(['微博管理：置顶', pinOn.status === 200])
    console.log(`  ${pinOn.status === 200 ? '✓' : '✗'} 微博管理：置顶`)
    await check('GET', `/weibo?wb=${wbId}`, 200, 'is-pinned', wbCookie)
    const pinOff = await raw('POST', `/api/admin/weibo/${wbId}/pin`, {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ pinned: false }),
    })
    results.push(['微博管理：取消置顶', pinOff.status === 200])
    console.log(`  ${pinOff.status === 200 ? '✓' : '✗'} 微博管理：取消置顶`)
    // 编辑（PUT 全量更新，前台编辑保存同款请求体）→ 单条与前台页都应看到新文本
    const wbEdit = await raw('PUT', `/api/admin/weibo/${wbId}`, {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: '冒烟管理链路已编辑 #冒烟话题#', images: [], status: 'published' }),
    })
    results.push(['微博管理：编辑保存', wbEdit.status === 200])
    console.log(`  ${wbEdit.status === 200 ? '✓' : '✗'} 微博管理：编辑保存`)
    await check('GET', `/api/admin/weibo/${wbId}`, 200, '冒烟管理链路已编辑', wbCookie)
    await check('GET', `/weibo?wb=${wbId}`, 200, '冒烟管理链路已编辑', wbCookie)
    // 删除 → 单条 404、深链定位失效但页面仍 200
    const wbDel = await raw('DELETE', `/api/admin/weibo/${wbId}`, wbCookie)
    results.push(['微博管理：删除', wbDel.status === 200])
    console.log(`  ${wbDel.status === 200 ? '✓' : '✗'} 微博管理：删除`)
    await check('GET', `/api/admin/weibo/${wbId}`, 404, undefined, wbCookie)
    await check('GET', `/weibo?wb=${wbId}`, 200)
  }

  // ── 文章列表「发布/下架」守卫（2026-10 安全复查 P0 回归）：PUT 缺键即保留 ──
  // 列表页状态切换只发 {status}，服务端必须保留正文/标签/分类——曾经整包 {...post}
  // 提交（列表项无 content 键）导致正文标签分类被清空且假成功
  console.log('\n▸ 文章状态切换保留正文')
  const pCreate = await raw('POST', '/api/admin/posts', {
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: '冒烟：状态切换守卫',
      content: '<p>守卫正文不能被清掉</p>',
      tags: ['冒烟守卫'],
      status: 'draft',
    }),
  })
  const pCreated = await pCreate.json().catch(() => null)
  const pId = pCreated && pCreated.post && pCreated.post.id
  results.push(['状态切换：建临时草稿', pCreate.status === 200 && !!pId])
  console.log(`  ${pCreate.status === 200 && !!pId ? '✓' : '✗'} 状态切换：建临时草稿（id ${pId}）`)
  if (pId) {
    const pCookie = { headers: { Cookie: cookie } }
    // 只发 {status}（列表页 toggle 的真实载荷形态），随后逐项核对内容未丢
    const toggle = await raw('PUT', `/api/admin/posts/${pId}`, {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status: 'published' }),
    })
    results.push(['状态切换：只发 status 的 PUT', toggle.status === 200])
    console.log(`  ${toggle.status === 200 ? '✓' : '✗'} 状态切换：只发 status 的 PUT`)
    await check('GET', `/api/admin/posts/${pId}`, 200, '守卫正文不能被清掉', pCookie)
    await check('GET', `/api/admin/posts/${pId}`, 200, '冒烟守卫', pCookie)
    // SETTING 回显打码：写入真实 Token 后，保存/读取的回显都必须是打码形态而非明文
    const seedToken = await raw('PUT', '/api/admin/settings', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ telegramBotToken: 'smoke-secret-12345' }),
    })
    const seededBody = await seedToken.json().catch(() => null)
    const seedMaskOk =
      seedToken.status === 200 && seededBody?.settings?.telegramBotToken === '••••••••'
    results.push(['状态切换：settings 保存后密钥打码回显', seedMaskOk])
    console.log(`  ${seedMaskOk ? '✓' : '✗'} 状态切换：settings 保存后密钥打码回显`)
    // 打码占位符整表提交 = 保持原值（前端整表提交不会被占位符写坏库）
    const reSave = await raw('PUT', '/api/admin/settings', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ telegramBotToken: '••••••••', footerText: '冒烟临时页脚' }),
    })
    const reSaved = await reSave.json().catch(() => null)
    const reMaskOk = reSave.status === 200 && reSaved?.settings?.telegramBotToken === '••••••••'
    results.push(['状态切换：打码占位符提交不覆盖真实值', reMaskOk])
    console.log(`  ${reMaskOk ? '✓' : '✗'} 状态切换：打码占位符提交不覆盖真实值`)
    await raw('PUT', '/api/admin/settings', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ telegramBotToken: '', footerText: '由 博客号 驱动 · 住在 Cloudflare 上' }),
    })
    const cleanup = await raw('DELETE', `/api/admin/posts/${pId}`, pCookie)
    results.push(['状态切换：清理临时文章', cleanup.status === 200])
    console.log(`  ${cleanup.status === 200 ? '✓' : '✗'} 状态切换：清理临时文章`)
  }

} finally {
  if (dev && dev.exitCode === null) dev.kill('SIGTERM')
}

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${failed.length ? '✗' : '✓'} 冒烟结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.error('失败项：\n' + failed.map(([l]) => `  - ${l}`).join('\n'))
  process.exitCode = 1
}
