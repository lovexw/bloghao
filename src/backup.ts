/**
 * 每晚自动备份：Cloudflare Cron Trigger 定时把 D1 全表快照存进 R2
 *
 * - 备份文件：IMAGES 桶 backups/xwblog-YYYY-MM-DD.json（北京时间日期，同一天重跑覆盖）
 * - 保留策略：滚动保留最近 KEEP_DAYS 份，更早的自动删除
 * - 开关：后台「设置 → 订阅与备份」；lastBackupAt/lastBackupBytes 记录最近一次结果
 * - 本地验证：wrangler dev --test-scheduled 后 curl "http://localhost:8787/__scheduled?cron=30+16+*+*+*"
 */
import { getSettings, saveSettings } from './db'
import { notifyAdminText } from './external'
import type { Env } from './types'

const BACKUP_PREFIX = 'backups/'
const KEEP_FILES = 30
// 会话表是临时凭证、tg_buffer 是相册合并缓冲，都不值得备份
const BACKUP_TABLES = [
  'users',
  'posts',
  'comments',
  'categories',
  'post_categories',
  'weibo',
  'tags',
  'uploads',
  'friend_links',
  'settings',
]
const TABLE_ROW_LIMIT = 100_000

export interface BackupResult {
  ok: boolean
  key?: string
  bytes?: number
  tables?: number
  skipped?: boolean
  error?: string
}

/** 全表导出成一份 JSON 存进 R2，并回写 lastBackup* 设置 */
export async function runBackup(env: Env): Promise<BackupResult> {
  try {
    const settings = await getSettings(env.DB)
    if (settings.backupEnabled === '0') return { ok: false, skipped: true, error: 'disabled' }

    const tables: Record<string, unknown[]> = {}
    for (const table of BACKUP_TABLES) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table} LIMIT ?`).bind(TABLE_ROW_LIMIT).all()
      tables[table] = results ?? []
    }
    // 文件名用北京时间日期：new Date(ts+8h).toISOString() 即东八区墙上时间
    const cstDay = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
    const key = `${BACKUP_PREFIX}xwblog-${cstDay}.json`
    const payload = JSON.stringify({
      app: 'xwblog',
      version: 1,
      exportedAt: new Date().toISOString(),
      tables,
    })
    await env.IMAGES.put(key, payload, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    })
    const bytes = new TextEncoder().encode(payload).length

    // 滚动清理：按文件名（即日期）排序，只留最近 KEEP_FILES 份
    const listed = await env.IMAGES.list({ prefix: BACKUP_PREFIX, limit: 1000 })
    const olds = (listed.objects ?? [])
      .map((o) => o.key)
      .filter((k) => k !== key)
      .sort()
    for (const k of olds.slice(0, Math.max(0, olds.length + 1 - KEEP_FILES))) {
      await env.IMAGES.delete(k)
    }

    await saveSettings(env.DB, {
      lastBackupAt: String(Date.now()),
      lastBackupKey: key,
      lastBackupBytes: String(bytes),
    })
    return { ok: true, key, bytes, tables: BACKUP_TABLES.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Cron 入口：备份失败时尽量推一条 Telegram 给站长（成功不打扰） */
export async function scheduledBackup(_controller: unknown, env: Env): Promise<void> {
  const r = await runBackup(env)
  if (!r.ok && !r.skipped) {
    await notifyAdminText(env, `⚠️ 昨晚的数据库备份失败了\n原因：${r.error || '未知'}\n到后台「订阅与备份」点「立即备份」重试，或检查 R2 / D1 状态。`)
  }
}
