import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, ZipWriter } from '../src/zip.ts'

// ── CRC32 标准向量（ISO 3309 / zip 规范同款）──
test('crc32 标准向量与增量一致性', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  assert.equal(crc32(new TextEncoder().encode('')), 0)
  assert.equal(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414fa339)
  // 增量计算 = 一次性计算（导出图片流式算 CRC 依赖这一点）
  const bytes = new TextEncoder().encode('hello world, 你好，世界！')
  const a = bytes.slice(0, 9)
  const b = bytes.slice(9)
  assert.equal(crc32(b, crc32(a)), crc32(bytes))
})

/** 手工解析一个 zip：返回 EOCD 里的条目数、中央目录起始偏移与各本地头的魔数/文件名 */
function parseZip(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // 从尾部找 EOCD 签名
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  assert.ok(eocd >= 0, 'EOCD 签名必须存在')
  const entries = v.getUint16(eocd + 10, true)
  const cdSize = v.getUint32(eocd + 12, true)
  const cdOffset = v.getUint32(eocd + 16, true)
  const names: string[] = []
  let p = cdOffset
  for (let i = 0; i < entries; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, '中央目录签名')
    const nameLen = v.getUint16(p + 28, true)
    const crc = v.getUint32(p + 16, true)
    const size = v.getUint32(p + 24, true)
    const localOffset = v.getUint32(p + 42, true)
    names.push(new TextDecoder().decode(buf.slice(p + 46, p + 46 + nameLen)))
    // 校验本地头与真实数据
    assert.equal(v.getUint32(localOffset, true), 0x04034b50, '本地头签名')
    const localNameLen = v.getUint16(localOffset + 26, true)
    const dataStart = localOffset + 30 + localNameLen
    const data = buf.slice(dataStart, dataStart + size)
    assert.equal(crc32(data), crc, `条目 ${names[i]} 的 CRC 必须与数据一致`)
    p += 46 + nameLen
  }
  assert.equal(p - cdOffset, cdSize, '中央目录尺寸一致')
  return { entries, names }
}

// ── zip 结构（内存构建，手工解析校验签名/偏移/CRC）──
test('ZipWriter 产出结构合法的 store 模式 zip', async () => {
  const chunks: Uint8Array[] = []
  const stream = new TransformStream<Uint8Array>()
  const writer = stream.writable.getWriter()
  const reading = (async () => {
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
  })()
  const zip = new ZipWriter(writer)
  const enc = new TextEncoder()
  await zip.add('posts/hello.md', enc.encode('# 你好\n\n正文一段。'))
  await zip.add('images/u/x.png', enc.encode('FAKE-PNG-BYTES'), Date.UTC(2026, 0, 2))
  await zip.add('empty.bin', new Uint8Array(0))
  await zip.close()
  await reading

  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  const parsed = parseZip(buf)
  assert.deepEqual(parsed.names, ['posts/hello.md', 'images/u/x.png', 'empty.bin'])
  assert.equal(parsed.entries, 3)
})

test('ZipWriter 流式写入（ReadableStream 数据源）CRC 与尺寸正确', async () => {
  const chunks: Uint8Array[] = []
  const stream = new TransformStream<Uint8Array>()
  const writer = stream.writable.getWriter()
  const reading = (async () => {
    const reader = stream.readable.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
  })()
  const zip = new ZipWriter(writer)
  // 模拟 R2 图片流：分三块
  const part = (s: string) => new TextEncoder().encode(s)
  const src = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(part('AAAA'))
      controller.enqueue(part('BBBB'))
      controller.enqueue(part('CCCC'))
      controller.close()
    },
  })
  await zip.add('images/big.png', src)
  await zip.close()
  await reading

  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  const parsed = parseZip(buf)
  assert.deepEqual(parsed.names, ['images/big.png'])
})
