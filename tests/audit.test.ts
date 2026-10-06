import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backfillHashes, cleanupUnreferenced, collectReferencedKeys, groupDuplicates, HASH_MISSING, isMediaKey, mergeDuplicate, runAudit, type UploadRow } from '../src/audit.ts'
import { sha256Hex } from '../src/utils.ts'
import type { Env } from '../src/types.ts'

/* ---------------- 媒体体检：引用识别 / 重复分组 / fake D1+R2 全链路 ---------------- */

const enc = new TextEncoder()
const bytes = (s: string): number => enc.encode(s).length
const bufOf = (s: string): ArrayBuffer => enc.encode(s).buffer as ArrayBuffer
const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

/** 迷你 D1 桩：只实现 audit.ts 发出的那几类 SQL（与 SQLite 语义对齐的最小集）。
 *  UPDATE 改写里所有列的 from 相同（都是 /images/<rm>），桩按同一 from/to 处理等价 */
function fakeDb(tables: Tables): D1Database {
  function exec(sql: string, binds: unknown[]): { results?: Row[]; meta?: { changes: number } } {
    // 绑定数与占位符数必须一致（真实 D1 会报 Wrong number of parameter bindings——曾被宽松的桩放过）
    const ph = (sql.match(/\?/g) || []).length
    if (ph !== binds.length) throw new Error(`绑定数不匹配: 占位符 ${ph} 个, 绑定 ${binds.length} 个: ${sql}`)
    // 全量 uploads（体检）
    if (sql.startsWith('SELECT id, key, name, mime, size, created_at, hash FROM uploads ORDER BY created_at DESC'))
      return { results: [...tables.uploads].sort((a, b) => (b.created_at as number) - (a.created_at as number)) }
    // 分桶探测：只挑含 /images/ 的行
    let m = /SELECT id, length\(CAST\((\w+) AS BLOB\)\) AS len FROM (\w+) WHERE \1 LIKE '%\/images\/%'$/.exec(sql)
    if (m) {
      const [, col, table] = m
      return {
        results: tables[table]
          .filter((r) => String(r[col] ?? '').includes('/images/'))
          .map((r) => ({ id: r.id, len: bytes(String(r[col] ?? '')) })),
      }
    }
    // 分桶拉取：WHERE id IN (...)
    m = /SELECT (\w+) AS v FROM (\w+) WHERE id IN \(([^)]*)\)$/.exec(sql)
    if (m) {
      const [, col, table] = m
      const ids = binds as number[]
      return { results: tables[table].filter((r) => ids.includes(r.id as number)).map((r) => ({ v: r[col] })) }
    }
    // uploads key IN 查询（体检合并/清理取行）
    m = /SELECT (.+?) FROM uploads WHERE key IN \(([^)]*)\)$/.exec(sql)
    if (m) {
      const cols = m[1].split(',').map((c) => c.trim())
      const keys = binds as string[]
      return { results: tables.uploads.filter((r) => keys.includes(r.key as string)).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))) }
    }
    // 小字段批查：SELECT <col> AS v FROM <table> WHERE <col> LIKE '%/images/%'[ LIMIT n]
    m = /SELECT (\w+) AS v FROM (\w+) WHERE \1 LIKE '%\/images\/%'( LIMIT \d+)?$/.exec(sql)
    if (m) {
      const [, col, table] = m
      return { results: tables[table].filter((r) => String(r[col] ?? '').includes('/images/')).map((r) => ({ v: r[col] })) }
    }
    // 回填：选取 / 计数 / 写指纹
    if (sql.startsWith("SELECT key FROM uploads WHERE hash = '' LIMIT"))
      return { results: tables.uploads.filter((r) => !r.hash).slice(0, Number(binds[0])) }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM uploads WHERE hash = ''"))
      return { results: [{ n: tables.uploads.filter((r) => !r.hash).length }] }
    if (sql === 'UPDATE uploads SET hash = ? WHERE key = ?') {
      const [hash, key] = binds as string[]
      const row = tables.uploads.find((r) => r.key === key)
      if (row) row.hash = hash
      return { meta: { changes: row ? 1 : 0 } }
    }
    // 引用改写：UPDATE <table> SET c1 = REPLACE(c1, ?, ?), ... WHERE instr(c1, ?) > 0 OR ...
    m = /^UPDATE (\w+) SET (.+?) WHERE (.+?)$/.exec(sql)
    if (m && m[2].includes('REPLACE(')) {
      const [, table, setPart, wherePart] = m
      const cols = [...setPart.matchAll(/(\w+) = REPLACE\(\1, \?, \?\)/g)].map((x) => x[1])
      const whereCols = [...wherePart.matchAll(/instr\((\w+), \?\) > 0/g)].map((x) => x[1])
      const from = binds[0] as string
      const to = binds[1] as string
      let changes = 0
      for (const row of tables[table]) {
        if (!whereCols.some((c) => String(row[c] ?? '').includes(from))) continue
        for (const c of cols) row[c] = String(row[c] ?? '').split(from).join(to)
        changes++
      }
      return { meta: { changes } }
    }
    // 删除登记
    m = /^DELETE FROM uploads WHERE key IN \(([^)]*)\)$/.exec(sql)
    if (m) {
      const keys = binds as string[]
      const before = tables.uploads.length
      tables.uploads = tables.uploads.filter((r) => !keys.includes(r.key as string))
      return { meta: { changes: before - tables.uploads.length } }
    }
    throw new Error('fakeDb 未实现的 SQL: ' + sql)
  }

  function stmt(sql: string) {
    return {
      sql,
      binds: [] as unknown[],
      bind(...args: unknown[]) {
        this.binds = args
        return this
      },
      async first<T>(): Promise<T | null> {
        const r = exec(sql, this.binds)
        return ((r.results ?? [])[0] ?? null) as T | null
      },
      async all<T>(): Promise<{ results: T[] }> {
        const r = exec(sql, this.binds)
        return { results: (r.results ?? []) as T[] }
      },
      async run() {
        return exec(sql, this.binds)
      },
    }
  }
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: { sql: string; binds: unknown[] }[]) => stmts.map((s) => exec(s.sql, s.binds)),
  } as unknown as D1Database
}

