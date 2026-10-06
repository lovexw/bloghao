import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { ThemeModule } from '../src/themes/registry.ts'
import type { AboutData, ArchivesData, GuestbookData, HomeData, LinksData, PageData, PostData, WeiboData } from '../src/themes/registry.ts'
import type { HomePostView, WeiboItemView, ArchiveYearGroup, FriendLinkView, CategoryLink, TagCount } from '../src/render.ts'

// 主题模块 import 了 .css（wrangler 部署走 Text rule）——测试环境先用 hook 顶替，再动态加载注册表
register('./tests/css-loader.mjs', pathToFileURL(`${process.cwd()}/`))
const { THEMES } = await import('../src/themes/registry.ts')

// ── 五套主题 × 八类页面渲染回归：任何主题任何页面函数抛错/漏关键结构都会在这里炸 ──
// 页脚由各主题 foot() 公共件渲染，本测试同时守着「八页页脚一个不少」

const settings = {
  siteName: '测试站',
  siteDescription: '一句话描述',
  siteUrl: '',
  footerText: '© 测试站',
  avatarUrl: '',
  pluginsDisabled: '',
}

const TS = 1_700_000_000_000
const cat: CategoryLink = { name: '分类', slug: 'cat' }
const tags: TagCount[] = [
  { name: '生活', count: 3 },
  { name: '技术', count: 1 },
]
const postView: HomePostView = {
  slug: 'hello',
  title: '你好世界',
  summary: '这是摘要',
  cover: '/images/u/a.png',
  tags: ['生活'],
  published_at: TS,
  views: 12,
  likes: 2,
  pinned: false,
  commentCount: 1,
  readingMinutes: 3,
}
const weiboView: WeiboItemView = {
  id: 7,
  content: '随手记一条 #话题#',
  images: ['/images/u/b.png'],
  created_at: TS,
  likes: 1,
  commentCount: 0,
}
const groups: ArchiveYearGroup[] = [{ year: 2026, count: 1, items: [{ slug: 'hello', title: '你好世界', ts: TS }] }]
const friend: FriendLinkView = { name: '朋友', url: 'https://example.com', description: '朋友的站', icon: '' }
const pages = [{ title: '关于页面', href: '/page/about-page', key: 'p:about-page' }]

const homeData = (): HomeData => ({
  settings,
  posts: [postView],
  page: 1,
  totalPages: 1,
  total: 1,
  tags,
  categories: [cat],
  pages,
  weibo: { items: [weiboView], total: 1 },
  onThisDay: null,
})
const postData = (): PostData => ({
  settings,
  post: {
    slug: 'hello',
    title: '你好世界',
    contentHtml: '<p>正文</p>',
    summary: '这是摘要',
    cover: '/images/u/a.png',
    tags: ['生活'],
    published_at: TS,
    views: 12,
    likes: 2,
    readingMinutes: 3,
  },
  category: cat,
  categories: [cat],
  pages,
  tags,
  comments: { html: '<ul class="cmt-list"></ul>', count: 1 },
  related: [postView],
})
const aboutData = (): AboutData => ({ settings, contentHtml: '<p>关于</p>', categories: [cat], pages, navActive: 'about' })
const pageData = (): PageData => ({ settings, title: '自建页', contentHtml: '<p>页面</p>', categories: [cat], pages, navActive: 'p:about-page' })
const archivesData = (): ArchivesData => ({ settings, categories: [cat], pages, total: 1, groups })
const guestbookData = (): GuestbookData => ({ settings, categories: [cat], pages, html: '<div class="gb"></div>', count: 1 })
const weiboData = (): WeiboData => ({
  settings,
  categories: [cat],
  pages,
  tags,
  items: [weiboView],
  page: 1,
  totalPages: 1,
  total: 1,
  allowComments: true,
  adminName: '作者',
  topics: [{ name: '话题', count: 1 }],
})
const linksData = (): LinksData => ({ settings, categories: [cat], pages, items: [friend], total: 1 })

/** 每个页面函数的冒烟断言：能渲染 + 页脚 + 导航都在。
 *  页脚链接组按页面类型有变体（部分页面无 RSS），由各主题 foot() 公共件统一承载 */
function checkPage(themeId: string, name: string, html: string): void {
  assert.ok(typeof html === 'string' && html.length > 200, `${themeId}.${name} 应渲染出实质 HTML`)
  assert.ok(html.includes('footer'), `${themeId}.${name} 应含页脚`)
  assert.ok(html.includes(settings.siteName), `${themeId}.${name} 应含站名`)
}

for (const [themeId, theme] of Object.entries(THEMES as Record<string, ThemeModule>)) {
  test(`${themeId}: 模块元数据完整`, () => {
    assert.equal(theme.id, themeId)
    assert.ok(theme.name && theme.description)
    // css 在 Node 测试环境被 loader 顶替为空串（部署侧由 wrangler Text rule 注入真实内容）
    assert.equal(typeof theme.css, 'string')
  })

  test(`${themeId}: home 渲染`, () => {
    const d = homeData()
    const html = theme.home(d)
    checkPage(themeId, 'home', html)
    assert.ok(html.includes('rss.xml'))
    assert.ok(html.includes(postView.title))
  })

  test(`${themeId}: post 渲染（正文/点赞/评论区）`, () => {
    const html = theme.post(postData())
    checkPage(themeId, 'post', html)
    assert.ok(html.includes('<p>正文</p>'))
    assert.ok(html.includes('like-btn'))
    assert.ok(html.includes('cmt-list'))
  })

  test(`${themeId}: about 与 page 渲染（标题区分）`, () => {
    const about = theme.about(aboutData())
    const page = theme.page(pageData())
    checkPage(themeId, 'about', about)
    checkPage(themeId, 'page', page)
    assert.ok(about.includes('关于我'))
    assert.ok(page.includes('自建页'))
  })

  test(`${themeId}: archives 渲染`, () => {
    const html = theme.archives(archivesData())
    checkPage(themeId, 'archives', html)
    assert.ok(html.includes('你好世界'))
  })

  test(`${themeId}: guestbook 渲染`, () => {
    const html = theme.guestbook(guestbookData())
    checkPage(themeId, 'guestbook', html)
    assert.ok(html.includes('gb'))
  })

  test(`${themeId}: weibo 渲染（卡片+发布器）`, () => {
    const html = theme.weibo(weiboData())
    checkPage(themeId, 'weibo', html)
    assert.ok(html.includes('wb-card'), `${themeId} 微博页应含卡片`)
    assert.ok(html.includes('wb-composer'), '管理员可见发布器')
  })

  test(`${themeId}: links 渲染`, () => {
    const html = theme.links(linksData())
    checkPage(themeId, 'links', html)
    assert.ok(html.includes('example.com'))
  })

  test(`${themeId}: page 未实现时运行时兜底由 pages.ts 负责（本主题已实现）`, () => {
    assert.equal(typeof theme.page, 'function')
  })
}

test('getTheme：未知主题回退 wechat（hasOwnProperty 挡原型链）', async () => {
  const { getTheme } = await import('../src/themes/registry.ts')
  assert.equal(getTheme('nope').id, 'wechat')
  assert.equal(getTheme('constructor').id, 'wechat')
})
