# 主题开发指南

博客号的公开页面（首页 / 文章页 / 关于页）由**主题模块**服务端渲染。任何会写 HTML/CSS 的人都可以新增主题，无需理解后端。

## 目录结构

```
src/themes/
├── registry.ts     ← 主题注册表（新主题在这里加一行）
├── wechat.ts / wechat.css
├── paper.ts / paper.css
├── minimal.ts / minimal.css
└── midnight.ts / midnight.css
```

## 一个主题需要提供什么

新建 `src/themes/mytheme.ts` 与 `src/themes/mytheme.css`：

```ts
import type { ThemeModule } from './registry'
import { commentsHtml, esc, fmtDate, likesBtn, pagerHtml, tagLink, type HomePostView } from '../render'
import css from './mytheme.css'

const id = 'mytheme'

export function home(d: {
  settings: Record<string, string>   // 全站设置（siteName/siteDescription/avatarUrl/footerText…）
  posts: HomePostView[]              // 当前页文章列表
  page: number; totalPages: number; total: number
  tag?: string                       // /tag/xxx 筛选时当前标签
  q?: string                         // /search 页当前关键词（刊头搜索框回填用）
  tags: TagCount[]                   // 顶部导航「分类话题」菜单的标签（带计数，已按热度排序）
}): string {
  return `<div class="my-page">
    ${d.posts.map(p => `
      <a class="my-item" href="/post/${esc(p.slug)}">
        <h2>${esc(p.title)}</h2>
        <p>${esc(p.summary)}</p>
        <time>${fmtDate(p.published_at)}</time>
      </a>`).join('')}
    ${pagerHtml({ page: d.page, totalPages: d.totalPages, base: '/?' })}
  </div>`
}

export function post(d: {
  settings: Record<string, string>
  post: {
    slug: string; title: string; contentHtml: string  // 正文已是净化后的 HTML
    summary: string; cover: string; tags: string[]
    published_at: number | null; views: number; likes: number
    readingMinutes: number
  }
  comments: { html: string; count: number }  // 直接输出即可（含留言表单）
  related: HomePostView[]
}): string {
  return `<div class="my-article">
    <h1>${esc(d.post.title)}</h1>
    <div class="rich">${d.post.contentHtml}</div>
    ${likesBtn(d.post.slug, d.post.likes)}
    ${d.comments.html}
  </div>`
}

export function about(d: { settings: Record<string, string>; contentHtml: string }): string {
  return `<div class="my-about"><div class="rich">${d.contentHtml}</div></div>`
}

export function weibo(d: {
  settings: Record<string, string>
  categories: CategoryLink[]         // 顶部站点导航数据
  tags?: TagCount[]                  // 顶部导航「分类话题」菜单的标签
  items: WeiboItemView[]             // 微博列表 { id, content, images, created_at }
  page: number; totalPages: number; total: number
}): string {
  // 卡片/翻页可用 render.ts 的 weiboCards / weiboPager（语义化 .wb-* class，样式由你的 CSS 塑形）
  return `<div class="my-page">
    <h1>微博</h1>
    ${weiboCards({ settings: d.settings, items: d.items, avatarHtml: '' })}
    ${weiboPager(d.page, d.totalPages)}
  </div>`
}

export { id, css }
```

然后在 `registry.ts` 注册：

```ts
import * as mytheme from './mytheme'

export const THEMES: Record<string, ThemeModule> = {
  // …已有主题
  mytheme: { ...mytheme, id: 'mytheme', name: '我的主题', description: '一句话描述' } as ThemeModule,
}
```

保存后（本地 `npm run dev` 即时生效）到后台「设置 → 外观」就能看到并切换。

## 公共积木（来自 `src/render.ts`，鼓励复用）

| 导出 | 用途 |
| --- | --- |
| `esc(s)` | HTML 转义（标题、摘要等所有字符串必须转义后再拼接） |
| `fmtDate / fmtDateCN / fmtViews` | 日期（`2026-10-03` / `2026年10月3日`）与 `1.2w` 阅读数 |
| `pagerHtml({page,totalPages,base})` | 标准分页条，class 交给你的 CSS 塑形 |
| `commentsHtml({...})` | 完整留言区（列表 + 表单 + 蜜罐），语义化 class：`.cmt-*` |
| `likesBtn(slug, likes)` | 点赞按钮，配 `public/site.js` 自动工作，class `.like-btn` |
| `tagLink(name)` | 标签链接 `/tag/<encodeURIComponent(name)>` |
| `siteNav({cls,categories,tags,active})` | 顶部站点导航（首页 / 微博 / 「分类话题」details 折叠菜单 / 随机）。菜单面板（`.{cls}-menu/-chips/-caret` 等）由你的 CSS 塑形，参考任一现有主题的同名段落 |
| `weiboCards({settings,items,avatarHtml,adminName})` | 微博卡片列表（头像 + 文字 + 图片网格 + 折叠评论），class `.wb-*` |
| `weiboPager(page,totalPages)` | 微博翻页（上一条 / 更早），class `.wb-pager*` |
| `weiboImageGrid(images)` | 微博图片网格（1 大图 / 2·4 双列 / 其余三列） |

## 交互约定

公开页只挂了一个 `public/site.js`，主题不需要写任何 JS，自动处理：

1. 点击 `.like-btn` → 调 `/api/public/like/:slug`（或微博的 `/api/public/like/weibo/:id`），更新计数与 `.liked` 状态（localStorage 去重）
2. 提交 `#comment-form` / `.wb-cmt-form` → 调对应评论接口，成功后刷新或就地刷新列表；管理员登录态由服务端渲染进表单（免填昵称）
3. 微博卡片评论区的展开 / 折叠与楼中楼回复按钮
4. 顶部「分类话题」折叠菜单：点击菜单外或按 Esc 收起

想加更多交互？在你的主题 CSS 之外追加一个 JS 文件放 `public/`，并在 `src/render.ts` 的 `page()` 里加一行 `<script src="/你的.js" defer></script>`（CSP 已允许同源脚本）。

## 排版规范（建议遵守）

主题模板与正文渲染遵循《微信公众平台编辑器插件开发规范》要点，完整清单见 [wechat-typography-spec.md](wechat-typography-spec.md)。给主题作者的三条底线：

1. **不写固定像素宽**：容器用 `max-width + 百分比`，横滚等特殊场景在节点上加 `data-ignore-width`
2. **行高 ≥ 字号**：`line-height` 小于 `font-size` 会让多行文字重叠
3. **别在正文容器设 font-family**：跟随默认字体栈，各端观感一致（标题/代码可用）

## 正文 `.rich` 的样式责任

文章 HTML 由编辑器产出（已白名单净化），主题负责给 `.rich` 下的 `p / h2 / blockquote / pre / code / img / video / table / ul / ol / a / hr / mark / figcaption` 写样式——参考 `wechat.css` 的 `.rich` 段落即可。
