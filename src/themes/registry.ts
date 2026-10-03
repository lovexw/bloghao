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
    hotTags: string[]
    /** 顶部导航数据与高亮：'home' | 分类 slug | 'search' | '' */
    categories: import('../render').CategoryLink[]
    navActive?: string
    /** 列表上方的通知区（搜索框/分类说明），由 pages 层构建好的 HTML */
    notice?: string
    /** 空列表文案（搜索/分类页有定制文案） */
    emptyText?: string
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
    comments: { html: string; count: number }
    related: import('../render').HomePostView[]
  }): string
  about(d: { settings: Record<string, string>; contentHtml: string; categories: import('../render').CategoryLink[] }): string
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
  return THEMES[id] ?? THEMES.wechat
}
