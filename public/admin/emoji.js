/**
 * 微信表情（文本码体系）后台共享助手：表单一来源在服务端 src/emoji.ts，
 * 经 GET /api/public/emoji 下发，editor.js（文章编辑器）与 app.js（微博发布器）共用。
 * 拉取失败时 gridHtml 出降级文案，文本码手打渲染不受影响（渲染层查表不到就显示原文）。
 */

let CODES = null
let BASE = '/emoji/'
let pending = null

export function loadEmoji() {
  if (CODES) return Promise.resolve()
  if (!pending) {
    pending = fetch('/api/public/emoji')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.codes && d.base) {
          CODES = d.codes
          BASE = d.base
        }
      })
      .catch(() => {})
  }
  return pending
}

/** 面板网格：data-wxq=名称 的按钮流，调用方事件委托取 data-wxq 插入 */
export function emojiGridHtml() {
  if (!CODES) return '<p class="wxq-empty">表情加载失败，刷新重试；也可以直接手打 [微笑] 这类文本码</p>'
  const cells = Object.keys(CODES)
    .map(
      (n) =>
        `<button type="button" class="wxq-cell" data-wxq="${n}" title="[${n}]"><img src="${BASE}${CODES[n]}.png" alt="" loading="lazy"></button>`
    )
    .join('')
  return `<div class="wxq-grid">${cells}</div>`
}

/** 表情 img（编辑器富文本内嵌版）：data-emoji 存文本码，保存时反替换回文本码（存库不带图） */
export function emojiEditorImg(name) {
  return `<img class="wxq-emoji" src="${BASE}${CODES[name]}.png" alt="[${name}]" data-emoji="[${name}]">`
}

/** 富文本里编辑器插入的表情 img → 文本码（serialize 口径：存库永远是文本码，渲染层才转图） */
export function stripEmojiImgs(html) {
  return String(html || '').replace(/<img\b[^>]*\bdata-emoji="([^"]*)"[^>]*>/g, '$1')
}

/** textarea 光标处插入文本码（微信面板口径：插入后光标停在码后，可连续插） */
export function insertToken(ta, token) {
  if (!ta) return
  const s = ta.selectionStart ?? ta.value.length
  const e = ta.selectionEnd ?? s
  ta.setRangeText(token, s, e, 'end')
  ta.focus()
}
