/**
 * 极简 QR 码生成器（字节模式，版本 1-10 自动选型；纠错 M 级优先，放不下退 L 级）
 *
 * 用途：文章分享按钮把文章链接编成矩阵，随页面内联下发（packMatrix 的 base64 位串），
 * 前台 share-card.js 画分享卡片时按矩阵直接绘码，不引入任何客户端 QR 库。
 * 算法按 ISO/IEC 18004：RS 纠错（GF(2^8)、生成多项式 0x11D）→ 分块交错 →
 * 功能图形 → 之字形布点 → 8 掩膜评估择优。正确性由 tests/qrcode.test.ts 用 jsqr
 * 解码回读守住——改任何表或位序，测试会当场红。
 */

/* ---------------- 版本参数表（v1-10，L/M 两级） ----------------
 * data=数据码字总数 ec=每块纠错码字 g1/g1cw=第一组块数与每块数据码字 g2/g2cw=第二组（+1 码字） */
interface LevelSpec {
  data: number
  ec: number
  g1: number
  g1cw: number
  g2: number
  g2cw: number
}
const LEVELS: Record<'L' | 'M', LevelSpec[]> = {
  L: [
    { data: 19, ec: 7, g1: 1, g1cw: 19, g2: 0, g2cw: 0 },
    { data: 34, ec: 10, g1: 1, g1cw: 34, g2: 0, g2cw: 0 },
    { data: 55, ec: 15, g1: 1, g1cw: 55, g2: 0, g2cw: 0 },
    { data: 80, ec: 20, g1: 1, g1cw: 80, g2: 0, g2cw: 0 },
    { data: 108, ec: 26, g1: 1, g1cw: 108, g2: 0, g2cw: 0 },
    { data: 136, ec: 18, g1: 2, g1cw: 68, g2: 0, g2cw: 0 },
    { data: 156, ec: 20, g1: 2, g1cw: 78, g2: 0, g2cw: 0 },
    { data: 194, ec: 24, g1: 2, g1cw: 97, g2: 0, g2cw: 0 },
    { data: 232, ec: 30, g1: 2, g1cw: 116, g2: 0, g2cw: 0 },
    { data: 274, ec: 18, g1: 2, g1cw: 68, g2: 2, g2cw: 69 },
  ],
  M: [
    { data: 16, ec: 10, g1: 1, g1cw: 16, g2: 0, g2cw: 0 },
    { data: 28, ec: 16, g1: 1, g1cw: 28, g2: 0, g2cw: 0 },
    { data: 44, ec: 26, g1: 1, g1cw: 44, g2: 0, g2cw: 0 },
    { data: 64, ec: 18, g1: 2, g1cw: 32, g2: 0, g2cw: 0 },
    { data: 86, ec: 24, g1: 2, g1cw: 43, g2: 0, g2cw: 0 },
    { data: 108, ec: 16, g1: 4, g1cw: 27, g2: 0, g2cw: 0 },
    { data: 124, ec: 18, g1: 4, g1cw: 31, g2: 0, g2cw: 0 },
    { data: 154, ec: 22, g1: 2, g1cw: 38, g2: 2, g2cw: 39 },
    { data: 182, ec: 22, g1: 3, g1cw: 36, g2: 2, g2cw: 37 },
    { data: 216, ec: 26, g1: 4, g1cw: 43, g2: 1, g2cw: 44 },
  ],
}
/** 校正图形中心坐标（行列同表）；与定位图形重叠的角自动跳过 */
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

/* ---------------- GF(256)，本原多项式 0x11D ---------------- */
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  GF_EXP[i] = x
  GF_LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
const gmul = (a: number, b: number) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0)

/** RS 生成多项式系数（最高次在前，长度 ec+1，首项恒 1） */
function rsGenPoly(ec: number): number[] {
  let poly = [1]
  for (let i = 0; i < ec; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j] // × x
      next[j + 1] ^= gmul(poly[j], GF_EXP[i]) // × α^i
    }
    poly = next
  }
  return poly
}

/** 对一组数据码字算纠错码字（多项式长除取余式） */
function rsEc(data: number[], ec: number): number[] {
  const gen = rsGenPoly(ec)
  const rem = data.concat(new Array(ec).fill(0))
  for (let i = 0; i < data.length; i++) {
    const f = rem[i]
    if (f === 0) continue
    for (let j = 0; j < gen.length; j++) rem[i + j] ^= gmul(gen[j], f)
  }
  return rem.slice(data.length)
}

