/* 微博分享卡片生成器（按需由 site.js 动态 import，不占常驻体积）
 * 纯 Canvas 2D 手绘，无任何依赖：暖纸底 + 白色浮卡，头像/站名 → 正文（#话题#高亮）→ 九宫格配图 → 时间 + 域名。
 * 图片全部先经 loadImage（跨域强制 crossOrigin='anonymous'，失败返回 null 画占位），
 * 保证画布永不被跨域内容污染，toBlob 导出必成功。
 * 产出 1280px 宽 PNG：弹窗内 <img> 预览（手机长按可存），「保存图片」走 download，
 * 支持 navigator.share 带文件的设备（iOS/安卓）唤起系统分享面板直发朋友圈。 */

const S = 2 // 输出倍率：逻辑 640 宽 × 2 = 1280px 成品
const W = 640
const PAD = 40 // 画布到卡片边距
const CPAD = 44 // 卡片内边距
const INNER = W - PAD * 2 - CPAD * 2 // 内容宽 472
const MAX_H = 1920 // 成品高度上限（逻辑值），超出自动压缩正文行数

const INK = '#33302a' // 正文墨色
const SUB = '#a29a89' // 次级（时间/描述）
const TOPIC = '#b95c38' // #话题# 赭红
const LINE = '#eee8dc' // 分割线
const CARD = '#fffdf9' // 卡片底
const AVBG = '#f3ecdf' // 首字头像底
const AVFG = '#b08a5a'
const PHBG = '#f1ece2' // 图片占位底
const HOST = '#8f8672' // 域名

const F = (w, s) => w + ' ' + s + 'px -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif'

/* ---------------- 数据采集：全部读卡片现成 DOM，不需要服务端配合 ---------------- */
function collect(card) {
  const nameEl = card.querySelector('.wb-name')
  const timeEl = card.querySelector('.wb-time')
  const textEl = card.querySelector('.wb-text')
  const avImg = card.querySelector('.wb-avatar img')
  const avSpan = avImg ? null : card.querySelector('.wb-avatar span')
  const descMeta = document.querySelector('meta[name="description"]')
  const site = (nameEl && nameEl.textContent.trim()) || document.title || '微博'
  const id = (card.id || '').replace(/^wb-/, '')
  return {
    id,
    site,
    desc: ((descMeta && descMeta.content) || '').trim(),
    avatar: avImg ? avImg.currentSrc || avImg.src : '',
    letter: avSpan ? (avSpan.textContent.trim()[0] || site[0]) : site[0],
    text: textEl ? textEl.textContent.trim() : '',
    images: [].slice.call(card.querySelectorAll('.wb-imgs img'), 0, 9).map(function (im) {
      return im.currentSrc || im.src
    }),
    time: timeEl ? timeEl.textContent.trim() : '',
    host: location.host,
  }
}

function loadImage(url) {
  return new Promise(function (resolve) {
    var im = new Image()
    try {
      if (!/^data:/i.test(url) && new URL(url, location.href).origin !== location.origin) im.crossOrigin = 'anonymous'
    } catch (e) {
      /* URL 解析不了按同源尝试，失败走 onerror 占位 */
    }
    im.onload = function () {
      resolve(im)
    }
    im.onerror = function () {
      resolve(null)
    }
    im.src = url
  })
}

/* ---------------- 绘制小件 ---------------- */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 居中 cover 裁切进圆角格子 */
function drawCover(ctx, img, x, y, w, h, r) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return false
  const scale = Math.max(w / iw, h / ih)
  ctx.save()
  rr(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.drawImage(img, (iw - w / scale) / 2, (ih - h / scale) / 2, w / scale, h / scale, x, y, w, h)
  ctx.restore()
  return true
}

function drawPlaceholder(ctx, x, y, w, h, r) {
  ctx.save()
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = PHBG
  ctx.fill()
  ctx.strokeStyle = '#d8d0c0'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const s = Math.min(w, h) * 0.22
  const cx = x + w / 2
  const cy = y + h / 2
  ctx.beginPath()
  ctx.moveTo(cx - s, cy + s * 0.6)
  ctx.lineTo(cx - s * 0.3, cy - s * 0.5)
  ctx.lineTo(cx + s * 0.2, cy + s * 0.1)
  ctx.lineTo(cx + s * 0.55, cy - s * 0.25)
  ctx.lineTo(cx + s, cy + s * 0.6)
  ctx.stroke()
  ctx.restore()
}

