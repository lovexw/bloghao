/**
 * 主题视觉预览生成器（仅本地开发用，不参与部署）
 * 用与线上一致的渲染函数（render.ts + themes/journal.ts）生成七类页面的静态 HTML，
 * 供浏览器截图审查主题视觉效果。运行：
 *   npx esbuild scripts/preview-journal.ts --bundle --platform=node --format=esm --loader:.css=text --outfile=.preview/build.mjs
 *   node .preview/build.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { archiveGroups } from '../src/render'
import { page } from '../src/render'
import * as journal from '../src/themes/journal'
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
      : `<path d="M0 ${h * 0.7} Q ${w * 0.25} ${h * 0.5} ${w * 0.5} ${h * 0.68} T ${w} ${h * 0.6} V ${h} H 0 Z" fill="rgba(255,255,255,.25)"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${dot}<text x="${w / 2}" y="${h * 0.85}" font-size="${Math.round(h * 0.09)}" fill="rgba(255,255,255,.92)" text-anchor="middle" font-family="Kaiti SC, KaiTi, serif">${label}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

const covers = {
  autumn: ph(1200, 900, '#e0a15c', '#b05634', '阳台上的秋天'),
  night: ph(1200, 800, '#5d6d8c', '#2e3a52', '凌晨的书店', 'hill'),
  ride: ph(1200, 900, '#8fae8b', '#4e7050', '川西的经幡', 'hill'),
  rain: ph(1200, 800, '#a8b4be', '#5f7383', '雨天的图书馆', 'hill'),
  weibo1: ph(900, 900, '#f0c45c', '#e08a4c', '向日葵'),
  weibo2: ph(800, 800, '#e29494', '#c05f5f', '番茄'),
  weibo3: ph(800, 800, '#96af82', '#6c8a5a', '小葱'),
  weibo4: ph(800, 800, '#8ca8c3', '#5a7898', '集市'),
  weibo5: ph(900, 900, '#b8a8d0', '#7f6ba0', '第一杯手冲'),
  avatar: ph(200, 200, '#e0a15c', '#b05634', '拾'),
}
const iconFor = (c1: string, c2: string) => ph(96, 96, c1, c2, '')

/* ---------- 站点设置 ---------- */
const settings: Record<string, string> = {
  siteName: '拾光手账',
  siteDescription: '把日子过成诗，把博客写成手账',
  footerText: '一笔一画，都是生活',
  avatarUrl: covers.avatar,
}

const categories = [
  { name: '生活', slug: 'life' },
  { name: '旅行', slug: 'travel' },
  { name: '技术', slug: 'tech' },
]
const tags = [
  { name: '日常', count: 12 },
  { name: '骑行', count: 5 },
  { name: '咖啡', count: 3 },
  { name: '读书', count: 7 },
]

/* ---------- 文章列表 ---------- */
function homePost(slug: string, title: string, summary: string, cover: string, tagList: string[], daysAgo: number, opts: Partial<{ views: number; likes: number; comments: number; pinned: boolean; minutes: number }> = {}) {
  return {
    slug,
    title,
    summary,
    cover,
    tags: tagList,
    published_at: now - daysAgo * DAY,
    views: opts.views ?? 320,
    likes: opts.likes ?? 18,
    pinned: opts.pinned ?? false,
    commentCount: opts.comments ?? 3,
    readingMinutes: opts.minutes ?? 4,
  }
}

const posts = [
  homePost('balcony-autumn', '在阳台上种出一小片秋天', '搬把椅子坐在花盆前，看辣椒从青转红，看风把薄荷吹得摇摇晃晃。原来秋天不用去山里找。', covers.autumn, ['日常', '生活'], 2, { views: 1280, likes: 86, comments: 12, pinned: true, minutes: 5 }),
  homePost('midnight-bookstore', '凌晨四点的城市，和一家二十四小时书店', '失眠的夜里我总去那里坐着。店员说，凌晨来的人各有各的故事，书只是借口。', covers.night, ['读书', '夜'], 6, { views: 2360, likes: 152, comments: 21, minutes: 8 }),
  homePost('letter-to-past', '给三年前自己的一封信', '你担心的事情大多没有发生，发生了的你也 都扛过来了。慢慢来，真的。', '', ['日常'], 11, { views: 980, likes: 64, comments: 8, minutes: 3 }),
  homePost('west-sichuan-ride', '川西小环线骑行记：四天，三百公里', '海拔四千米上气喘吁吁，下坡时冷风灌进袖口。经幡在垭口响，那一刻觉得一切都值。', covers.ride, ['骑行', '旅行'], 18, { views: 3120, likes: 205, comments: 33, minutes: 12 }),
  homePost('pourover-coffee', '手冲咖啡入门：从一杯失败开始', '第一杯酸得像柠檬汁，第五杯终于有了回甘。记录一下踩过的坑和买错的器具。', ph(1200, 800, '#c9a27c', '#8a6544', '手冲的早晨'), ['咖啡', '日常'], 26, { views: 1560, likes: 77, comments: 9, minutes: 6 }),
  homePost('rainy-library', '雨天的图书馆与一本旧词典', '在旧书区翻到一本 1987 年的词典，借书卡上的名字比我的年龄还大。', covers.rain, ['读书', '日常'], 34, { views: 760, likes: 41, comments: 5, minutes: 4 }),
]

