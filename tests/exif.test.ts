import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Env } from '../src/types.ts'
import { stripImageMetadata } from '../src/exif.ts'
import { saveUpload } from '../src/store.ts'

// ── fixture 工具：手工拼字节流，不依赖图片库 ──
const u8 = (...parts: Array<number[] | Uint8Array>): Uint8Array => {
  const all = parts.map((p) => Array.from(p instanceof Uint8Array ? p : p)).flat()
  const out = new Uint8Array(all.length)
  out.set(all)
  return out
}
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
const contains = (b: Uint8Array, needle: number[]) => {
  outer: for (let i = 0; i + needle.length <= b.length; i++) {
    for (let k = 0; k < needle.length; k++) if (b[i + k] !== needle[k]) continue outer
    return true
  }
  return false
}

/** 小端 TIFF：IFD0（orientation + GPS IFD 指针）+ GPS IFD（北纬 34°13′12.34″），
 *  结构 8 + 30 + 42 + 24 = 104 字节，orientation 参数可换 */
function exifTiff(orientation: number): number[] {
  const ifd0 = [
    0x02, 0x00, // IFD0 条目数 2
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation & 0xff, 0x00, 0x00, 0x00, // 0x0112 orientation, SHORT 内联
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, // 0x8825 GPS IFD 指针 → 80
    0x00, 0x00, 0x00, 0x00, // next IFD
  ]
  const gps = [
    0x03, 0x00, // GPS IFD 条目数 3
    0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00, // GPSLatitudeRef 'N'
    0x02, 0x00, 0x05, 0x00, 0x03, 0x00, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, // GPSLatitude RATIONAL×3 → 80
    0x04, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x45, 0x00, 0x00, 0x00, // GPSLongitudeRef 'E'
    0x00, 0x00, 0x00, 0x00, // next IFD
  ]
  const rationals = [
    34, 0, 0, 0, 1, 0, 0, 0, // 34/1
    13, 0, 0, 0, 1, 0, 0, 0, // 13/1
    0xd2, 0x04, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, // 1234/100
  ]
  return [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II" 42 IFD0@8
    ...ifd0, ...gps, ...rationals, // 8+30=38 起 GPS IFD，38+42=80 起 rationals
  ]
}

const app1 = (payload: number[]) => [0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload]
const jpeg = (orientation: number) =>
  u8(
    [0xff, 0xd8],
    app1([...ascii('Exif'), 0, 0, ...exifTiff(orientation)]),
    [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00], // DQT 占位（len=4：长度字段 + 2 字节表数据）
    [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33], // SOS + 扫描数据
    [0xff, 0xd9]
  )

