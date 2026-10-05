/**
 * 服务端插件钩子（roadmap A5）：内核在关键动作处广播事件，插件按需订阅处理。
 *
 * 设计约束（AGENTS.md 复杂度预算）：总线、注册表与官方示例插件全部收在本文件——
 * 第三方服务端插件以「提交进 SERVER_PLUGINS 注册表」的方式分发（与主题注册表同模式，
 * 随部署生效、无热加载）；前台编辑器插件（public/plugins/，免部署启停）是另一条线，互不相干。
 *
 * 铁律：任何插件抛错都不影响主流程（发文/评论/渲染照常）——fire 函数统一 try/catch 吞掉，
 * 页脚注入是同步渲染路径，插件 HTML 原样拼接不做转义（内容来自站长自己，与主题 CSS 同信任级）。
 */
import { getSettings } from './db'
import type { Env, SettingsMap } from './types'
import { excerpt, isDemo } from './utils'

export interface HookContext {
  /** 异步事件的运行环境（页脚注入是同步渲染路径，没有 env） */
  env?: Env
  settings: SettingsMap
  /** 站点绝对地址前缀（siteUrl 去尾斜杠，未配置为空串） */
  base: string
}

export interface PostPublishedPayload {
  slug: string
  title: string
  summary: string
  /** 触发来源：后台手动发布 / 定时到点 */
  via: 'admin' | 'scheduler'
}

export interface CommentCreatedPayload {
  kind: 'post' | 'weibo' | 'guestbook'
  nickname: string
  content: string
  /** 所在文章标题 / 微博摘要，留言板为空 */
  context?: string
  /** 访客可点的直达地址（含锚点），未配置站点链接时为空串 */
  url: string
  /** 是否待审核（先审后展模式下访客留言的初始状态） */
  pending: boolean
}

export interface ServerPlugin {
  id: string
  title: string
  description: string
  version: string
  author: string
  /** 文章发布（草稿/定时 → 已发布的跃迁，重复保存已发布文章不触发） */
  onPostPublished?: (p: PostPublishedPayload, ctx: HookContext) => Promise<void> | void
  /** 访客发表评论 / 留言（作者自己的回复不触发，避免同步场景里自我刷屏） */
  onCommentCreated?: (p: CommentCreatedPayload, ctx: HookContext) => Promise<void> | void
  /** 页脚注入：返回的 HTML 拼在每页 </body> 前（同步，不能访问 env） */
  footerHtml?: (ctx: HookContext) => string
}

/* ---------------- 官方示例插件 ---------------- */

/** 示例 1：发布同步 TG 频道 —— 复用「外部发布」的 Bot Token，频道 ID 在「设置 → 外部发布」填写 */
const tgChannel: ServerPlugin = {
  id: 'tg-channel',
  title: '发布同步 Telegram 频道',
  description:
    '文章发布时自动推送到指定 Telegram 频道 / 群。复用「外部发布」的 Bot Token，另填频道 ID（如 @mychannel 或 -100 开头的群 ID）；Bot 需先加入频道并有发帖权限。',
  version: '1.0.0',
  author: '官方',
  async onPostPublished(p, ctx) {
    const chatId = (ctx.settings.tgChannelChatId || '').trim()
    const token = (ctx.settings.telegramBotToken || '').trim()
    if (!chatId || !token) return
    const link = ctx.base ? `${ctx.base}/post/${p.slug}` : ''
    const text = [`📢 ${p.title}`, excerpt(p.summary, 120), link]
      .filter(Boolean)
      .join('\n\n')
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  },
}