/* ---------------- 码字序列：比特缓冲 → 终止符/填充 → 分块纠错 → 交错 ---------------- */
function codewords(bytes: number[], v: number, level: 'L' | 'M'): number[] {
  const spec = LEVELS[level][v - 1]
  const capBits = spec.data * 8
  const acc: number[] = [] // 完整码字流
  let cur = 0
  let n = 0
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      cur = (cur << 1) | ((val >>> i) & 1)
      if (++n === 8) {
        acc.push(cur)
        cur = 0
        n = 0
      }
    }
  }
  put(0b0100, 4) // 字节模式
  put(bytes.length, v >= 10 ? 16 : 8) // 字符计数（v10 起 16 位）
  for (const b of bytes) put(b, 8)
  // 终止符最多 4 个 0，随后补齐字节边界，再以 EC 11 交替填满数据容量
  const used = acc.length * 8 + n
  put(0, Math.min(4, capBits - used))
  while (n !== 0) put(0, 1)
  const pads = [0xec, 0x11]
  for (let i = 0; acc.length < spec.data; i++) acc.push(pads[i % 2])

  // 分块（第二组每块比第一组多 1 码字）→ 各块算纠错 → 数据/纠错分别逐字节交错
  const blocks: number[][] = []
  const ecs: number[][] = []
  let off = 0
  for (let i = 0; i < spec.g1; i++) {
    const d = acc.slice(off, off + spec.g1cw)
    off += spec.g1cw
    blocks.push(d)
    ecs.push(rsEc(d, spec.ec))
  }
  for (let i = 0; i < spec.g2; i++) {
    const d = acc.slice(off, off + spec.g2cw)
    off += spec.g2cw
    blocks.push(d)
    ecs.push(rsEc(d, spec.ec))
  }
  const out: number[] = []
  const maxLen = Math.max(spec.g1cw, spec.g2cw)
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i])
  for (let i = 0; i < spec.ec; i++) for (const e of ecs) out.push(e[i])
  return out
}

/* ---------------- 矩阵搭建：功能图形 + 之字形布点 ---------------- */
function baseMatrix(v: number): { m: boolean[][]; reserved: boolean[][] } {
  const size = 17 + 4 * v
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setFn = (r: number, c: number, dark: boolean) => {
    m[r][c] = dark
    reserved[r][c] = true
  }
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r
        const cc = c0 + c
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
        setFn(rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)))
      }
  }
  finder(0, 0)
  finder(0, size - 7)
  finder(size - 7, 0)
  // 校正图形 5×5：与任一定位图形区（含分隔符）重叠的角自动跳过
  const pos = ALIGN[v - 1]
  for (const r of pos)
    for (const c of pos) {
      if ((r < 9 && c < 9) || (r < 9 && c > size - 10) || (r > size - 10 && c < 9)) continue
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const d = Math.max(Math.abs(dr), Math.abs(dc))
          setFn(r + dr, c + dc, d === 2 || (dr === 0 && dc === 0))
        }
    }
  // 时序图形：第 6 行/列交替，交点已由校正图形占用
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setFn(6, i, i % 2 === 0)
    if (!reserved[i][6]) setFn(i, 6, i % 2 === 0)
  }
  // 固定暗模块 + 格式信息两份副本的位置先占位（值等选定掩膜后回填）
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      if (!reserved[8][i]) setFn(8, i, false)
      if (!reserved[i][8]) setFn(i, 8, false)
    }
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[size - 1 - i][8]) setFn(size - 1 - i, 8, false)
    if (!reserved[8][size - 1 - i]) setFn(8, size - 1 - i, false)
  }
  setFn(size - 8, 8, true) // 固定暗模块
  if (v >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3)
      const c = size - 11 + (i % 3)
      setFn(r, c, false)
      setFn(c, r, false)
    }
  }
  return { m, reserved }
}

/** 之字形布点：码字流按位填入非功能模块（跳过第 6 列，列对方向上下交替） */
function placeData(m: boolean[][], reserved: boolean[][], seq: number[], v: number) {
  const size = m.length
  const totalBits = seq.length * 8 + (v >= 2 && v <= 6 ? 7 : 0) // v2-6 有 7 个残留位
  let bitIdx = 0
  const bit = () => (bitIdx < totalBits ? ((seq[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1) === 1 : false)
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i
      for (const c of [right, right - 1]) {
        if (!reserved[r][c]) {
          m[r][c] = bit()
          bitIdx++
        }
      }
    }
    upward = !upward
  }
}