/* ---------------- 文本：#话题# 分词 + 原子化换行（与 render.ts weiboTextHtml 同一话题口径） ---------------- */
function tokenize(text) {
  const out = []
  const re = /#[^\s#&<>"']{1,24}(?:#|(?=\s)|$)/gu
  let last = 0
  let m
  while ((m = re.exec(text))) {
    const prev = m.index ? text.charAt(m.index - 1) : ''
    if (prev && /[\p{L}\p{N}#]/u.test(prev)) continue // 紧贴字母数字/# 的不算话题
    if (m.index > last) out.push({ t: text.slice(last, m.index) })
    out.push({ t: m[0], topic: true })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ t: text.slice(last) })
  return out
}

const WORD = /[A-Za-z0-9@%&/._+=?-]/
/** 换行原子：英文/数字串整词不断，其余逐字符；\n 成独立换行原子 */
function atoms(tokens) {
  const out = []
  for (const tk of tokens) {
    let buf = ''
    const topic = !!tk.topic
    const flush = function () {
      if (buf) {
        out.push({ t: buf, topic: topic })
        buf = ''
      }
    }
    for (const ch of tk.t) {
      if (ch === '\n') {
        flush()
        out.push({ t: '', br: true })
      } else if (!topic && WORD.test(ch)) {
        buf += ch
      } else {
        flush()
        out.push({ t: ch, topic: topic })
      }
    }
    flush()
  }
  return out
}

/** 贪心换行；超宽原子（长 URL 等）先硬切成单字符 */
function wrapLines(ctx, items, maxWidth) {
  const flat = []
  for (const it of items) {
    if (it.br || !it.t || ctx.measureText(it.t).width <= maxWidth) {
      flat.push(it)
      continue
    }
    for (const ch of it.t) flat.push({ t: ch, topic: it.topic })
  }
  const lines = []
  let line = []
  let w = 0
  for (const it of flat) {
    if (it.br) {
      lines.push(line)
      line = []
      w = 0
      continue
    }
    const iw = ctx.measureText(it.t).width
    if (line.length && w + iw > maxWidth) {
      lines.push(line)
      line = []
      w = 0
      if (it.t === ' ') continue // 行首空格不吃
    }
    line.push(it)
    w += iw
  }
  lines.push(line)
  return lines
}

/** 画一行（跨原子着色），返回结束 x */
function drawSegLine(ctx, line, x, y) {
  let cx = x
  for (const it of line) {
    if (!it.t) continue
    ctx.fillStyle = it.topic ? TOPIC : INK
    ctx.fillText(it.t, cx, y)
    cx += ctx.measureText(it.t).width
  }
  return cx
}

function ellipsize(ctx, line, maxWidth) {
  let out = line.slice()
  const dot = { t: '…' }
  while (out.length && ctx.measureText(out.map(function (i) { return i.t }).join('') + '…').width > maxWidth) out.pop()
  return out.concat([dot])
}

/* ---------------- 网格规格：1 大图 / 2·4 两列 / 其余三列（与前台微博九宫格同规则） ---------------- */
function gridSpec(n) {
  if (n === 1) return { cols: 1, cw: INNER, ch: Math.min(Math.round(INNER * 0.75), 430), gap: 0 }
  if (n === 2 || n === 4) {
    const cw = Math.round((INNER - 10) / 2)
    return { cols: 2, cw: cw, ch: Math.round(cw * 0.8), gap: 10 }
  }
  const cw = Math.round((INNER - 16) / 3)
  return { cols: 3, cw: cw, ch: cw, gap: 8 }
}

/* ---------------- 主绘制：先量高再画，产出画布 ---------------- */
function renderCard(d, av, imgs) {
  const cv = document.createElement('canvas')
  const ctx = cv.getContext('2d')
  const F_NAME = F(600, 31)
  const F_DESC = F(400, 20)
  const F_TEXT = F(400, 29)
  const F_FOOT = F(400, 21)
  const F_LETTER = F(600, 38)
  const AV = 84
  const AV_R = 22
  const LH = 50
  const MAX_LINES = 18

  // 量高（ctx 状态此时随意改，画布尺寸最后设定）
  let lines = []
  let truncated = false
  if (d.text) {
    ctx.font = F_TEXT
    lines = wrapLines(ctx, atoms(tokenize(d.text)), INNER)
  }
  const gs = d.images.length ? gridSpec(d.images.length) : null
  const gridRows = gs ? Math.ceil(d.images.length / gs.cols) : 0

  function totalH(maxLines) {
    const shown = Math.min(lines.length, maxLines)
    const textH = shown ? shown * LH : 0
    const gridH = gs ? gridRows * gs.ch + (gridRows - 1) * gs.gap : 0
    return (
      PAD * 2 +
      CPAD * 2 +
      AV +
      (textH ? 26 + textH : 0) +
      (gridH ? 24 + gridH : 0) +
      24 + // 分割线上间距
      1 +
      18 + // 分割线下间距
      26 // 底行
    )
  }
  let maxLines = MAX_LINES
  while (maxLines > 6 && totalH(maxLines) > MAX_H) maxLines--
  truncated = lines.length > maxLines
  const H = totalH(maxLines)

  cv.width = W * S
  cv.height = H * S
  ctx.scale(S, S)
  ctx.textBaseline = 'middle'

  // 背景：暖纸渐变 + 两团柔和色晕
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#f7f4ec')
  bg.addColorStop(1, '#efe9dc')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const blob = function (x, y, r, color) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  blob(W * 0.85, H * 0.08, 260, 'rgba(185,92,56,0.10)')
  blob(W * 0.06, H * 0.92, 300, 'rgba(176,138,90,0.12)')

  // 卡片浮起
  ctx.save()
  ctx.shadowColor = 'rgba(70,55,30,0.16)'
  ctx.shadowBlur = 34
  ctx.shadowOffsetY = 12
  ctx.fillStyle = CARD
  rr(ctx, PAD, PAD, W - PAD * 2, H - PAD * 2, 28)
  ctx.fill()
  ctx.restore()

  const x0 = PAD + CPAD
  const y0 = PAD + CPAD

  // 头部：头像 + 站名 + 站点简介
  if (av) drawCover(ctx, av, x0, y0, AV, AV, AV_R)
  else {
    ctx.fillStyle = AVBG
    rr(ctx, x0, y0, AV, AV, AV_R)
    ctx.fill()
    ctx.font = F_LETTER
    ctx.fillStyle = AVFG
    ctx.textAlign = 'center'
    ctx.fillText(d.letter || '博', x0 + AV / 2, y0 + AV / 2 + 2)
    ctx.textAlign = 'left'
  }
  const tx = x0 + AV + 22
  ctx.font = F_NAME
  ctx.fillStyle = INK
  ctx.fillText(d.site, tx, y0 + 24)
  if (d.desc) {
    ctx.font = F_DESC
    ctx.fillStyle = SUB
    let desc = d.desc
    while (desc.length > 1 && ctx.measureText(desc + '…').width > INNER - AV - 22) desc = desc.slice(0, -1)
    ctx.fillText(desc.length < d.desc.length ? desc + '…' : desc, tx, y0 + 58)
  }

  let y = y0 + AV

  // 正文（话题高亮 + 换行保留 + 超长省略）
  if (lines.length) {
    y += 26 + LH / 2
    ctx.font = F_TEXT
    const shown = lines.slice(0, maxLines)
    for (let i = 0; i < shown.length; i++) {
      drawSegLine(ctx, i === maxLines - 1 && truncated ? ellipsize(ctx, shown[i], INNER) : shown[i], x0, y)
      y += LH
    }
    y -= LH / 2
  }

  // 配图九宫格
  if (gs) {
    y += 24
    for (let i = 0; i < d.images.length; i++) {
      const col = i % gs.cols
      const row = Math.floor(i / gs.cols)
      const gx = x0 + col * (gs.cw + gs.gap)
      const gy = y + row * (gs.ch + gs.gap)
      if (imgs[i]) drawCover(ctx, imgs[i], gx, gy, gs.cw, gs.ch, 14)
      else drawPlaceholder(ctx, gx, gy, gs.cw, gs.ch, 14)
    }
    y += gridRows * gs.ch + (gridRows - 1) * gs.gap
  }

  // 底栏：分割线 + 时间 + 域名
  y += 24
  ctx.fillStyle = LINE
  ctx.fillRect(x0, y, INNER, 1)
  y += 18 + 13
  ctx.font = F_FOOT
  ctx.fillStyle = SUB
  ctx.fillText(d.time, x0, y)
  ctx.fillStyle = HOST
  ctx.textAlign = 'right'
  ctx.fillText(d.host, x0 + INNER, y)
  ctx.textAlign = 'left'

  return cv
}

/* ---------------- 弹窗（singleton，内联 <style> 一次注入，CSP 允许） ---------------- */
let modal = null
let state = null // { url, file, site, text }

function ensureModal() {
  if (modal) return modal
  const style = document.createElement('style')
  style.textContent =
    '.sc-overlay{position:fixed;inset:0;z-index:99998;background:rgba(22,17,10,.72);display:flex;align-items:center;justify-content:center;padding:16px;animation:sc-fade .18s ease}' +
    '.sc-panel{background:#faf8f3;border-radius:16px;width:min(400px,94vw);max-height:min(88vh,880px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)}' +
    '.sc-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px 9px;font-size:15px;font-weight:600;color:#4a4438}' +
    '.sc-close{border:0;background:none;font-size:24px;line-height:1;color:#a29a89;cursor:pointer;padding:2px 6px}' +
    '.sc-close:hover{color:#4a4438}' +
    '.sc-body{overflow:auto;padding:2px 16px 4px;display:flex;min-height:200px;-webkit-overflow-scrolling:touch}' +
    /* 居中用子元素 margin:auto：align-items:center 会让超高内容的顶部溢出滚不回来 */
    '.sc-body>*{margin:auto}' +
    '.sc-body img{width:100%;height:auto;border-radius:10px;display:block;box-shadow:0 6px 24px rgba(60,50,30,.18)}' +
    '.sc-spin{width:30px;height:30px;border-radius:50%;border:3px solid #e4dccb;border-top-color:#b95c38;animation:sc-rot .8s linear infinite}' +
    '@keyframes sc-rot{to{transform:rotate(360deg)}}' +
    '@keyframes sc-fade{from{opacity:0}}' +
    '.sc-tip{padding:8px 16px 0;text-align:center;font-size:12px;color:#a29a89}' +
    '.sc-foot{padding:12px 16px calc(14px + env(safe-area-inset-bottom));display:flex;gap:10px}' +
    '.sc-btn{flex:1;border:0;border-radius:10px;padding:11px 0;font-size:15px;cursor:pointer;font-family:inherit}' +
    '.sc-btn:disabled{opacity:.45;cursor:default}' +
    '.sc-btn-main{background:#2f2a24;color:#fff}' +
    '.sc-btn-main:not(:disabled):active{background:#4a4438}' +
    '.sc-btn-alt{background:none;border:1px solid #d8d0c0;color:#4a4438}' +
    '.sc-btn-alt:not(:disabled):active{background:#f0ebe0}' +
    '@media (max-width:480px){.sc-overlay{padding:10px}.sc-panel{max-height:92vh}}'
  document.head.appendChild(style)

  const overlay = document.createElement('div')
  overlay.className = 'sc-overlay'
  overlay.innerHTML =
    '<div class="sc-panel" role="dialog" aria-label="分享卡片">' +
    '<div class="sc-head"><span>分享卡片</span><button type="button" class="sc-close" aria-label="关闭">×</button></div>' +
    '<div class="sc-body"><div class="sc-spin" aria-hidden="true"></div></div>' +
    '<p class="sc-tip">手机长按图片可保存或转发</p>' +
    '<div class="sc-foot">' +
    '<button type="button" class="sc-btn sc-btn-alt" data-act="share" hidden>分享给朋友</button>' +
    '<button type="button" class="sc-btn sc-btn-main" data-act="save" disabled>生成中…</button>' +
    '</div>' +
    '</div>'
  document.body.appendChild(overlay)

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) close()
  })
  overlay.querySelector('.sc-close').addEventListener('click', close)
  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && modal) close()
    },
    true
  )
  overlay.querySelector('[data-act=save]').addEventListener('click', function () {
    if (!state) return
    const a = document.createElement('a')
    a.href = state.url
    a.download = state.file.name
    a.click()
  })
  overlay.querySelector('[data-act=share]').addEventListener('click', function () {
    if (!state) return
    navigator
      .share({ files: [state.file], title: state.site + '的微博', text: state.text })
      .catch(function () {})
  })

  modal = { overlay: overlay, body: overlay.querySelector('.sc-body'), save: overlay.querySelector('[data-act=save]'), share: overlay.querySelector('[data-act=share]') }
  return modal
}

