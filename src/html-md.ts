/**
 * 服务端 HTML → Markdown（供「数据导出」的 Markdown 包使用）。
 *
 * 编辑器里的 htmlToMd（public/admin/editor.js）依赖 DOMParser，Workers 运行时没有 DOM，
 * 这里照 src/sanitize.ts 的正则 token 行走器模式重写：输入是 sanitizeHtml 的输出，
 * 标签集合已知（白名单、结构良好），逐 token 走栈即可，无需完整 HTML 解析。
 * 转换口径与编辑器版一致：标题/加粗/斜体/删除/行内代码/链接/图片/引用/代码块/列表/分割线；
 * 表格转为管道表，其余未知标签剥壳保留内文。
 */

const TOKEN_RE = /<!--[\s\S]*?-->|<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s+[^<>]*?)?\/?>|[^<]+/g

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const PARAGRAPH_BLOCKS = new Set(['p', 'section', 'div', 'article', 'figure', 'figcaption', 'summary', 'details'])
/** 无 markdown 语义、剥壳保留内文的标签 */
const PASS_THROUGH = new Set(['span', 'u', 'ins', 'mark', 'sup', 'sub', 'small', 'abbr', 'cite', 'q', 'kbd', 'samp', 'font'])

/** 解析开标签：返回标签名与属性表；selfClose 标记 <img/>、<br/> 这类写法 */
function parseOpenTag(raw: string): { tag: string; attrs: Record<string, string>; selfClose: boolean } | null {
  const m = /^<([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)>$/.exec(raw)
  if (!m) return null
  const attrs: Record<string, string> = {}
  for (const a of m[2].matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = a[2]
  return { tag: m[1].toLowerCase(), attrs, selfClose: m[3] === '/' }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 行内修饰符（strong/em/del/code/a）的开合标记；a 的闭合串在开标签时带上 href */
function inlineMarker(tag: string, attrs: Record<string, string>): { before: string; after: string } {
  switch (tag) {
    case 'strong':
    case 'b':
      return { before: '**', after: '**' }
    case 'em':
    case 'i':
      return { before: '*', after: '*' }
    case 'del':
    case 's':
      return { before: '~~', after: '~~' }
    case 'code':
      return { before: '`', after: '`' }
    case 'a':
      return { before: '[', after: `](${attrs.href || ''})` }
    default:
      return { before: '', after: '' }
  }
}

interface Ctx {
  tag: string
  /** ol 的已序号计数（li 前缀用）；li 的 '- ' 前缀；行内标记的闭合串 */
  n?: number
  prefix?: string
  after?: string
}

export function htmlToMd(html: string): string {
  const tokens = html.match(TOKEN_RE) ?? []
  const out: string[] = []
  const stack: Ctx[] = []
  let inline = ''

  const liPrefix = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === 'li') return stack[i].prefix || ''
    return ''
  }
  const quoteDepth = () => stack.filter((s) => s.tag === 'blockquote').length
  const emit = (line: string) => {
    let l = line
    const pre = liPrefix()
    if (pre) l = pre + l.replace(/\n/g, '\n' + pre)
    const q = quoteDepth()
    if (q) l = '> '.repeat(q) + l.replace(/\n/g, '\n' + '> '.repeat(q))
    out.push(l)
  }
  const flush = () => {
    const t = inline.trim()
    inline = ''
    if (t) emit(t)
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti]
    if (tok.startsWith('<!--')) continue
    if (!tok.startsWith('<')) {
      inline += decodeEntities(tok).replace(/\s+/g, ' ')
      continue
    }

    // ---- 闭标签 ----
    if (tok.startsWith('</')) {
      const tag = tok.slice(2, -1).trim().toLowerCase()
      if (tag === 'pre') {
        // pre 的内容已在开标签时整体捕获，这里弹出并输出 fenced code block
        const i = stack.map((s) => s.tag).lastIndexOf('pre')
        if (i >= 0) {
          const raw = stack[i].prefix || ''
          stack.length = i
          emit('```\n' + decodeEntities(raw).replace(/\n$/, '') + '\n```')
        }
        continue
      }
      if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'caption') {
        const i = stack.map((s) => s.tag).lastIndexOf(tag)
        if (i >= 0) stack.length = i
        flush()
        continue
      }
      if (tag === 'tr') {
        // 行缓冲：td/th 闭标签时已把单元格写进 rowBuf（prefix 字段借用）
        const i = stack.map((s) => s.tag).lastIndexOf('tr')
        if (i >= 0) {
          const row = stack[i].prefix || ''
          stack.length = i
          flush()
          emit(row + '|')
        }
        continue
      }
      if (tag === 'td' || tag === 'th') {
        const i = stack.map((s) => s.tag).lastIndexOf(tag)
        if (i >= 0) {
          const tr = [...stack].reverse().find((s) => s.tag === 'tr')
          if (tr) tr.prefix = (tr.prefix || '') + '| ' + inline.trim() + ' '
          inline = ''
          stack.length = i
        }
        continue
      }
      if (tag === 'li') {
        const i = stack.map((s) => s.tag).lastIndexOf('li')
        if (i >= 0) {
          flush() // 先 flush：li 前缀依赖栈内上下文，弹栈后就丢了
          stack.length = i
        }
        continue
      }
      if (tag === 'ul' || tag === 'ol' || tag === 'blockquote') {
        const i = stack.map((s) => s.tag).lastIndexOf(tag)
        if (i >= 0) {
          flush() // 引用前缀同理，先 flush 再弹栈
          stack.length = i
        }
        continue
      }
      if (HEADINGS.has(tag)) {
        const i = stack.map((s) => s.tag).lastIndexOf(tag)
        if (i >= 0) {
          const t = inline.trim()
          inline = ''
          if (t) emit('#'.repeat(Number(tag[1])) + ' ' + t)
          stack.length = i
        }
        continue
      }
      if (PARAGRAPH_BLOCKS.has(tag)) {
        const i = stack.map((s) => s.tag).lastIndexOf(tag)
        if (i >= 0) stack.length = i
        flush()
        continue
      }
      // 行内标签：弹最近同名标记并补闭合串（str/strong 等白名单输出保证配对，这里只作防御）
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          inline += stack[i].after || ''
          stack.splice(i, 1)
          break
        }
      }
      continue
    }

    // ---- 开标签 ----
    const open = parseOpenTag(tok)
    if (!open) continue
    const { tag, attrs, selfClose } = open

    if (tag === 'br') {
      inline += '\n'
      continue
    }
    if (tag === 'hr') {
      flush()
      emit('---')
      continue
    }
    if (tag === 'img') {
      const md = `![${decodeEntities(attrs.alt || '')}](${attrs.src || ''})`
      // 顶层裸图（编辑器允许 img 直接是块），否则并入所在块
      if (stack.some((s) => s.tag === 'td' || s.tag === 'li' || PARAGRAPH_BLOCKS.has(s.tag) || HEADINGS.has(s.tag))) {
        inline += md
      } else {
        flush()
        emit(md)
      }
      continue
    }
    if (tag === 'pre') {
      flush()
      // 捕获到 </pre> 为止的原始文本（代码块不走行内转换，保留换行与空白）
      let raw = ''
      let j = ti + 1
      for (; j < tokens.length; j++) {
        if (/^<\/pre>$/i.test(tokens[j])) break
        if (!tokens[j].startsWith('<')) raw += tokens[j]
      }
      ti = j - 1 // 游标停在 </pre> 前一位，下一轮循环处理闭合、出栈输出
      stack.push({ tag: 'pre', prefix: raw })
      continue
    }
    if (tag === 'table') {
      flush()
      stack.push({ tag: 'table' })
      continue
    }
    if (tag === 'tr') {
      flush()
      stack.push({ tag: 'tr', prefix: '' })
      continue
    }
    if (tag === 'td' || tag === 'th') {
      flush()
      stack.push({ tag })
      continue
    }
    if (tag === 'li') {
      flush()
      const ol = [...stack].reverse().find((s) => s.tag === 'ol')
      stack.push({ tag: 'li', prefix: ol ? `${++(ol.n as number)}. ` : '- ' })
      continue
    }
    if (tag === 'ol') {
      flush()
      stack.push({ tag, n: 0 })
      continue
    }
    if (tag === 'ul' || tag === 'blockquote') {
      flush()
      stack.push({ tag })
      continue
    }
    if (HEADINGS.has(tag)) {
      flush()
      stack.push({ tag })
      continue
    }
    if (PARAGRAPH_BLOCKS.has(tag)) {
      flush()
      stack.push({ tag })
      continue
    }
    if (PASS_THROUGH.has(tag)) {
      if (!selfClose) stack.push({ tag })
      continue
    }
    // 其余一律按行内修饰符处理（strong/em/del/code/a…）
    const mk = inlineMarker(tag, attrs)
    inline += mk.before
    if (!selfClose) stack.push({ tag, after: mk.after })
  }
  flush()
  return postProcess(out)
}

/** 表格行合并为单换行（Markdown 表格行之间不能有空行）并给表格首行补分隔线，其余块间保持空行 */
function postProcess(lines: string[]): string {
  const res: string[] = []
  for (const line of lines) {
    const isRow = /^\|.*\|\s*$/.test(line)
    const prev = res[res.length - 1]
    if (isRow && !(prev && /^\|.*\|\s*$/.test(prev))) {
      const cols = Math.max((line.match(/\|/g) || []).length - 1, 1)
      res.push(line)
      res.push('|' + ' --- |'.repeat(cols))
      continue
    }
    res.push(line)
  }
  return res
    .join('\n\n')
    .replace(/(\|[^\n]*\|)\n\n(?=\|)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
