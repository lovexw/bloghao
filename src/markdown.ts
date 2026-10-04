import { escAttr } from './sanitize'

/**
 * 轻量 Markdown 渲染器（编辑器 Markdown 模式使用）
 * 支持：# 标题、**粗体**、*斜体*、`行内代码`、``` 代码块、> 引用、
 * -/1. 列表、![图](src)、[链接](href)、--- 分隔线、表格不支持（v1）
 */

interface CodeSpan {
  placeholder: string
  html: string
}

function inline(s: string, codes: CodeSpan[]): string {
  // 1. 提取行内代码，避免内部被二次格式化（传入文本已被 escLine 转义，这里不再重复）
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    const placeholder = `\u0000${codes.length}\u0000`
    codes.push({ placeholder, html: `<code>${code}</code>` })
    return placeholder
  })
  // 2. 图片
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt: string, src: string, title?: string) => {
    if (!safeUrlMd(src)) return _m
    return `<img src="${escQuote(src)}" alt="${escQuote(alt)}"${title ? ` title="${escQuote(title)}"` : ''}>`
  })
  // 3. 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, href: string) => {
    if (!safeUrlMd(href)) return m
    return `<a href="${escQuote(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`
  })
  // 4. 粗体 / 斜体 / 删除线
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  // 5. 还原行内代码
  for (const c of codes) s = s.split(c.placeholder).join(c.html)
  return s
}

function safeUrlMd(v: string): boolean {
  // 先剥掉 tab/换行：URL 解析器会忽略它们，`jav\tascript:` 这类混淆不能靠前缀正则漏过去
  const t = v.replace(/[\t\r\n]/g, '').trim().toLowerCase()
  if (/^(javascript|vbscript|data|file|blob):/.test(t)) return false
  if (/^[a-z][a-z0-9+.-]*:/.test(t)) return /^https?:/.test(t)
  return true
}

function escLine(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 进 inline() 的文本已被 escLine 转义过 & < >，属性上下文只补引号；
 *  不能再用 escAttr，否则 & 会变成 &amp;amp;，含参数的链接/图片 URL 全部损坏 */
function escQuote(s: string): string {
  return s.replace(/"/g, '&quot;')
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let quote: string[] = []
  let codeLang = ''
  let codeBuf: string[] = []

  const flushPara = () => {
    if (para.length) {
      const codes: CodeSpan[] = []
      // para 入队时已逐行 escLine，这里不再整体转义，否则软换行的 <br> 会被转成字面文本
      out.push(`<p>${inline(para.join('<br>'), codes)}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }
  const flushQuote = () => {
    if (quote.length) {
      const codes: CodeSpan[] = []
      // quote 入队的是原始行，需先逐行转义再拼接
      out.push(`<blockquote>${inline(quote.map(escLine).join('<br>'), codes)}</blockquote>`)
      quote = []
    }
  }
  const flushAll = () => {
    flushPara()
    flushList()
    flushQuote()
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    if (codeLang) {
      if (/^```\s*$/.test(line)) {
        out.push(`<pre><code${codeLang !== 'code' ? ` class="language-${escAttr(codeLang)}"` : ''}>${escLine(codeBuf.join('\n'))}</code></pre>`)
        codeLang = ''
        codeBuf = []
      } else {
        codeBuf.push(raw)
      }
      continue
    }
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      flushAll()
      codeLang = fence[1] || 'code'
      continue
    }
    if (!line.trim()) {
      flushAll()
      continue
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      flushAll()
      const level = h[1].length
      const codes: CodeSpan[] = []
      out.push(`<h${level}>${inline(escLine(h[2]), codes)}</h${level}>`)
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll()
      out.push('<hr>')
      continue
    }
    const q = /^>\s?(.*)$/.exec(line)
    if (q) {
      flushPara()
      flushList()
      quote.push(q[1])
      continue
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line)
    if (ul) {
      flushPara()
      flushQuote()
      if (listType !== 'ul') {
        flushList()
        out.push('<ul>')
        listType = 'ul'
      }
      const codes: CodeSpan[] = []
      out.push(`<li>${inline(escLine(ul[1]), codes)}</li>`)
      continue
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ol) {
      flushPara()
      flushQuote()
      if (listType !== 'ol') {
        flushList()
        out.push('<ol>')
        listType = 'ol'
      }
      const codes: CodeSpan[] = []
      out.push(`<li>${inline(escLine(ol[1]), codes)}</li>`)
      continue
    }
    flushList()
    flushQuote()
    para.push(escLine(line))
  }
  // 结尾处理
  if (codeLang) {
    out.push(`<pre><code>${escLine(codeBuf.join('\n'))}</code></pre>`)
  }
  flushAll()
  return out.join('\n')
}