function fakeR2(objects: Map<string, string>): R2Bucket {
  return {
    get: async (key: string) => (objects.has(key) ? { arrayBuffer: async () => bufOf(objects.get(key)!) } : null),
    put: async () => {},
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k)
    },
  } as unknown as R2Bucket
}

function fakeEnv(tables: Tables, r2 = new Map<string, string>()): Env {
  return { DB: fakeDb(tables), IMAGES: fakeR2(r2) } as unknown as Env
}

let seq = 0
function up(key: string, hash = '', size = 100): UploadRow {
  return { id: ++seq, key, name: key, mime: 'image/png', size, created_at: 1700000000000 + seq, hash }
}

/* ---------------- 纯函数 ---------------- */

test('sha256Hex：标准向量', async () => {
  assert.equal(await sha256Hex(bufOf('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(await sha256Hex(bufOf('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
})

test('collectReferencedKeys：正文 / 绝对 URL / JSON / markdown / 标点与 ?#& 参数都识别', () => {
  const k1 = 'u/202510/aaa111.jpg'
  const k2 = 'og/202510/aaa222.png'
  const texts = [
    `<p><img src="/images/${k1}" alt="x"></p>`,
    `https://blog.example.com/images/${k2}?w=100#frag`,
    `![](/images/${k1})`,
    `["/images/${k2}","/images/别的.jpg"]`,
    `图在 /images/${k1}。`,
  ]
  assert.deepEqual([...collectReferencedKeys([k1, k2], texts)].sort(), [k1, k2].sort())
})

test('collectReferencedKeys：不误伤（key 精确命中，前缀相似的 key 不串）', () => {
  const a = 'u/a/1.jpg'
  const b = 'u/a/10.jpg'
  const found = collectReferencedKeys([a, b], [`<img src="/images/${b}">`])
  assert.ok(found.has(b))
  assert.ok(!found.has(a))
  assert.equal(collectReferencedKeys([], ['<img src="/images/u/a/1.jpg">']).size, 0)
  assert.equal(collectReferencedKeys([a], ['普通文字，没有引用']).size, 0)
})

test('collectReferencedKeys：与非 URL 字符直接相邻不吸附尾巴（防漏识别→误删）', () => {
  const k = 'u/202510/ccc333.jpg'
  // 中文正文里紧贴 key：候选串若把「即可」吸进来，精确命中失败 → 会被当成未引用误删
  assert.ok(collectReferencedKeys([k], [`详见/images/${k}即可`]).has(k))
  // HTML 属性值以 &amp; 结尾（& 在 key 字符集之外，自然截断）
  assert.ok(collectReferencedKeys([k], [`<img src="/images/${k}&amp;">`]).has(k))
})

test('groupDuplicates：只认 64 位十六进制指纹，空串与 missing 哨兵不参与，冗余按 (n-1)×size', () => {
  const k1 = 'u/x/1.jpg'
  const k2 = 'u/x/2.jpg'
  const k3 = 'u/x/3.jpg'
  const groups = groupDuplicates([
    up(k1, H1, 300),
    up(k2, H1, 300),
    up(k3, H2, 100), // 单份不成组
    up('u/x/4.jpg', '', 50), // 未回填
    up('u/x/5.jpg', HASH_MISSING, 50), // 失踪
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].hash, H1)
  assert.deepEqual(groups[0].items.map((i) => i.key), [k1, k2])
  assert.equal(groups[0].wasteBytes, 300)
})

test('isMediaKey：u/ 与 og/ 放行，其余（backups/、users/、空串）拒绝', () => {
  assert.ok(isMediaKey('u/202510/a.jpg'))
  assert.ok(isMediaKey('og/202510/a.png'))
  assert.ok(!isMediaKey('backups/x.json'))
  assert.ok(!isMediaKey('users/x.jpg'))
  assert.ok(!isMediaKey(''))
})

/* ---------------- 全链路（fake D1 + R2） ---------------- */

function auditTables() {
  return {
    uploads: [
      up('u/k/1.jpg', H1, 300), // 正文引用
      up('u/k/2.jpg', H2, 200), // 封面引用
      up('u/k/3.jpg', H1, 300), // 与 1 内容相同（OG 设置引用）
      up('u/k/4.jpg', '', 400), // 未引用，指纹未回填
      up('u/k/5.jpg', HASH_MISSING, 500), // 失踪
    ],
    posts: [{ id: 1, content: `<p><img src="/images/u/k/1.jpg"></p>`, cover: '/images/u/k/2.jpg' }],
    pages: [{ id: 1, content: '<p>无图页面</p>' }],
    weibo: [{ id: 1, images: '[]' }],
    users: [{ avatar: '' }],
    friend_links: [{ icon: '' }],
    settings: [{ value: '/images/u/k/3.jpg' }],
    tg_buffer: [],
  } satisfies Tables
}

test('runAudit：引用源（正文/封面/设置）识别 + 未引用/指纹缺失/失踪/重复分组', async () => {
  const d = await runAudit(fakeEnv(auditTables()))
  assert.equal(d.scanned, 5)
  assert.equal(d.missingHash, 1)
  // 未引用只有 k4（k5 是失踪单独呈现）；体积口径正确
  assert.deepEqual(d.unreferenced.map((u) => u.key), ['u/k/4.jpg'])
  assert.equal(d.unreferencedBytes, 400)
  // 失踪记录带引用状态
  assert.deepEqual(d.ghosts.map((g) => g.key), ['u/k/5.jpg'])
  assert.equal(d.ghosts[0].referenced, false)
  // 重复组：k1+k3 内容相同（结果按创建时间倒序），且都带引用状态
  assert.equal(d.duplicateGroups.length, 1)
  assert.deepEqual(d.duplicateGroups[0].items.map((u) => u.key).sort(), ['u/k/1.jpg', 'u/k/3.jpg'])
  assert.deepEqual(d.duplicateGroups[0].items.map((u) => u.referenced), [true, true])
  assert.equal(d.duplicateBytes, 300)
})

test('runAudit：tg_buffer 里的待合并图片也算引用，不会被判成未引用', async () => {
  const t = auditTables()
  t.tg_buffer.push({ content: '', images: '["/images/u/k/4.jpg"]' })
  const d = await runAudit(fakeEnv(t))
  assert.deepEqual(d.unreferenced, [])
})

test('backfillHashes：增量回填到算完为止，R2 缺失的写 missing 哨兵且不无限循环', async () => {
  const t = auditTables()
  t.uploads.forEach((r) => (r.hash = ''))
  const r2 = new Map<string, string>([
    ['u/k/1.jpg', 'AAA'],
    ['u/k/2.jpg', 'BBB'],
    ['u/k/3.jpg', 'AAA'],
    ['u/k/4.jpg', 'CCC'],
    // u/k/5.jpg 故意不放 → 失踪
  ])
  const env = fakeEnv(t, r2)
  let rounds = 0
  for (;;) {
    const r = await backfillHashes(env, 2)
    rounds++
    assert.ok(rounds < 10, '回填必须收敛')
    if (!r.remaining) break
  }
  assert.equal(rounds, 3)
  const byKey = Object.fromEntries(t.uploads.map((r) => [r.key, r]))
  assert.equal(byKey['u/k/1.jpg'].hash, await sha256Hex(bufOf('AAA')))
  assert.equal(byKey['u/k/5.jpg'].hash, HASH_MISSING)
  // 回填后体检：k1/k3 内容相同 → 同指纹成组
  const d = await runAudit(env)
  assert.equal(d.missingHash, 0)
  assert.equal(d.duplicateGroups.length, 1)
  assert.deepEqual(d.duplicateGroups[0].items.map((u) => u.key).sort(), ['u/k/1.jpg', 'u/k/3.jpg'])
})

test('mergeDuplicate：引用跨表改写 + 删 R2 与登记；指纹一致才放行', async () => {
  const t = auditTables()
  const r2 = new Map<string, string>([
    ['u/k/1.jpg', 'AAA'],
    ['u/k/3.jpg', 'AAA'],
  ])
  const env = fakeEnv(t, r2)
  const r = await mergeDuplicate(env, 'u/k/1.jpg', ['u/k/3.jpg'])
  assert.equal(r.updated, 1) // settings 里那处引用
  assert.equal(r.freedBytes, 300)
  // 引用全部指向保留项
  assert.equal(t.settings[0].value, '/images/u/k/1.jpg')
  assert.ok(!t.settings[0].value.includes('u/k/3.jpg'))
  // R2 与登记都清了
  assert.ok(!r2.has('u/k/3.jpg'))
  assert.ok(t.uploads.some((u) => u.key === 'u/k/1.jpg'))
  assert.ok(!t.uploads.some((u) => u.key === 'u/k/3.jpg'))
  // 再体检：重复组消失
  const d = await runAudit(env)
  assert.equal(d.duplicateGroups.length, 0)
})

test('mergeDuplicate：微博/封面/友链/缓存缓冲的引用一并改写', async () => {
  const t = auditTables()
  t.posts[0].cover = '/images/u/k/3.jpg'
  t.weibo[0].images = '["/images/u/k/3.jpg"]'
  t.friend_links[0].icon = '/images/u/k/3.jpg'
  t.tg_buffer.push({ content: '看图 /images/u/k/3.jpg', images: '[]' })
  const env = fakeEnv(t)
  const r = await mergeDuplicate(env, 'u/k/1.jpg', ['u/k/3.jpg'])
  assert.equal(t.posts[0].cover, '/images/u/k/1.jpg')
  assert.equal(t.weibo[0].images, '["/images/u/k/1.jpg"]')
  assert.equal(t.friend_links[0].icon, '/images/u/k/1.jpg')
  assert.equal(t.tg_buffer[0].content, '看图 /images/u/k/1.jpg')
  // 封面 + 微博 + 友链 + tg_buffer + settings（种子里那处 OG 引用）共 5 处
  assert.equal(r.updated, 5)
})

test('mergeDuplicate：安全闸——指纹不一致 / 不存在 / 非法 key / 包含保留项 全部拒绝', async () => {
  const t = auditTables()
  const env = fakeEnv(t)
  await assert.rejects(() => mergeDuplicate(env, 'u/k/1.jpg', ['u/k/2.jpg']), /指纹不一致或尚未计算/)
  await assert.rejects(() => mergeDuplicate(env, 'u/k/9.jpg', ['u/k/1.jpg']), /要保留的文件不存在/)
  await assert.rejects(() => mergeDuplicate(env, 'u/k/1.jpg', ['u/k/9.jpg']), /部分文件不存在/)
  await assert.rejects(() => mergeDuplicate(env, 'u/k/1.jpg', ['backups/x.json']), /非法的文件 Key/)
  await assert.rejects(() => mergeDuplicate(env, 'u/k/1.jpg', ['u/k/1.jpg']), /非法的文件 Key/)
})

test('cleanupUnreferenced：删掉未引用的，期间被内容引用的原样保留并回告', async () => {
  const t = auditTables()
  const r2 = new Map<string, string>([
    ['u/k/1.jpg', 'AAA'],
    ['u/k/2.jpg', 'BBB'],
    ['u/k/4.jpg', 'CCC'],
  ])
  const env = fakeEnv(t, r2)
  // k1（正文）、k2（封面）被引用；k4 未引用；k5 失踪未引用
  const r = await cleanupUnreferenced(env, ['u/k/1.jpg', 'u/k/2.jpg', 'u/k/4.jpg', 'u/k/5.jpg'])
  assert.equal(r.deleted, 2)
  assert.deepEqual(r.blocked, ['u/k/1.jpg', 'u/k/2.jpg'])
  assert.equal(r.freedBytes, 900) // k4 400 + k5 500
  assert.ok(!r2.has('u/k/4.jpg'))
  assert.ok(r2.has('u/k/1.jpg'))
  assert.ok(!t.uploads.some((u) => u.key === 'u/k/4.jpg'))
  assert.ok(t.uploads.some((u) => u.key === 'u/k/2.jpg'))
})

test('cleanupUnreferenced：全被引用时一个不删；非法 key / 超量拒绝', async () => {
  const t = auditTables()
  const env = fakeEnv(t)
  const r = await cleanupUnreferenced(env, ['u/k/1.jpg', 'u/k/2.jpg'])
  assert.equal(r.deleted, 0)
  assert.equal(r.blocked.length, 2)
  await assert.rejects(() => cleanupUnreferenced(env, ['backups/x.json']), /非法的文件 Key/)
  await assert.rejects(() => cleanupUnreferenced(env, Array.from({ length: 101 }, (_, i) => `u/x/${i}.jpg`)), /非法的文件 Key/)
})
