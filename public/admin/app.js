/* 博客号后台 SPA（原生 ES Module，无构建依赖） */
import { mountEditor } from './editor.js'

const $app = document.getElementById('app')
const $toastSlot = document.getElementById('toast-slot')

const state = {
  user: null,
  needsSetup: false,
  settings: null,
  themes: [],
}

/* ---------------- 工具 ---------------- */
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDateTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return bytes + ' B'
}

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} }
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch('/api' + path, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || '请求失败')
    err.status = res.status
    throw err
  }
  return data
}

function toast(msg, isErr = false) {
  const el = document.createElement('div')
  el.className = 'toast' + (isErr ? ' toast-err' : '')
  el.textContent = msg
  $toastSlot.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

function modal(html, opts = {}) {
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  mask.innerHTML = `<div class="modal${opts.large ? ' modal-lg' : ''}" role="dialog">${html}</div>`
  const close = () => mask.remove()
  mask.addEventListener('click', (e) => {
    if (e.target === mask) close()
  })
  mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close))
  document.body.appendChild(mask)
  return { mask, close }
}

function confirmBox(text) {
  return new Promise((resolve) => {
    const m = modal(`<div class="modal-body" style="padding:24px 20px;">${esc(text)}</div>
      <div class="modal-foot"><button class="btn" data-act="no">取消</button><button class="btn btn-primary" data-act="yes">确定</button></div>`)
    m.mask.querySelector('[data-act=no]').addEventListener('click', () => { m.close(); resolve(false) })
    m.mask.querySelector('[data-act=yes]').addEventListener('click', () => { m.close(); resolve(true) })
  })
}

/* ---------------- 图标 ---------------- */
const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  post: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 4h9l4 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5M9 13h7M9 17h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 20l1.2-3.2C3.8 15.4 3 13.5 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 19 5.5-5.5L14 17l3-3 4 4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z"/></svg>',
}

const THEME_SWATCH = {
  wechat: { bg: '#ededed', bar: '#07c160', card: '#ffffff', card2: '#e8f7ef', card3: '#f2f2f2' },
  paper: { bg: '#f7f4ee', bar: '#a03c2e', card: '#fffdf8', card2: '#efe9db', card3: '#f1ede2' },
  minimal: { bg: '#ffffff', bar: '#111111', card: '#f5f5f5', card2: '#efefef', card3: '#f7f7f7' },
  midnight: { bg: '#0f1115', bar: '#58a6ff', card: '#161a22', card2: '#1d232e', card3: '#181d26' },
}

