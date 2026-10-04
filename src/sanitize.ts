/**
 * HTML 白名单净化器
 *
 * 文章正文是管理员/作者书写的富文本（可能来自公众号等外部编辑器的粘贴），
 * 因此存储前统一走这里：只保留安全标签与安全属性，其余一律剥掉（保留其内部文字）。
 *
 * 同时遵循《微信公众平台编辑器插件开发规范》中的排版友好原则：
 * - 保留 data-w / data-ignore-width / data-no-dark / data-ignore-dm 等规范属性
 * - 内联样式仅保留排版类属性，且 url() 只允许站内相对路径
 */

const VOID_TAGS = new Set(['br', 'hr', 'img', 'source', 'wbr'])

/** 连同内容一起丢弃的标签（安全风险或与排版无关） */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'svg', 'math',
  'form', 'input', 'button', 'select', 'textarea', 'option', 'link', 'meta',
  'base', 'frame', 'frameset', 'applet', 'template', 'dialog', 'audio',
])

/** meta 例外：编辑器生成的 OG 分享卡图标记（<meta data-og-image="/images/...">），存进正文供前台输出 og:image */
const OG_META_RE = /^\s*<meta[^>]*\bdata-og-image=(?:"[^"]+"|'[^']+'|[^\s>]+)[^>]*\/?>\s*$/i

/** 从 OG meta 里取卡图 URL；必须是站内相对路径，拒绝任何外链/协议 */
function ogImageUrl(raw: string): string | null {
  const m = /data-og-image=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(raw)
  const v = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim()
  return v.startsWith('/images/') && !v.includes('"') && !/[\s<>]/.test(v) ? v : null
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'kbd', 'samp',
  'ul', 'ol', 'li', 'a', 'img', 'video', 'source',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sup', 'sub', 'small', 'abbr', 'cite', 'q', 'span',
  'section', 'div', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'details', 'summary',
])

/** 所有标签都可用的属性 */
const GLOBAL_ATTRS = new Set(['class', 'id', 'data-w', 'data-ignore-width', 'data-no-dark', 'data-ignore-dm'])

const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'title']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
  video: new Set(['src', 'poster', 'controls', 'width', 'height', 'preload', 'playsinline']),
  source: new Set(['src', 'type']),
  ol: new Set(['start', 'type']),
  li: new Set(['value']),
  th: new Set(['colspan', 'rowspan']),
  td: new Set(['colspan', 'rowspan']),
  details: new Set(['open']),
}

const BOOL_ATTRS = new Set(['controls', 'playsinline', 'open'])

/** 内联样式允许的属性（排版用途白名单） */
const CSS_PROP =
  /^(?:color|background-color|background|font-size|font-weight|font-style|font-family|font-family|letter-spacing|line-height|text-align|text-decoration|text-decoration\+\w+|text-indent|text-transform|white-space|word-break|word-spacing|vertical-align|display|margin|margin-(?:top|right|bottom|left)|padding|padding-(?:top|right|bottom|left)|border(?:-(?:top|right|bottom|left))?(?:-\w+)?|border-radius(?:-\w+)?|width|max-width|min-width|height|max-height|float|clear|opacity|overflow(?:-(?:x|y))?|box-shadow|list-style(?:-\w+)?|flex(?:-\w+)?|align-\w+|justify-\w+)$/

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
export { escAttr }

/** 危险协议一律拒绝；相对路径、https(s)、mailto、页内锚点放行。
 *  先剥掉 tab/换行：URL 解析器会忽略它们，`jav\tascript:` 这类混淆不能靠前缀正则漏过去 */
function safeUrl(v: string): boolean {
  const t = v.replace(/[\t\r\n]/g, '').trim().toLowerCase()
  if (/^(javascript|vbscript|data|file|blob|about):/.test(t)) return false
  if (/^[a-z][a-z0-9+.-]*:/.test(t)) return /^https?:/.test(t) || t.startsWith('mailto:')
  return true
}

