import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fireCommentCreated, firePostPublished, listServerPlugins, renderFooterHtml } from '../src/hooks.ts'
import { DEFAULT_SETTINGS } from '../src/db.ts'
import type { Env, SettingsMap } from '../src/types.ts'

// ── 服务端插件钩子（roadmap A5）：总线过滤 + 官方示例插件行为 + 失败吞掉 ──

const settings = (over: Partial<SettingsMap>): SettingsMap => ({ ...DEFAULT_SETTINGS, ...over })

/** getSettings 只用 prepare().all()，桩掉整个 D1（注意包一层 Env：fire 函数取 env.DB） */
function fakeEnv(rows: { key: string; value: string }[] = []): Env {
  return {
    DB: { prepare: () => ({ all: async () => ({ results: rows }) }) } as unknown as D1Database,
  } as unknown as Env
}

/** 抓 fetch 调用（示例插件全部走 fetch 外发） */
function captureFetch() {
  const calls: { url: string; init?: RequestInit }[] = []
  const orig = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  return {
    calls,
    restore() {
      globalThis.fetch = orig
    },
  }
}

test('页脚注入：footerHtmlCode 进页脚，停用名单可关掉', () => {
  const s = settings({ footerHtmlCode: '<div class="badge">🌙 365 天</div>' })
  assert.equal(renderFooterHtml(s), '<div class="badge">🌙 365 天</div>')
  const off = settings({ footerHtmlCode: '<div>x</div>', serverPluginsDisabled: 'footer-html' })
  assert.equal(renderFooterHtml(off), '')
  // 其他插件被停用不影响 footer-html
  const otherOff = settings({ footerHtmlCode: '<i>hi</i>', serverPluginsDisabled: 'tg-channel,comment-webhook' })
  assert.equal(renderFooterHtml(otherOff), '<i>hi</i>')
  assert.equal(renderFooterHtml(settings({})), '')
})

test('发布同步 TG 频道：token+频道ID 齐才发，消息带标题与链接，可被停用', async () => {
  const cap = captureFetch()
  try {
    const env = fakeEnv([
      { key: 'telegramBotToken', value: 'tok123' },
      { key: 'tgChannelChatId', value: '@mychannel' },
      { key: 'siteUrl', value: 'https://blog.example.com/' },
    ])
    await firePostPublished(env, { slug: 'hello', title: '新文章', summary: '摘要', via: 'scheduler' })
    assert.equal(cap.calls.length, 1)
    assert.match(cap.calls[0].url, /api\.telegram\.org\/bottok123\/sendMessage/)
    const body = JSON.parse(String(cap.calls[0].init?.body))
    assert.equal(body.chat_id, '@mychannel')
    assert.match(body.text, /新文章/)
    assert.match(body.text, /https:\/\/blog\.example\.com\/post\/hello/)
    // 频道 ID 未填：静默不发
    await firePostPublished(fakeEnv([{ key: 'telegramBotToken', value: 'tok123' }]), {
      slug: 'x', title: 't', summary: '', via: 'admin',
    })
    // 插件被停用：不发
    await firePostPublished(
      fakeEnv([
        { key: 'telegramBotToken', value: 'tok123' },
        { key: 'tgChannelChatId', value: '@mychannel' },
        { key: 'serverPluginsDisabled', value: 'tg-channel' },
      ]),
      { slug: 'x', title: 't', summary: '', via: 'admin' }
    )
    assert.equal(cap.calls.length, 1)
  } finally {
    cap.restore()
  }
})

test('评论 webhook：合法地址才 POST JSON（含事件名与留言内容）', async () => {
  const cap = captureFetch()
  try {
    const env = fakeEnv([{ key: 'commentWebhookUrl', value: 'https://hook.example.com/feed' }])
    await fireCommentCreated(env, {
      kind: 'post', nickname: '小吴', content: '写得真好', context: '某文章', url: 'https://blog.example.com/post/a#comments', pending: false,
    })
    assert.equal(cap.calls.length, 1)
    assert.equal(cap.calls[0].url, 'https://hook.example.com/feed')
    const body = JSON.parse(String(cap.calls[0].init?.body))
    assert.equal(body.event, 'comment.created')
    assert.equal(body.nickname, '小吴')
    assert.equal(body.content, '写得真好')
    // 地址不合法 / 插件停用：不发
    await fireCommentCreated(fakeEnv([{ key: 'commentWebhookUrl', value: 'javascript:alert(1)' }]), {
      kind: 'guestbook', nickname: 'a', content: 'b', url: '', pending: true,
    })
    await fireCommentCreated(
      fakeEnv([
        { key: 'commentWebhookUrl', value: 'https://hook.example.com/feed' },
        { key: 'serverPluginsDisabled', value: 'comment-webhook' },
      ]),
      { kind: 'guestbook', nickname: 'a', content: 'b', url: '', pending: true }
    )
    assert.equal(cap.calls.length, 1)
  } finally {
    cap.restore()
  }
})

test('插件失败被吞掉：fetch 抛错时 fire 正常 resolve，不影响主流程', async () => {
  const orig = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    const env = fakeEnv([
      { key: 'commentWebhookUrl', value: 'https://hook.example.com/feed' },
      { key: 'telegramBotToken', value: 'tok' },
      { key: 'tgChannelChatId', value: '@ch' },
    ])
    await fireCommentCreated(env, { kind: 'weibo', nickname: 'a', content: 'b', url: '', pending: false })
    await firePostPublished(env, { slug: 'a', title: 'b', summary: '', via: 'admin' })
  } finally {
    globalThis.fetch = orig
  }
})

test('注册表元数据：id/标题/版本齐全，不带处理函数，id 全部合法（可进停用名单）', () => {
  const list = listServerPlugins()
  assert.ok(list.length >= 3)
  for (const p of list) {
    assert.ok(p.id && p.title && p.version && p.author)
    assert.match(p.id, /^[A-Za-z0-9_-]+$/)
    assert.equal('onPostPublished' in p, false)
    assert.equal('onCommentCreated' in p, false)
    assert.equal('footerHtml' in p, false)
  }
})
