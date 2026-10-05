/**
 * 演示站种子配图：程序化生成的 SVG（src/demo.ts 播种时写入 R2）。
 * 不用真实照片/外链图床的原因：demo 每隔两小时重置，图必须能从代码原样重建，
 * 且不赌外网图床的可用性。生成器确定性（同参数同输出），每张 1-3KB，bundle 开销可忽略。
 * 仅 DEMO_MODE 下被动态 import，生产 Worker 不执行这份数据。
 */

interface Palette {
  bg: string
  ink: string
  a: string
  b: string
  c: string
}

const PALETTES: Record<string, Palette> = {
  zhusha: { bg: '#f6f0e4', ink: '#37322b', a: '#b23a29', b: '#dd9a80', c: '#8c2f21' },
  zhuqing: { bg: '#f1f5ee', ink: '#2b332b', a: '#5a7d5a', b: '#9db697', c: '#3d5c3f' },
  dailan: { bg: '#edf2f7', ink: '#242c34', a: '#3a5a78', b: '#8aa8c2', c: '#274055' },
  muzi: { bg: '#f6f1e5', ink: '#332e24', a: '#c9922a', b: '#e4c276', c: '#96690f' },
  muwan: { bg: '#f3f0f5', ink: '#2f2a35', a: '#6d5a7d', b: '#a795b5', c: '#4a3d57' },
  yanzi: { bg: '#f7f0ee', ink: '#332b29', a: '#a8524a', b: '#d69a90', c: '#7c3a33' },
}

/** 纸感颗粒：fractalNoise 压成低透明度暗斑，盖在最上层 */
function grain(seed: number, w: number, h: number, opacity = 0.5): string {
  return (
    `<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="${seed}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 0.10 0 0 0 0 0.09 0 0 0 0 0.08 0 0 0 0.30 0"/></filter>` +
    `<rect width="${w}" height="${h}" filter="url(#grain)" opacity="${opacity}"/>`
  )
}

function blurFilter(id: string, dev: number): string {
  return `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${dev}"/></filter>`
}

/** 色块雾面：几团模糊椭圆叠出 mesh gradient */
function mesh(p: Palette, s: number, w: number, h: number): string {
  const f = blurFilter('b', Math.round(w / 9))
  const e = (cx: number, cy: number, rx: number, ry: number, fill: string, op: number) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="${op}" filter="url(#b)"/>`
  return (
    f +
    e(w * (0.2 + 0.08 * s), h * 0.3, w * 0.42, h * 0.5, p.a, 0.6) +
    e(w * 0.78, h * (0.24 + 0.1 * s), w * 0.36, h * 0.46, p.b, 0.75) +
    e(w * 0.5, h * 0.85, w * 0.5, h * 0.42, p.c, 0.32) +
    e(w * (0.62 - 0.1 * s), h * 0.62, w * 0.22, h * 0.24, p.bg, 0.5)
  )
}

/** 山脊层叠：三层正弦多边形 + 一轮太阳 */
function ridges(p: Palette, s: number, w: number, h: number): string {
  const ridge = (baseY: number, amp: number, phase: number, fill: string, op: number) => {
    const n = 9
    const pts: string[] = [`0,${h}`]
    for (let i = 0; i <= n; i++) {
      const x = (i * w) / n
      const y = baseY + Math.sin(phase + i * (1.3 + 0.2 * s)) * amp + Math.sin(phase * 2 + i * 0.6) * amp * 0.4
      pts.push(`${x.toFixed(0)},${y.toFixed(0)}`)
    }
    pts.push(`${w},${h}`)
    return `<polygon points="${pts.join(' ')}" fill="${fill}" opacity="${op}"/>`
  }
  const sun = `<circle cx="${w * (0.3 + 0.35 * s)}" cy="${h * 0.3}" r="${h * 0.13}" fill="${p.a}" opacity="0.85"/>`
  return (
    sun +
    ridge(h * 0.62, h * 0.09, s * 2 + 1, p.b, 0.55) +
    ridge(h * 0.74, h * 0.08, s * 3 + 4, p.a, 0.5) +
    ridge(h * 0.88, h * 0.05, s + 7, p.c, 0.72)
  )
}

/** 波纹线：几条起伏的水平曲线 */
function waves(p: Palette, s: number, w: number, h: number): string {
  let out = ''
  const n = 6
  for (let i = 0; i < n; i++) {
    const y = h * (0.28 + (0.62 * i) / n)
    const amp = h * (0.05 + 0.012 * ((i + s) % 3))
    const d = `M0 ${y.toFixed(0)} C ${w * 0.25} ${(y - amp).toFixed(0)}, ${w * 0.42} ${(y + amp).toFixed(0)}, ${w * 0.62} ${y.toFixed(0)} S ${w * 0.9} ${(y - amp).toFixed(0)}, ${w} ${(y - amp * 0.3).toFixed(0)}`
    out += `<path d="${d}" fill="none" stroke="${i % 2 ? p.a : p.c}" stroke-width="${(2 + (i % 3)).toFixed(1)}" opacity="${(0.75 - i * 0.09).toFixed(2)}"/>`
  }
  return out + `<circle cx="${w * (0.16 + 0.12 * s)}" cy="${h * 0.2}" r="${h * 0.07}" fill="${p.b}" opacity="0.9"/>`
}

/** 圆点阵：半径随正弦起伏的圆格 */
function dots(p: Palette, s: number, w: number, h: number): string {
  let out = ''
  const cols = 9
  const rows = 5
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (w * (c + 0.5)) / cols
      const y = (h * (r + 0.6)) / rows
      const rad = h * 0.035 * (1 + Math.sin(s * 2 + c * 0.8 + r * 1.1) * 0.9)
      const fill = (r + c + s) % 3 === 0 ? p.a : (r + c) % 3 === 1 ? p.b : p.c
      out += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${Math.max(2, rad).toFixed(1)}" fill="${fill}" opacity="0.8"/>`
    }
  }
  return out
}