function sanitizeStyle(v: string): string {
  const keep: string[] = []
  for (const decl0 of v.split(';')) {
    const decl = decl0.trim()
    if (!decl) continue
    const i = decl.indexOf(':')
    if (i < 1) continue
    const prop = decl.slice(0, i).trim().toLowerCase()
    let val = decl
      .slice(i + 1)
      .replace(/!important/gi, '')
      .trim()
    if (!CSS_PROP.test(prop) || !val) continue
    if (/expression\s*\(|behavior\s*:|javascript:/i.test(val)) continue
    // url() 只允许站内相对路径，外链背景图换成 none（防追踪/防外域依赖）
    val = val.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, _q, u: string) => {
      const url = String(u).trim()
      return url.startsWith('/') ? `url("${url}")` : 'none'
    })
    keep.push(`${prop}: ${val}`)
  }
  return keep.join('; ')
}

function sanitizeAttrs(tag: string, raw: string): string {
  const allowed = TAG_ATTRS[tag] ?? new Set<string>()
  const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const seen = new Set<string>()
  let out = ''
  let m: RegExpExecArray | null
  while ((m = are.exec(raw))) {
    const name = m[1].toLowerCase()
    if (seen.has(name)) continue
    seen.add(name)
    if (name.startsWith('on')) continue
    const rawVal = m[2] ?? m[3] ?? m[4]

    if (name === 'style') {
      if (rawVal !== undefined) {
        const s = sanitizeStyle(rawVal)
        if (s) out += ` style="${escAttr(s)}"`
      }
      continue
    }
    const isGlobal = GLOBAL_ATTRS.has(name)
    if (!isGlobal && !allowed.has(name)) continue

    if (rawVal === undefined) {
      if (BOOL_ATTRS.has(name)) out += ` ${name}`
      continue
    }
    let v = rawVal.trim()

    if (name === 'href' || name === 'src' || name === 'poster') {
      if (!safeUrl(v)) continue
      if (name === 'href') {
        out += ` href="${escAttr(v)}"`
        if (/^https?:\/\//i.test(v)) out += ' rel="noopener noreferrer"'
        continue
      }
      out += ` ${name}="${escAttr(v)}"`
      continue
    }
    if (name === 'target') {
      if (!/^(?:_blank|_self)$/i.test(v)) continue
      out += ` target="${escAttr(v)}"`
      continue
    }
    if (name === 'class') {
      v = v.replace(/[^\w\- ]/g, '').replace(/\s+/g, ' ').trim()
      if (!v) continue
    }
    if (name === 'id') {
      v = v.replace(/[^\w\-]/g, '')
      if (!v) continue
    }
    if (name === 'data-w') {
      if (!/^\d{1,5}$/.test(v)) continue
    }
    out += ` ${name}="${escAttr(v)}"`
  }
  return out
}

export function sanitizeHtml(input: string): string {
  if (!input) return ''
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    out += input.slice(last, m.index)
    last = re.lastIndex
    if (m[0].startsWith('<!--')) continue

    const isClose = m[1] === '/'
    const name = m[2].toLowerCase()
    const attrsRaw = m[3] ?? ''
    const selfClosed = m[4] === '/'

    if (DROP_WITH_CONTENT.has(name)) {
      // 例外：OG 卡图 meta（必须整段只有一个 meta 且 URL 是站内 /images/ 路径）原样放行
      if (name === 'meta' && !isClose && OG_META_RE.test(m[0])) {
        const url = ogImageUrl(attrsRaw)
        if (url) {
          out += `<meta data-og-image="${escAttr(url)}" content="${escAttr(url)}">`
          continue
        }
      }
      if (!isClose && !selfClosed) {
        // 丢弃到对应结束标签为止；未闭合则丢弃其后全部内容（对 script/style 是正确行为）
        const rest = input.slice(last)
        const cm = new RegExp(`</${name}[\\s>]`, 'i').exec(rest)
        last = cm ? last + cm.index : input.length
        re.lastIndex = last
      }
      continue
    }
    if (!ALLOWED_TAGS.has(name)) continue // 不认识的标签：剥壳留字

    if (isClose) {
      out += `</${name}>`
      continue
    }
    const attrs = sanitizeAttrs(name, attrsRaw)
    out += `<${name}${attrs}>`
  }
  out += input.slice(last)
  return out
}

/** 净化纯文本（评论区等场景不涉及 HTML，直接转义） */
export function escapeText(s: string): string {
  return escAttr(s)
}

/** 取正文里的 OG 分享卡图 URL（sanitize 后的 content 只会有合法的站内 /images/ 路径） */
export function extractOgImage(contentHtml: string): string | null {
  const m = /<meta[^>]+data-og-image="([^"]+)"/i.exec(contentHtml)
  return m?.[1] ?? null
}