const pngChunk = (type: string, data: number[]) => {
  const len = data.length
  return [len >>> 24 & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...ascii(type), ...data, 1, 2, 3, 4]
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (withMeta: boolean) =>
  u8(
    PNG_SIG,
    pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...(withMeta ? [pngChunk('eXIf', [...ascii('GPS!')]), pngChunk('tEXt', [...ascii('hello')])] : []),
    pngChunk('IDAT', [0xaa, 0xbb]),
    pngChunk('IEND', [])
  )

const riffSize = (size: number) => [size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff]
const webpChunk = (cc: string, data: number[]) => [...ascii(cc), ...riffSize(data.length), ...data, ...Array((data.length & 1) as number).fill(0)]
const webp = (withMeta: boolean) => {
  const body = u8(
    webpChunk('VP8X', [0x3c, 1, 0, 0, 0, 0, 0]), // flags: ICC|ALPHA|EXIF|XMP
    webpChunk('VP8 ', [0xaa, 0xbb, 0xcc, 0xdd]),
    ...(withMeta ? [webpChunk('EXIF', [...ascii('GPS!!')]), webpChunk('XMP ', [...ascii('xmp1')])] : [])
  )
  return u8([...ascii('RIFF'), ...riffSize(body.length), ...ascii('WEBP'), ...body])
}

// ── JPEG ──
test('JPEG：EXIF/GPS 所在的 APP1 被整段摘除，其余段原样保留', () => {
  const out = new Uint8Array(stripImageMetadata(jpeg(1).buffer!))
  assert.ok(!contains(out, [0xff, 0xe1]), 'APP1 应被摘除')
  assert.ok(!contains(out, ascii('Exif')), 'Exif 头应消失（含 GPS 坐标）')
  assert.deepEqual(Array.from(out.subarray(0, 2)), [0xff, 0xd8], 'SOI 保留')
  assert.ok(contains(out, [0xff, 0xdb]), 'DQT 保留')
  assert.ok(contains(out, [0xff, 0xda]), 'SOS+扫描数据保留')
  assert.ok(out.byteLength < jpeg(1).byteLength, '体积应收窄')
})

test('JPEG：orientation ≠ 1 整体跳过（防剥掉旋转标记后显示颠倒）', () => {
  const file = jpeg(6)
  assert.equal(stripImageMetadata(file.buffer!), file.buffer, '应原样返回同一缓冲')
})

test('JPEG：无 EXIF / 截断损坏 / 纯扫描数据 → 原样返回不抛错', () => {
  const plain = u8([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9])
  assert.equal(stripImageMetadata(plain.buffer!), plain.buffer)
  const truncated = u8([0xff, 0xd8, 0xff, 0xe1, 0x00])
  assert.equal(stripImageMetadata(truncated.buffer!), truncated.buffer)
  const tiny = new ArrayBuffer(4)
  assert.equal(stripImageMetadata(tiny), tiny)
})

// ── PNG ──
test('PNG：eXIf / tEXt 辅助块摘除，IHDR/IDAT/IEND 与 CRC 原样', () => {
  const out = new Uint8Array(stripImageMetadata(png(true).buffer!))
  assert.ok(!contains(out, ascii('eXIf')), 'eXIf 块应消失')
  assert.ok(!contains(out, ascii('hello')), 'tEXt 块应消失')
  assert.ok(contains(out, ascii('IDAT')), 'IDAT 保留')
  const expected = png(false)
  assert.deepEqual(Array.from(out), Array.from(expected), '应与无元数据版本逐字节一致')
})

test('PNG：无元数据原样返回同一缓冲', () => {
  const file = png(false)
  assert.equal(stripImageMetadata(file.buffer!), file.buffer)
})

// ── WebP ──
test('WebP：EXIF/XMP 块摘除、VP8X 标志位清零、RIFF 尺寸修正，VP8 数据保留', () => {
  const withMeta = webp(true)
  const out = new Uint8Array(stripImageMetadata(withMeta.buffer!))
  assert.ok(!contains(out, ascii('EXIF')), 'EXIF 块应消失')
  assert.ok(!contains(out, ascii('XMP ')), 'XMP 块应消失')
  const vp8xFlags = out[out.findIndex((v, i) => out[i] === 0x56 && out[i + 1] === 0x50 && out[i + 2] === 0x38 && out[i + 3] === 0x58) + 8]
  assert.equal(vp8xFlags, 0x30, 'VP8X flags 应只清 EXIF/XMP 位、保留 ICC/ALPHA')
  assert.equal(out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24), out.byteLength - 8, 'RIFF 尺寸字段应修正')
  assert.ok(contains(out, [0xaa, 0xbb, 0xcc, 0xdd]), 'VP8 数据保留')
})

test('WebP：无元数据原样返回同一缓冲', () => {
  const file = webp(false)
  assert.equal(stripImageMetadata(file.buffer!), file.buffer)
})

// ── 其它类型 ──
test('GIF / ico / 非 / 空缓冲一律原样返回', () => {
  const gif = u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(stripImageMetadata(gif.buffer!), gif.buffer)
  const junk = u8(...ascii('<html><script>alert(1)</script></html>'))
  assert.equal(stripImageMetadata(junk.buffer!), junk.buffer)
})

// ── saveUpload 集成：落库字节 = 剥离后字节，哈希与登记 size 同口径 ──
test('saveUpload 落库前剥元数据：R2 字节、登记 size、哈希全部取剥离后缓冲', async () => {
  const file = jpeg(1)
  const stored: Record<string, ArrayBuffer> = {}
  const rows: unknown[][] = []
  const env = {
    IMAGES: { put: async (key: string, v: ArrayBuffer) => void (stored[key] = v) },
    DB: { prepare: () => ({ bind: (...args: unknown[]) => ({ run: async () => void rows.push(args) }) }) },
  } as unknown as Env
  const url = await saveUpload(env, file.buffer!, 'image/jpeg', 'gps.jpg', 'jpg')
  const key = url.slice('/images/'.length)
  assert.match(key, /^u\/\d{6}\/[a-z0-9]+\.jpg$/)
  const out = new Uint8Array(stored[key])
  assert.ok(!contains(out, [0xff, 0xe1]), '落库字节不应含 APP1')
  assert.equal(rows[0]?.[3], out.byteLength, '登记 size = 剥离后体积')
  assert.notEqual(rows[0]?.[3], file.byteLength, '比原文件小（GPS 段已剥离）')
})
