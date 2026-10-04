/* 博客号后台 SPA（原生 ES Module，无构建依赖） */
import { flushEditorSave, mountEditor } from './editor.js'

const $app = document.getElementById('app')
const $toastSlot = document.getElementById('toast-slot')

const state = {
  user: null,
  needsSetup: false,
  settings: null,
  themes: [],
}

/* 微博编辑态：null = 新建；点「编辑」后暂存，离开微博页时清空 */
let wbEditing = null

/* 文章列表搜索防抖：模块级，路由切换时清掉，防遗留回调把用户「拽回」文章页 */
let postsSearchTimer = null
/* 搜索框是否处于焦点中：重渲染后据此恢复焦点与光标 */
let searchFocused = false
/* 当前路由名（'editor' 等）：判断「离开编辑器」用 */
let currentRoute = ''

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

/** 定时徽章用短格式：当年省略年份 */
function fmtScheduleShort(ts) {
  if (!ts) return '未设时间'
  const d = new Date(ts)
  const now = new Date()
  const p = (x) => String(x).padStart(2, '0')
  const ymd = `${p(d.getMonth() + 1)}-${p(d.getDate())}`
  return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '/'}${ymd} ${p(d.getHours())}:${p(d.getMinutes())}`
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
    // 会话过期兜底：登录之后发生的 401 一律立即回登录页并提示，
    // 各操作按钮不再出现「点了没反应」的静默失败。
    // 登录/初始化时 state.user 还没值，密码错误的 401 仍走表单内的错误提示。
    const expired = res.status === 401 && !!state.user
    if (expired) {
      state.user = null
      authView('login')
      toast('登录已过期，请重新登录', true)
    }
    const err = new Error(expired ? '登录已过期，请重新登录' : data.error || '请求失败')
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
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/></svg>',
  weibo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3v4l4.5-4H21a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M8 9h9M8 13h6"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.1-2.9-.4L4 20l1.2-3.2C3.8 15.4 3 13.5 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 19 5.5-5.5L14 17l3-3 4 4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z"/></svg>',
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6-6 6 6 6"/></svg>',
}

const THEME_SWATCH = {
  wechat: { bg: '#ededed', bar: '#b23a29', card: '#ffffff', card2: '#e8f7ef', card3: '#f2f2f2' },
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
    const btn = f.querySelector('button[type=submit]')
    btn.disabled = true
    try {
      const body = { username: f.username.value.trim(), password: f.password.value }
      if (isSetup) body.displayName = f.displayName.value.trim()
      const d = await api(isSetup ? '/auth/setup' : '/auth/login', { method: 'POST', body })
      state.user = d.user
      // 登录前拿不到设置，这里补拉一次，侧栏头像等依赖设置的 UI 立即生效
      if (!state.settings) {
        try {
          state.settings = (await api('/admin/settings')).settings
        } catch {
          /* ignore */
        }
      }
      toast(isSetup ? '账号创建成功 🎉' : '欢迎回来 👋')
      location.hash = '#/'
      navigate()
    } catch (err) {
      errEl.textContent = err.message
    } finally {
      btn.disabled = false
    }
  })
}

/* ---------------- 布局骨架 ---------------- */
async function shellView(active, contentHTML) {
  const pending = state.pendingComments || 0
  const pendingLinks = state.pendingLinks || 0
  const sideMini = localStorage.getItem('admin-side') === 'mini'
  $app.innerHTML = `<div class="shell${sideMini ? ' side-mini' : ''}">
    <aside class="sidebar">
      <div class="side-logo"><img src="/favicon.svg" alt=""><span>博客号</span><button class="side-fold" id="btn-side-fold" title="${sideMini ? '展开侧栏' : '收起侧栏'}">${I.fold}</button></div>
      <nav class="side-nav">
        <a class="side-item side-item-home" href="/" target="_blank" rel="noopener" title="查看主页">${I.home}<span>查看主页</span></a>
        <a class="side-item${active === 'home' ? ' is-active' : ''}" href="#/" title="概览">${I.home}<span>概览</span></a>
        <a class="side-item${active === 'posts' ? ' is-active' : ''}" href="#/posts" title="文章">${I.post}<span>文章</span></a>
        <a class="side-item${active === 'weibo' ? ' is-active' : ''}" href="#/weibo" title="微博">${I.weibo}<span>微博</span></a>
        <a class="side-item${active === 'links' ? ' is-active' : ''}" href="#/links" title="友链">${I.link}<span>友链</span>${pendingLinks ? `<span class="side-badge">${pendingLinks}</span>` : ''}</a>
        <a class="side-item${active === 'categories' ? ' is-active' : ''}" href="#/categories" title="分类">${I.folder}<span>分类</span></a>
        <a class="side-item${active === 'editor' ? ' is-active' : ''}" href="#/editor/new" title="写作">${I.edit}<span>写作</span></a>
        <a class="side-item${active === 'comments' ? ' is-active' : ''}" href="#/comments" title="评论">${I.comment}<span>评论</span>${pending ? `<span class="side-badge">${pending}</span>` : ''}</a>
        <a class="side-item${active === 'media' ? ' is-active' : ''}" href="#/media" title="媒体">${I.image}<span>媒体</span></a>
        <a class="side-item${active === 'settings' ? ' is-active' : ''}" href="#/settings" title="设置">${I.gear}<span>设置</span></a>
      </nav>
      <div class="side-user">
        ${state.settings?.avatarUrl ? `<img class="side-user-avatar" src="${esc(state.settings.avatarUrl)}" alt="">` : `<span class="side-user-avatar">${esc((state.user.display_name || state.user.username).charAt(0).toUpperCase())}</span>`}
        <span class="side-user-name">${esc(state.user.display_name || state.user.username)}</span>
        <button class="side-logout" id="btn-logout">退出</button>
      </div>
    </aside>
    <main class="main">${contentHTML}</main>
  </div>`
  document.getElementById('btn-side-fold').addEventListener('click', (e) => {
    const mini = $app.querySelector('.shell').classList.toggle('side-mini')
    localStorage.setItem('admin-side', mini ? 'mini' : 'full')
    e.currentTarget.title = mini ? '展开侧栏' : '收起侧栏'
  })
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
  state.pendingLinks = s.pendingLinks
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

  const rows = d.items
    .map((p) => {
      const chip =
        p.status === 'published'
          ? '<span class="chip chip-green">已发布</span>'
          : p.status === 'scheduled'
            ? `<span class="chip chip-warn">定时 ${fmtScheduleShort(p.publish_at)}</span>`
            : '<span class="chip chip-gray">草稿</span>'
      return `<div class="post-row" data-id="${p.id}">
      <div class="post-main">
        <div class="post-title"><a href="#/editor/${p.id}">${esc(p.title)}</a>
          ${chip}
          ${p.pinned ? '<span class="chip chip-warn">置顶</span>' : ''}
        </div>
        <div class="post-meta">
          <span>${p.slug}</span><span>·</span><span>${p.views} 阅读</span><span>·</span><span>${p.likes} 赞</span>
          <span>·</span><span>${fmtDateTime(p.published_at || p.updated_at)}</span>
          ${p.categoryName ? `<span>·</span><span>${esc(p.categoryName)}</span>` : ''}
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
    })
    .join('')

  await shellView(
    'posts',
    `<div class="page-head">
      <div><div class="page-title">文章</div><div class="page-sub">共 ${d.total} 篇</div></div>
      <a class="btn btn-primary" href="#/editor/new">✍️ 写文章</a>
    </div>
    <div class="toolbar">
      <div class="tabs">
        ${['all', 'published', 'scheduled', 'draft']
          .map(
            (t) =>
              `<button class="tab${t === status ? ' is-active' : ''}" data-tab="${t}">${{ all: '全部', published: '已发布', scheduled: '定时', draft: '草稿' }[t]}</button>`
          )
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
  searchEl.addEventListener('focus', () => (searchFocused = true))
  searchEl.addEventListener('blur', () => (searchFocused = false))
  searchEl.addEventListener('input', () => {
    clearTimeout(postsSearchTimer)
    postsSearchTimer = setTimeout(() => nav({ q: searchEl.value.trim(), page: 1 }), 400)
  })
  // 上一轮渲染时搜索框持有焦点（连续输入触发了重渲染）：恢复焦点并把光标放到末尾
  if (searchFocused && kw) {
    searchEl.focus()
    searchEl.setSelectionRange(kw.length, kw.length)
  }
  const prev = document.getElementById('pg-prev')
  const next = document.getElementById('pg-next')
  if (prev) prev.addEventListener('click', () => nav({ page: page - 1 }))
  if (next) next.addEventListener('click', () => nav({ page: page + 1 }))

  $app.querySelectorAll('.post-row').forEach((row) => {
    const id = row.dataset.id
    const post = d.items.find((p) => String(p.id) === id)
    row.querySelector('[data-act=pin]').addEventListener('click', async () => {
      try {
        await api(`/admin/posts/${id}/pin`, { method: 'POST', body: { pinned: !post.pinned } })
        toast(post.pinned ? '已取消置顶' : '已置顶')
        viewPosts()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=toggle]').addEventListener('click', async () => {
      const publish = post.status !== 'published'
      try {
        // 定时文章点「发布」立即发出并清掉定时时间
        await api(`/admin/posts/${id}`, {
          method: 'PUT',
          body: { ...post, status: publish ? 'published' : 'draft', publishAt: publish ? null : post.publishAt ?? null },
        })
        toast(publish ? '已发布 🎉' : '已转为草稿')
        viewPosts()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!(await confirmBox(`确定删除《${post.title}》？该操作不可恢复。`))) return
      try {
        await api(`/admin/posts/${id}`, { method: 'DELETE' })
        toast('已删除')
        viewPosts()
      } catch (e) {
        toast(e.message, true)
      }
    })
  })
}

/* ---------------- 微博（随手记） ---------------- */
const WB_MAX_IMAGES = 9
const WB_MAX_CHARS = 5000

async function viewWeibo() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const page = parseInt(q.get('page') || '1', 10)
  let d
  try {
    d = await api(`/admin/weibo?page=${page}`)
  } catch (e) {
    return handleApiErr(e)
  }

  const images = wbEditing ? [...wbEditing.images] : []
  const rows = d.items
    .map(
      (w) => `<div class="wb-row" data-id="${w.id}">
      <div class="wb-row-main">
        <div class="wb-row-text">${w.content ? esc(w.content) : '<span class="dim">（无文字）</span>'}</div>
        ${w.imageList.length ? `<div class="wb-row-thumbs">${w.imageList.map((u) => `<img src="${esc(u)}" loading="lazy" alt="">`).join('')}</div>` : ''}
        <div class="wb-row-meta">
          ${w.status === 'published' ? '<span class="chip chip-green">已发布</span>' : '<span class="chip chip-gray">草稿</span>'}
          ${w.pinned ? '<span class="chip chip-warn">置顶</span>' : ''}
          ${w.imageList.length ? `<span>${w.imageList.length} 图</span><span>·</span>` : ''}
          ${(w.topicList || []).length
            ? `<span class="wb-row-topics">${w.topicList.map((t) => `<a href="/weibo?topic=${encodeURIComponent(t)}" target="_blank">#${esc(t)}</a>`).join('')}</span><span>·</span>`
            : ''}
          <span>${w.likes || 0} 赞 · ${w.commentCount || 0} 评</span>
          <span>·</span>
          <span>${fmtDateTime(w.published_at || w.updated_at)}</span>
        </div>
      </div>
      <div class="post-ops">
        <a class="btn btn-ghost btn-sm" href="/weibo" target="_blank">查看</a>
        <button class="btn btn-ghost btn-sm" data-act="edit">编辑</button>
        ${w.status === 'published' ? `<button class="btn btn-ghost btn-sm" data-act="pin">${w.pinned ? '取消置顶' : '置顶'}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-act="toggle">${w.status === 'published' ? '下架' : '发布'}</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`
    )
    .join('')

  await shellView(
    'weibo',
    `<div class="page-head"><div><div class="page-title">微博</div><div class="page-sub">随手记：短文字 + 图片，不用起标题</div></div></div>
    <div class="panel wb-composer">
      <textarea class="textarea wb-input" id="wb-content" maxlength="${WB_MAX_CHARS}" placeholder="有什么新鲜事？">${esc(wbEditing?.content || '')}</textarea>
      <div class="wb-hint">支持 ⌘/Ctrl+V 粘贴截图、把图片拖进来，或点下方「加图」；正文里写 #话题# 可归类，如 #晚餐日记#</div>
      <div class="wb-imgs" id="wb-imgs"></div>
      <div class="wb-composer-foot">
        <button class="btn btn-ghost btn-sm" id="wb-add-img" type="button">${I.image} 加图（${images.length}/${WB_MAX_IMAGES}）</button>
        <span class="wb-count" id="wb-count">${(wbEditing?.content || '').length} / ${WB_MAX_CHARS}</span>
        <span class="spacer"></span>
        ${wbEditing
          ? '<button class="btn btn-sm" id="wb-cancel" type="button">取消</button><button class="btn btn-primary btn-sm" id="wb-save" type="button">保存修改</button>'
          : '<button class="btn btn-sm" id="wb-draft" type="button">存草稿</button><button class="btn btn-primary btn-sm" id="wb-publish" type="button">发布</button>'}
      </div>
    </div>
    <div class="panel">${rows || '<div class="empty-box">还没发过微博，在上面写一条吧</div>'}</div>
    ${d.totalPages > 1 ? `<div class="pager-admin"><button class="btn btn-sm" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${d.page} / ${d.totalPages}</span><button class="btn btn-sm" id="pg-next" ${page >= d.totalPages ? 'disabled' : ''}>下一页</button></div>` : ''}`
  )

  const contentEl = document.getElementById('wb-content')
  const addImgBtn = document.getElementById('wb-add-img')
  const countEl = document.getElementById('wb-count')
  const composer = $app.querySelector('.wb-composer')

  function renderImgs() {
    const box = document.getElementById('wb-imgs')
    box.innerHTML = images
      .map(
        (u, i) => `<span class="wb-tile"><img src="${esc(u)}" alt=""><button class="wb-tile-del" data-i="${i}" type="button" title="移除">×</button></span>`
      )
      .join('')
    box.querySelectorAll('.wb-tile-del').forEach((b) =>
      b.addEventListener('click', () => {
        images.splice(Number(b.dataset.i), 1)
        renderImgs()
      })
    )
    addImgBtn.innerHTML = `${I.image} 加图（${images.length}/${WB_MAX_IMAGES}）`
  }

  /** 加图统一入口：文件选择 / 粘贴 / 拖拽共用，自动过滤非图片并尊重 9 图上限 */
  async function addImageFiles(fileList) {
    const all = [...(fileList || [])]
    const imgs = all.filter((f) => /^image\//.test(f.type))
    if (!imgs.length) {
      if (all.length) toast('只支持 JPG / PNG / WebP / GIF 图片', true)
      return
    }
    const room = WB_MAX_IMAGES - images.length
    if (room <= 0) return toast(`最多 ${WB_MAX_IMAGES} 张图`, true)
    if (imgs.length > room) toast(`最多 ${WB_MAX_IMAGES} 张图，多出的 ${imgs.length - room} 张已忽略`, true)
    const label = addImgBtn.textContent
    for (const f of imgs.slice(0, room)) {
      try {
        addImgBtn.textContent = `上传中 ${f.name.slice(0, 12)}…`
        const r = await uploadFile(await compressImage(f), null)
        images.push(r.url)
        renderImgs()
      } catch (e) {
        toast(e.message, true)
      }
    }
    addImgBtn.textContent = label
    renderImgs()
  }

  function pickImages() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif'
    input.multiple = true
    input.onchange = () => addImageFiles(input.files)
    input.click()
  }

  // 粘贴图片：光标在发布器内 ⌘/Ctrl+V 即上传（纯文本粘贴不受影响）
  composer.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])]
    if (!files.length) return
    e.preventDefault()
    await addImageFiles(files)
  })

  // 拖拽图片到发布器（拖文本进输入框仍是默认行为）
  composer.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return
    e.preventDefault()
    composer.classList.add('is-dragover')
  })
  composer.addEventListener('dragleave', () => composer.classList.remove('is-dragover'))
  composer.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    e.preventDefault()
    composer.classList.remove('is-dragover')
    await addImageFiles(files)
  })

  async function saveWeibo(status) {
    const content = contentEl.value.trim()
    if (!content && !images.length) return toast('写点什么，或者配张图吧', true)
    // 请求期间禁用全部按钮：连击会重复发微博
    const btns = ['wb-save', 'wb-publish', 'wb-draft'].map((id) => document.getElementById(id)).filter(Boolean)
    btns.forEach((b) => (b.disabled = true))
    try {
      if (wbEditing) {
        await api(`/admin/weibo/${wbEditing.id}`, { method: 'PUT', body: { content, images, status: wbEditing.status } })
        wbEditing = null
        toast('已保存')
      } else {
        await api('/admin/weibo', { method: 'POST', body: { content, images, status } })
        toast(status === 'published' ? '已发布 🎉' : '草稿已保存')
      }
      viewWeibo()
    } catch (e) {
      toast(e.message, true)
    } finally {
      // 成功时页面已重渲染（按钮是旧节点）；失败时恢复可点
      btns.forEach((b) => (b.disabled = false))
    }
  }

  renderImgs()
  if (wbEditing) window.scrollTo({ top: 0 })
  contentEl.addEventListener('input', () => (countEl.textContent = `${contentEl.value.length} / ${WB_MAX_CHARS}`))
  addImgBtn.addEventListener('click', pickImages)
  document.getElementById('wb-save')?.addEventListener('click', () => saveWeibo(wbEditing?.status || 'draft'))
  document.getElementById('wb-publish')?.addEventListener('click', () => saveWeibo('published'))
  document.getElementById('wb-draft')?.addEventListener('click', () => saveWeibo('draft'))
  document.getElementById('wb-cancel')?.addEventListener('click', () => {
    wbEditing = null
    viewWeibo()
  })

  const prev = document.getElementById('pg-prev')
  const next = document.getElementById('pg-next')
  if (prev) prev.addEventListener('click', () => (location.hash = `#/weibo?page=${page - 1}`))
  if (next) next.addEventListener('click', () => (location.hash = `#/weibo?page=${page + 1}`))

  $app.querySelectorAll('.wb-row').forEach((row) => {
    const id = Number(row.dataset.id)
    const w = d.items.find((x) => String(x.id) === String(id))
    row.querySelector('[data-act=edit]').addEventListener('click', () => {
      wbEditing = { id: w.id, content: w.content, images: [...w.imageList], status: w.status }
      viewWeibo()
    })
    row.querySelector('[data-act=pin]')?.addEventListener('click', async () => {
      try {
        await api(`/admin/weibo/${id}/pin`, { method: 'POST', body: { pinned: !w.pinned } })
        toast(w.pinned ? '已取消置顶' : '已置顶，将显示在微博页最前')
        viewWeibo()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=toggle]').addEventListener('click', async () => {
      const publish = w.status !== 'published'
      try {
        await api(`/admin/weibo/${id}`, { method: 'PUT', body: { content: w.content, images: w.imageList, status: publish ? 'published' : 'draft' } })
        toast(publish ? '已发布 🎉' : '已转为草稿')
        viewWeibo()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!(await confirmBox('确定删除这条微博？该操作不可恢复。'))) return
      try {
        await api(`/admin/weibo/${id}`, { method: 'DELETE' })
        toast('已删除')
        viewWeibo()
      } catch (e) {
        toast(e.message, true)
      }
    })
  })
}