/** 示例 2：评论 webhook —— 访客留言时 POST 一段 JSON 到自配地址（飞书 / 企微 / Bark 等都能接） */
const commentWebhook: ServerPlugin = {
  id: 'comment-webhook',
  title: '评论 Webhook 推送',
  description:
    '访客发表评论 / 留言时，向自配 URL POST 一段 JSON（event/nickname/content/url 等）——飞书群机器人、企业微信、Bark、Server酱 等通知渠道都能接。地址在「设置 → 服务端插件」填写。',
  version: '1.0.0',
  author: '官方',
  async onCommentCreated(p, ctx) {
    const url = (ctx.settings.commentWebhookUrl || '').trim()
    if (!/^https?:\/\//i.test(url)) return
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'comment.created', site: ctx.settings.siteName, ...p }),
    })
  },
}

/** 示例 3：页脚注入 —— 「设置 → 服务端插件」里的自定义 HTML 注入每页页脚（挂件 / 徽章等） */
const footerHtmlPlugin: ServerPlugin = {
  id: 'footer-html',
  title: '页脚自定义代码',
  description:
    '把自定义 HTML（挂件、徽章、运行天数、备案图标等）注入每一页页脚，内容在「设置 → 服务端插件」维护。受全站 CSP 保护：内联样式可用，外部 <script> 不会执行。',
  version: '1.0.0',
  author: '官方',
  footerHtml(ctx) {
    return (ctx.settings.footerHtmlCode || '').trim()
  },
}

/** 注册表：第三方服务端插件在此登记（顺序即后台展示顺序） */
export const SERVER_PLUGINS: ServerPlugin[] = [tgChannel, commentWebhook, footerHtmlPlugin]

/** 后台「插件」页列表用：只出元数据，不带处理函数 */
export function listServerPlugins(): { id: string; title: string; description: string; version: string; author: string }[] {
  return SERVER_PLUGINS.map(({ id, title, description, version, author }) => ({ id, title, description, version, author }))
}

/* ---------------- 总线 ---------------- */

function enabledPlugins(settings: SettingsMap): ServerPlugin[] {
  const off = new Set((settings.serverPluginsDisabled || '').split(',').filter(Boolean))
  return SERVER_PLUGINS.filter((p) => !off.has(p.id))
}

/** 页脚注入汇总（render.ts page() 每页调用：同步、无 DB 访问、出错跳过该插件） */
export function renderFooterHtml(settings: SettingsMap): string {
  const ctx: HookContext = { settings, base: (settings.siteUrl || '').replace(/\/+$/, '') }
  let html = ''
  for (const p of enabledPlugins(settings)) {
    if (!p.footerHtml) continue
    try {
      html += p.footerHtml(ctx)
    } catch {
      /* 插件出错不影响页面渲染 */
    }
  }
  return html
}

/** 事件广播公共件：遍历启用的插件逐个调 handler，任何失败都不影响调用方主流程；
 *  演示站不外发：体验者随手配置的 TG/webhook 不应让 demo Worker 对外发请求 */
async function fireHook<P>(
  env: Env,
  pick: (plugin: ServerPlugin) => ((p: P, ctx: HookContext) => void | Promise<void>) | undefined,
  p: P
): Promise<void> {
  if (isDemo(env)) return
  try {
    const settings = await getSettings(env.DB)
    const ctx: HookContext = { env, settings, base: (settings.siteUrl || '').replace(/\/+$/, '') }
    for (const plugin of enabledPlugins(settings)) {
      const handler = pick(plugin)
      if (!handler) continue
      try {
        await handler(p, ctx)
      } catch {
        /* 单个插件失败不影响其余插件 */
      }
    }
  } catch {
    /* 读不到设置（库异常等）就放弃，不影响主流程 */
  }
}

/** 发布事件广播：后台发布与定时到点两条路都会调；任何失败都不影响发布本身 */
export function firePostPublished(env: Env, p: PostPublishedPayload): Promise<void> {
  return fireHook(env, (plugin) => plugin.onPostPublished, p)
}

/** 评论事件广播：访客评论/留言三条路（文章、微博、留言板）都会调；任何失败都不影响留言本身 */
export function fireCommentCreated(env: Env, p: CommentCreatedPayload): Promise<void> {
  return fireHook(env, (plugin) => plugin.onCommentCreated, p)
}