/* ---------------- 登录 / 初始化 ---------------- */
function authView(mode) {
  const isSetup = mode === 'setup'
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">
      <img src="/favicon.svg" alt="">
      <h1>${isSetup ? '创建管理员' : '登录博客号后台'}</h1>
      <p>${isSetup ? '第一次使用，设置你的管理员账号' : esc(state.settings?.siteName || '')}</p>
    </div>
    <form id="auth-form">
      <div class="auth-field"><label>用户名</label><input class="input" name="username" autocomplete="username" placeholder="2-24 位字母数字" required></div>
      <div class="auth-field"><label>密码</label><input class="input" type="password" name="password" autocomplete="${isSetup ? 'new-password' : 'current-password'}" placeholder="${isSetup ? '至少 8 位' : '输入密码'}" required></div>
      ${isSetup ? '<div class="auth-field"><label>昵称（可选）</label><input class="input" name="displayName" placeholder="显示在文章作者位"></div>' : ''}
      <button class="btn btn-primary auth-btn" type="submit">${isSetup ? '创建并进入' : '登 录'}</button>
      <div class="auth-err" id="auth-err"></div>
    </form>
    <p class="auth-tip">住在 Cloudflare 上的小博客 · D1 存储 · R2 图床</p>
  </div></div>`
  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = e.target
    const errEl = document.getElementById('auth-err')
    errEl.textContent = ''
    try {
      const body = { username: f.username.value.trim(), password: f.password.value }
      if (isSetup) body.displayName = f.displayName.value.trim()
      const d = await api(isSetup ? '/auth/setup' : '/auth/login', { method: 'POST', body })
      state.user = d.user
      toast(isSetup ? '账号创建成功 🎉' : '欢迎回来 👋')
      location.hash = '#/'
      navigate()
    } catch (err) {
      errEl.textContent = err.message
    }
  })
}

/* ---------------- 布局骨架 ---------------- */
async function shellView(active, contentHTML) {
  const pending = state.pendingComments || 0
  $app.innerHTML = `<div class="shell">
    <aside class="sidebar">
      <div class="side-logo"><img src="/favicon.svg" alt="">博客号</div>
      <nav class="side-nav">
        <a class="side-item${active === 'home' ? ' is-active' : ''}" href="#/">${I.home}<span>概览</span></a>
        <a class="side-item${active === 'posts' ? ' is-active' : ''}" href="#/posts">${I.post}<span>文章</span></a>
        <a class="side-item${active === 'editor' ? ' is-active' : ''}" href="#/editor/new">${I.edit}<span>写作</span></a>
        <a class="side-item${active === 'comments' ? ' is-active' : ''}" href="#/comments">${I.comment}<span>评论</span>${pending ? `<span class="side-badge">${pending}</span>` : ''}</a>
        <a class="side-item${active === 'media' ? ' is-active' : ''}" href="#/media">${I.image}<span>媒体</span></a>
        <a class="side-item${active === 'settings' ? ' is-active' : ''}" href="#/settings">${I.gear}<span>设置</span></a>
      </nav>
      <div class="side-user">
        <span class="side-user-avatar">${esc((state.user.display_name || state.user.username).charAt(0).toUpperCase())}</span>
        <span class="side-user-name">${esc(state.user.display_name || state.user.username)}</span>
        <button class="side-logout" id="btn-logout">退出</button>
      </div>
    </aside>
    <main class="main">${contentHTML}</main>
  </div>`
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    state.user = null
    location.hash = '#/'
    boot()
  })
}

/* ---------------- 概览 ---------------- */
async function viewHome() {
  let s
  try {
    s = await api('/admin/stats')
  } catch (e) {
    return handleApiErr(e)
  }
  state.pendingComments = s.pendingComments
  const recent = s.recent
    .map(
      (r) => `<div class="recent-item">
        <a class="recent-title" href="#/editor/${r.id}">${esc(r.title)}</a>
        <span class="recent-meta">${r.views} 阅读 · ${fmtDateTime(r.published_at)}</span>
      </div>`
    )
    .join('')
  await shellView(
    'home',
    `<div class="page-head">
      <div><div class="page-title">概览</div><div class="page-sub">小院今天的情况</div></div>
      <a class="btn btn-primary" href="#/editor/new">✍️ 写文章</a>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">已发布文章</div><div class="stat-value">${s.posts}</div></div>
      <div class="stat-card"><div class="stat-label">总阅读</div><div class="stat-value">${s.views}</div></div>
      <div class="stat-card"><div class="stat-label">收到的赞</div><div class="stat-value">${s.likes}</div></div>
      <div class="stat-card"><div class="stat-label">待审评论</div><div class="stat-value">${s.pendingComments}<small>${s.drafts} 篇草稿</small></div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><span>最近发布</span><a class="btn btn-ghost btn-sm" href="#/posts">全部文章 →</a></div>
      <div class="panel-body">${recent || '<div class="empty-box">还没有发布过文章，点右上角开始写作吧。</div>'}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><span>媒体库</span></div>
      <div class="panel-body" style="display:flex;gap:24px;align-items:center;">
        <div><div class="stat-value" style="font-size:20px;">${s.uploads.count}<small>个文件</small></div></div>
        <div style="color:var(--sub);font-size:13px;">占用 ${fmtSize(s.uploads.bytes)} · 存于 R2 图床，全球加速</div>
      </div>
    </div>`
  )
}

/* ---------------- 文章管理 ---------------- */
async function viewPosts() {
  const hash = location.hash
  const q = new URLSearchParams(hash.split('?')[1] || '')
  const status = q.get('status') || 'all'
  const page = parseInt(q.get('page') || '1', 10)
  const kw = q.get('q') || ''

  let d
  try {
    d = await api(`/admin/posts?status=${status}&page=${page}&q=${encodeURIComponent(kw)}`)
  } catch (e) {
    return handleApiErr(e)
  }
  state.pendingComments = 0

  const rows = d.items
    .map(
      (p) => `<div class="post-row" data-id="${p.id}">
      <div class="post-main">
        <div class="post-title"><a href="#/editor/${p.id}">${esc(p.title)}</a>
          ${p.status === 'published' ? '<span class="chip chip-green">已发布</span>' : '<span class="chip chip-gray">草稿</span>'}
          ${p.pinned ? '<span class="chip chip-warn">置顶</span>' : ''}
        </div>
        <div class="post-meta">
          <span>${p.slug}</span><span>·</span><span>${p.views} 阅读</span><span>·</span><span>${p.likes} 赞</span>
          <span>·</span><span>${fmtDateTime(p.published_at || p.updated_at)}</span>
          ${p.tagList && p.tagList.length ? `<span>·</span><span>${p.tagList.map(esc).join(' / ')}</span>` : ''}
        </div>
      </div>
      <div class="post-ops">
        <a class="btn btn-ghost btn-sm" href="/post/${esc(p.slug)}" target="_blank">查看</a>
        <a class="btn btn-ghost btn-sm" href="#/editor/${p.id}">编辑</a>
        <button class="btn btn-ghost btn-sm" data-act="pin">${p.pinned ? '取消置顶' : '置顶'}</button>
        <button class="btn btn-ghost btn-sm" data-act="toggle">${p.status === 'published' ? '下架' : '发布'}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`
    )
    .join('')

  await shellView(
    'posts',
    `<div class="page-head">
      <div><div class="page-title">文章</div><div class="page-sub">共 ${d.total} 篇</div></div>
      <a class="btn btn-primary" href="#/editor/new">✍️ 写文章</a>
    </div>
    <div class="toolbar">
      <div class="tabs">
        ${['all', 'published', 'draft']
          .map((t) => `<button class="tab${t === status ? ' is-active' : ''}" data-tab="${t}">${{ all: '全部', published: '已发布', draft: '草稿' }[t]}</button>`)
          .join('')}
      </div>
      <input class="input" id="search-input" placeholder="搜索标题 / 正文…" value="${esc(kw)}">
    </div>
    <div class="panel">${rows || '<div class="empty-box">没有找到文章</div>'}</div>
    ${d.totalPages > 1 ? `<div class="pager-admin"><button class="btn btn-sm" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${d.page} / ${d.totalPages}</span><button class="btn btn-sm" id="pg-next" ${page >= d.totalPages ? 'disabled' : ''}>下一页</button></div>` : ''}`
  )

  const nav = (patch) => {
    const p = new URLSearchParams({ status, page: String(page), ...(kw ? { q: kw } : {}), ...patch })
    location.hash = '#/posts?' + p.toString()
  }
  $app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => nav({ status: b.dataset.tab, page: 1 })))
  const searchEl = document.getElementById('search-input')
  let timer
  searchEl.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => nav({ q: searchEl.value.trim(), page: 1 }), 400)
  })
  const prev = document.getElementById('pg-prev')
  const next = document.getElementById('pg-next')
  if (prev) prev.addEventListener('click', () => nav({ page: page - 1 }))
  if (next) next.addEventListener('click', () => nav({ page: page + 1 }))

  $app.querySelectorAll('.post-row').forEach((row) => {
    const id = row.dataset.id
    const post = d.items.find((p) => String(p.id) === id)
    row.querySelector('[data-act=pin]').addEventListener('click', async () => {
      await api(`/admin/posts/${id}/pin`, { method: 'POST', body: { pinned: !post.pinned } })
      toast(post.pinned ? '已取消置顶' : '已置顶')
      viewPosts()
    })
    row.querySelector('[data-act=toggle]').addEventListener('click', async () => {
      const publish = post.status !== 'published'
      await api(`/admin/posts/${id}`, { method: 'PUT', body: { ...post, status: publish ? 'published' : 'draft' } })
      toast(publish ? '已发布 🎉' : '已转为草稿')
      viewPosts()
    })
    row.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!(await confirmBox(`确定删除《${post.title}》？该操作不可恢复。`))) return
      await api(`/admin/posts/${id}`, { method: 'DELETE' })
      toast('已删除')
      viewPosts()
    })
  })
}

/* ---------------- 评论管理 ---------------- */
async function viewComments() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const status = q.get('status') || 'all'
  let d
  try {
    d = await api(`/admin/comments?status=${status}&page=${q.get('page') || 1}`)
  } catch (e) {
    return handleApiErr(e)
  }
  const rows = d.items
    .map(
      (cm) => `<div class="comment-row">
      <div class="comment-main">
        <div class="comment-meta">
          <span class="who">${esc(cm.nickname)}</span>
          ${cm.status === 'pending' ? '<span class="chip chip-warn">待审核</span>' : '<span class="chip chip-green">已展示</span>'}
          <a class="comment-post" href="/post/${esc(cm.post_slug)}#comments" target="_blank">《${esc(cm.post_title)}》</a>
          <span style="color:var(--sub);font-size:12px;">${fmtDateTime(cm.created_at)}</span>
        </div>
        <div class="comment-content">${esc(cm.content)}</div>
      </div>
      <div class="comment-ops">
        ${cm.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-act="approve">通过</button>` : `<button class="btn btn-sm" data-act="hide">隐藏</button>`}
        <button class="btn btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`
    )
    .join('')

  await shellView(
    'comments',
    `<div class="page-head"><div><div class="page-title">评论</div><div class="page-sub">共 ${d.total} 条</div></div></div>
    <div class="toolbar"><div class="tabs">
      ${['all', 'pending', 'approved']
        .map((t) => `<button class="tab${t === status ? ' is-active' : ''}" data-tab="${t}">${{ all: '全部', pending: '待审核', approved: '已展示' }[t]}</button>`)
        .join('')}
    </div></div>
    <div class="panel">${rows || '<div class="empty-box">还没有评论</div>'}</div>`
  )
  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => (location.hash = `#/comments?status=${b.dataset.tab}`))
  )
  Array.from($app.querySelectorAll('.comment-row')).forEach((row, i) => {
    const cm = d.items[i]
    row.querySelector('[data-act=approve]')?.addEventListener('click', async () => {
      await api(`/admin/comments/${cm.id}`, { method: 'PUT', body: { status: 'approved' } })
      toast('已展示')
      viewComments()
    })
    row.querySelector('[data-act=hide]')?.addEventListener('click', async () => {
      await api(`/admin/comments/${cm.id}`, { method: 'PUT', body: { status: 'pending' } })
      toast('已隐藏')
      viewComments()
    })
    row.querySelector('[data-act=del]')?.addEventListener('click', async () => {
      if (!(await confirmBox('确定删除这条评论？'))) return
      await api(`/admin/comments/${cm.id}`, { method: 'DELETE' })
      toast('已删除')
      viewComments()
    })
  })
}