/* ---------------- 友情链接 ---------------- */

/** 友链图标预览：有图标用图，没有用站名首字 */
function flIconHtml(icon, name) {
  if (icon) return `<span class="fl-ico"><img src="${esc(icon)}" alt=""></span>`
  const ch = (name || '链').trim().charAt(0) || '链'
  return `<span class="fl-ico fl-ico-letter" aria-hidden="true">${esc(ch)}</span>`
}

async function viewLinks() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const status = q.get('status') === 'pending' ? 'pending' : 'approved'
  let d
  try {
    d = await api(`/admin/links?status=${status}`)
  } catch (e) {
    return handleApiErr(e)
  }
  state.pendingLinks = d.pending

  const rows = d.items
    .map(
      (l) => `<div class="fl-row" data-id="${l.id}">
      ${flIconHtml(l.icon, l.name)}
      <div class="fl-main">
        <div class="fl-row-name"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>
          ${l.source === 'user' ? '<span class="chip chip-gray">访客申请</span>' : ''}
          ${status === 'pending' ? '<span class="chip chip-warn">待审核</span>' : ''}
        </div>
        <div class="fl-row-url">${esc(l.url)}</div>
        ${l.description ? `<div class="fl-row-desc">${esc(l.description)}</div>` : ''}
      </div>
      <div class="post-ops">
        ${status === 'approved'
          ? `<button class="btn btn-ghost btn-sm" data-act="up" title="上移">↑</button>
        <button class="btn btn-ghost btn-sm" data-act="down" title="下移">↓</button>
        <button class="btn btn-ghost btn-sm" data-act="icon" title="自动获取网站图标">图标</button>
        <button class="btn btn-ghost btn-sm" data-act="hide">隐藏</button>`
          : `<button class="btn btn-sm btn-primary" data-act="approve">通过</button>`}
        <button class="btn btn-ghost btn-sm" data-act="edit">编辑</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`
    )
    .join('')

  await shellView(
    'links',
    `<div class="page-head">
      <div><div class="page-title">友链</div><div class="page-sub">朋友站点互相推荐，展示在前台「友情链接」页</div></div>
      <a class="btn" href="/links" target="_blank">查看页面</a>
    </div>
    <div class="toolbar">
      <div class="tabs">
        ${['approved', 'pending']
          .map((t) => `<button class="tab${t === status ? ' is-active' : ''}" data-tab="${t}">${{ approved: '已收录', pending: '待审核' }[t]}</button>`)
          .join('')}
      </div>
      <button class="btn btn-primary" id="fl-add" style="margin-left:auto;">添加友链</button>
    </div>
    <div class="panel">${rows || (status === 'pending' ? '<div class="empty-box">没有待审核的申请</div>' : '<div class="empty-box">还没有友链，点右上角「添加友链」</div>')}</div>`
  )

  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => (location.hash = `#/links?status=${b.dataset.tab}`))
  )
  document.getElementById('fl-add').addEventListener('click', () => flModal(null))

  async function flMove(id, dir) {
    try {
      await api('/admin/links/reorder', { method: 'POST', body: { id, dir } })
      viewLinks()
    } catch (e) {
      toast(e.message, true)
    }
  }

  $app.querySelectorAll('.fl-row').forEach((row) => {
    const id = Number(row.dataset.id)
    const link = d.items.find((x) => x.id === id)
    row.querySelector('[data-act=edit]')?.addEventListener('click', () => flModal(link))
    row.querySelector('[data-act=approve]')?.addEventListener('click', async () => {
      try {
        await api(`/admin/links/${id}/approve`, { method: 'POST' })
        toast(link.icon ? '已收录 🎉' : '已收录 🎉 正在后台获取图标')
        viewLinks()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=icon]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      btn.textContent = '获取中…'
      try {
        await api(`/admin/links/${id}/refresh-icon`, { method: 'POST' })
        toast('图标已更新')
        viewLinks()
      } catch (err) {
        toast(err.message, true)
        btn.textContent = '图标'
      }
    })
    row.querySelector('[data-act=up]')?.addEventListener('click', () => flMove(id, 'up'))
    row.querySelector('[data-act=down]')?.addEventListener('click', () => flMove(id, 'down'))
    row.querySelector('[data-act=hide]')?.addEventListener('click', async () => {
      try {
        await api(`/admin/links/${id}`, { method: 'PUT', body: { ...link, status: 'pending' } })
        toast('已移回待审核')
        viewLinks()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=del]')?.addEventListener('click', async () => {
      if (!(await confirmBox(`确定删除友链「${link.name}」？`))) return
      try {
        await api(`/admin/links/${id}`, { method: 'DELETE' })
        toast('已删除')
        viewLinks()
      } catch (e) {
        toast(e.message, true)
      }
    })
  })
}

