import * as journal from './journal'
import * as midnight from './midnight'
import * as minimal from './minimal'
import * as paper from './paper'
import * as wechat from './wechat'

export interface ThemeModule {
  id: string
  name: string
  description: string
  css: string
  home(d: {
    settings: Record<string, string>
    posts: import('../render').HomePostView[]
    page: number
    totalPages: number
    total: number
    tag?: string
    /** 搜索页当前关键词（刊头搜索框回填用） */
    q?: string
    /** 列表当前排序（首页/分类/搜索共用排序条；随机时翻页需带 seed） */
    sort?: import('../db').PostSort
    /** 随机排序的种子：服务端生成后回传，翻页链接携带以稳住同一组顺序 */
    seed?: number
    /** 当前分类页的 slug（分类页排序条/翻页回链用） */
    categorySlug?: string
    /** 顶部导航「分类话题」菜单的标签（带使用计数，已按热度排序） */
    tags: import('../render').TagCount[]
    /** 顶部导航数据与高亮：'home' | 'weibo' | 分类 slug | 'tag:标签名' | 'search' */
    categories: import('../render').CategoryLink[]
    navActive?: string
    /** 列表上方的通知区（搜索结果/分类说明），由 pages 层构建好的 HTML */
    notice?: string
    /** 空列表文案（搜索/分类页有定制文案） */
    emptyText?: string
    /** 首页微博入口卡数据（仅首页列表传入；没有已发布微博时为 null） */
    weibo?: { items: import('../render').WeiboItemView[]; total: number } | null
    /** 历史上的今天（仅首页第一页且未筛选时传入）：往年今日的文章与微博，空数组/缺省不渲染 */
    onThisDay?: import('../render').OnThisDayItemView[] | null
  }): string
  weibo(d: {
    settings: Record<string, string>
    categories: import('../render').CategoryLink[]
    /** 顶部导航「分类话题」菜单的标签 */
    tags?: import('../render').TagCount[]
    items: import('../render').WeiboItemView[]
    page: number
    totalPages: number
    total: number
    /** 站点「允许评论」开关：关闭时微博卡片只展示评论列表入口，不出表单 */
    allowComments: boolean
    /** 登录管理员昵称：卡片内评论表单免填昵称，以作者身份发言 */
    adminName?: string
    /** 当前筛选的话题（?topic=），为空为全部 */
    topic?: string
    /** 已发布微博的话题聚合（话题条数据），为空不渲染话题条 */
    topics?: { name: string; count: number }[]
  }): string
  links(d: {
    settings: Record<string, string>
    categories: import('../render').CategoryLink[]
    /** 顶部导航「分类话题」菜单的标签 */
    tags?: import('../render').TagCount[]
    /** 已收录的友链 */
    items: import('../render').FriendLinkView[]
    total: number
  }): string
  post(d: {
    settings: Record<string, string>
    post: {
      slug: string
      title: string
      contentHtml: string
      summary: string
      cover: string
      tags: string[]
      published_at: number | null
      views: number
      likes: number
      readingMinutes: number
    }
    category: import('../render').CategoryLink | null
    categories: import('../render').CategoryLink[]
    tags?: import('../render').TagCount[]
    comments: { html: string; count: number }
    related: import('../render').HomePostView[]
  }): string
  about(d: {
    settings: Record<string, string>
    contentHtml: string
    categories: import('../render').CategoryLink[]
    tags?: import('../render').TagCount[]
    /** 导航高亮：关于我页传 'about' */
    navActive?: string
  }): string
  /** 文章归档页（/archives）：全部已发布文章按年分组，pages 层构建好 groups */
  archives(d: {
    settings: Record<string, string>
    categories: import('../render').CategoryLink[]
    tags?: import('../render').TagCount[]
    /** 文章总篇数（页头副标题用） */
    total: number
    groups: import('../render').ArchiveYearGroup[]
  }): string
  /** 留言板页（/guestbook）：html 为 commentsHtml({ guestbook: true }) 构建的留言墙 + 表单 */
  guestbook(d: {
    settings: Record<string, string>
    categories: import('../render').CategoryLink[]
    tags?: import('../render').TagCount[]
    html: string
    count: number
  }): string
}

/**
 * 主题注册表 —— 新增主题：
 * 1. 在 src/themes/ 下新建 mytheme.ts + mytheme.css，导出与下面模块同构的接口
 * 2. 在这里注册一行
 * 详见 docs/THEMES.md
 */
export const THEMES: Record<string, ThemeModule> = {
  wechat: {
    ...wechat,
    id: 'wechat',
    name: '微信公众号',
    description: '订阅号卡片流 + 公众号文章页排版，明亮清爽',
  } as ThemeModule,
  journal: {
    ...journal,
    id: 'journal',
    name: '手账',
    description: '奶油纸面、和纸胶带、拍立得与贴纸，把博客写成一本手账',
  } as ThemeModule,
  paper: {
    ...paper,
    id: 'paper',
    name: '纸墨',
    description: '宋体排印、印章红点缀，安安静静读书的纸面',
  } as ThemeModule,
  minimal: {
    ...minimal,
    id: 'minimal',
    name: '极简',
    description: '黑白灰、大标题、大留白，内容即全部',
  } as ThemeModule,
  midnight: {
    ...midnight,
    id: 'midnight',
    name: '夜航',
    description: '深夜星图蓝 + 等宽字体点缀的开发者日志风',
  } as ThemeModule,
}

export function getTheme(id: string): ThemeModule {
  // hasOwnProperty 防原型链属性（constructor 等）被当成主题 id
  return Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : THEMES.wechat
}
