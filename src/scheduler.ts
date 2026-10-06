/**
 * 定时发布：cron 每分钟扫描到点的 scheduled 文章，翻成 published 并推 Telegram。
 *
 * - 到点判定：publish_at <= now（北京时间在编辑器里选，存的是毫秒时间戳）
 * - published_at 取 publish_at 本身（列表/归档按它排序，避免沉到老文章后面）
 * - Cron 入口在 index.ts scheduled() 里先于备份执行；Cloudflare cron 最细粒度即每分钟
 * - 本地验证：wrangler dev --test-scheduled 后 curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
 */
import { getSettings } from './db'
import { firePostPublished } from './hooks'
import { notifyAdminText } from './external'
import type { Env } from './types'

interface DuePost {
  id: number
  slug: string
  title: string
  summary: string
  publish_at: number
}

export interface ScheduleResult {
  published: number
  errors: string[]
}

/** 把所有到期的 scheduled 文章翻成 published；返回发布数量供 TG 汇总 */
export async function runScheduledPublish(env: Env): Promise<ScheduleResult> {
  const result: ScheduleResult = { published: 0, errors: [] }
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, slug, title, summary, publish_at FROM posts
       WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= ? AND deleted_at IS NULL
       LIMIT 20`
    )
      .bind(Date.now())
      .all<DuePost>()
    // 00:30 备份 cron 与发布 cron 同刻并发触发：UPDATE 带 status='scheduled' 原子护栏，
    // 只有 meta.changes=1 的（真正由本次发布的）才计数进通知，输家不虚报、不重复推
    const publishedIds = new Set<number>()
    for (const p of results ?? []) {
      try {
        const res = await env.DB.prepare(
          "UPDATE posts SET status = 'published', published_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled' AND deleted_at IS NULL"
        )
          .bind(p.publish_at, Date.now(), p.id)
          .run()
        if ((res.meta.changes ?? 0) === 1) {
          result.published++
          publishedIds.add(p.id)
        }
      } catch (e) {
        result.errors.push(`${p.title}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    // 广播发布事件给服务端插件（发布同步 TG 频道等，见 src/hooks.ts）：与手动发布同一事件
    for (const p of results ?? []) {
      if (!publishedIds.has(p.id)) continue
      await firePostPublished(env, { slug: p.slug, title: p.title, summary: p.summary, via: 'scheduler' })
    }
    // 汇总通知一条：发布了 0 篇不打扰；失败尽量报出来
    if (result.published > 0 || result.errors.length) {
      const settings = await getSettings(env.DB)
      const siteUrl = (settings.siteUrl || '').replace(/\/+$/, '')
      const lines: string[] = []
      if (result.published > 0) {
        lines.push(`⏰ 定时发布完成，共 ${result.published} 篇：`)
        for (const p of results ?? []) {
          if (!publishedIds.has(p.id)) continue
          lines.push(`· ${p.title}${siteUrl ? `\n  ${siteUrl}/post/${p.slug}` : ''}`)
        }
      }
      for (const e of result.errors) lines.push(`⚠️ 发布失败：${e}`)
      await notifyAdminText(env, lines.join('\n'))
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e))
  }
  return result
}