/** 添加 / 编辑友链弹窗；link 传 null 是新增 */
function flModal(link) {
  const isEdit = !!link
  const m = modal(`<div class="modal-head"><span>${isEdit ? '编辑友链' : '添加友链'}</span><button class="modal-close" data-close>×</button></div>
      <div class="modal-body">
        <label class="auth-field"><label>站点名称</label><input class="input" id="fl-name" maxlength="40" value="${esc(link?.name || '')}"></label>
        <label class="auth-field"><label>网址</label><input class="input" id="fl-url" inputmode="url" placeholder="https://" value="${esc(link?.url || '')}"></label>
        <label class="auth-field"><label>简介（一两句话，可选）</label><input class="input" id="fl-desc" maxlength="120" value="${esc(link?.description || '')}"></label>
        <div class="auth-field">
          <label>网站图标（可选：自动获取 / 上传图片 / 贴图片地址；留空则显示站名首字图标）</label>
          <div class="fav-row">
            <span id="fl-icon-slot">${flIconHtml(link?.icon || '', link?.name || '')}</span>
            <button class="btn btn-sm" id="fl-icon-fetch" type="button">自动获取</button>
            <button class="btn btn-sm" id="fl-icon-upload" type="button">上传图片</button>
            <button class="btn btn-sm btn-ghost" id="fl-icon-clear" type="button">清除</button>
            <input type="file" id="fl-icon-file" accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon" hidden>
          </div>
          <input class="input" id="fl-icon-url" inputmode="url" placeholder="也可直接贴图片地址 https://…，或把复制的图片 Ctrl+V 粘进来" style="margin-top:8px;" value="${esc(link?.icon || '')}">
          <input type="hidden" id="fl-icon" value="${esc(link?.icon || '')}">
        </div>
        ${isEdit ? `<label class="auth-field"><label>排序（数字小的靠前）</label><input class="input" id="fl-sort" type="number" min="0" value="${link.sort ?? 0}"></label>` : ''}
      </div>
      <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="fl-save">保存</button></div>`)

  const q = (sel) => m.mask.querySelector(sel)
  const renderIcon = (icon) => {
    icon = String(icon || '').trim()
    q('#fl-icon').value = icon
    q('#fl-icon-url').value = icon
    q('#fl-icon-slot').innerHTML = flIconHtml(icon, q('#fl-name').value)
  }
  m.mask.querySelector('#fl-icon-fetch').addEventListener('click', async () => {
    const url = m.mask.querySelector('#fl-url').value.trim()
    if (!url) return toast('先填网址，再自动获取图标', true)
    const btn = m.mask.querySelector('#fl-icon-fetch')
    btn.textContent = '获取中…'
    btn.disabled = true
    try {
      const r = await api('/admin/links/fetch-icon', { method: 'POST', body: { url } })
      renderIcon(r.icon)
      toast('图标已获取')
    } catch (e) {
      toast(e.message, true)
    }
    btn.textContent = '自动获取'
    btn.disabled = false
  })
  // 手动贴图片地址：实时同步预览
  q('#fl-icon-url').addEventListener('input', (e) => {
    const icon = e.target.value.trim()
    q('#fl-icon').value = icon
    q('#fl-icon-slot').innerHTML = flIconHtml(icon, q('#fl-name').value)
  })
  // 本地上传图标，走 R2 图床
  const iconFile = q('#fl-icon-file')
  const iconUploadBtn = q('#fl-icon-upload')
  iconUploadBtn.addEventListener('click', () => iconFile.click())
  iconFile.addEventListener('change', async () => {
    const file = iconFile.files[0]
    if (!file) return
    iconUploadBtn.textContent = '上传中…'
    iconUploadBtn.disabled = true
    try {
      const d = await uploadFile(await compressImage(file), null)
      renderIcon(d.url)
      toast('图标已上传')
    } catch (e) {
      toast(e.message, true)
    }
    iconUploadBtn.textContent = '上传图片'
    iconUploadBtn.disabled = false
    iconFile.value = ''
  })
  // 在弹窗里直接粘贴截图 / 复制的图片，自动传图床
  m.mask.addEventListener('paste', async (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    iconUploadBtn.textContent = '上传中…'
    iconUploadBtn.disabled = true
    try {
      const d = await uploadFile(await compressImage(file), null)
      renderIcon(d.url)
      toast('图片已上传')
    } catch (err) {
      toast(err.message, true)
    }
    iconUploadBtn.textContent = '上传图片'
    iconUploadBtn.disabled = false
  })
  m.mask.querySelector('#fl-icon-clear').addEventListener('click', () => renderIcon(''))
  m.mask.querySelector('#fl-save').addEventListener('click', async () => {
    const icon = m.mask.querySelector('#fl-icon').value.trim()
    if (icon && !icon.startsWith('/images/') && !/^https?:\/\//i.test(icon)) {
      return toast('图标地址要以 https:// 开头，或直接上传 / 粘贴图片', true)
    }
    const body = {
      name: m.mask.querySelector('#fl-name').value.trim(),
      url: m.mask.querySelector('#fl-url').value.trim(),
      description: m.mask.querySelector('#fl-desc').value.trim(),
      icon,
      status: link ? link.status : 'approved',
      sort: isEdit ? Number(m.mask.querySelector('#fl-sort').value) || 0 : 0,
    }
    if (!body.name || !body.url) return toast('站名和网址不能为空', true)
    const saveBtn = m.mask.querySelector('#fl-save')
    saveBtn.disabled = true
    try {
      if (isEdit) await api(`/admin/links/${link.id}`, { method: 'PUT', body })
      else await api('/admin/links', { method: 'POST', body })
      toast('已保存')
      m.close()
      viewLinks()
    } catch (e) {
      toast(e.message, true)
      saveBtn.disabled = false
    }
  })
}

