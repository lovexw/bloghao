import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listTrash, purgeTrash, restorePostStatus, trashTable, TRASH_RETENTION_DAYS } from '../src/trash.ts'

// ── type 白名单：路由 :type 参数 → 表名（防原型链属性穿透，同 THEMES 口径）──
test('trashTable：合法 type 映射三表', () => {
  assert.equal(trashTable('post'), 'posts')
  assert.equal(trashTable('weibo'), 'weibo')
  assert.equal(trashTable('page'), 'pages')
})

test('trashTable：非法与原型链属性一律返回 null', () => {
  for (const t of ['', 'POST', 'post ', 'comments', 'users', 'constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.equal(trashTable(t), null, t)
  }
})

// ── 恢复文章的状态决策：过期定时文必须转草稿，防「恢复即撞发」──
const NOW = 1_800_000_000_000

test('restorePostStatus：published / draft 恢复保持原状态', () => {
  assert.equal(restorePostStatus('published', null, NOW), 'published')
  assert.equal(restorePostStatus('draft', null, NOW), 'draft')
})

test('restorePostStatus：未到点的定时文保持 scheduled，继续等 cron 发布', () => {
  assert.equal(restorePostStatus('scheduled', NOW + 3_600_000, NOW), 'scheduled')
})

test('restorePostStatus：已过期的定时文恢复为草稿（含 publish_at 异常缺失）', () => {
  assert.equal(restorePostStatus('scheduled', NOW - 1, NOW), 'draft')
  assert.equal(restorePostStatus('scheduled', NOW, NOW), 'draft')
  assert.equal(restorePostStatus('scheduled', null, NOW), 'draft')
})

// ── purgeTrash：六条 DELETE 一个 batch（事务），级联子查询先清评论/分类关联 ──
function fakePurgeDb(): { db: D1Database; sqls: string[]; binds: unknown[][]; batchStmts: unknown[] } {
  const sqls: string[] = []
  const binds: unknown[][] = []
  const batchStmts: unknown[] = []
  const db = {
    prepare(sql: string) {
      sqls.push(sql)
      return {
        bind: (...args: unknown[]) => {
          binds.push(args)
          const stmt = { sql }
          batchStmts.push(stmt)
          return stmt
        },
      }
    },
    batch: async () => batchStmts.map(() => ({ meta: { changes: 1 } })),
  } as unknown as D1Database
  return { db, sqls, binds, batchStmts }
}

test('purgeTrash：只清超过保留期的软删行，六条语句按「先级联后主行」排序', async () => {
  const { db, sqls, binds, batchStmts } = fakePurgeDb()
  const now = 1_750_000_000_000
  const n = await purgeTrash(db, now)

  assert.equal(n, 6)
  assert.equal(batchStmts.length, 6)
  // 每条都带保留期条件；cutoff = now - 30 天（毫秒口径与三表时间列一致）
  const cutoff = now - TRASH_RETENTION_DAYS * 86_400_000
  assert.equal(TRASH_RETENTION_DAYS, 30)
  for (const b of binds) assert.deepEqual(b, [cutoff])
  // 级联在前：posts 的评论/分类关联先删，再删 weibo 评论，最后三张主表
  assert.match(sqls[0], /^DELETE FROM comments WHERE post_id IN/)
  assert.match(sqls[1], /^DELETE FROM post_categories WHERE post_id IN/)
  assert.match(sqls[2], /^DELETE FROM posts WHERE/)
  assert.match(sqls[3], /^DELETE FROM comments WHERE weibo_id IN/)
  assert.match(sqls[4], /^DELETE FROM weibo WHERE/)
  assert.match(sqls[5], /^DELETE FROM pages WHERE/)
  // 子查询内必须同时满足「在回收站」与「已过期」两个条件，避免误删未到期行的人工数据
  for (const s of sqls) assert.match(s, /deleted_at IS NOT NULL AND deleted_at < \?/)
})

// ── listTrash：合并/单类型两种查询形态 + 行归一化 ──
function fakeListDb(rows: { src: string; id: number; label: string; status: string; deleted_at: number }[], total: number) {
  const sqls: string[] = []
  const db = {
    prepare(sql: string) {
      sqls.push(sql)
      const bound = {
        all: async () => ({ results: rows }),
        first: async () => ({ n: total }),
      }
      return { bind: () => bound, all: bound.all, first: bound.first }
    },
  } as unknown as D1Database
  return { db, sqls }
}

test('listTrash：不带 type 合并三表（UNION ALL），行归一化为前端 type 并按删除时间倒序', async () => {
  const rows = [
    { src: 'posts', id: 3, label: '文章标题', status: 'published', deleted_at: 300 },
    { src: 'weibo', id: 2, label: '微博内容', status: 'published', deleted_at: 200 },
    { src: 'pages', id: 1, label: '页面标题', status: 'draft', deleted_at: 100 },
  ]
  const { db, sqls } = fakeListDb(rows, 23)
  const r = await listTrash(db, { page: 2 })

  assert.equal(sqls.length, 2)
  assert.match(sqls[0], /UNION ALL/)
  for (const t of ['FROM posts', 'FROM weibo', 'FROM pages']) assert.ok(sqls[0].includes(t), t)
  assert.match(sqls[1], /\+ .+COUNT\(\*\).*deleted_at IS NOT NULL/) // 三段计数相加
  assert.deepEqual(
    r.items.map((i) => [i.type, i.id, i.label]),
    [
      ['post', 3, '文章标题'],
      ['weibo', 2, '微博内容'],
      ['page', 1, '页面标题'],
    ]
  )
  assert.equal(r.total, 23)
  assert.equal(r.page, 2)
  assert.equal(r.totalPages, 2) // ceil(23/20)
  // 列表 SQL 统一 deleted_at DESC + LIMIT/OFFSET，与 weibo/listPosts 分页口径一致
  assert.match(sqls[0], /ORDER BY deleted_at DESC, id DESC LIMIT \? OFFSET \?/)
})

test('listTrash：带 type 只查单表（weibo 用正文摘要作 label），分页不串表', async () => {
  const { db, sqls } = fakeListDb([], 0)
  const r = await listTrash(db, { type: 'weibo', page: 1 })

  assert.equal(r.items.length, 0)
  assert.equal(r.totalPages, 1)
  assert.equal(sqls.length, 2)
  assert.doesNotMatch(sqls[0], /UNION ALL/)
  assert.match(sqls[0], /FROM weibo WHERE deleted_at IS NOT NULL/)
  assert.match(sqls[0], /substr\(content, 1, 120\) AS label/) // 微博无标题，正文前 120 字上屏
  assert.match(sqls[1], /FROM weibo WHERE deleted_at IS NOT NULL/)
})
