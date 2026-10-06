import { test } from 'node:test'
import assert from 'node:assert/strict'
import jsQR from 'jsqr'
import { packMatrix, qrMatrix } from '../src/qrcode.ts'

/** 把布尔矩阵渲染成带静区的灰度位图，用 jsqr 真解码回读——生成器改错任何表/位序，这里当场红 */
function decode(m: boolean[][]): string | null {
  const size = m.length
  const scale = 8
  const quiet = 4
  const dim = (size + quiet * 2) * scale
  const data = new Uint8ClampedArray(dim * dim * 4)
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const my = Math.floor(y / scale) - quiet
      const mx = Math.floor(x / scale) - quiet
      const dark = my >= 0 && my < size && mx >= 0 && mx < size && m[my][mx]
      const o = (y * dim + x) * 4
      data[o] = data[o + 1] = data[o + 2] = dark ? 0 : 255
      data[o + 3] = 255
    }
  }
  const res = jsQR(data, dim, dim)
  return res ? res.data : null
}

test('生成的 QR 矩阵可被 jsqr 解码回读（覆盖 v1-M/v4-M/v7-L/v10-L 四个量级）', () => {
  const cases = [
    'https://x.cn/a', // 14 字节 → v1-M
    'https://blog.xiaowuleyi.com/post/p-muuqd0g7wcx', // 46 字节 → v4-M
    `https://blog.xiaowuleyi.com/post/${'p-'.repeat(10)}abcdefghijklmnop${'?utm=1&from=share&utm_source=wx'}`, // ~130 字节 → v7-L（触发版本信息块）
    `https://blog.xiaowuleyi.com/post/${'abcdefgh'.repeat(27)}`, // 249 字节 → v10-L
  ]
  for (const url of cases) {
    const m = qrMatrix(url)
    assert.ok(m, `应生成矩阵：${url.slice(0, 40)}…`)
    assert.equal(m.length, m[0].length, '矩阵应为正方形')
    assert.equal(m.length % 4, 1, '边长应为 17+4v')
    assert.equal(decode(m), url)
  }
})

test('UTF-8 内容按字节编码，中文可解码回读', () => {
  const text = 'https://blog.xiaowuleyi.com/post/p-muuqd0g7wcx?share=小吴乐意'
  const m = qrMatrix(text)
  assert.ok(m)
  assert.equal(decode(m), text)
})

test('M 级纠错优先：短内容用小版本 M 级（v1-M 只有 16 码字）', () => {
  const m = qrMatrix('https://x.cn/a')
  assert.ok(m)
  assert.equal(m.length, 21) // v1
  assert.equal(decode(m), 'https://x.cn/a')
})

test('超出版本容量返回 null（调用方降级为不带码的分享卡片）', () => {
  assert.equal(qrMatrix(`https://blog.xiaowuleyi.com/${'a'.repeat(300)}`), null)
})

test('packMatrix 打包：首字节边长，位流行主序可无损还原', () => {
  const m = qrMatrix('https://blog.xiaowuleyi.com/post/p-muuqd0g7wcx')!
  const packed = packMatrix(m)
  const bin = Buffer.from(packed, 'base64')
  assert.equal(bin[0], m.length)
  let k = 0
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < m.length; c++) {
      const byte = bin[1 + (k >> 3)]
      const bit = (byte >> (7 - (k & 7))) & 1
      assert.equal(!!bit, m[r][c], `(${r},${c}) 位不一致`)
      k++
    }
})
