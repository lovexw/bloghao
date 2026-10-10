/**
 * 主题视觉预览生成器（仅本地开发用，不参与部署；留档工具，未接入 npm scripts）
 * 只覆盖 bitcoin 一套主题；换其他主题截图需照此改 import。
 * 用与线上一致的渲染函数（render.ts + themes/bitcoin.ts）生成七类页面的静态 HTML，
 * 供浏览器截图审查主题视觉效果。运行：
 *   npx esbuild scripts/preview-bitcoin.ts --bundle --platform=node --format=esm --loader:.css=text --outfile=.preview/build.mjs
 *   node .preview/build.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { page } from '../src/render'
import * as bitcoin from '../src/themes/bitcoin'
import type { CommentRow } from '../src/types'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.preview')
mkdirSync(outDir, { recursive: true })

const now = Date.now()
const DAY = 24 * 3600 * 1000

/* ---------- 占位图（渐变 SVG data URI，模拟照片） ---------- */
function ph(w: number, h: number, c1: string, c2: string, label: string, deco = 'circle'): string {
  const dot =
    deco === 'circle'
      ? `<circle cx="${w * 0.78}" cy="${h * 0.26}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,.4)"/>`
      : `<path d="M0 ${h * 0.7} Q ${w * 0.25} ${h * 0.5} ${w * 0.5} ${h * 0.68} T ${w} ${h} H 0 Z" fill="rgba(255,255,255,.25)"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${dot}<text x="${w / 2}" y="${h * 0.85}" font-size="${Math.round(h * 0.09)}" fill="rgba(255,255,255,.92)" text-anchor="middle" font-family="Georgia, serif">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

const covers = {
  chain: ph(1200, 900, '#f7931a', '#b0562a', '链上数据', 'hill'),
  halving: ph(1200, 800, '#e8b04a', '#8a5a1a', '减半周期', 'hill'),
  node: ph(1200, 900, '#c88a3a', '#5a4020', '运行一个节点', 'hill'),
  keys: ph(1200, 800, '#d09a4a', '#6a4a22', '自己保管钥匙', 'hill'),
  weibo1: ph(900, 900, '#f0c45c', '#c07a2a', '价格曲线'),
  weibo2: ph(800, 800, '#a8a8a8', '#5a5a5a', '矿机噪音'),
  avatar: ph(200, 200, '#f7931a', '#8a5a1a', ''),
}
const iconFor = (c1: string, c2: string) => ph(96, 96, c1, c2, '')

/* ---------- 站点设置 ---------- */
const settings: Record<string, string> = {
  siteName: 'Mempool 日志',
  siteDescription: 'Don\'t trust, verify. 链上与链下的观察记录',
  footerText: 'Don\'t trust, verify.',
}

const categories = [
  { name: '市场', slug: 'market' },
  { name: '技术', slug: 'tech' },
  { name: '随笔', slug: 'essay' },
]
const tags = [
  { name: '比特币', count: 12 },
  { name: '闪电网络', count: 5 },
  { name: '自托管', count: 3 },
  { name: '宏观', count: 7 },
]

/* ---------- 文章列表 ---------- */
type Post = {
  slug: string; title: string; summary: string; cover: string; tags: string[];
  category: { name: string; slug: string }; published_at: number; views: number;
  likes: number; comments: number; pinned?: boolean; readingMinutes: number;
}
const posts: Post[] = [
  { slug: 'run-your-own-node', title: '运行你自己的节点：从下载到验证第一个区块', summary: '信任的起点是自己验证。一条树莓派、一块 1TB 硬盘，一个晚上就能摆脱对第三方 API 的依赖——本篇从零开始。', cover: covers.node, tags: ['自托管', '比特币'], category: categories[1], published_at: now - 2 * DAY, views: 1284, likes: 96, comments: 12, pinned: true, readingMinutes: 9 },
  { slug: 'halving-cycle-notes', title: '减半之后：一次非线性的周期观察', summary: '历史不会重押韵的韵脚，但供给曲线是确定的。把三轮减半后的链上数据并排放在一起看。', cover: covers.halving, tags: ['比特币', '宏观'], category: categories[0], published_at: now - 9 * DAY, views: 2310, likes: 143, comments: 21, readingMinutes: 12 },
  { slug: 'self-custody-keys', title: '自己保管钥匙的十个工程细节', summary: '备份不是抄一遍助记词就完事：介质寿命、地理冗余、继承预案，每一条都值得单独一节。', cover: covers.keys, tags: ['自托管'], category: categories[1], published_at: now - 16 * DAY, views: 1892, likes: 118, comments: 9, readingMinutes: 15 },
  { slug: 'lightning-in-practice', title: '闪电网络实测：小额支付的日常可行性', summary: '开了三张通道跑了三个月，收发合计 400 多笔——把能撑起日常的场景和还不行的都记下来。', cover: covers.chain, tags: ['闪电网络'], category: categories[1], published_at: now - 23 * DAY, views: 956, likes: 61, comments: 6, readingMinutes: 8 },
  { slug: 'mempool-diary-41', title: 'Mempool 日记 #41：费率低谷是最好的广播窗口', summary: '周末凌晨的 1 sat/vB 窗口、RBF 替换的实操、以及一次被卡住 36 小时的交易复盘。', cover: covers.chain, tags: ['比特币'], category: categories[2], published_at: now - 31 * DAY, views: 743, likes: 40, comments: 3, readingMinutes: 6 },
]
const postOf = (p: Post, daysAgo: number) => ({ ...p, published_at: now - daysAgo * DAY })

/* ---------- 微博（随手记） ---------- */
const weiboItems = [
  { id: 5, content: '减半叙事年年有，链上费用第一次连续两周低于 2 sat/vB——观察窗口比预测价格有用。#比特币#', images: [covers.weibo1], created_at: now - 5 * 3600 * 1000, likes: 18, commentCount: 2 },
  { id: 4, content: '矿机到货，噪音实测 68 分贝，放阳台正合适。邻居以为是新买的冰箱。', images: [covers.weibo2], created_at: now - 2 * DAY, likes: 25, commentCount: 5 },
  { id: 3, content: '今天把验证节点从 SSD 换成了 NVMe，IBD 速度直接翻倍。#自托管#', images: [], created_at: now - 4 * DAY, likes: 9, commentCount: 1 },
]

const comment = (n: number): CommentRow => ({
  id: n, post_slug: 'run-your-own-node', parent_id: 0, nickname: n % 2 ? 'HODLer' : 'SatoshiFan',
  content: n % 2 ? '跑全节点之后看行情 App 的心态完全不一样了。' : '教程很实用，树莓派 5 也适用吗？',
  is_admin: n === 1, reply_admin: '', created_at: now - n * 3600 * 1000, avatar: '', email: '',
  member_name: '', member_tier: '', member_avatar: '', website: '', qq: null,
} as unknown as CommentRow)
const postComments = [comment(1), comment(2)]
const guestbookComments = [comment(3), comment(4)]

const archiveItems = posts.map((p) => ({ slug: p.slug, title: p.title, ts: p.published_at }))
const olderYear = posts.map((p) => ({ slug: p.slug + '-23', title: p.title, ts: p.published_at - 365 * DAY }))

const pages: { file: string; title: string; path: string; body: string }[] = []

// 首页
pages.push({
  file: 'home.html',
  title: '',
  path: '/',
  body: bitcoin.home({
    settings,
    posts: posts.map((p, i) => postOf(p, i * 7)),
    page: 1,
    totalPages: 3,
    total: 26,
    tags,
    categories,
    navActive: 'home',
    weibo: { items: weiboItems.slice(0, 2), total: 18 },
  }),
})

// 文章页
{
  const commentsHtml = (await import('../src/render')).commentsHtml
  pages.push({
    file: 'post.html',
    title: posts[0].title,
    path: '/post/run-your-own-node',
    body: bitcoin.post({
      settings,
      post: {
        slug: posts[0].slug,
        title: posts[0].title,
        contentHtml: `<p>信任的起点是<mark>自己验证</mark>。一条树莓派、一块 1TB 硬盘，一个晚上就能摆脱对第三方 API 的依赖。</p><h2>为什么自己跑节点</h2><p>轻节点把区块头信任给别人的全节点，钱包把余额查询信任给公司的 API——当你的储蓄以数字形式存在时，这些信任值得收回。</p><pre><code>bitcoin-cli getblockchaininfo
# blocks: 873,412 · headers: 873,412 · verificationprogress: 0.9999</code></pre><h2>硬件清单</h2><ul><li>树莓派 5（8GB）</li><li>1TB NVMe 硬盘</li><li>稳定的电源与散热</li></ul><blockquote>Don't trust, verify.</blockquote>`,
        summary: posts[0].summary,
        cover: posts[0].cover,
        tags: posts[0].tags,
        published_at: posts[0].published_at,
        views: posts[0].views,
        likes: posts[0].likes,
        readingMinutes: posts[0].readingMinutes,
      },
      category: categories[1],
      categories,
      tags,
      comments: { html: commentsHtml({ comments: postComments, slug: 'run-your-own-node', allowComments: true, count: postComments.length }), count: postComments.length },
      related: posts.slice(1, 4).map((p) => ({ slug: p.slug, title: p.title, summary: p.summary, cover: p.cover, tags: p.tags, published_at: p.published_at, views: p.views, likes: p.likes, pinned: false })),
    }),
  })
}