/* ---------- 微博 ---------- */
const weiboItems = [
  { id: 101, content: '今天路过巷口的花店，老板娘送了我一支向日葵，说「拿去吧，今天也要开心一点」。#生活的糖#', images: [covers.weibo1], created_at: now - 2 * 3600 * 1000, likes: 45, commentCount: 6 },
  { id: 102, content: '周末逛菜市场，买了三颗番茄两把小葱，晚饭做了一碗打卤面。人间烟火气，最抚凡人心。#柴米油盐#', images: [covers.weibo2, covers.weibo3, covers.weibo4], created_at: now - 1.2 * DAY, likes: 62, commentCount: 9 },
  { id: 100, content: '这本「手账」终于开张了！以后随手记都住在这里，想到什么写什么。#开张#', images: [], created_at: now - 3 * DAY, likes: 128, commentCount: 15, pinned: true },
  { id: 103, content: '第一杯手冲，酸得像柠檬汁；第五杯，终于有了回甘。失败五次换来的经验：水温别超 90 度。', images: [covers.weibo5], created_at: now - 4 * DAY, likes: 38, commentCount: 4 },
  { id: 104, content: '把阳台的花搬进屋，一边搬一边下起了雨。秋天真的来了。', images: [covers.autumn, covers.rain, covers.weibo1, covers.weibo3], created_at: now - 6 * DAY, likes: 51, commentCount: 7 },
]

/* ---------- 评论（文章页楼中楼 + 留言板墙共用结构） ---------- */
function comment(id: number, nickname: string, content: string, daysAgo: number, opts: Partial<{ parent: number; admin: boolean }> = {}): CommentRow {
  return {
    id,
    post_id: 1,
    weibo_id: 0,
    parent_id: opts.parent ?? 0,
    is_admin: opts.admin ? 1 : 0,
    nickname,
    email: '',
    website: '',
    content,
    status: 'approved' as const,
    ip: '',
    created_at: now - daysAgo * DAY,
  }
}

const postComments = [
  comment(1, '山月', '写得真好，我也想回家种辣椒了。', 1.5),
  comment(2, '拾光手账', '辣椒好养，撒把籽就发芽，秋天就有得吃～', 1.4, { parent: 1, admin: true }),
  comment(3, '路过的猫', '收藏了，等我的阳台到位。', 1.2),
  comment(4, '老陈', '薄荷建议地栽，盆栽会疯长给你看。', 1.1),
]

const guestbookComments = [
  comment(11, '南方的风', '路过打个招呼！你的手账排版好好看。', 0.8),
  comment(12, '拾光手账', '谢谢！常来坐～', 0.75, { parent: 11, admin: true }),
  comment(13, '像素小酒馆', '已添加友链，有空来小店坐坐。', 2.1),
  comment(14, '阿汤', '第 100 个留言者打卡（不是）。', 3.3),
  comment(15, '山月', '每一篇都好温柔，追更了。', 5.2),
  comment(16, '纸飞机', '请问用的什么相机？色彩好舒服。', 6.6),
  comment(17, '拾光手账', '大部分是手机随手拍的，光线好就行。', 6.5, { parent: 16, admin: true }),
  comment(18, '冬眠的熊', '冒个泡，博客越办越好！', 8.4),
  comment(19, '一盏茶', '从 RSS 找过来的，文章质量很高。', 9.1),
]

/* ---------- 归档 ---------- */
const archiveItems = posts.map((p) => ({ slug: p.slug, title: p.title, ts: p.published_at ?? now }))
const olderYear = posts.map((p) => ({ slug: p.slug + '-24', title: p.title, ts: (p.published_at ?? now) - 365 * DAY }))
const groups = archiveGroups([...archiveItems, ...olderYear])

/* ---------- 时光机 ---------- */
const onThisDay = [
  { kind: 'post' as const, href: '/post/west-sichuan-ride', text: '川西小环线骑行记：四天，三百公里', ts: now - 365 * DAY, yearsAgo: 1 },
  { kind: 'weibo' as const, href: '/weibo?wb=88#wb-88', text: '搬进新家的第一夜，睡在地铺上也很开心', ts: now - 2 * 365 * DAY, yearsAgo: 2 },
]