/* ---------------- 分类管理 ---------------- */
async function viewCategories() {
  let d, t
  try {
    ;[d, t] = await Promise.all([api('/admin/categories'), api('/admin/tags')])
  } catch (e) {
    return handleApiErr(e)
  }
  const rows = d.categories
    .map(
      (c) => `<div class="cat-row" data-id="${c.id}">
      <div class="cat-main">
        <span class="cat-name">${esc(c.name)}</span>
        <span class="cat-slug">/category/${esc(c.slug)} · ${c.post_count ?? 0} 篇</span>
      </div>
      <div class="post-ops">
        <button class="btn btn-ghost btn-sm" data-act="edit">编辑</button>
        <button class="btn btn-ghost btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`
    )
    .join('')
  const tagChips = t.tags
    .map(
      (tg) => `<span class="tag-manage-item" data-name="${esc(tg.name)}">
      <span class="tag-manage-name">${esc(tg.name)}</span><i>${tg.count}</i>
      <button class="tag-manage-del" data-act="del-tag" title="删除标签">×</button>
    </span>`
    )
    .join('')

  await shellView(
    'categories',
    `<div class="page-head"><div><div class="page-title">分类</div><div class="page-sub">文章的大归类，与随手的标签互补</div></div></div>
    <div class="toolbar">
      <input class="input" id="cat-name" placeholder="新分类名称，如：生活随笔" maxlength="20">
      <button class="btn btn-primary" id="cat-add">添加分类</button>
    </div>
    <div class="panel">${rows || '<div class="empty-box">还没有分类，添加一个吧</div>'}</div>
    <div class="panel">
      <div class="panel-head"><span>标签</span><span class="panel-head-sub">共 ${t.tags.length} 个 · 可预建标签，删除会从所有文章移除</span></div>
      <div class="panel-body">
        <div class="toolbar" style="margin-bottom:12px;">
          <input class="input" id="tag-name" placeholder="新标签名称，回车或点添加" maxlength="20">
          <button class="btn btn-primary" id="tag-add">添加标签</button>
        </div>
        <div class="tag-manage-list">${tagChips || '<div class="empty-box" style="padding:20px 0;">还没有标签，在写文章时添加，或在这里预建</div>'}</div>
      </div>
    </div>`
  )

  document.getElementById('cat-add').addEventListener('click', async () => {
    const el = document.getElementById('cat-name')
    const name = el.value.trim()
    if (!name) return toast('先填个分类名', true)
    const btn = document.getElementById('cat-add')
    btn.disabled = true
    try {
      await api('/admin/categories', { method: 'POST', body: { name } })
      toast('分类已创建')
      viewCategories()
    } catch (e) {
      toast(e.message, true)
      btn.disabled = false
    }
  })

  const addTag = async () => {
    const el = document.getElementById('tag-name')
    const name = el.value.trim()
    if (!name) return toast('先填个标签名', true)
    const btn = document.getElementById('tag-add')
    btn.disabled = true
    try {
      await api('/admin/tags', { method: 'POST', body: { name } })
      toast('标签已创建')
      viewCategories()
    } catch (e) {
      toast(e.message, true)
      btn.disabled = false
    }
  }
  document.getElementById('tag-add').addEventListener('click', addTag)
  document.getElementById('tag-name').addEventListener('keydown', (e) => {
    // 输入法组词回车（确认候选词）不建标签，与编辑器里同一处理
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') addTag()
  })

  $app.querySelectorAll('.tag-manage-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.closest('.tag-manage-item').dataset.name
      if (!(await confirmBox(`删除标签「${name}」？它会从所有文章中被移除。`))) return
      try {
        await api(`/admin/tags/${encodeURIComponent(name)}`, { method: 'DELETE' })
        toast('标签已删除')
        viewCategories()
      } catch (e) {
        toast(e.message, true)
      }
    })
  })

  $app.querySelectorAll('.cat-row').forEach((row) => {
    const id = Number(row.dataset.id)
    const cat = d.categories.find((c) => c.id === id)
    row.querySelector('[data-act=edit]').addEventListener('click', () => {
      const m = modal(`<div class="modal-head"><span>编辑分类</span><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <label class="auth-field"><label>名称</label><input class="input" id="cat-edit-name" value="${esc(cat.name)}" maxlength="20"></label>
          <label class="auth-field" style="margin-top:10px;"><label>链接标识（字母 / 数字 / 中文 / 短横线）</label><input class="input" id="cat-edit-slug" value="${esc(cat.slug)}"></label>
        </div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="cat-edit-save">保存</button></div>`)
      m.mask.querySelector('#cat-edit-save').addEventListener('click', async () => {
        try {
          await api(`/admin/categories/${id}`, {
            method: 'PUT',
            body: {
              name: m.mask.querySelector('#cat-edit-name').value.trim(),
              slug: m.mask.querySelector('#cat-edit-slug').value.trim(),
            },
          })
          toast('已保存')
          m.close()
          viewCategories()
        } catch (e) {
          toast(e.message, true)
        }
      })
    })
    row.querySelector('[data-act=del]').addEventListener('click', async () => {
      if (!(await confirmBox(`删除分类「${cat.name}」？其下文章会变为未分类，文章本身不受影响。`))) return
      try {
        await api(`/admin/categories/${id}`, { method: 'DELETE' })
        toast('已删除')
        viewCategories()
      } catch (e) {
        toast(e.message, true)
      }
    })
  })
}

