/**
 * R2（S3 兼容接口）适配层 —— 与 r2disk.ts 完全同接口，业务代码零改动。
 *
 * 零依赖：SigV4 签名用 node:crypto 手写（server.ts --selftest 用 AWS 官方测试向量校验）。
 * R2 端点固定 path-style：https://<accountId>.r2.cloudflarestorage.com/<bucket>/<key>，region 用 'auto'。
 * 零出口流量费：图片从 R2 出不收带宽费；读多写少场景只有存储费（$0.015/GB·月）。
 *
 * prefix 隔离：多个租户共享一个桶时，所有 key 实际落在 <prefix>/<key>（prefix=租户域名），
 * 租户间互相不可见——与本地盘「每租户一个目录」同等的隔离语义，迁移时也只搬自己的前缀。
 *
 * 与 r2disk 的差异（有意为之）：
 * - get 会把对象整体读进内存再封流：上传上限 25MB（MAX_UPLOAD_BYTES），瞬时缓冲可接受，
 *   换取 arrayBuffer()/text()/json()/body 四种读法共用一次网络请求
 * - list 单页最多 1000 条（ListObjectsV2 上限）；回收站滚动清理、备份列表的量级远够
 */
import crypto from 'node:crypto'

export interface R2S3Config {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** 租户隔离前缀（多租户共享桶），如 'poc.example.com' */
  prefix?: string
  /** R2 固定 'auto'；留默认即可，参数化是为了 SigV4 自检能跑 AWS 官方向量 */
  region?: string
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function sha256hex(data: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** AWS UriEncode：encodeURIComponent 再补上 !'()* 五个字符 */
function awsUriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${awsUriEncode(k)}=${awsUriEncode(query[k])}`)
    .join('&')
}

/** 生成 Authorization 头。now 可注入（自检用 AWS 文档向量的固定时间） */
export function signAuthorization(
  method: string,
  urlStr: string,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  now: Date,
  body?: Buffer
): string {
  const url = new URL(urlStr)
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = body ? sha256hex(body) : sha256hex('')

  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, url.pathname, url.search.replace(/^\?/, ''), canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n')
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  // 逗号后不加空格，与 AWS 文档/SDK 输出格式严格一致
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`
}

function toBuffer(value: unknown): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) return Buffer.from(value as Uint8Array)
  throw new Error('[r2s3] put 只支持 string / ArrayBuffer / TypedArray')
}

function xmlUnescape(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e as string] as string)
}

function xmlTag(seg: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(seg)
  return m ? xmlUnescape(m[1]) : null
}

export function createR2S3(cfg: R2S3Config) {
  const region = cfg.region || 'auto'
  const base = `https://${cfg.accountId}.r2.cloudflarestorage.com`
  const prefix = cfg.prefix ? cfg.prefix.replace(/\/+$/, '') + '/' : ''
  const full = (key: string) => prefix + key

  function requestUrl(key: string, query?: Record<string, string>): string {
    // path-style + 按段编码；查询串用规范编码原样放行（与签名一致）
    const path = `/${cfg.bucket}${key ? '/' + key.split('/').map(awsUriEncode).join('/') : ''}`
    return `${base}${path}${query ? '?' + canonicalQuery(query) : ''}`
  }

  async function s3fetch(method: string, key: string, opts: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> } = {}): Promise<Response> {
    const url = requestUrl(key, opts.query)
    const authorization = signAuthorization(method, url, cfg.accessKeyId, cfg.secretAccessKey, region, new Date(), opts.body)
    const res = await fetch(url, {
      method,
      headers: { authorization, 'x-amz-content-sha256': opts.body ? sha256hex(opts.body) : sha256hex(''), ...opts.headers },
      body: opts.body,
    })
    return res
  }

  function makeObject(key: string, buf: Buffer, headers: Headers, sizeOverride?: number) {
    const etag = headers.get('etag') || `"${crypto.createHash('md5').update(buf).digest('hex')}"`
    const contentType = headers.get('content-type') || undefined
    const cacheControl = headers.get('cache-control') || undefined
    return {
      key,
      size: sizeOverride ?? buf.length,
      uploaded: headers.get('last-modified') ? new Date(headers.get('last-modified') as string) : new Date(),
      httpEtag: etag.startsWith('"') ? etag : `"${etag}"`,
      httpMetadata: { contentType, cacheControl },
      writeHttpMetadata(headers: Headers) {
        if (contentType) headers.set('Content-Type', contentType)
        if (cacheControl) headers.set('Cache-Control', cacheControl)
      },
      body: new Response(buf).body as unknown as ReadableStream,
      async arrayBuffer(): Promise<ArrayBuffer> {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
      },
      async text(): Promise<string> {
        return buf.toString('utf8')
      },
      async json(): Promise<unknown> {
        return JSON.parse(buf.toString('utf8'))
      },
    }
  }

  function fail(method: string, key: string, res: Response): never {
    throw new Error(`[r2s3] ${method} ${key} → HTTP ${res.status}（检查 accountId/密钥/桶名与令牌权限）`)
  }

  return {
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) {
      const buf = toBuffer(value)
      const headers: Record<string, string> = {}
      if (opts?.httpMetadata?.contentType) headers['content-type'] = opts.httpMetadata.contentType
      if (opts?.httpMetadata?.cacheControl) headers['cache-control'] = opts.httpMetadata.cacheControl
      const res = await s3fetch('PUT', full(key), { body: buf, headers })
      if (!res.ok) fail('PUT', key, res)
      return makeObject(key, buf, res.headers)
    },

    async get(key: string) {
      const res = await s3fetch('GET', full(key))
      if (res.status === 404) return null
      if (!res.ok) fail('GET', key, res)
      return makeObject(key, Buffer.from(await res.arrayBuffer()), res.headers)
    },

    async head(key: string) {
      const res = await s3fetch('HEAD', full(key))
      if (res.status === 404) return null
      if (!res.ok) fail('HEAD', key, res)
      const size = Number(res.headers.get('content-length') || 0)
      return makeObject(key, Buffer.alloc(0), res.headers, size)
    },

    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        const res = await s3fetch('DELETE', full(k))
        if (!res.ok && res.status !== 204) fail('DELETE', k, res)
      }
    },

    async list(opts?: { prefix?: string; limit?: number }) {
      const limit = Math.min(opts?.limit ?? 1000, 1000)
      const res = await s3fetch('GET', '', {
        query: { 'list-type': '2', prefix: full(opts?.prefix ?? ''), 'max-keys': String(limit) },
      })
      if (!res.ok) fail('LIST', opts?.prefix ?? '', res)
      const xml = await res.text()
      const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => {
        const key = (xmlTag(m[1], 'Key') || '').slice(prefix.length)
        return { key, size: Number(xmlTag(m[1], 'Size') || 0), uploaded: new Date(xmlTag(m[1], 'LastModified') || Date.now()) }
      })
      return { objects, truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml) }
    },
  }
}