/* ---------- 文章正文（覆盖 .rich 各元素） ---------- */
const demoContent = `
<p>搬把椅子坐在花盆前，看辣椒从青转红，看风把薄荷吹得摇摇晃晃<mark>，原来秋天不用去山里找</mark>，它就住在阳台上。</p>
<h2>从三盆薄荷开始</h2>
<p>今年春天随手撒了一把薄荷籽，出芽率惊人。到了九月，它们已经占领了三个花盆、半个栏杆，以及我每天早晨的五分钟——摘两片叶子，泡一杯薄荷绿茶。</p>
<blockquote>园艺教会我的第一课：你没办法催促一株植物，你只能提供阳光和水，然后等。</blockquote>
<h3>九月记录表</h3>
<table><thead><tr><th>植物</th><th>状态</th><th>备注</th></tr></thead><tbody><tr><td>辣椒</td><td>红了 7 颗</td><td>鸟先吃了一颗</td></tr><tr><td>薄荷</td><td>疯长</td><td>泡茶管够</td></tr><tr><td>小葱</td><td>矮胖</td><td>剪了又长</td></tr></tbody></table>
<h3>浇水提醒脚本</h3>
<p>怕忘浇水，写了个十行的小脚本，每天早上七点提醒我：</p>
<pre><code>const plants = ['mint', 'chili', 'spring-onion']
if (weather.rainedToday) {
  console.log('今天不用浇水，去摸摸它们就行')
} else {
  plants.forEach(p =&gt; water(p, '500ml'))
}</code></pre>
<ul><li>薄荷：喜水，两天一次</li><li>辣椒：见干见湿</li><li>小葱：随便，怎么都活</li></ul>
<p>傍晚拍了张照，夕阳正好打在辣椒上：</p>
<img src="${covers.autumn}" alt="阳台上的秋天" loading="lazy">
<p>如果你也想在阳台上种点什么，<strong>从薄荷开始准没错</strong>——它对新手宽容得像一位老朋友。</p>
`

const relatedPosts = [posts[3], posts[4], posts[5]]

/* ---------- 渲染器 ---------- */
function navProps() {
  return { categories, tags }
}

const pages: { file: string; title: string; path: string; body: string; dark?: boolean }[] = []

// 首页
pages.push({
  file: 'home.html',
  title: '',
  path: '/',
  body: journal.home({
    settings,
    posts,
    page: 1,
    totalPages: 3,
    total: 26,
    tags: tags,
    categories,
    navActive: 'home',
    weibo: { items: weiboItems.slice(0, 2), total: 18 },
    onThisDay,
  }),
})

// 文章页
{
  const commentsHtml = (await import('../src/render')).commentsHtml
  pages.push({
    file: 'post.html',
    title: posts[0].title,
    path: '/post/balcony-autumn',
    body: journal.post({
      settings,
      post: {
        slug: posts[0].slug,
        title: posts[0].title,
        contentHtml: demoContent,
        summary: posts[0].summary,
        cover: posts[0].cover,
        tags: ['日常', '生活'],
        published_at: posts[0].published_at,
        views: posts[0].views,
        likes: posts[0].likes,
        readingMinutes: posts[0].readingMinutes,
      },
      category: categories[0],
      categories,
      tags,
      comments: { html: commentsHtml({ comments: postComments, slug: 'balcony-autumn', allowComments: true, count: postComments.length }), count: postComments.length },
      related: relatedPosts,
    }),
  })
}

// 微博页
pages.push({
  file: 'weibo.html',
  title: '随手记',
  path: '/weibo',
  body: journal.weibo({
    settings,
    categories,
    tags,
    items: weiboItems,
    page: 1,
    totalPages: 4,
    total: 68,
    allowComments: true,
    topic: undefined,
    topics: [
      { name: '生活的糖', count: 12 },
      { name: '柴米油盐', count: 9 },
      { name: '开张', count: 1 },
    ],
  }),
})

// 友链页
pages.push({
  file: 'links.html',
  title: '友邻',
  path: '/links',
  body: journal.links({
    settings,
    categories,
    tags,
    total: 8,
    items: [
      { name: '小吴乐意', url: 'https://blog.xiaowuleyi.com', description: '写代码也写生活，博客号作者的自留地。', icon: iconFor('#5d8ca8', '#2e5a78') },
      { name: '像素小酒馆', url: 'https://example.com', description: '深夜打烊前，聊游戏、像素与旧时光。', icon: '' },
      { name: '纸上田野', url: 'https://example.com', description: '人类学学生的田野笔记与慢速观察。', icon: '' },
      { name: '深夜代码铺', url: 'https://example.com', description: 'Bug 与咖啡同样提神。', icon: iconFor('#8a7fb0', '#4a3f78') },
      { name: '南方小站', url: 'https://example.com', description: '记录一座南方小城的四季与街巷。', icon: '' },
      { name: '一盏茶的时间', url: 'https://example.com', description: '泡茶、读书、发呆，以及一只叫年糕的猫。', icon: iconFor('#c9a27c', '#8a6544') },
    ],
  }),
})

