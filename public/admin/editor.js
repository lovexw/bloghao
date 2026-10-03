/**
 * 博客号编辑器 —— 微信公众号风格写作区
 *
 * 能力：
 * - 富文本工具栏（标题/加粗斜体/引用/代码/列表/分割线/链接/图片/视频）
 * - 截图粘贴 & 拖拽自动上传到 R2，插入时补 data-w（微信排版规范 1.4.3）
 * - 自动保存草稿 + 发布 / 转草稿 / 预览
 * - Markdown 模式互转
 * - 排版体检：静态检查《微信公众平台编辑器插件开发规范》要点
 * - 插件系统：window.BlogHao.registerPlugin（见 docs/PLUGINS.md）
 */

const editorPage = () => document.querySelector('.editor-page')

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} }
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch('/api' + path, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: res.status })
  return data
}

function toast(msg, isErr = false) {
  const slot = document.getElementById('toast-slot')
  const el = document.createElement('div')
  el.className = 'toast' + (isErr ? ' toast-err' : '')
  el.textContent = msg
  slot.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

/* ---------------- 图标 ---------------- */
const IC = {
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5 4 9l4 4"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 5 4 4-4 4"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  bold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h6.5a4 4 0 0 1 0 8H7z"/><path d="M7 12h7.5a4 4 0 0 1 0 8H7z"/></svg>',
  italic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4h-6M15 20H9M14 4 10 20"/></svg>',
  underline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/></svg>',
  strike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16M8 7a4 3 0 1 1 8 0M16 17a4 3 0 1 1-8 0"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V9a4 4 0 0 1 4-4M13 16V9a4 4 0 0 1 4-4"/><path d="M5 16h4M13 16h4"/></svg>',
  code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/></svg>',
  ul: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/><path d="M10 6h10M10 12h10M10 18h10"/></svg>',
  ol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><text x="3" y="8" font-size="7" fill="currentColor" stroke="none">1.</text><text x="3" y="18" font-size="7" fill="currentColor" stroke="none">2.</text><path d="M11 6h9M11 16h9"/></svg>',
  hr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16M8 6h8M8 18h8" opacity="0.5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.1"/><path d="M14 10a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.1"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 19 5.5-5.5L14 17l3-3 4 4"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.5 5 2.5-5 2.5z" fill="currentColor" stroke="none"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 15 6-6 8 8-3 3H10z"/><path d="M11 9 15 5l6 6-4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6h5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8.5 4 4 0 0 1 17.5 18z"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 16-7-4 16-4.5-6.5z"/><path d="M11.5 14.5 20 5"/></svg>',
}

/* ---------------- 插件系统 ---------------- */
const plugins = []
let pluginSlotEl = null

function renderPluginButtons(ctx) {
  if (!pluginSlotEl) return
  pluginSlotEl.innerHTML = ''
  for (const p of plugins) {
    const b = document.createElement('button')
    b.className = 'ed-btn'
    b.type = 'button'
    b.title = p.title || p.name
    b.innerHTML = p.icon || '插件'
    b.addEventListener('click', (e) => {
      e.preventDefault()
      saveSelection()
      try {
        p.onClick(ctx)
      } catch (err) {
        console.warn('插件执行出错', err)
      }
    })
    pluginSlotEl.appendChild(b)
  }
}

async function loadPlugins(ctx) {
  try {
    const res = await fetch('/plugins/manifest.json', { credentials: 'same-origin' })
    if (!res.ok) return
    const list = await res.json()
    if (!Array.isArray(list)) return
    for (const f of list) {
      try {
        await import('/plugins/' + f)
      } catch (e) {
        console.warn('插件加载失败：', f, e)
      }
    }
  } catch {
    /* 没有插件清单也完全不影响使用 */
  }
  renderPluginButtons(ctx)
}

/* ---------------- 排版体检（依据微信编辑器插件开发规范） ---------------- */
function parseStyle(styleText) {
  const map = {}
  for (const decl of String(styleText || '').split(';')) {
    const i = decl.indexOf(':')
    if (i < 1) continue
    map[decl.slice(0, i).trim().toLowerCase()] = decl.slice(i + 1).trim()
  }
  return map
}

function px(v) {
  const m = /^(-?[\d.]+)px/.exec(String(v || '').trim())
  return m ? parseFloat(m[1]) : null
}

function hasText(el) {
  return (el.textContent || '').trim().length > 0
}

export function runChecks(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
  const issues = []
  const add = (level, rule, msg) => {
    if (!issues.some((x) => x.rule === rule && x.msg === msg)) issues.push({ level, rule, msg })
  }

  doc.body.querySelectorAll('*').forEach((el) => {
    const style = parseStyle(el.getAttribute && el.getAttribute('style'))

    // 1.4 固定宽度
    const w = px(style['width'])
    if (w !== null && w > 120) {
      const exempt = el.closest && el.closest('[data-ignore-width]')
      add(
        'warn',
        '1.4 固定宽度',
        exempt
          ? '存在固定宽度节点（已用 data-ignore-width 豁免，请确认是有意为之）'
          : `检测到固定宽度 ${w}px，窄屏会溢出、宽屏会偏移；建议用百分比宽度，或确认后加 data-ignore-width 豁免`
      )
    }

    // 1.3 行高过小
    const fs = px(style['font-size'])
    const lh = px(style['line-height'])
    const lhUnitless = /^([\d.]+)\s*;?$/.test(String(style['line-height'] || '').trim())
    if (fs && lh && lh < fs) add('warn', '1.3 行高过小', `行高 ${lh}px 小于字号 ${fs}px，多行文字会重叠`)
    if (lhUnitless && parseFloat(style['line-height']) < 1 && hasText(el))
      add('warn', '1.3 行高过小', `行高倍数 ${style['line-height']} 小于 1，多行文字会重叠（若仅为图片拼接可忽略）`)

    // 1.5 height:0 隐藏文字
    const h = px(style['height'])
    if (h !== null && h <= 2 && hasText(el)) add('warn', '1.5 高度为 0', '容器高度接近 0 且含有文字，手机上会被隐藏')

    // 1.6 text-align start/end
    const ta = (style['text-align'] || '').trim().toLowerCase()
    if (ta === 'start' || ta === 'end') add('warn', '1.6 text-align', 'text-align 使用 start/end 在不同设备表现不一致，请改为 left/right/center')

    // 1.8 pre 包正文
    if (el.tagName === 'PRE' && !el.querySelector('code') && hasText(el))
      add('warn', '1.8 pre 标签', 'pre 包裹普通段落不会自动换行，手机上会被截断；正文请用普通段落')

    // 3 字体族
    if (style['font-family']) add('info', '3 字体使用', '不建议自设 font-family，公众号默认字体栈在各端体验最优')

    // 1.2 光标透明（粘贴内容可能带）
    if (/transparent|rgba\(0,\s*0,\s*0,\s*0\)/i.test(style['caret-color'] || ''))
      add('warn', '1.2 caret-color', '光标颜色透明会导致看不到输入位置')

    // 1.1 透明图片
    if (el.tagName === 'IMG' && parseFloat(style.opacity) === 0)
      add('warn', '1.1 opacity', '图片 opacity 为 0：真图被隐藏，发布后无法在编辑器中修改图片')

    // 4.5.2 !important
    if (/!important/i.test(el.getAttribute && el.getAttribute('style') || ''))
      add('warn', '4.5.2 !important', '!important 会破坏平台公共样式与 Dark Mode 转换')

    // 4.1.2 渐变背景上的文字
    if (/gradient/i.test(style['background-image'] || style['background'] || '') && hasText(el))
      add('info', '4.1.2 渐变背景', '文字下方的渐变背景在 Dark Mode 下会被转为纯色，请确认效果')

    // 无障碍：img alt
    if (el.tagName === 'IMG' && !el.getAttribute('alt')) add('info', '无障碍', '图片缺少 alt 描述')
  })

  // 2.1 同标签嵌套 ≥ 10 层
  doc.body.querySelectorAll('section,div,p,span').forEach((el) => {
    let depth = 1
    let cur = el.parentElement
    while (cur && cur !== doc.body) {
      if (cur.tagName === el.tagName) depth++
      cur = cur.parentElement
    }
    if (depth >= 10) {
      add('warn', '2.1 嵌套层级', '同一标签连续嵌套超过 10 层，编辑器会自动精简，建议清理结构')
    }
  })

  // 1.4.3 图片 data-w
  doc.body.querySelectorAll('img').forEach((img) => {
    if (!img.getAttribute('data-w'))
      add('info', '1.4.3 data-w', '图片缺少 data-w（原始像素宽度），加载超时时缺少可靠的宽度兜底；博客号上传的图会自动补上')
  })

  return issues
}

function applyAutoFixes() {
  const editor = document.getElementById('ed-editor')
  let html = editor.innerHTML
  html = html.replace(/!important/gi, '')
  html = html.replace(/text-align\s*:\s*(start|end)/gi, 'text-align: left')
  editor.innerHTML = html
  markDirty()
}

/* ---------------- HTML → Markdown ---------------- */
function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  function inline(node) {
    let out = ''
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent.replace(/\s+/g, ' ')
        return
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return
      const t = n.tagName.toLowerCase()
      const inner = inline(n)
      if (t === 'br') out += '\n'
      else if (t === 'strong' || t === 'b') out += `**${inner.trim()}**`
      else if (t === 'em' || t === 'i') out += `*${inner.trim()}*`
      else if (t === 'del' || t === 's') out += `~~${inner.trim()}~~`
      else if (t === 'code') out += '`' + n.textContent + '`'
      else if (t === 'a') out += `[${inner.trim()}](${n.getAttribute('href') || ''})`
      else if (t === 'img') out += `![${n.getAttribute('alt') || ''}](${n.getAttribute('src') || ''})`
      else out += inner
    })
    return out
  }

  const lines = []
  doc.body.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      if (n.textContent.trim()) lines.push(n.textContent.trim())
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const t = n.tagName.toLowerCase()
    if (/^h[1-4]$/.test(t)) lines.push('#'.repeat(Number(t[1])) + ' ' + inline(n).trim())
    else if (t === 'p' || t === 'section' || t === 'div') {
      const text = inline(n).trim()
      if (text) lines.push(text)
    } else if (t === 'blockquote') lines.push('> ' + inline(n).trim().replace(/\n/g, '\n> '))
    else if (t === 'pre') lines.push('```\n' + n.textContent.replace(/\n$/, '') + '\n```')
    else if (t === 'ul' || t === 'ol') {
      let i = 1
      n.querySelectorAll(':scope > li').forEach((li) => {
        lines.push((t === 'ul' ? '- ' : `${i++}. `) + inline(li).trim())
      })
    } else if (t === 'hr') lines.push('---')
    else if (t === 'img') lines.push(`![](${n.getAttribute('src') || ''})`)
    else {
      const text = inline(n).trim()
      if (text) lines.push(text)
    }
  })
  return lines.join('\n\n')
}

