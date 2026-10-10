import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPostPassword,
  hasValidUnlock,
  isProtected,
  mergeUnlockCookie,
  passwordFormHtml,
  PP_COOKIE,
  PP_NOTICE,
  protectedDescription,
  verifyPostPassword,
} from '../src/protect.ts'

const NOW = 1_800_000_000_000

// ── 哈希与校验：PBKDF2 存储 `salt:hash`，与登录口令同强度 ──
test('hashPostPassword/verifyPostPassword：正确密码通过、错误密码拒绝', async () => {
  const stored = await hashPostPassword('芝麻开门')
  assert.match(stored, /^[0-9a-f]+:[0-9a-f]{64}$/)
  assert.equal(await verifyPostPassword(stored, '芝麻开门'), true)
  assert.equal(await verifyPostPassword(stored, '芝麻开门 '), false)
  assert.equal(await verifyPostPassword(stored, ''), false)
  assert.equal(await verifyPostPassword(stored, 'wrong'), false)
  // 同一密码两次加盐：存储串不同，但都能通过校验
  const again = await hashPostPassword('芝麻开门')
  assert.notEqual(again, stored)
  assert.equal(await verifyPostPassword(again, '芝麻开门'), true)
})

test('verifyPostPassword：脏存储格式一律拒绝', async () => {
  for (const stored of ['', 'no-colon', ':abcdef', 'saltonly:', 'x:y']) {
    assert.equal(await verifyPostPassword(stored, '任意'), false, stored)
  }
})

test('isProtected：空串/NULL 未加密，非空即加密', () => {
  assert.equal(isProtected({ password_hash: '' }), false)
  assert.equal(isProtected({ password_hash: null }), false)
  assert.equal(isProtected({}), false)
  assert.equal(isProtected({ password_hash: 'aa:bb' }), true)
})

// ── 解锁令牌：HMAC key = password_hash，改密即全端失效 ──
test('hasValidUnlock：签出的令牌对同密码有效，换密码/过期/伪造/脏数据全失效', async () => {
  const stored = await hashPostPassword('pass-1234')
  const cookie = await mergeUnlockCookie(null, 7, stored, NOW)
  assert.match(cookie, /^7\.\d+\.[0-9a-f]{64}$/)
  assert.equal(await hasValidUnlock(cookie, 7, stored, NOW), true)
  assert.equal(await hasValidUnlock(cookie, 7, stored, NOW + 29 * 86_400_000), true)
  // 过期（TTL 30 天）
  assert.equal(await hasValidUnlock(cookie, 7, stored, NOW + 31 * 86_400_000), false)
  // 换了密码：旧 Cookie 立即失效
  const rotated = await hashPostPassword('new-pass-5678')
  assert.equal(await hasValidUnlock(cookie, 7, rotated, NOW), false)
  // 伪造 1：直接改签名尾巴 / 改有效期（HMAC 覆盖 postId.exp，任一改动都对不上）
  assert.equal(await hasValidUnlock(cookie.slice(0, -4) + '0000', 7, stored, NOW), false)
  const expTampered = cookie.replace(/^7\.(\d+)\./, (_, exp) => `7.${Number(exp) + 1000}.`)
  assert.equal(await hasValidUnlock(expTampered, 7, stored, NOW), false)
  // 伪造 2：其他文章的令牌不能解锁这一篇（HMAC key 是本文的 password_hash）
  assert.equal(await hasValidUnlock(cookie, 8, stored, NOW), false)
  for (const dirty of [null, '', 'garbage', '7.abc', '7..x', 'x.y.z']) {
    assert.equal(await hasValidUnlock(dirty, 7, stored, NOW), false, String(dirty))
  }
})

test('mergeUnlockCookie：并入新令牌、剔除过期、同篇替换、封顶 20 条、脏输入忽略', async () => {
  const stored = await hashPostPassword('pass-1234')
  const fresh = await mergeUnlockCookie(null, 7, stored, NOW)
  // 再解锁一篇：两条并存
  const two = await mergeUnlockCookie(fresh, 8, stored, NOW)
  assert.equal(two.split(',').length, 2)
  // 同一篇重复解锁：替换旧令牌而不是堆积（旧密码下的令牌一并作废）
  const rotated = await hashPostPassword('rotated-9999')
  const replaced = await mergeUnlockCookie(two, 7, rotated, NOW)
  assert.equal(replaced.split(',').length, 2)
  assert.equal(await hasValidUnlock(replaced, 7, rotated, NOW), true)
  assert.equal(await hasValidUnlock(replaced, 7, stored, NOW), false)
  assert.equal(await hasValidUnlock(replaced, 8, stored, NOW), true)
  // 过期条目清理：把 id 8 的 exp 改到过去，再解锁第 9 篇 → 只剩 7 与 9
  const expired = two.replace(/,8\.\d+\./, `,8.${NOW - 1}.`)
  const cleaned = await mergeUnlockCookie(expired, 9, stored, NOW)
  assert.equal(cleaned.split(',').length, 2)
  assert.equal(await hasValidUnlock(cleaned, 7, stored, NOW), true)
  assert.equal(await hasValidUnlock(cleaned, 9, stored, NOW), true)
  // 封顶 20：连续解锁 25 篇只保留最近 20 条
  let acc: string | null = null
  for (let id = 1; id <= 25; id++) acc = await mergeUnlockCookie(acc, id, stored, NOW)
  assert.equal(acc!.split(',').length, 20)
  assert.equal(await hasValidUnlock(acc, 25, stored, NOW), true)
  assert.equal(await hasValidUnlock(acc, 1, stored, NOW), false)
  // 脏 existing 原样忽略，不抛错
  assert.equal((await mergeUnlockCookie('garbage,,x.y', 7, stored, NOW)).split(',').length, 1)
})

// ── 防泄漏展示口径 ──
test('protectedDescription：作者摘要优先，否则固定话术（正文摘要绝不参与）', () => {
  assert.equal(protectedDescription('作者写的导读'), '作者写的导读')
  assert.equal(protectedDescription(''), PP_NOTICE)
})

test('passwordFormHtml：action 编码 slug、错误态文案、无内联事件', () => {
  const ok = passwordFormHtml('my-slug')
  assert.ok(ok.includes('action="/post/my-slug/unlock"'))
  assert.ok(ok.includes('type="password"'))
  assert.ok(!ok.includes('pp-err'))
  // 中文 slug 走百分号编码
  assert.ok(passwordFormHtml('中文slug').includes('/post/%E4%B8%AD%E6%96%87slug/unlock'))
  assert.ok(passwordFormHtml('s', { error: 'wrong' }).includes('密码不对'))
  assert.ok(passwordFormHtml('s', { error: 'slow' }).includes('尝试次数过多'))
  assert.ok(passwordFormHtml('s', { error: 'wrong' }).includes('type="password"'))
  // Cookie 名与 SESSION_COOKIE 同族（bloghao_ 前缀）
  assert.equal(PP_COOKIE, 'bloghao_pp')
})