/** 斜切色带：几条旋转的半透明矩形 */
function bands(p: Palette, s: number, w: number, h: number): string {
  let out = ''
  for (let i = 0; i < 5; i++) {
    const bw = w * (0.1 + 0.05 * ((i + s) % 3))
    const x = w * (0.08 + i * 0.2) - w * 0.1
    const fill = [p.a, p.b, p.c, p.b, p.a][i]
    out += `<rect x="${x.toFixed(0)}" y="${-h * 0.2}" width="${bw.toFixed(0)}" height="${h * 1.4}" fill="${fill}" opacity="${(0.16 + 0.09 * ((i + s) % 3)).toFixed(2)}" transform="rotate(${-14 - 2 * s} ${w / 2} ${h / 2})"/>`
  }
  return out
}

const COMPOS: Array<(p: Palette, s: number, w: number, h: number) => string> = [mesh, ridges, waves, dots, bands]

function svg(name: string, w: number, h: number, body: string, seed: number): { key: string; mime: string; svg: string } {
  return {
    key: `u/demo/${name}.svg`,
    mime: 'image/svg+xml',
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      body +
      grain(seed, w, h) +
      `</svg>`,
  }
}

/** 11 张种子图：8 张 16:9 封面 + 3 张微博图。确定性输出，重置前后完全一致 */
export function demoImages(): { key: string; mime: string; svg: string }[] {
  const plan: Array<[string, number, number, string, number]> = [
    // [文件名, 宽, 高, 色板, 构图序号]
    ['cover-01', 800, 450, 'zhusha', 0],
    ['cover-02', 800, 450, 'dailan', 1],
    ['cover-03', 800, 450, 'zhuqing', 2],
    ['cover-04', 800, 450, 'muwan', 4],
    ['cover-05', 800, 450, 'muzi', 3],
    ['cover-06', 800, 450, 'dailan', 0],
    ['cover-07', 800, 450, 'yanzi', 1],
    ['cover-08', 800, 450, 'zhuqing', 0],
    ['wb-01', 640, 640, 'muzi', 0],
    ['wb-02', 640, 480, 'zhusha', 2],
    ['wb-03', 640, 640, 'dailan', 4],
  ]
  return plan.map(([name, w, h, pal, comp], i) => {
    const p = PALETTES[pal]
    const bg = `<rect width="${w}" height="${h}" fill="${p.bg}"/>`
    return svg(name, w, h, bg + COMPOS[comp](p, (i % 5) + 1, w, h), i * 7 + 3)
  })
}