function close() {
  if (!modal) return
  modal.overlay.remove()
  if (state) URL.revokeObjectURL(state.url)
  state = null
  modal = null
  document.body.style.overflow = ''
}

/** 入口：card 为 .wb-card 元素，生成失败抛错由 site.js 提示 */
export async function openShareCard(card) {
  const d = collect(card)
  const m = ensureModal()
  m.body.innerHTML = '<div class="sc-spin" aria-hidden="true"></div>'
  m.save.disabled = true
  m.save.textContent = '生成中…'
  m.share.hidden = true
  if (state) {
    URL.revokeObjectURL(state.url)
    state = null
  }
  document.body.style.overflow = 'hidden'

  const loaded = await Promise.all([d.avatar ? loadImage(d.avatar) : Promise.resolve(null)].concat(d.images.map(loadImage)))
  const av = loaded[0]
  const imgs = loaded.slice(1)

  await new Promise(function (resolve, reject) {
    let cv
    try {
      cv = renderCard(d, av, imgs)
    } catch (err) {
      return reject(err)
    }
    cv.toBlob(function (blob) {
      if (!blob) return reject(new Error('生成失败'))
      const name = 'weibo-card-' + (d.id || Date.now()) + '.png'
      const file = new File([blob], name, { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      state = { url: url, file: file, site: d.site, text: d.text.slice(0, 100) }
      m.body.innerHTML = ''
      const img = document.createElement('img')
      img.src = url
      img.alt = '微博分享卡片'
      m.body.appendChild(img)
      m.save.disabled = false
      m.save.textContent = '保存图片'
      m.share.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }))
      resolve()
    }, 'image/png')
  })
}
