/**
 * 链接卡片（编辑器「插入链接」的卡片风格）
 *
 * 编辑器插入卡片链接时选择「卡片」，先调 /api/admin/tools/linkmeta 抓取目标页的
 * title / description / og:image，再由编辑器把 linkCardHtml() 产出的结构化 HTML
 * 插进正文。卡片本质是一个带 data-link-card 的 <a>（内部 div/img 布局），
 * 存库后走 sanitizeHtml 白名单（div/img/a 本就放行，data-* 走 GLOBAL_ATTRS 扩展），
 * 前台样式由六主题的 .rich .link-card 段渲染——抓不到元数据时退化为标题 + 域名的占位卡。
 *
 * SSRF 约束：只抓 http(s) 公网地址（私有网段 / 非常规端口一律拒绝），
 * 限长限时，解析异常静默返回空元数据（卡片退化为占位，不阻塞插入）。
 */

export interface LinkMeta {
  title: string
  description: string
  image: string
  siteName: string
}

const FETCH_TIMEOUT_MS = 8_000
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 私有/保留网段：Workers 出口公网无此场景，防御的是自托管（docker-poc）部署 */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true
  }
  return false
}

/** 只放行 http(s) 公网地址；返回 null 表示不可抓（调用方让卡片退化为纯超链接口径） */
export function fetchableUrl(raw: string): URL | null {
  const t = raw.replace(/[\t\r\n]/g, '').trim()
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null
  if (isPrivateHost(u.hostname)) return null
  if (u.port && !/^(80|443|8080|8443)$/.test(u.port)) return null
  return u
}

/** 与 collect.ts 同口径的轻量实体解码（og:title 常含 &quot; 等实体；未知实体原样保留） */
function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9a-fA-F]+);/g, (whole, code: string) => {
    if (code === 'amp') return '&'
    if (code === 'lt') return '<'
    if (code === 'gt') return '>'
    if (code === 'quot') return '"'
    if (code === 'apos') return "'"
    const n = code.startsWith('#x') || code.startsWith('#X') ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : whole
  })
}

/** 从 meta 标签里取 content（property/name 两认，单双引号兼容） */
function metaContent(html: string, key: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i'
  )
  const tag = re.exec(html)?.[0] || ''
  const m = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
  const v = (m?.[1] ?? m?.[2] ?? '').trim()
  return decodeEntities(v).replace(/\s+/g, ' ').slice(0, 500)
}

/** <title> 兜底（og:title 缺失时用）；title 内不做解码重放——只剥标签取文本再统一解码 */
function titleTag(html: string): string {
  const m = /<title[^>]*>([\s\S]{0,500}?)<\/title>/i.exec(html)
  return decodeEntities((m?.[1] ?? '').replace(/<[^>]+>/g, '')).trim()
}

/** 抓取页面并解析链接卡元数据；任何异常都返回空对象（卡片退化，不阻塞插入） */
export async function fetchLinkMeta(rawUrl: string): Promise<Partial<LinkMeta>> {
  const u = fetchableUrl(rawUrl)
  if (!u) return {}
  let html: string
  try {
    const res = await fetch(u, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return {}
    if (Number(res.headers.get('content-length') || 0) > MAX_PAGE_BYTES) return {}
    const ct = res.headers.get('content-type') || ''
    if (ct && !/text\/html|application\/xhtml/i.test(ct)) return {}
    html = await res.text()
    if (html.length > MAX_PAGE_BYTES) return {}
  } catch {
    return {}
  }
  const title = metaContent(html, 'og:title') || metaContent(html, 'twitter:title') || titleTag(html)
  const description =
    metaContent(html, 'og:description') || metaContent(html, 'description') || metaContent(html, 'twitter:description')
  const image = metaContent(html, 'og:image') || metaContent(html, 'twitter:image')
  const siteName = metaContent(html, 'og:site_name')
  return { title, description, image, siteName }
}

/* ---------------- 组卡（纯函数，Node 测试直接导入） ---------------- */

/** 属性上下文转义（& < > " '），与 sanitize.ts escAttr 同规则——卡片由编辑器拼接，
 *  编辑器侧仅做防破结构的轻转义，存库时 sanitizeHtml 仍会整体复核一遍 */
function escCard(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 卡片上的文案截断（按码点，不劈开代理对） */
function clampText(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  const chars = Array.from(t)
  return chars.length > n ? chars.slice(0, n).join('') + '…' : t
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname
  } catch {
    return ''
  }
}

export interface CardInput {
  url: string
  title: string
  description?: string
  image?: string
  siteName?: string
}

/** 组卡片 HTML：有图出图（站内 /images/ 直存，外图不走中间页也不转存——卡图只是装饰，
 *  加载失败有 layout 兜底），无图出纯文字布局。description ≤64 字、title ≤40 字。
 *  **内部全用 span**：卡片段落里常落在已有 <p> 内，块级 div 会让浏览器提前闭合 <p>
 *  把 <a> 拦腰截断、样式作用域散架（.lc-body 脱离 a.link-card）——span + CSS display:flex
 *  同样的盒模型，段落内插入也不破结构。整卡是一个 <a data-link-card>，鼠标手势、
 *  外链中间页（outHref 渲染层包装）与普通链接一致 */
export function linkCardHtml(input: CardInput): string {
  const host = input.siteName ? clampText(input.siteName, 30) : hostOf(input.url)
  const title = clampText(input.title, 40) || host || '打开链接'
  const desc = clampText(input.description || '', 64)
  const img = (input.image || '').trim()
  // 站内相对地址（/post/…）解析不出 host，host 位可能为空——空则不出该行
  const hostPart = host ? `<span class="lc-host">${escCard(host)}</span>` : ''
  const inner = img
    ? `<span class="lc-body"><span class="lc-text"><span class="lc-title">${escCard(title)}</span>${
        desc ? `<span class="lc-desc">${escCard(desc)}</span>` : ''
      }${hostPart}</span><img class="lc-img" src="${escCard(img)}" alt="" loading="lazy"></span>`
    : `<span class="lc-body"><span class="lc-text"><span class="lc-title">${escCard(title)}</span>${
        desc ? `<span class="lc-desc">${escCard(desc)}</span>` : ''
      }${hostPart}</span></span>`
  return `<a class="link-card" data-link-card="link-card" href="${escCard(input.url)}" target="_blank" rel="noopener noreferrer">${inner}</a><p><br></p>`
}