/* ---------------- 掩膜与惩罚评估（8 选 1，标准四规则） ---------------- */
const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function penalty(m: boolean[][]): number {
  const size = m.length
  let score = 0
  // N1：行/列同色连续 ≥5
  for (let axis = 0; axis < 2; axis++)
    for (let i = 0; i < size; i++) {
      let run = 1
      for (let j = 1; j <= size; j++) {
        const cur = j < size ? (axis === 0 ? m[i][j] : m[j][i]) : null
        const prev = axis === 0 ? m[i][j - 1] : m[j - 1][i]
        if (cur !== null && cur === prev) run++
        else {
          if (run >= 5) score += 3 + (run - 5)
          run = 1
        }
      }
    }
  // N2：2×2 同色块
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++)
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3
  // N3：1011101 一侧带 0000 的图形单位（行/列）
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false]
  const pat2 = [...pat1].reverse()
  const matchAt = (get: (k: number) => boolean, pat: boolean[]) => {
    for (let k = 0; k < pat.length; k++) if (get(k) !== pat[k]) return false
    return true
  }
  for (let axis = 0; axis < 2; axis++)
    for (let i = 0; i < size; i++)
      for (let j = 0; j + pat1.length <= size; j++) {
        const get = (k: number) => (axis === 0 ? m[i][j + k] : m[j + k][i])
        if (matchAt(get, pat1) || matchAt(get, pat2)) score += 40
      }
  // N4：暗模块占比偏离 50%，每 5% 记 10 分
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const total = size * size
  const percent = (dark * 100) / total
  const prev = Math.floor(percent / 5) * 5
  score += (Math.min(Math.abs(prev - 50), Math.abs(prev + 5 - 50)) / 5) * 10
  return score
}

function applyMask(m: boolean[][], reserved: boolean[][], mask: (r: number, c: number) => boolean) {
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (!reserved[r][c]) m[r][c] = m[r][c] !== mask(r, c)
}

/** 格式信息：2 位纠错级别 + 3 位掩膜 → BCH(15,5)，异或 0x5412；级别 L=01、M=00 */
function formatBits(level: 'L' | 'M', maskIdx: number): number {
  const data = (level === 'L' ? 0b01 : 0b00) << 3 | maskIdx
  let d = data << 10
  for (let i = 4; i >= 0; i--) if ((d >> (i + 10)) & 1) d ^= 0x537 << i
  return ((data << 10) | (d & 0x3ff)) ^ 0x5412
}

function drawFormat(m: boolean[][], level: 'L' | 'M', maskIdx: number) {
  const size = m.length
  const bits = formatBits(level, maskIdx)
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  // 第一份副本：环绕左上定位图形（b14 从 (8,0) 起，跳过 (8,6) 时序点，沿第 8 列上行到 (0,8)）
  for (let i = 0; i <= 5; i++) m[8][i] = bit(14 - i)
  m[8][7] = bit(8)
  m[8][8] = bit(7)
  m[7][8] = bit(6)
  for (let i = 9; i < 15; i++) m[14 - i][8] = bit(14 - i)
  // 第二份副本：右上横条（b0 从最右起）+ 左下竖条（b8 从 size-7 行起向上）
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i)
}

/** 版本信息（v≥7）：6 位版本号 + BCH(18,6)，TR 角与 BL 角两份镜像 */
function drawVersion(m: boolean[][], v: number) {
  const size = m.length
  let rem = v
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  const bits = (v << 12) | rem
  for (let i = 0; i < 18; i++) {
    const b = ((bits >>> i) & 1) === 1
    const r = Math.floor(i / 3)
    const c = size - 11 + (i % 3)
    m[r][c] = b
    m[c][r] = b
  }
}

/* ---------------- 对外：矩阵与打包 ---------------- */

/** 生成矩阵（行主序布尔二维数组）；超出版本容量返回 null（调用方降级为不带码的卡片） */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text))
  for (const level of ['M', 'L'] as const) {
    for (let v = 1; v <= 10; v++) {
      const spec = LEVELS[level][v - 1]
      const need = 4 + (v >= 10 ? 16 : 8) + bytes.length * 8
      if (need > spec.data * 8) continue
      const { m, reserved } = baseMatrix(v)
      if (v >= 7) drawVersion(m, v)
      placeData(m, reserved, codewords(bytes, v, level), v)
      let best: { m: boolean[][]; score: number } | null = null
      for (let k = 0; k < 8; k++) {
        const trial = m.map((row) => row.slice())
        applyMask(trial, reserved, MASKS[k])
        drawFormat(trial, level, k)
        const score = penalty(trial)
        if (!best || score < best.score) best = { m: trial, score }
      }
      return best!.m
    }
  }
  return null
}

/** 矩阵 → base64 位串（首字节边长，其后行主序位流），前端按行主序直接绘码 */
export function packMatrix(m: boolean[][]): string {
  const bytes: number[] = [m.length]
  let acc = 0
  let n = 0
  for (const row of m)
    for (const v of row) {
      acc = (acc << 1) | (v ? 1 : 0)
      if (++n === 8) {
        bytes.push(acc)
        acc = 0
        n = 0
      }
    }
  if (n > 0) bytes.push(acc << (8 - n))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
