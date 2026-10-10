/**
 * R2 → 磁盘适配层（自托管 POC，docker-poc/ 独立目录）。
 *
 * 使用面（对 src/ 全量 grep 过）：
 *   put(key, ArrayBuffer|string, { httpMetadata: { contentType, cacheControl } })
 *   get(key) → { body(流), arrayBuffer(), text(), json(), httpEtag, uploaded, size, writeHttpMetadata() }
 *   head(key)、delete(key | key[])、list({ prefix, limit }) → { objects: [{ key, size, uploaded }] }
 *
 * 正文落 <root>/<key>；contentType/etag 落旁车文件 <root>/<key>.meta.json
 * （业务 key 由 store.ts 生成，不会带 .meta.json 后缀，无碰撞）。
 * etag 存「带引号的 HTTP 形态」，与 R2 httpEtag 口径一致——/images/ 路由拿它和
 * 浏览器的 If-None-Match 直接做全等比较实现 304。
 * get 的 body 保持流式：导出 zip「边流边算 CRC」的用法不变（AGENTS 防线）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

const META_SUFFIX = '.meta.json'

function safeJoin(root: string, key: string): string {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('\0')) {
    throw new Error(`[r2-shim] 非法 key: ${key}`)
  }
  const p = path.resolve(root, key)
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error(`[r2-shim] 越界 key: ${key}`)
  return p
}

function toBuffer(value: unknown): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) return Buffer.from(value as Uint8Array)
  throw new Error('[r2-shim] put 只支持 string / ArrayBuffer / TypedArray')
}

interface ObjectMeta {
  etag?: string
  contentType?: string
  cacheControl?: string
}

function writeMeta(file: string, meta: ObjectMeta) {
  fs.writeFileSync(file + META_SUFFIX, JSON.stringify(meta))
}

function readMeta(file: string): ObjectMeta {
  try {
    return JSON.parse(fs.readFileSync(file + META_SUFFIX, 'utf8'))
  } catch {
    return {}
  }
}

/** 递归收集对象 key（跳过旁车元数据文件），字典序输出 */
function listAllKeys(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (!e.name.endsWith(META_SUFFIX)) out.push(path.relative(root, full).split(path.sep).join('/'))
    }
  }
  walk(root)
  return out.sort()
}

function makeObject(file: string, key: string, withBody: boolean) {
  const meta = readMeta(file)
  const st = fs.statSync(file)
  const etag = `"${meta.etag ?? crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')}"`
  return {
    key,
    size: st.size,
    uploaded: st.mtime,
    httpEtag: etag,
    httpMetadata: { contentType: meta.contentType, cacheControl: meta.cacheControl },
    writeHttpMetadata(headers: Headers) {
      if (meta.contentType) headers.set('Content-Type', meta.contentType)
      if (meta.cacheControl) headers.set('Cache-Control', meta.cacheControl)
    },
    body: withBody ? (Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream) : undefined,
    async arrayBuffer(): Promise<ArrayBuffer> {
      const b = fs.readFileSync(file)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
    async text(): Promise<string> {
      return fs.readFileSync(file, 'utf8')
    },
    async json(): Promise<unknown> {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    },
  }
}

export type R2Shim = ReturnType<typeof createR2Disk>

export function createR2Disk(root: string) {
  fs.mkdirSync(root, { recursive: true })

  return {
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) {
      const file = safeJoin(root, key)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const buf = toBuffer(value)
      fs.writeFileSync(file, buf)
      writeMeta(file, {
        etag: crypto.createHash('md5').update(buf).digest('hex'),
        contentType: opts?.httpMetadata?.contentType,
        cacheControl: opts?.httpMetadata?.cacheControl,
      })
      return makeObject(file, key, false)
    },

    async get(key: string) {
      const file = safeJoin(root, key)
      let st: fs.Stats
      try {
        st = fs.statSync(file)
      } catch {
        return null
      }
      if (!st.isFile()) return null
      return makeObject(file, key, true)
    },

    async head(key: string) {
      const file = safeJoin(root, key)
      try {
        if (!fs.statSync(file).isFile()) return null
      } catch {
        return null
      }
      return makeObject(file, key, false)
    },

    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        const file = safeJoin(root, k)
        fs.rmSync(file, { force: true })
        fs.rmSync(file + META_SUFFIX, { force: true })
      }
    },

    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = opts?.prefix ?? ''
      const limit = opts?.limit ?? 1000
      const keys = listAllKeys(root).filter((k) => k.startsWith(prefix))
      // cursor round-trip（demo.ts wipeBucket 分页删光）：磁盘实现无并发写，offset 即安全
      const start = Number(opts?.cursor) || 0
      const page = keys.slice(start, start + limit)
      const next = start + page.length
      return {
        objects: page.map((k) => {
          const st = fs.statSync(path.resolve(root, k))
          return { key: k, size: st.size, uploaded: st.mtime }
        }),
        truncated: next < keys.length,
        cursor: next < keys.length ? String(next) : undefined,
      }
    },
  }
}