/* ---------------- 主挂载 ---------------- */
export async function mountEditor(root, postId) {
  const post = {
    id: null,
    slug: '',
    title: '',
    content: '',
    summary: '',
    cover: '',
    tags: [],
    categoryId: null,
    status: 'draft',
    pinned: false,
    published_at: null,
  }
  if (postId) {
    const d = await api(`/admin/posts/${postId}`)
    Object.assign(post, d.post, { tags: d.post.tagList || [], categoryId: d.post.categoryId ?? null })
  }

  let mdMode = false
  let dirty = false
  let saving = false
  let saveTimer = null
  let savedRange = null

  root.innerHTML = `<div class="editor-page">
  <div class="ed-topbar">
    <a class="ed-back" href="#/posts">← 文章</a>
    <span class="ed-status-pill chip ${post.status === 'published' ? 'chip-green' : 'chip-gray'}" id="ed-pill">${post.status === 'published' ? '已发布' : '草稿'}</span>
    <span class="ed-save-state" id="ed-save-state">—</span>
    <div class="ed-top-ops">
      <button class="btn btn-sm" id="ed-check" title="按微信排版规范检查正文">${IC.check} 体检</button>
      <button class="btn btn-sm" id="ed-preview">${IC.eye} 预览</button>
      <button class="btn btn-sm" id="ed-save">${IC.cloud} 存草稿</button>
      <button class="btn btn-primary btn-sm" id="ed-publish">${post.status === 'published' ? '更新' : '发布'}</button>
      <button class="btn btn-ghost btn-sm" id="ed-drawer-toggle" title="文章信息">信息</button>
    </div>
  </div>

  <div class="ed-toolbar" id="ed-toolbar">
    <button class="ed-btn" data-cmd="undo" title="撤销 ⌘Z">${IC.undo}</button>
    <button class="ed-btn" data-cmd="redo" title="重做 ⇧⌘Z">${IC.redo}</button>
    <span class="ed-sep"></span>
    <button class="ed-btn ed-btn-md" data-block="h2" title="标题 H2">H2</button>
    <button class="ed-btn ed-btn-md" data-block="h3" title="标题 H3">H3</button>
    <button class="ed-btn ed-btn-md" data-block="h4" title="标题 H4">H4</button>
    <span class="ed-sep"></span>
    <button class="ed-btn" data-cmd="bold" title="加粗 ⌘B">${IC.bold}</button>
    <button class="ed-btn" data-cmd="italic" title="斜体 ⌘I">${IC.italic}</button>
    <button class="ed-btn" data-cmd="underline" title="下划线 ⌘U">${IC.underline}</button>
    <button class="ed-btn" data-cmd="strikeThrough" title="删除线">${IC.strike}</button>
    <span class="ed-sep"></span>
    <button class="ed-btn" data-block="blockquote" title="引用">${IC.quote}</button>
    <button class="ed-btn" data-act="codeblock" title="代码块">${IC.code}</button>
    <button class="ed-btn" data-act="inlinecode" title="行内代码">&lt;/&gt;</button>
    <span class="ed-sep"></span>
    <button class="ed-btn" data-cmd="insertUnorderedList" title="无序列表">${IC.ul}</button>
    <button class="ed-btn" data-cmd="insertOrderedList" title="有序列表">${IC.ol}</button>
    <button class="ed-btn" data-act="hr" title="分割线">${IC.hr}</button>
    <span class="ed-sep"></span>
    <button class="ed-btn" data-act="link" title="链接">${IC.link}</button>
    <button class="ed-btn" data-act="image" title="图片（可粘贴 / 拖拽）">${IC.image}</button>
    <button class="ed-btn" data-act="video" title="视频">${IC.video}</button>
    <button class="ed-btn" data-act="clear" title="清除格式">${IC.eraser}</button>
    <span class="ed-sep"></span>
    <span id="ed-plugin-slot" style="display:flex;gap:2px;"></span>
  </div>

  <div class="ed-main">
    <div class="ed-center">
      <div class="ed-paper" id="ed-paper">
        <input class="ed-title" id="ed-title" placeholder="输入文章标题…" maxlength="150" value="${esc(post.title)}">
        <div class="ed-rich-wrap">
          <div class="ed-editor" id="ed-editor" contenteditable="true" spellcheck="false" data-placeholder="从这里开始写——支持直接粘贴截图、拖拽上传图片；⌘S 随时保存"></div>
        </div>
        <div class="ed-md-wrap">
          <textarea class="ed-md" id="ed-md" placeholder="Markdown 模式：# 标题 / **加粗** / *斜体* / \`行内代码\` / > 引用 / - 列表 / [链接](url) / ![图](url) / \`\`\`代码块\`\`\` / ---"></textarea>
        </div>
      </div>
    </div>
    <aside class="ed-drawer" id="ed-drawer">
      <button class="ed-drawer-close" id="ed-drawer-close" title="收起">×</button>
      <div class="drawer-title">摘要</div>
      <textarea class="textarea" id="ed-summary" rows="3" maxlength="500" placeholder="不填则自动截取正文前 80 字">${esc(post.summary)}</textarea>

      <div class="drawer-title">封面图</div>
      <div class="cover-box" id="ed-cover-box" title="点击上传封面图">
        ${post.cover ? `<img src="${esc(post.cover)}" id="ed-cover-img"><button class="cover-remove" id="ed-cover-remove" title="移除封面">×</button>` : '＋ 上传封面图'}
      </div>

      <div class="drawer-title">标签</div>
      <div class="tag-box" id="ed-tag-box">
        <input class="tag-input" id="ed-tag-input" placeholder="回车添加，最多 8 个" list="tag-suggestions">
        <datalist id="tag-suggestions"></datalist>
      </div>

      <div class="drawer-title">分类</div>
      <select class="input" id="ed-category">
        <option value="">未分类</option>
      </select>
      <div style="font-size:12px;color:var(--sub);margin-top:6px;">在后台「分类」里维护</div>

      <div class="drawer-title">链接 Slug</div>
      <input class="input" id="ed-slug" value="${esc(post.slug)}" placeholder="留空则根据标题自动生成">

      <div class="drawer-title">更多</div>
      <div class="switch-row">
        <div><div class="switch-label">置顶文章</div><div class="switch-sub">在首页列表置顶展示</div></div>
        <label class="switch"><input type="checkbox" id="ed-pinned" ${post.pinned ? 'checked' : ''}><span class="track"></span></label>
      </div>
      <div style="font-size:12px;color:var(--sub);margin-top:16px;line-height:1.8;">
        发布时间：${post.published_at ? new Date(post.published_at).toLocaleString('zh-CN') : '未发布'}<br>
        图片粘贴后自动上传 R2，外链图片不受影响。
      </div>
    </aside>
  </div>

  <div class="ed-bottombar">
    <span id="ed-count">0 字</span>
    <span id="ed-read">约 1 分钟</span>
    <span class="spacer"></span>
    <button class="ed-link" id="ed-md-toggle" title="Markdown 与富文本互转">Markdown</button>
  </div>
</div>`

  const editor = document.getElementById('ed-editor')
  const mdArea = document.getElementById('ed-md')
  const titleEl = document.getElementById('ed-title')
  const saveState = document.getElementById('ed-save-state')
  const pill = document.getElementById('ed-pill')
  pluginSlotEl = document.getElementById('ed-plugin-slot')

  editor.innerHTML = post.content || ''

  /* ---------- 选择保存 / 恢复 ---------- */
  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange()
  }
  function restoreSelection() {
    const sel = window.getSelection()
    if (!sel) return
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      sel.removeAllRanges()
      sel.addRange(savedRange)
    } else {
      const r = document.createRange()
      r.selectNodeContents(editor)
      r.collapse(false)
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }

  /* ---------- 插入 ---------- */
  function insertHTML(html) {
    editor.focus()
    restoreSelection()
    let ok = false
    try {
      ok = document.execCommand('insertHTML', false, html)
    } catch {
      ok = false
    }
    if (!ok) {
      const sel = window.getSelection()
      const r = sel && sel.rangeCount ? sel.getRangeAt(0) : document.createRange()
      r.deleteContents()
      const tpl = document.createElement('template')
      tpl.innerHTML = html
      r.insertNode(tpl.content)
      r.collapse(false)
    }
    markDirty()
    updateCount()
  }

  /* ---------- 图片探测 data-w ---------- */
  function probeWidth(url) {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth || null)
      img.onerror = () => resolve(null)
      img.src = url
      setTimeout(() => resolve(null), 4000)
    })
  }

  async function uploadAndInsert(file) {
    saveState.textContent = `上传中 ${file.name}…`
    try {
      const d = await uploadFile(file, (p) => (saveState.textContent = `上传中 ${p}%`))
      const w = await probeWidth(d.url)
      const name = (file.name || '').replace(/\.[^.]+$/, '')
      if (file.type.startsWith('video/')) {
        insertHTML(`<video src="${esc(d.url)}" controls playsinline style="width:100%;"></video><p><br></p>`)
      } else {
        insertHTML(`<img src="${esc(d.url)}"${w ? ` data-w="${w}"` : ''} alt="${esc(name)}"><p><br></p>`)
      }
      saveState.textContent = '图片已插入 ✅'
      markDirty()
    } catch (e) {
      saveState.textContent = '上传失败'
      toast(e.message, true)
    }
  }

  function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/admin/upload')
      xhr.responseType = 'json'
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(Math.round((e.loaded / e.total) * 100))
      xhr.onload = () => {
        const d = xhr.response || {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(d)
        else reject(new Error(d.error || '上传失败'))
      }
      xhr.onerror = () => reject(new Error('网络错误，上传失败'))
      const fd = new FormData()
      fd.append('file', file)
      xhr.send(fd)
    })
  }

  /* ---------- 状态 & 保存 ---------- */
  function updateCount() {
    const n = (editor.innerText || '').replace(/\s/g, '').length
    document.getElementById('ed-count').textContent = `${n} 字`
    document.getElementById('ed-read').textContent = `约 ${Math.max(1, Math.ceil(n / 400))} 分钟`
  }

  function markDirty() {
    dirty = true
    saveState.textContent = '有未保存更改'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => save(false), 1500)
  }

  function collect(extra = {}) {
    const catVal = document.getElementById('ed-category').value
    return {
      title: titleEl.value.trim(),
      content: editor.innerHTML,
      summary: document.getElementById('ed-summary').value.trim(),
      cover: post.cover,
      tags: post.tags,
      categoryId: catVal ? Number(catVal) : null,
      pinned: document.getElementById('ed-pinned').checked,
      slug: document.getElementById('ed-slug').value.trim(),
      status: post.status,
      ...extra,
    }
  }

  async function save(publishIntent) {
    if (saving) return
    if (!mdMode) {
      // 富文本模式下同步 markdown 不可见内容
    } else {
      const d = await api('/admin/tools/md', { method: 'POST', body: { md: mdArea.value } })
      editor.innerHTML = d.html
    }
    const payload = collect(publishIntent && publishIntent.status ? publishIntent : {})
    if (!payload.title && !payload.content.replace(/<[^>]+>/g, '').trim()) return
    saving = true
    saveState.textContent = '保存中…'
    try {
      if (post.id) {
        const d = await api(`/admin/posts/${post.id}`, { method: 'PUT', body: payload })
        Object.assign(post, d.post, { tags: d.post.tagList || post.tags })
        post.cover = payload.cover
        post.tags = payload.tags
      } else {
        const d = await api('/admin/posts', { method: 'POST', body: payload })
        post.id = d.post.id
        post.slug = d.post.slug
        post.cover = payload.cover
        post.tags = payload.tags
        // 无 hashchange 的地址替换，避免重挂载丢失光标
        history.replaceState(null, '', `#/editor/${post.id}`)
      }
      document.getElementById('ed-slug').value = post.slug
      dirty = false
      clearTimeout(saveTimer)
      const t = new Date()
      saveState.textContent = `已保存 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      pill.textContent = post.status === 'published' ? '已发布' : '草稿'
      pill.className = `ed-status-pill chip ${post.status === 'published' ? 'chip-green' : 'chip-gray'}`
      return post
    } catch (e) {
      saveState.textContent = '保存失败，点击重试'
      saveState.style.cursor = 'pointer'
      saveState.onclick = () => save(false)
      throw e
    } finally {
      saving = false
    }
  }

  async function ensureSaved() {
    if (dirty || !post.id) await save(false).catch(() => null)
    return post
  }

  async function publish() {
    if (!titleEl.value.trim()) {
      titleEl.focus()
      return toast('发布前先取个标题吧', true)
    }
    if (mdMode) await exitMdMode()
    post.status = 'published'
    try {
      await save({ status: 'published' })
      document.getElementById('ed-publish').textContent = '更新'
      toast('发布成功 🎉 点击「预览」查看文章')
    } catch (e) {
      post.status = 'draft'
      toast(e.message, true)
    }
  }

  async function unpublish() {
    post.status = 'draft'
    await save({ status: 'draft' }).catch(() => (post.status = 'published'))
    document.getElementById('ed-publish').textContent = '发布'
    toast('已转为草稿')
  }

  /* ---------- 工具栏行为 ---------- */
  function currentBlock() {
    const sel = window.getSelection()
    if (!sel || !sel.anchorNode) return null
    let n = sel.anchorNode.nodeType === Node.ELEMENT_NODE ? sel.anchorNode : sel.anchorNode.parentElement
    while (n && n !== editor) {
      if (/^(H1|H2|H3|H4|BLOCKQUOTE|P|PRE)$/.test(n.tagName)) return n
      n = n.parentElement
    }
    return null
  }

  function toggleBlock(tag) {
    editor.focus()
    const cur = currentBlock()
    if (cur && cur.tagName.toLowerCase() === tag) document.execCommand('formatBlock', false, 'p')
    else document.execCommand('formatBlock', false, tag)
    markDirty()
    refreshToolbarState()
  }

  function refreshToolbarState() {
    if (mdMode) return
    const cmds = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']
    root.querySelectorAll('[data-cmd]').forEach((b) => {
      const cmd = b.dataset.cmd
      if (cmds.includes(cmd)) {
        let on = false
        try {
          on = document.queryCommandState(cmd)
        } catch {
          on = false
        }
        b.classList.toggle('is-active', on)
      }
    })
    const cur = currentBlock()
    root.querySelectorAll('[data-block]').forEach((b) => {
      const tag = b.dataset.block
      b.classList.toggle('is-active', !!cur && cur.tagName.toLowerCase() === tag)
    })
  }

  root.querySelector('.ed-toolbar').addEventListener('mousedown', (e) => {
    // 防止工具栏抢焦点导致选区丢失
    if (e.target.closest('.ed-btn')) e.preventDefault()
  })

  root.querySelector('.ed-toolbar').addEventListener('click', async (e) => {
    const btn = e.target.closest('.ed-btn')
    if (!btn) return
    const { cmd, block, act } = btn.dataset
    if (cmd) {
      editor.focus()
      document.execCommand(cmd, false, null)
      markDirty()
      refreshToolbarState()
      return
    }
    if (block) return toggleBlock(block)
    if (act === 'codeblock') {
      const text = window.getSelection().toString() || '// 在这里写代码'
      insertHTML(`<pre><code>${esc(text)}</code></pre><p><br></p>`)
    } else if (act === 'inlinecode') {
      const text = window.getSelection().toString() || '代码'
      insertHTML(`<code>${esc(text)}</code>&nbsp;`)
    } else if (act === 'hr') {
      insertHTML('<hr><p><br></p>')
    } else if (act === 'link') {
      await linkDialog()
    } else if (act === 'image') {
      await imageDialog()
    } else if (act === 'video') {
      pickVideoFile()
    } else if (act === 'clear') {
      editor.focus()
      document.execCommand('removeFormat')
      document.execCommand('formatBlock', false, 'p')
      markDirty()
    }
    refreshToolbarState()
  })

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) refreshToolbarState()
  })

  /* ---------- 对话框们 ---------- */
  function linkDialog() {
    saveSelection()
    const selText = window.getSelection().toString()
    const m = modal(`<div class="modal-head"><span>插入链接</span><button class="modal-close" data-close>×</button></div>
      <div class="modal-body">
        <div class="auth-field"><label>链接地址</label><input class="input" id="lk-url" placeholder="https://…"></div>
        <div class="auth-field"><label>文字（留空则显示地址）</label><input class="input" id="lk-text" value="${esc(selText)}"></div>
      </div>
      <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="lk-ok">插入</button></div>`)
    m.mask.querySelector('#lk-url').focus()
    const ok = m.mask.querySelector('#lk-ok')
    const doInsert = () => {
      let url = m.mask.querySelector('#lk-url').value.trim()
      const text = m.mask.querySelector('#lk-text').value.trim()
      if (!url) return
      if (!/^(https?:\/\/|mailto:|#|\/)/i.test(url)) url = 'https://' + url
      m.close()
      restoreSelection()
      insertHTML(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text || url)}</a>&nbsp;`)
    }
    ok.addEventListener('click', doInsert)
    m.mask.addEventListener('keydown', (e) => e.key === 'Enter' && doInsert())
  }

  function imageDialog() {
    saveSelection()
    const m = modal(
      `<div class="modal-head"><span>插入图片</span><button class="modal-close" data-close>×</button></div>
      <div class="modal-body upload-dialog">
        <div class="tab-line"><button class="is-active" data-tab="up">上传到图床</button><button data-tab="url">图片地址</button></div>
        <div data-pane="up">
          <div class="upload-drop" id="up-drop">点击选择图片，或拖拽到此处<br><span style="font-size:12px;">支持 JPG / PNG / WebP / GIF，≤ 25MB</span></div>
          <div class="upload-progress" id="up-progress"><i></i></div>
        </div>
        <div data-pane="url" style="display:none;">
          <div class="auth-field"><label>图片 URL</label><input class="input" id="img-url" placeholder="https://… 或 /images/…"></div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="img-ok">插入</button></div>`,
      { large: false }
    )
    const bar = m.mask.querySelector('#up-progress i')
    const progress = m.mask.querySelector('#up-progress')
    const drop = m.mask.querySelector('#up-drop')
    const handleFiles = async (files) => {
      const list = [...files].filter((f) => /^image\//.test(f.type))
      if (!list.length) return toast('请选择图片文件', true)
      progress.classList.add('on')
      for (const f of list) {
        try {
          const d = await uploadFile(f, (p) => (bar.style.width = p + '%'))
          const w = await probeWidth(d.url)
          m.close()
          restoreSelection()
          insertHTML(`<img src="${esc(d.url)}"${w ? ` data-w="${w}"` : ''} alt="${esc(f.name.replace(/\.[^.]+$/, ''))}"><p><br></p>`)
        } catch (e) {
          toast(e.message, true)
        }
      }
    }
    drop.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/jpeg,image/png,image/webp,image/gif'
      input.multiple = true
      input.onchange = () => handleFiles(input.files)
      input.click()
    })
    drop.addEventListener('dragover', (e) => {
      e.preventDefault()
      drop.classList.add('is-over')
    })
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('is-over')
      handleFiles(e.dataTransfer.files)
    })
    m.mask.querySelectorAll('[data-tab]').forEach((t) =>
      t.addEventListener('click', () => {
        m.mask.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('is-active', x === t))
        m.mask.querySelectorAll('[data-pane]').forEach((p) => (p.style.display = p.dataset.pane === t.dataset.tab ? '' : 'none'))
      })
    )
    m.mask.querySelector('#img-ok').addEventListener('click', () => {
      const url = m.mask.querySelector('#img-url').value.trim()
      if (!url) return
      m.close()
      restoreSelection()
      insertHTML(`<img src="${esc(url)}" alt=""><p><br></p>`)
    })
  }

  function pickVideoFile() {
    saveSelection()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/mp4,video/webm'
    input.onchange = async () => {
      if (input.files[0]) await uploadAndInsert(input.files[0])
    }
    input.click()
  }

  function modal(html, opts = {}) {
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    mask.innerHTML = `<div class="modal${opts.large ? ' modal-lg' : ''}" role="dialog">${html}</div>`
    const close = () => mask.remove()
    mask.addEventListener('click', (e) => e.target === mask && close())
    mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close))
    document.body.appendChild(mask)
    return { mask, close }
  }

  /* ---------- 编辑区事件 ---------- */
  editor.addEventListener('input', () => {
    markDirty()
    updateCount()
  })
  titleEl.addEventListener('input', markDirty)
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      editor.focus()
    }
  })
  ;['ed-summary', 'ed-slug'].forEach((id) => document.getElementById(id).addEventListener('input', markDirty))
  document.getElementById('ed-pinned').addEventListener('change', markDirty)

  editor.addEventListener('paste', async (e) => {
    const cd = e.clipboardData
    if (!cd) return
    const files = [...(cd.files || [])]
    if (files.length) {
      e.preventDefault()
      for (const f of files) {
        if (/^(image|video)\//.test(f.type)) await uploadAndInsert(f)
      }
      return
    }
    const html = cd.getData('text/html')
    if (html) {
      e.preventDefault()
      saveState.textContent = '正在净化粘贴内容…'
      try {
        const d = await api('/admin/tools/sanitize', { method: 'POST', body: { html } })
        insertHTML(d.html || '')
        saveState.textContent = '粘贴完成'
      } catch {
        insertHTML(esc(cd.getData('text/plain') || ''))
      }
    }
  })

  editor.addEventListener('dragover', (e) => {
    e.preventDefault()
    editor.dataset.drag = '1'
  })
  editor.addEventListener('dragleave', () => delete editor.dataset.drag)
  editor.addEventListener('drop', async (e) => {
    e.preventDefault()
    delete editor.dataset.drag
    saveSelection()
    const files = [...(e.dataTransfer?.files || [])]
    for (const f of files) {
      if (/^(image|video)\//.test(f.type)) await uploadAndInsert(f)
    }
  })

  // 快捷键
  root.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save(false).catch(() => toast('保存失败，请重试', true))
    }
  })

  // 离开提醒
  const beforeUnload = (e) => {
    if (dirty) {
      e.preventDefault()
      e.returnValue = ''
    }
  }
  window.addEventListener('beforeunload', beforeUnload)

  /* ---------- Markdown 模式 ---------- */
  async function enterMdMode() {
    mdArea.value = htmlToMd(editor.innerHTML)
    root.querySelector('.editor-page').classList.add('ed-mode-md')
    document.getElementById('ed-md-toggle').classList.add('is-active')
    mdMode = true
  }
  async function exitMdMode() {
    const d = await api('/admin/tools/md', { method: 'POST', body: { md: mdArea.value } })
    editor.innerHTML = d.html
    root.querySelector('.editor-page').classList.remove('ed-mode-md')
    document.getElementById('ed-md-toggle').classList.remove('is-active')
    mdMode = false
    markDirty()
    updateCount()
  }
  document.getElementById('ed-md-toggle').addEventListener('click', async () => {
    try {
      if (!mdMode) await enterMdMode()
      else await exitMdMode()
    } catch (e) {
      toast(e.message, true)
    }
  })
  mdArea.addEventListener('input', markDirty)

  /* ---------- 顶栏按钮 ---------- */
  document.getElementById('ed-save').addEventListener('click', () => save(false).catch(() => {}))
  document.getElementById('ed-publish').addEventListener('click', publish)
  document.getElementById('ed-preview').addEventListener('click', async () => {
    const p = await ensureSaved()
    if (!p || !p.slug) return toast('先写点内容再预览', true)
    window.open(`/post/${p.slug}?preview=1`, '_blank')
  })
  document.getElementById('ed-check').addEventListener('click', () => {
    if (mdMode) return toast('请先退出 Markdown 模式', true)
    const issues = runChecks(editor.innerHTML)
    const warns = issues.filter((i) => i.level === 'warn').length
    const body = issues.length
      ? issues
          .map(
            (i) => `<div class="check-item">
          <span class="check-icon">${i.level === 'warn' ? '⚠️' : '💡'}</span>
          <div><div>${esc(i.msg)}</div><div class="check-rule">规范 ${esc(i.rule)}</div></div>
        </div>`
          )
          .join('')
      : '<div class="check-pass">🎉 全部通过，排版很规范！</div>'
    const m = modal(
      `<div class="modal-head"><span>排版体检报告 ${warns ? `· ${warns} 项建议修复` : ''}</span><button class="modal-close" data-close>×</button></div>
      <div class="modal-body" style="max-height:50vh;overflow:auto;">${body}
        <p style="font-size:12px;color:var(--sub);margin-top:14px;">依据《微信公众平台编辑器插件开发规范》静态检查：固定宽度、行高、height、text-align、pre、字体族、!important、嵌套层级、data-w 等。完整规范见 docs/wechat-typography-spec.md</p>
      </div>
      ${issues.some((i) => i.rule.includes('!important') || i.rule.includes('text-align')) ? '<div class="modal-foot"><button class="btn btn-primary" id="ck-fix">一键修复可自动处理项</button></div>' : ''}`,
      { large: true }
    )
    m.mask.querySelector('#ck-fix')?.addEventListener('click', () => {
      applyAutoFixes()
      m.close()
      toast('已修复，可再次体检确认')
    })
  })
  document.getElementById('ed-drawer-toggle').addEventListener('click', () => {
    document.getElementById('ed-drawer').classList.toggle('is-hidden')
  })
  document.getElementById('ed-drawer-close').addEventListener('click', () => {
    document.getElementById('ed-drawer').classList.add('is-hidden')
  })
  // 小屏下抽屉是覆盖层，编辑器打开时默认收起
  if (window.matchMedia('(max-width: 860px)').matches) {
    document.getElementById('ed-drawer').classList.add('is-hidden')
  }

  /* ---------- 封面 ---------- */
  const coverBox = document.getElementById('ed-cover-box')
  coverBox.addEventListener('click', (e) => {
    if (e.target.id === 'ed-cover-remove') {
      post.cover = ''
      coverBox.innerHTML = '＋ 上传封面图'
      markDirty()
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif'
    input.onchange = async () => {
      if (!input.files[0]) return
      try {
        const d = await uploadFile(input.files[0], null)
        post.cover = d.url
        coverBox.innerHTML = `<img src="${esc(post.cover)}"><button class="cover-remove" id="ed-cover-remove" title="移除封面">×</button>`
        coverBox.querySelector('#ed-cover-remove').addEventListener('click', (ev) => {
          ev.stopPropagation()
          post.cover = ''
          coverBox.innerHTML = '＋ 上传封面图'
          markDirty()
        })
        markDirty()
      } catch (err) {
        toast(err.message, true)
      }
    }
    input.click()
  })

  /* ---------- 标签 ---------- */
  const tagBox = document.getElementById('ed-tag-box')
  const tagInput = document.getElementById('ed-tag-input')
  function renderTags() {
    tagBox.querySelectorAll('.tag-chip').forEach((c) => c.remove())
    post.tags.forEach((t, i) => {
      const chip = document.createElement('span')
      chip.className = 'tag-chip'
      chip.innerHTML = `${esc(t)}<button type="button" title="移除">×</button>`
      chip.querySelector('button').addEventListener('click', () => {
        post.tags.splice(i, 1)
        renderTags()
        markDirty()
      })
      tagBox.insertBefore(chip, tagInput)
    })
  }
  function addTag(name) {
    name = name.trim().replace(/[,，]$/, '')
    if (!name || post.tags.includes(name) || post.tags.length >= 8) return
    post.tags.push(name)
    renderTags()
    markDirty()
  }
  tagInput.addEventListener('keydown', (e) => {
    // 输入法组词中的回车/逗号是确认拼音，不是确认标签；忽略，否则标签被提前加入，
    // 输入法提交后文本又落回输入框，看起来「重复出现」
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput.value)
      tagInput.value = ''
    } else if (e.key === 'Backspace' && !tagInput.value && post.tags.length) {
      post.tags.pop()
      renderTags()
    }
  })
  tagInput.addEventListener('blur', () => {
    if (tagInput.value.trim()) {
      addTag(tagInput.value)
      tagInput.value = ''
    }
  })
  renderTags()
  api('/admin/tags')
    .then((d) => {
      document.getElementById('tag-suggestions').innerHTML = d.tags.map((t) => `<option value="${esc(t.name)}">`).join('')
    })
    .catch(() => {})

  /* ---------- 分类下拉 ---------- */
  const catSelect = document.getElementById('ed-category')
  api('/admin/categories')
    .then((d) => {
      catSelect.innerHTML =
        '<option value="">未分类</option>' +
        d.categories.map((c) => `<option value="${c.id}"${c.id === post.categoryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')
    })
    .catch(() => {})
  catSelect.addEventListener('change', markDirty)

  /* ---------- 插件 ctx & 加载 ---------- */
  const pluginCtx = {
    insertHTML,
    getHTML: () => editor.innerHTML,
    setHTML: (h) => {
      editor.innerHTML = String(h || '')
      markDirty()
      updateCount()
    },
    exec: (cmd, val) => {
      editor.focus()
      document.execCommand(cmd, false, val || null)
      markDirty()
    },
    notify: (m) => toast(String(m || '')),
  }
  window.BlogHao = {
    version: '1.0',
    registerPlugin(p) {
      if (p && p.name && typeof p.onClick === 'function') plugins.push(p)
      renderPluginButtons(pluginCtx)
    },
    ...pluginCtx,
  }
  loadPlugins(pluginCtx)

  updateCount()
  refreshToolbarState()
  saveState.textContent = post.id ? '已加载' : '新文章，首次修改后自动保存'
  editor.focus()
}
