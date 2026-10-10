/* ---------------- 回收站（三表软删除） ----------------
 * posts / weibo / pages 共用一套「deleted_at 毫秒时间戳，NULL = 存活」的软删标记：
 * 删除 = 打标记（原 DELETE 端点改写），恢复 = 清标记，彻底删除 = 真 DELETE 并级联评论。
 * 独立成模块（同 src/closed.ts 的理由）：不依赖 hono / 主题，Node 测试可直接导入。
 * 铁律：三表的新增业务查询必须带 deleted_at IS NULL（例外清单见 AGENTS.md 回收站节）。
 */
import { clampInt } from './utils'

/** 回收站保留天数：到期由每晚备份 cron 顺带彻底清除（src/index.ts scheduled()），到期前数据仍在每日备份里 */
export const TRASH_RETENTION_DAYS = 30

export type TrashType = 'post' | 'weibo' | 'page'
export type TrashTable = 'posts' | 'weibo' | 'pages'

const TRASH_TYPES: Record<TrashType, TrashTable> = { post: 'posts', weibo: 'weibo', page: 'pages' }

/** 路由 :type 参数 → 表名白名单（hasOwnProperty 挡原型链穿透，同 THEMES 校验口径）；非法返回 null */
export function trashTable(type: string): TrashTable | null {
  if (!Object.prototype.hasOwnProperty.call(TRASH_TYPES, type)) return null
  return TRASH_TYPES[type as TrashType]
}

/** 恢复文章时的状态决策：过期的定时文（到点未被 cron 发出，或停用期间已过期）恢复为草稿，
 *  避免恢复动作直接触发「到点即发」；publish_at 仍在前台的定时文保持原状态继续等 cron */
export function restorePostStatus(
  status: string,
  publishAt: number | null,
  now: number
): 'draft' | 'published' | 'scheduled' {
  if (status === 'scheduled' && (publishAt == null || publishAt <= now)) return 'draft'
  return status === 'published' ? 'published' : status === 'scheduled' ? 'scheduled' : 'draft'
}

export interface TrashItem {
  type: TrashType
  id: number
  /** 展示文本：文章/页面标题、微博正文摘要 */
  label: string
  status: string
  deleted_at: number
}

export interface ListTrashResult {
  items: TrashItem[]
  total: number
  page: number
  totalPages: number
}

const TRASH_PAGE_LIMIT = 20

/** 单表回收站列表 SQL 片段：weibo 无标题，用正文前 120 字作展示文本 */
function trashSelect(table: TrashTable): string {
  const label = table === 'weibo' ? 'substr(content, 1, 120)' : 'title'
  return `SELECT '${table}' AS src, id, ${label} AS label, status, deleted_at FROM ${table} WHERE deleted_at IS NOT NULL`
}

/** 回收站列表（后台「回收站」页）：type 缺省 = 三表合并，按删除时间倒序分页 */
export async function listTrash(
  db: D1Database,
  opts: { type?: TrashTable | null; page?: number } = {}
): Promise<ListTrashResult> {
  const page = clampInt(opts.page, 1, 1000, 1)
  const offset = (page - 1) * TRASH_PAGE_LIMIT
  const tables: TrashTable[] = opts.type ? [opts.type] : ['posts', 'weibo', 'pages']
  const countSql = `SELECT ${tables.map((t) => `(SELECT COUNT(*) FROM ${t} WHERE deleted_at IS NOT NULL)`).join(' + ')} AS n`
  const unionSql = tables.map(trashSelect).join(' UNION ALL ')
  const [itemsRes, countRes] = await Promise.all([
    db
      // 子查询内层不排序（合并后统一按 deleted_at DESC 取整页），外层再把 src 映射回前端 type
      .prepare(`SELECT src, id, label, status, deleted_at FROM (${unionSql}) ORDER BY deleted_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(TRASH_PAGE_LIMIT, offset)
      .all<{ src: string; id: number; label: string; status: string; deleted_at: number }>(),
    db.prepare(countSql).first<{ n: number }>(),
  ])
  const total = countRes?.n ?? 0
  const reverse: Record<string, TrashType> = { posts: 'post', weibo: 'weibo', pages: 'page' }
  const items = (itemsRes.results ?? []).map((r) => ({
    type: reverse[r.src] ?? 'post',
    id: r.id,
    label: r.label || '',
    status: r.status,
    deleted_at: r.deleted_at,
  }))
  return { items, total, page, totalPages: Math.max(1, Math.ceil(total / TRASH_PAGE_LIMIT)) }
}

/** 到期彻底清除：每晚备份 cron 调用（src/index.ts scheduled()）。级联子查询先清评论/分类关联再删主行，
 *  一个 batch 事务内完成；返回清除的总行数（仅日志用途；因 FTS 删除触发器会计入索引删除行，
 *  posts/weibo 部分约为实际条数的 2 倍——只看趋势勿当精确值） */
export async function purgeTrash(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - TRASH_RETENTION_DAYS * 86_400_000
  const postCond = 'deleted_at IS NOT NULL AND deleted_at < ?'
  const results = await db.batch([
    db.prepare(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE ${postCond})`).bind(cutoff),
    db.prepare(`DELETE FROM post_categories WHERE post_id IN (SELECT id FROM posts WHERE ${postCond})`).bind(cutoff),
    db.prepare(`DELETE FROM posts WHERE ${postCond}`).bind(cutoff),
    db.prepare(`DELETE FROM comments WHERE weibo_id IN (SELECT id FROM weibo WHERE ${postCond})`).bind(cutoff),
    db.prepare(`DELETE FROM weibo WHERE ${postCond}`).bind(cutoff),
    db.prepare(`DELETE FROM pages WHERE ${postCond}`).bind(cutoff),
  ])
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0)
}