// 微博页
pages.push({
  file: 'weibo.html',
  title: '随手记',
  path: '/weibo',
  body: bitcoin.weibo({
    settings,
    categories,
    tags,
    items: weiboItems,
    page: 1,
    totalPages: 2,
    total: 18,
    allowComments: true,
    topic: undefined,
    topics: [
      { name: '比特币', count: 12 },
      { name: '自托管', count: 3 },
    ],
  }),
})

// 友链页
pages.push({
  file: 'links.html',
  title: '友邻',
  path: '/links',
  body: bitcoin.links({
    settings,
    categories,
    tags,
    total: 3,
    items: [
      { name: 'Mempool.Space', url: 'https://mempool.space', description: '内存池与费率实时观测。', icon: iconFor('#f7931a', '#8a5a1a') },
      { name: 'Bitcoin Optech', url: 'https://bitcoinops.org', description: '协议进展技术周报。', icon: iconFor('#c88a3a', '#5a4020') },
      { name: '橙皮书斋', url: '#', description: '链上人类学随笔。', icon: iconFor('#e8b04a', '#8a5a1a') },
    ],
  }),
})

// 归档页
{
  const groups = [
    { year: '2026', items: archiveItems },
    { year: '2025', items: olderYear },
  ]
  pages.push({
    file: 'archives.html',
    title: '归档',
    path: '/archives',
    body: bitcoin.archives({ settings, categories, tags, total: 52, groups }),
  })
}

// 留言板页
{
  const commentsHtml = (await import('../src/render')).commentsHtml
  pages.push({
    file: 'guestbook.html',
    title: '留言板',
    path: '/guestbook',
    body: bitcoin.guestbook({
      settings,
      categories,
      tags,
      count: 41,
      html: commentsHtml({ comments: guestbookComments, slug: 'guestbook', allowComments: true, count: 41, guestbook: true }),
    }),
  })
}

// 关于我
pages.push({
  file: 'about.html',
  title: '关于我',
  path: '/about',
  body: bitcoin.about({
    settings,
    categories,
    tags,
    navActive: 'about',
    contentHtml: `<p>一个相信「自己验证」的普通用户，记录运行节点的折腾与市场周期的观察。</p><h2>这里写什么</h2><ul><li>链上数据的长周期观察</li><li>自托管与节点运维的工程细节</li><li>闪电网络的日常实测</li></ul><blockquote>Don't trust, verify.</blockquote>`,
  }),
})

for (const p of pages) {
  writeFileSync(join(outDir, p.file), page({ settings, css: bitcoin.css, title: p.title, path: p.path, body: p.body }), 'utf8')
  console.log('built', p.file)
}
console.log('done ->', outDir)