/* ---------------- 媒体库 ---------------- */
async function viewMedia() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const page = parseInt(q.get('page') || '1', 10)
  let d
  try {
    d = await api(`/admin/uploads?page=${page}`)
  } catch (e) {
    return handleApiErr(e)
  }
  const grid = d.items
    .map((u) => {
      const isVideo = u.mime.startsWith('video/')
      return `<div class="media-item" data-key="${esc(u.key)}" data-url="${esc(u.url)}">
      <div class="media-thumb">
        ${isVideo ? `<video src="${esc(u.url)}" muted></video>` : `<div style="background-image:url('${esc(u.url)}');width:100%;height:100%;background-size:cover;background-position:center;"></div>`}
      </div>
      <div class="media-info">
        <div class="media-name" title="${esc(u.name)}">${esc(u.name || u.key)}</div>
        <div class="media-size">${fmtSize(u.size)} · ${fmtDateTime(u.created_at)}</div>
      </div>
    </div>`
    })
    .join('')
  await shellView(
    'media',
    `<div class="page-head">
      <div><div class="page-title">媒体库</div><div class="page-sub">存在 R2 图床 · 共 ${d.total} 个文件</div></div>
      <button class="btn btn-primary" id="media-upload">上传文件</button>
    </div>
    <div class="media-grid">${grid || '<div class="empty-box" style="grid-column:1/-1;">还没有上传过文件</div>'}</div>
    ${d.total > 24 ? `<div class="pager-admin"><button class="btn btn-sm" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} 页</span><button class="btn btn-sm" id="pg-next">下一页</button></div>` : ''}`
  )

  document.getElementById('media-upload').addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm'
    input.onchange = async () => {
      if (!input.files[0]) return
      try {
        await uploadFile(input.files[0], null)
        toast('上传成功')
        viewMedia()
      } catch (e) {
        toast(e.message, true)
      }
    }
    input.click()
  })
  $app.querySelectorAll('.media-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const key = item.dataset.key
      const m = modal(`<div class="modal-head"><span>文件详情</span><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div style="background:#f6f6f6;border-radius:8px;overflow:hidden;margin-bottom:14px;display:flex;align-items:center;justify-content:center;max-height:300px;">
            <img src="${esc(item.dataset.url)}" style="max-width:100%;max-height:300px;" onerror="this.outerHTML='<video src=&quot;${esc(item.dataset.url)}&quot; controls style=&quot;max-width:100%&quot;></video>'">
          </div>
          <label class="auth-field" style="margin-bottom:10px;"><label>访问地址</label><input class="input" readonly value="${esc(item.dataset.url)}" onclick="this.select()"></label>
        </div>
        <div class="modal-foot">
          <button class="btn btn-danger" id="mi-del">删除</button>
          <button class="btn btn-primary" id="mi-copy">复制地址</button>
        </div>`)
      m.mask.querySelector('#mi-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(location.origin + item.dataset.url).then(() => toast('已复制'))
      })
      m.mask.querySelector('#mi-del').addEventListener('click', async () => {
        if (!(await confirmBox('删除后引用它的文章将无法显示图片，确定？'))) return
        await api(`/admin/uploads?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
        toast('已删除')
        m.close()
        viewMedia()
      })
    })
  })
  const prev = document.getElementById('pg-prev')
  const next = document.getElementById('pg-next')
  if (prev) prev.addEventListener('click', () => (location.hash = `#/media?page=${page - 1}`))
  if (next) next.addEventListener('click', () => (location.hash = `#/media?page=${page + 1}`))
}

/* ---------------- 设置 ---------------- */
async function viewSettings() {
  let themes
  try {
    ;[{ settings: state.settings }, themes] = await Promise.all([api('/admin/settings'), api('/meta/themes')])
  } catch (e) {
    return handleApiErr(e)
  }
  const s = state.settings
  const themeCards = themes.themes
    .map((t) => {
      const c = THEME_SWATCH[t.id] || { bg: '#eee', bar: '#07c160', card: '#fff', card2: '#eee', card3: '#eee' }
      return `<div class="theme-card${s.theme === t.id ? ' is-active' : ''}" data-theme="${t.id}">
      <div class="theme-preview" style="background:${c.bg};">
        <div class="tp-bar" style="background:${c.bar};"></div>
        <div class="tp-card" style="background:${c.card};"></div>
        <div class="tp-card2" style="background:${c.card2};"></div>
        <div class="tp-card3" style="background:${c.card3};"></div>
      </div>
      <div class="theme-meta"><div class="theme-name"><span>${esc(t.name)}</span></div><div class="theme-desc">${esc(t.description)}</div></div>
    </div>`
    })
    .join('')

  await shellView(
    'settings',
    `<div class="page-head"><div><div class="page-title">设置</div><div class="page-sub">站点的门面和规矩</div></div>
      <button class="btn btn-primary" id="btn-save">保存全部</button></div>

    <div class="panel" style="padding:20px;">
      <div class="form-section">
        <h3>站点信息</h3>
        <div class="sec-desc">名字会出现在浏览器标题、RSS 和文章作者位</div>
        <div class="form-row">
          <div class="form-item"><label>站点名称</label><input class="input" id="st-siteName" value="${esc(s.siteName)}" maxlength="40"></div>
          <div class="form-item"><label>站点链接（用于 RSS / sitemap，如 https://blog.example.com）</label><input class="input" id="st-siteUrl" value="${esc(s.siteUrl)}" placeholder="https://"></div>
        </div>
        <div class="form-item"><label>站点描述</label><input class="input" id="st-siteDescription" value="${esc(s.siteDescription)}" maxlength="120"></div>
        <div class="form-item"><label>页脚文字</label><input class="input" id="st-footerText" value="${esc(s.footerText)}" maxlength="120"></div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>外观</h3><div class="sec-desc">选择一个主题，保存后立即生效（新增主题见 docs/THEMES.md）</div>
        <div class="settings-grid" id="theme-grid">${themeCards}</div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>评论</h3><div class="sec-desc">访客留言的规则</div>
        <div class="switch-row">
          <div><div class="switch-label">开启留言</div><div class="switch-sub">关闭后文章页隐藏留言区</div></div>
          <label class="switch"><input type="checkbox" id="st-allowComments" ${s.allowComments === '1' ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="switch-row">
          <div><div class="switch-label">留言先审后展</div><div class="switch-sub">开启后新留言需在「评论」里手动通过</div></div>
          <label class="switch"><input type="checkbox" id="st-moderateComments" ${s.moderateComments === '1' ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="form-item" style="max-width:180px;"><label>每页文章数</label><input class="input" id="st-postsPerPage" type="number" min="1" max="50" value="${esc(s.postsPerPage)}"></div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>关于页</h3><div class="sec-desc">显示在 /about，支持富文本</div>
        <textarea class="textarea" id="st-about" rows="5">${esc(s.about)}</textarea>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>账号</h3><div class="sec-desc">修改登录密码</div>
        <div class="form-row">
          <div class="form-item"><label>旧密码</label><input class="input" type="password" id="pw-old" autocomplete="current-password"></div>
          <div class="form-item"><label>新密码（至少 8 位）</label><input class="input" type="password" id="pw-new" autocomplete="new-password"></div>
          <div class="form-item" style="flex:0 0 auto;align-self:flex-end;"><button class="btn" id="btn-pw">修改密码</button></div>
        </div>
      </div>
    </div>`
  )

  $app.querySelectorAll('.theme-card').forEach((card) =>
    card.addEventListener('click', () => {
      $app.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('is-active'))
      card.classList.add('is-active')
    })
  )

  document.getElementById('btn-save').addEventListener('click', async () => {
    const g = (id) => document.getElementById(id)
    const body = {
      siteName: g('st-siteName').value.trim() || '博客号',
      siteDescription: g('st-siteDescription').value.trim(),
      siteUrl: g('st-siteUrl').value.trim(),
      footerText: g('st-footerText').value.trim(),
      theme: $app.querySelector('.theme-card.is-active')?.dataset.theme || 'wechat',
      allowComments: g('st-allowComments').checked ? '1' : '0',
      moderateComments: g('st-moderateComments').checked ? '1' : '0',
      postsPerPage: g('st-postsPerPage').value || '10',
      about: g('st-about').value,
    }
    try {
      const d = await api('/admin/settings', { method: 'PUT', body })
      state.settings = d.settings
      toast('设置已保存 ✅')
    } catch (e) {
      toast(e.message, true)
    }
  })

  document.getElementById('btn-pw').addEventListener('click', async () => {
    const oldP = document.getElementById('pw-old').value
    const newP = document.getElementById('pw-new').value
    if (!oldP || newP.length < 8) return toast('新密码至少 8 位', true)
    try {
      await api('/admin/password', { method: 'PUT', body: { oldPassword: oldP, newPassword: newP } })
      toast('密码已修改')
      document.getElementById('pw-old').value = ''
      document.getElementById('pw-new').value = ''
    } catch (e) {
      toast(e.message, true)
    }
  })
}

/* ---------------- 上传（带进度） ---------------- */
function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/upload')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
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

/* ---------------- 路由 ---------------- */
function handleApiErr(e) {
  if (e.status === 401) {
    state.user = null
    authView('login')
    return
  }
  toast(e.message || '出错了', true)
}

async function navigate() {
  const h = location.hash.replace(/^#\/?/, '')
  const [path] = h.split('?')
  const parts = path.split('/')
  const name = parts[0] || 'home'

  if (!state.user) {
    authView(state.needsSetup ? 'setup' : 'login')
    return
  }
  try {
    if (name === 'home') await viewHome()
    else if (name === 'posts') await viewPosts()
    else if (name === 'comments') await viewComments()
    else if (name === 'media') await viewMedia()
    else if (name === 'settings') await viewSettings()
    else if (name === 'editor') await viewEditor(parts[1] || 'new')
    else await viewHome()
  } catch (e) {
    handleApiErr(e)
  }
}

async function viewEditor(id) {
  // 编辑器是独立的全屏页面，不套 shell
  $app.innerHTML = '<div class="editor-page" id="editor-root"><div style="margin:auto;color:var(--sub);">加载编辑器…</div></div>'
  await mountEditor(document.getElementById('editor-root'), id === 'new' ? null : Number(id))
}

async function boot() {
  try {
    const st = await api('/auth/state')
    state.user = st.user
    state.needsSetup = st.needsSetup
  } catch {
    state.user = null
  }
  if (state.user) {
    try {
      const s = await api('/admin/settings')
      state.settings = s.settings
      document.title = `后台 - ${state.settings.siteName}`
    } catch {
      /* ignore */
    }
  }
  navigate()
}

window.addEventListener('hashchange', navigate)
boot()
