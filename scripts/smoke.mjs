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
  const label = `${method} ${url}${expectBody ? '（含内容断言）' : ''}`
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
      method,
      headers: opts.headers,
      body: opts.body,
      signal: AbortSignal.timeout(15_000),
    })
    let bodyOk = true
    if (expectBody) {
      const text = await res.text()
      bodyOk = text.includes(expectBody)
      if (!bodyOk) console.error(`  ✗ ${label}：响应中未找到「${expectBody}」`)
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
  await check('GET', `/tag/${encodeURIComponent('冒烟测试')}`, 200, 'smoke-multi-tag')
  await check('GET', '/archives', 200)
  await check('GET', '/weibo', 200)
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
} finally {
  if (dev && dev.exitCode === null) dev.kill('SIGTERM')
}

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${failed.length ? '✗' : '✓'} 冒烟结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length) {
  console.error('失败项：\n' + failed.map(([l]) => `  - ${l}`).join('\n'))
  process.exitCode = 1
}