// 归档页
pages.push({
  file: 'archives.html',
  title: '归档',
  path: '/archives',
  body: journal.archives({ settings, categories, tags, total: 52, groups }),
})

// 留言板页
{
  const commentsHtml = (await import('../src/render')).commentsHtml
  pages.push({
    file: 'guestbook.html',
    title: '留言板',
    path: '/guestbook',
    body: journal.guestbook({
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
  body: journal.about({
    settings,
    categories,
    tags,
    navActive: 'about',
    contentHtml: `<p>你好，我是<mark>阿拾</mark>，一个喜欢把日子记在本子里的人。</p><h2>这里写什么</h2><ul><li>阳台上种菜的失败与收获</li><li>骑车去山里看云的路线记录</li><li>读完的书，和一些摘抄</li></ul><blockquote>写作最好的状态：像发动态一样轻，像写文章一样认真。</blockquote><p>邮箱在页脚，来 信 均 回。</p>`,
  }),
})

/* ---------- 暗色变体（复制暗色变量为无条件覆盖） ---------- */
const darkOverride = `:root{color-scheme:dark;--jrn-paper:#272220;--jrn-card:#312b26;--jrn-field:#39322b;--jrn-ink:#e8dfcd;--jrn-ink-soft:#a79b87;--jrn-line:#463d33;--jrn-dot:rgba(232,223,205,.05);--jrn-accent:#ef8f66;--jrn-hl:rgba(239,143,102,.16);--jrn-tape-a:rgba(240,196,92,.3);--jrn-tape-b:rgba(150,175,130,.26);--jrn-tape-c:rgba(226,148,148,.26);--jrn-tape-d:rgba(140,168,195,.26);--jrn-sage-ink:#a9c09a;--jrn-blue-ink:#9db8d4;--jrn-terra-ink:#ef9270;--jrn-must-ink:#d9b75f;--jrn-note-a:#3b362a;--jrn-note-b:#3d3330;--jrn-note-c:#363c2e;--jrn-note-d:#333b42;--jrn-shadow:0 10px 26px rgba(0,0,0,.34);--jrn-shadow-sm:0 4px 12px rgba(0,0,0,.3)}.rich pre{background-color:#2a251f;background-image:repeating-linear-gradient(0deg,rgba(232,223,205,.045) 0 1px,transparent 1px 22px),repeating-linear-gradient(90deg,rgba(232,223,205,.045) 0 1px,transparent 1px 22px)}`

const lightOverride = `:root{color-scheme:light;--jrn-paper:#faf5ea;--jrn-card:#fffdf6;--jrn-field:#fffdf6;--jrn-ink:#3f3a31;--jrn-ink-soft:#94897a;--jrn-line:#e7ddc9;--jrn-dot:rgba(63,58,49,.055);--jrn-accent:#e06a3c;--jrn-hl:rgba(224,106,60,.14);--jrn-tape-a:rgba(240,196,92,.55);--jrn-tape-b:rgba(150,175,130,.5);--jrn-tape-c:rgba(226,148,148,.5);--jrn-tape-d:rgba(140,168,195,.5);--jrn-sage-ink:#5f7048;--jrn-blue-ink:#46648a;--jrn-terra-ink:#b05634;--jrn-must-ink:#8a6d1f;--jrn-note-a:#fdf6d8;--jrn-note-b:#fde7e2;--jrn-note-c:#e7f0da;--jrn-note-d:#e2ecf5;--jrn-shadow:0 10px 26px rgba(94,78,55,.1);--jrn-shadow-sm:0 4px 12px rgba(94,78,55,.08)}.rich pre{background-color:#fbf6e9;background-image:repeating-linear-gradient(0deg,rgba(63,58,49,.05) 0 1px,transparent 1px 22px),repeating-linear-gradient(90deg,rgba(63,58,49,.05) 0 1px,transparent 1px 22px)}`

for (const p of pages) {
  writeFileSync(join(outDir, p.file), page({ settings, css: journal.css, title: p.title, path: p.path, body: p.body }), 'utf8')
  // 亮色强制版：系统偏好暗色时也能审查亮色视觉
  writeFileSync(join(outDir, p.file.replace('.html', '-light.html')), page({ settings, css: journal.css + lightOverride, title: p.title, path: p.path, body: p.body }), 'utf8')
  if (['home.html', 'post.html', 'weibo.html', 'guestbook.html'].includes(p.file)) {
    writeFileSync(join(outDir, p.file.replace('.html', '-dark.html')), page({ settings, css: journal.css + darkOverride, title: p.title, path: p.path, body: p.body }), 'utf8')
  }
  console.log('built', p.file)
}
console.log('done ->', outDir)
