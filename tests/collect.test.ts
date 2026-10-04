import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sniffImageExt } from '../src/collect.ts'

// ── 图片类型只认魔数（回归：曾信任源站 Content-Type / URL wx_fmt，
//    可把 HTML/SVG 以图片身份转存进站点源，形成存储型 XSS）──
const buf = (bytes: number[]) => Uint8Array.from(bytes).buffer
const str = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

test('四种白名单图片的魔数正确识别', () => {
  assert.equal(sniffImageExt(buf([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'jpg')
  assert.equal(sniffImageExt(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assert.equal(sniffImageExt(buf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'gif') // GIF89a
  assert.equal(sniffImageExt(buf([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])), 'gif') // GIF87a
  assert.equal(sniffImageExt(buf([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp')
})

test('HTML/SVG/文本/伪 RIFF 一律拒收', () => {
  assert.equal(sniffImageExt(str('<html><script>alert(1)</script></html>')), null)
  assert.equal(sniffImageExt(str('<?xml version="1.0"?><svg onload="alert(1)">')), null)
  assert.equal(sniffImageExt(str('hello world')), null)
  assert.equal(sniffImageExt(buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), null) // RIFF 但非 WEBP
  assert.equal(sniffImageExt(new ArrayBuffer(0)), null)
})