/* ---------------- 评论管理 ---------------- */
async function viewComments() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const status = q.get('status') || 'all'
  const type = q.get('type') || 'all'
  const page = parseInt(q.get('page') || '1', 10)
  let d
  try {
    d = await api(`/admin/comments?type=${type}&status=${status}&page=${page}`)
  } catch (e) {
    return handleApiErr(e)
  }
  // 后端返回全局待审数：审核操作后侧栏「评论」角标随之刷新
  state.pendingComments = d.pending ?? 0
  const totalPages = Math.max(1, Math.ceil(d.total / 20))
  const rows = d.items
    .map((cm) => {
      const wbText = String(cm.weibo_content || '').replace(/\s+/g, ' ').trim()
      const wbShort = wbText.length > 16 ? wbText.slice(0, 16) + '…' : wbText
      const typeChip = cm.post_id ? '文章' : cm.weibo_id ? '微博' : '留言板'
      const target = cm.post_id
        ? `<a class="comment-post" href="/post/${esc(cm.post_slug)}#comments" target="_blank">《${esc(cm.post_title)}》</a>`
        : cm.weibo_id
          ? `<a class="comment-post" href="/weibo#wb-${cm.weibo_id}" target="_blank">微博${wbShort ? ` · ${esc(wbShort)}` : ''}</a>`
          : `<a class="comment-post" href="/guestbook" target="_blank">留言板</a>`
      return `<div class="comment-row">
      <div class="comment-main">
        <div class="comment-meta">
          <span class="who">${esc(cm.nickname)}</span>
          ${Number(cm.is_admin) ? '<span class="chip chip-green">作者</span>' : ''}
          ${cm.status === 'pending' ? '<span class="chip chip-warn">待审核</span>' : '<span class="chip chip-green">已展示</span>'}
          <span class="chip chip-gray">${typeChip}</span>
          ${target}
          ${cm.parent_nickname ? `<span class="chip chip-gray">回复 @${esc(cm.parent_nickname)}</span>` : ''}
          <span style="color:var(--sub);font-size:12px;">${fmtDateTime(cm.created_at)}</span>
        </div>
        <div class="comment-content">${esc(cm.content)}</div>
        <div class="comment-reply" hidden>
          <textarea class="textarea" rows="2" placeholder="以作者身份回复，前台会带「作者」徽标…"></textarea>
          <div class="comment-reply-ops"><button class="btn btn-sm btn-primary" data-act="send-reply">发送回复</button></div>
        </div>
      </div>
      <div class="comment-ops">
        <button class="btn btn-sm" data-act="reply">回复</button>
        ${cm.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-act="approve">通过</button>` : `<button class="btn btn-sm" data-act="hide">隐藏</button>`}
        <button class="btn btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`
    })
    .join('')

  const nav = (patch) => {
    const p = new URLSearchParams({ type, status, ...patch })
    location.hash = '#/comments?' + p.toString()
  }
  await shellView(
    'comments',
    `<div class="page-head"><div><div class="page-title">评论</div><div class="page-sub">共 ${d.total} 条</div></div></div>
    <div class="toolbar">
      <div class="tabs">
        ${['all', 'post', 'weibo', 'guestbook']
          .map((t) => `<button class="tab${t === type ? ' is-active' : ''}" data-type="${t}">${{ all: '全部', post: '文章评论', weibo: '微博评论', guestbook: '留言板' }[t]}</button>`)
          .join('')}
      </div>
      <div class="tabs">
        ${['all', 'pending', 'approved']
          .map((t) => `<button class="tab${t === status ? ' is-active' : ''}" data-tab="${t}">${{ all: '全部状态', pending: '待审核', approved: '已展示' }[t]}</button>`)
          .join('')}
      </div>
    </div>
    <div class="panel">${rows || '<div class="empty-box">还没有评论</div>'}</div>
    ${totalPages > 1 ? `<div class="pager-admin"><button class="btn btn-sm" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>${page} / ${totalPages} 页</span><button class="btn btn-sm" id="pg-next" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div>` : ''}`
  )
  $app.querySelectorAll('[data-type]').forEach((b) =>
    b.addEventListener('click', () => nav({ type: b.dataset.type, page: 1 }))
  )
  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => nav({ status: b.dataset.tab, page: 1 }))
  )
  const pgPrev = document.getElementById('pg-prev')
  const pgNext = document.getElementById('pg-next')
  if (pgPrev) pgPrev.addEventListener('click', () => nav({ page: page - 1 }))
  if (pgNext) pgNext.addEventListener('click', () => nav({ page: page + 1 }))
  Array.from($app.querySelectorAll('.comment-row')).forEach((row, i) => {
    const cm = d.items[i]
    row.querySelector('[data-act=reply]')?.addEventListener('click', () => {
      const box = row.querySelector('.comment-reply')
      if (!box) return
      box.hidden = !box.hidden
      if (!box.hidden) box.querySelector('textarea').focus()
    })
    row.querySelector('[data-act=send-reply]')?.addEventListener('click', async () => {
      const box = row.querySelector('.comment-reply')
      const content = box.querySelector('textarea').value.trim()
      if (!content) return toast('先写点回复内容', true)
      const sendBtn = box.querySelector('[data-act=send-reply]')
      sendBtn.disabled = true
      try {
        await api(`/admin/comments/${cm.id}/replies`, { method: 'POST', body: { content } })
        toast('已回复')
        viewComments()
      } catch (e) {
        toast(e.message, true)
        sendBtn.disabled = false
      }
    })
    row.querySelector('[data-act=approve]')?.addEventListener('click', async () => {
      try {
        await api(`/admin/comments/${cm.id}`, { method: 'PUT', body: { status: 'approved' } })
        toast('已展示')
        viewComments()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=hide]')?.addEventListener('click', async () => {
      try {
        await api(`/admin/comments/${cm.id}`, { method: 'PUT', body: { status: 'pending' } })
        toast('已隐藏')
        viewComments()
      } catch (e) {
        toast(e.message, true)
      }
    })
    row.querySelector('[data-act=del]')?.addEventListener('click', async () => {
      if (!(await confirmBox('删除这条评论？它的回复也会一并删除。'))) return
      try {
        await api(`/admin/comments/${cm.id}`, { method: 'DELETE' })
        toast('已删除')
        viewComments()
      } catch (e) {
        toast(e.message, true)
      }
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
    ${
      d.total > 24
        ? (() => {
            const totalPages = Math.ceil(d.total / 24)
            return `<div class="pager-admin"><button class="btn btn-sm" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button><span>第 ${page} / ${totalPages} 页</span><button class="btn btn-sm" id="pg-next" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div>`
          })()
        : ''
    }`
  )

  document.getElementById('media-upload').addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm'
    input.onchange = async () => {
      if (!input.files[0]) return
      try {
        await uploadFile(await compressImage(input.files[0]), null)
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
        try {
          await api(`/admin/uploads?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
          toast('已删除')
          m.close()
          viewMedia()
        } catch (e) {
          toast(e.message, true)
        }
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
      const c = THEME_SWATCH[t.id] || { bg: '#eee', bar: '#b23a29', card: '#fff', card2: '#eee', card3: '#eee' }
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
        <div class="form-item">
          <label>站点头像（显示在首页刊头、微博与后台，圆形/方角由主题决定）</label>
          <div class="fav-row">
            <span id="avatar-preview-slot">${s.avatarUrl ? `<img class="avatar-preview" src="${esc(s.avatarUrl)}" alt="站点头像">` : '<span class="fav-empty">未设置，显示站名首字</span>'}</span>
            <button class="btn btn-sm" id="btn-avatar-upload" type="button">上传头像</button>
            <button class="btn btn-sm btn-ghost" id="btn-avatar-clear" type="button">恢复默认</button>
          </div>
          <input type="hidden" id="st-avatarUrl" value="${esc(s.avatarUrl || '')}">
        </div>
        <div class="form-item">
          <label>网站图标（浏览器标签页小图，PNG / ICO / WebP，存 R2 图床）</label>
          <div class="fav-row">
            <span id="fav-preview-slot">${s.faviconUrl ? `<img class="fav-preview" src="${esc(s.faviconUrl)}" alt="站点图标">` : '<span class="fav-empty">未设置，使用默认图标</span>'}</span>
            <button class="btn btn-sm" id="btn-fav-upload" type="button">上传图标</button>
            <button class="btn btn-sm btn-ghost" id="btn-fav-clear" type="button">恢复默认</button>
          </div>
          <input type="hidden" id="st-faviconUrl" value="${esc(s.faviconUrl || '')}">
        </div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>外观</h3><div class="sec-desc">选择一个主题，保存后立即生效（新增主题见 docs/THEMES.md）</div>
        <div class="settings-grid" id="theme-grid">${themeCards}</div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>评论</h3><div class="sec-desc">访客留言的规则（文章、微博与留言板通用）</div>
        <div class="switch-row">
          <div><div class="switch-label">开启留言</div><div class="switch-sub">关闭后文章页与留言板隐藏留言区</div></div>
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
      <div class="form-section"><h3>外部发布</h3><div class="sec-desc">用 Telegram 机器人或开放 API 远程发微博（文字 / 图片 / 相册都可以）</div>
        <div class="form-item">
          <label>API Token（开放接口密钥，重新生成后旧 Token 立即失效）</label>
          <div class="fav-row">
            <input class="input" id="st-externalToken" readonly style="flex:1;min-width:200px;font-family:ui-monospace,monospace;" value="${esc(s.externalToken || '')}" placeholder="未生成，点右侧按钮" onclick="this.select()">
            <button class="btn btn-sm" id="btn-token-gen" type="button">${s.externalToken ? '重新生成' : '生成 Token'}</button>
            <button class="btn btn-sm btn-ghost" id="btn-token-copy" type="button" ${s.externalToken ? '' : 'disabled'}>复制</button>
          </div>
          <div class="sec-desc" style="margin-top:6px;">接口：<code>POST ${esc(location.origin)}/api/external/weibo</code>，用法见 docs/GUIDE.md 第 8 节</div>
        </div>
        <div class="form-item">
          <label>Telegram Bot Token（找 @BotFather 发 /newbot 创建机器人后获得）</label>
          <input class="input" id="st-telegramBotToken" placeholder="123456789:AA…" autocomplete="off" value="${esc(s.telegramBotToken || '')}">
        </div>
        <div class="form-item">
          <label>允许发布的 Chat ID（逗号分隔；给机器人发 /start 可查看自己的 ID）</label>
          <input class="input" id="st-telegramAllowFrom" placeholder="如 123456789" value="${esc(s.telegramAllowFrom || '')}">
        </div>
        <div class="switch-row">
          <div><div class="switch-label">新留言推送到 Telegram</div><div class="switch-sub">文章 / 微博 / 留言板有新留言时推送到白名单第一个 Chat ID（需先填 Bot Token 并设置 Webhook）</div></div>
          <label class="switch"><input type="checkbox" id="st-notifyNewComment" ${s.notifyNewComment === '1' ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="fav-row">
          <button class="btn" id="btn-tg-webhook" type="button">保存并一键设置 Webhook</button>
          <span class="sec-desc" id="tg-webhook-status"></span>
        </div>
        <div class="sec-desc" style="margin-top:6px;">设置好后在 Telegram 给机器人发文字 / 图片即可发微博；相册多图自动合并成一条；消息开头写 /draft 存草稿</div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>订阅与备份</h3><div class="sec-desc">把内容完整地交给订阅者，把数据完整地交回自己</div>
        <div class="switch-row">
          <div><div class="switch-label">RSS 输出全文</div><div class="switch-sub">开启后订阅器（Follow / NetNewsWire 等）不点开就能读完；关闭则只输出摘要</div></div>
          <label class="switch"><input type="checkbox" id="st-rssFullText" ${s.rssFullText === '1' ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="switch-row">
          <div><div class="switch-label">每晚自动备份</div><div class="switch-sub">每天北京时间 00:30 把数据库全量快照存进 R2 图床的 backups/ 目录，滚动保留最近 30 份</div></div>
          <label class="switch"><input type="checkbox" id="st-backupEnabled" ${s.backupEnabled === '1' ? 'checked' : ''}><span class="track"></span></label>
        </div>
        <div class="fav-row">
          <button class="btn" id="btn-backup-now" type="button">立即备份</button>
          <span class="sec-desc" id="backup-status">${s.lastBackupAt ? `上次备份：${esc(fmtDateTime(Number(s.lastBackupAt)))}${s.lastBackupBytes ? ' · ' + fmtSize(Number(s.lastBackupBytes)) : ''}` : '从未备份过，点右侧按钮试一次'}</span>
        </div>
      </div>
    </div>

    <div class="panel" style="padding:20px;">
      <div class="form-section"><h3>关于我</h3><div class="sec-desc">显示在 /about（顶部导航「关于我」页），支持富文本</div>
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

  function renderFavSlot(url) {
    document.getElementById('fav-preview-slot').innerHTML = url
      ? `<img class="fav-preview" src="${esc(url)}" alt="站点图标">`
      : '<span class="fav-empty">未设置，使用默认图标</span>'
  }

  function renderAvatarSlot(url) {
    document.getElementById('avatar-preview-slot').innerHTML = url
      ? `<img class="avatar-preview" src="${esc(url)}" alt="站点头像">`
      : '<span class="fav-empty">未设置，显示站名首字</span>'
  }

  document.getElementById('btn-avatar-upload').addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/gif'
    input.onchange = async () => {
      if (!input.files[0]) return
      try {
        const d = await uploadFile(await compressImage(input.files[0]))
        document.getElementById('st-avatarUrl').value = d.url
        renderAvatarSlot(d.url)
        toast('头像已上传，记得点「保存全部」生效')
      } catch (e) {
        toast(e.message, true)
      }
    }
    input.click()
  })
  document.getElementById('btn-avatar-clear').addEventListener('click', () => {
    document.getElementById('st-avatarUrl').value = ''
    renderAvatarSlot('')
    toast('已恢复默认，记得点「保存全部」生效')
  })

  document.getElementById('btn-fav-upload').addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico,.png'
    input.onchange = async () => {
      if (!input.files[0]) return
      try {
        const d = await uploadFile(await compressImage(input.files[0]))
        document.getElementById('st-faviconUrl').value = d.url
        renderFavSlot(d.url)
        toast('图标已上传，记得点「保存全部」生效')
      } catch (e) {
        toast(e.message, true)
      }
    }
    input.click()
  })
  document.getElementById('btn-fav-clear').addEventListener('click', () => {
    document.getElementById('st-faviconUrl').value = ''
    renderFavSlot('')
    toast('已恢复默认，记得点「保存全部」生效')
  })

  document.getElementById('btn-save').addEventListener('click', async (e) => {
    const g = (id) => document.getElementById(id)
    const btn = e.currentTarget
    btn.disabled = true
    const body = {
      siteName: g('st-siteName').value.trim() || '博客号',
      siteDescription: g('st-siteDescription').value.trim(),
      siteUrl: g('st-siteUrl').value.trim(),
      footerText: g('st-footerText').value.trim(),
      faviconUrl: g('st-faviconUrl').value.trim(),
      avatarUrl: g('st-avatarUrl').value.trim(),
      theme: $app.querySelector('.theme-card.is-active')?.dataset.theme || 'wechat',
      allowComments: g('st-allowComments').checked ? '1' : '0',
      moderateComments: g('st-moderateComments').checked ? '1' : '0',
      postsPerPage: g('st-postsPerPage').value || '10',
      telegramBotToken: g('st-telegramBotToken').value.trim(),
      telegramAllowFrom: g('st-telegramAllowFrom').value.trim(),
      notifyNewComment: g('st-notifyNewComment').checked ? '1' : '0',
      rssFullText: g('st-rssFullText').checked ? '1' : '0',
      backupEnabled: g('st-backupEnabled').checked ? '1' : '0',
      about: g('st-about').value,
    }
    try {
      const d = await api('/admin/settings', { method: 'PUT', body })
      state.settings = d.settings
      toast('设置已保存 ✅')
    } catch (e) {
      toast(e.message, true)
    } finally {
      btn.disabled = false
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

  const tokenInput = document.getElementById('st-externalToken')
  document.getElementById('btn-token-gen').addEventListener('click', async () => {
    if (tokenInput.value && !(await confirmBox('重新生成后旧 Token 立即失效，已配置的外部工具需要更换新 Token。确定？'))) return
    try {
      const d = await api('/admin/external/token', { method: 'POST' })
      tokenInput.value = d.token
      document.getElementById('btn-token-copy').disabled = false
      toast('Token 已生成并保存，同步给外部工具即可使用')
    } catch (e) {
      toast(e.message, true)
    }
  })
  document.getElementById('btn-token-copy').addEventListener('click', () => {
    if (!tokenInput.value) return
    navigator.clipboard.writeText(tokenInput.value).then(() => toast('已复制'))
  })

  document.getElementById('btn-tg-webhook').addEventListener('click', async () => {
    const btn = document.getElementById('btn-tg-webhook')
    const statusEl = document.getElementById('tg-webhook-status')
    const botToken = document.getElementById('st-telegramBotToken').value.trim()
    if (!botToken) return toast('先填写 Telegram Bot Token', true)
    btn.disabled = true
    btn.textContent = '设置中…'
    try {
      // 先落库两项 Telegram 配置，再让服务端校验 Token 并调 setWebhook
      await api('/admin/settings', { method: 'PUT', body: { telegramBotToken: botToken, telegramAllowFrom: document.getElementById('st-telegramAllowFrom').value.trim() } })
      state.settings.telegramBotToken = botToken
      const d = await api('/admin/external/telegram/webhook', { method: 'POST' })
      statusEl.textContent = `✅ 已绑定 ${d.bot}`
      toast('Webhook 设置成功，去 Telegram 给机器人发 /start 试试')
    } catch (e) {
      toast(e.message, true)
    }
    btn.disabled = false
    btn.textContent = '保存并一键设置 Webhook'
  })

  document.getElementById('btn-backup-now').addEventListener('click', async () => {
    const btn = document.getElementById('btn-backup-now')
    const statusEl = document.getElementById('backup-status')
    btn.disabled = true
    btn.textContent = '备份中…'
    try {
      const d = await api('/admin/backup', { method: 'POST' })
      if (d.skipped) {
        statusEl.textContent = '自动备份开关已关闭，先打开再备份'
        toast('自动备份开关已关闭', true)
      } else {
        statusEl.textContent = `上次备份：${fmtDateTime(Date.now())} · ${fmtSize(d.bytes || 0)}`
        toast('备份完成，已存进 R2 的 backups/ 目录 ✅')
      }
    } catch (e) {
      toast(e.message, true)
    }
    btn.disabled = false
    btn.textContent = '立即备份'
  })
}

/* ---------------- 上传（带进度） ----------------
 * 上传前自动压缩（与编辑器同参数）：JPEG/PNG/WebP 超 300KB 或超 2000px 时压成 JPEG（PNG 透明保 PNG）；
 * GIF 动图会压丢帧，原样直传。失败回退原文件。 */
const IMG_COMPRESS = { MAX_DIM: 2000, MIN_BYTES: 300 * 1024, QUALITY: 0.82 }

function hasAlphaSampled(bmp) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d')
  ctx.drawImage(bmp, 0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return d[3] < 250
}

async function compressImage(file) {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= IMG_COMPRESS.MIN_BYTES) return file
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, IMG_COMPRESS.MAX_DIM / Math.max(bmp.width, bmp.height))
    const toJpeg = file.type !== 'image/png' || !hasAlphaSampled(bmp)
    if (scale >= 1 && !toJpeg) return file
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise((r) => cv.toBlob(r, toJpeg ? 'image/jpeg' : 'image/png', IMG_COMPRESS.QUALITY))
    bmp.close?.()
    if (!blob || blob.size >= file.size) return file
    const name = (file.name || 'image').replace(/\.[^.]+$/, '') + (toJpeg ? '.jpg' : '.png')
    return new File([blob], name, { type: toJpeg ? 'image/jpeg' : 'image/png' })
  } catch {
    return file
  }
}

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
  clearTimeout(postsSearchTimer)
  // 离开编辑器：有未保存修改先自动保存再切页（此时编辑器 DOM 还在，能取到最新内容）；
  // 保存失败只提示不阻塞导航，避免把用户困在编辑器里
  if (currentRoute === 'editor' && name !== 'editor') {
    await flushEditorSave().catch(() => toast('离开时自动保存失败，内容可能没存上，请回去检查', true))
  }
  if (name !== 'weibo') wbEditing = null

  if (!state.user) {
    authView(state.needsSetup ? 'setup' : 'login')
    return
  }
  try {
    if (name === 'home') await viewHome()
    else if (name === 'posts') await viewPosts()
    else if (name === 'weibo') await viewWeibo()
    else if (name === 'links') await viewLinks()
    else if (name === 'categories') await viewCategories()
    else if (name === 'comments') await viewComments()
    else if (name === 'media') await viewMedia()
    else if (name === 'settings') await viewSettings()
    else if (name === 'editor') await viewEditor(parts[1] || 'new')
    else await viewHome()
  } catch (e) {
    currentRoute = name
    handleApiErr(e)
    return
  }
  currentRoute = name
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
