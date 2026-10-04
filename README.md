<div align="center">

<img src="public/favicon.svg" width="76" alt="xwblog">

# xwblog · 小吴乐意

**微信有公众号，你有博客号。** 写文章、发随手记、交朋友 · 全套跑在 Cloudflare 上 · 免费额度即可长期运行

**线上地址：[https://blog.xiaowuleyi.com](https://blog.xiaowuleyi.com)**

[![License](https://img.shields.io/badge/License-MIT-07c160) ![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%C2%B7%20D1%20%C2%B7%20R2-F38020) ![No Framework](https://img.shields.io/badge/%E5%89%8D%E5%90%8E%E7%AB%AF-%E6%97%A0%E6%A1%86%E6%9E%B6%E4%BE%9D%E8%B5%96-1a1a1a)](https://github.com/lovexw/bloghao-blog)

</div>

---

本仓库是 [博客号 BlogHao](https://github.com/lovexw/bloghao-blog)（一款完全运行在 Cloudflare 上的开源博客引擎）的**二次开发版本**：网页由 Workers 边缘渲染，文字存进 D1，图片传进 R2——服务器、运维、账单，统统不存在。写作后台对标微信公众号编辑器，截图 `⌘V` 粘贴即自动上云。

在原版「写文章」的基础上，这一版按自己的使用习惯扩展了一整套**日常记录与互动**能力：短内容的「微博 / 随手记」、楼中楼评论、友情链接、首页搜索与排序、公众号文章一键采集等，四套主题全部适配，手机端同样完整可用。

## ✨ 特性一览

| | |
| --- | --- |
| ✍️ **公众号风写作后台** | 富文本工具栏 / Markdown 模式互转 / 粘贴与拖拽自动上传 / 自动保存 / 分类·标签·封面·摘要·置顶 / 一键预览 |
| 🏪 **微博（随手记）** | 不用起标题的图文时间线：最多 9 图、`#话题#` 自动归类、置顶（最多 3 条）、点赞、评论，支持粘贴/拖拽发图 |
| 💬 **评论互动** | 文章与微博评论楼中楼、作者回复带徽标（登录后前台发言免填昵称）、站点级开关、先审后展 |
| 🤝 **友情链接** | 前台 `/links` 展示 + 访客在线申请收录；后台审核 / 排序 / 隐藏，图标可自动抓取、本地上传或直接粘贴 |
| 🔍 **站内搜索与排序** | 首页搜索文章；列表按最新 / 最多阅读 / 最多点赞 / 最多留言 / 随机排序（随机洗牌翻页不重洗） |
| 🩺 **排版体检** | 按微信官方规范静态检查 13 条规则（固定宽度、行高叠字、`!important`、嵌套层级、`data-w`…），支持一键修复 |
| 📰 **公众号采集** | 编辑器插件：粘贴公众号文章链接，抓正文、配图转存图床，生成保留原发布时间的草稿 |
| 🎨 **四套主题** | 微信公众号（明亮）/ 纸墨 / 极简 / 夜航，后台即点即换；主题即模块，开放注册 |
| 🖼️ **R2 图床** | 图片视频私有存储，Worker 鉴权输出 + 长缓存 + ETag 304，媒体库可视化管理 |
| 🔒 **安全默认开启** | PBKDF2 / HttpOnly 会话 / CSRF 同源校验 / HTML 白名单净化 / 评论与友链蜜罐限流 / CSP |
| ⚡ **快** | SSR 直出、主题 CSS 内联零额外请求、边缘节点全球分发 |
| 📡 **自带生态件** | RSS、sitemap、robots.txt、OG 分享标签、GitHub Actions 自动部署 |

<details>
<summary><b>📖 查看全部特性细节</b></summary>

- **文章**：草稿 / 发布 / 置顶 / 自定义 slug / 分类（单分类）/ 标签（多标签）/ 摘要 / 封面 / 阅读量与点赞 / 阅读时长 / 相关文章
- **微博**：5000 字以内 + 9 图，话题从正文 `#话题#` 自动提取（兼容 Memos 式 `#层级/标签`），草稿与置顶，微博页 `?topic=` 按话题筛选
- **外部发布**：Telegram 机器人发文字 / 图片 / 相册即发微博（相册自动合并，图片转存 R2，Chat ID 白名单）；另有 Token 鉴权开放 API（JSON / multipart / base64，教程见 docs/GUIDE.md 8.1–8.2）
- **评论**：文章评论 / 微博评论在后台分开管理；楼中楼回复；防垃圾三件套（蜜罐、同 IP 限流、长度限制）
- **分类与标签**：分类页 `/category/:slug`；分类页可直接预建 / 删除全站标签
- **站点外观**：站点名称 / 描述 / 页脚 / 头像 / 浏览器 favicon（均可上传到图床）/ 每页文章数 / 关于我富文本
- **规范属性透传**：`data-w`、`data-ignore-width`、`data-no-dark`、`data-ignore-dm` 原样保留
- **账号**：首次进入后台即创建管理员，后台可改密码

</details>

## 🗺 页面速查

| 地址 | 内容 |
| --- | --- |
| [`/`](https://blog.xiaowuleyi.com/) | 首页：微博入口卡 + 搜索框 + 排序条 + 文章列表 |
| [`/weibo`](https://blog.xiaowuleyi.com/weibo) | 微博时间线（随手记），从正文 `#话题#` 可进入话题筛选 |
| [`/archives`](https://blog.xiaowuleyi.com/archives) | 文章归档：全部文章按年份分组 |
| [`/guestbook`](https://blog.xiaowuleyi.com/guestbook) | 留言板：独立留言墙（楼中楼、作者回复） |
| [`/links`](https://blog.xiaowuleyi.com/links) | 友情链接 + 访客申请收录 |
| [`/post/:slug`](https://blog.xiaowuleyi.com) | 文章页（评论楼中楼、点赞、相关文章） |
| [`/category/:slug`](https://blog.xiaowuleyi.com) · `/tag/:tag` · `/search?q=` | 分类 / 标签 / 搜索归档 |
| [`/about`](https://blog.xiaowuleyi.com/about) · [`/random`](https://blog.xiaowuleyi.com/random) · [`/rss.xml`](https://blog.xiaowuleyi.com/rss.xml) | 关于我 · 随机一篇 · RSS 订阅 |
| [`/admin/`](https://blog.xiaowuleyi.com/admin/) | 管理后台（写作、微博、友链、评论、媒体、设置） |

顶部导航（四主题一致）：**首页 · 微博 · 归档 · 留言板 · 分类话题（折叠菜单）· 友情链接 · 关于我 · 随机**。

## 🚀 部署自己的副本

> 前置：Node.js 18+、一个 Cloudflare 账号。完整版教程（含自定义域名、备份、FAQ）见 [docs/DEPLOY.md](docs/DEPLOY.md)。

```bash
# 1. 克隆并安装
git clone https://github.com/lovexw/bloghao-xwblog.git
cd bloghao-xwblog && npm install
npx wrangler login

# 2. 创建资源（名称可自定，与 wrangler.jsonc 保持一致）
npx wrangler d1 create xwblog-db        # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler r2 bucket create xwblog-images

# 3. 初始化数据库（幂等，可重复执行）
npx wrangler d1 execute DB --remote --file schema.sql

# 4. 部署
npm run deploy
```

打开 `https://<worker名>.<你的子域>.workers.dev/admin/`，**首次进入即创建管理员**，欢迎文章已就位，删掉它开始写你自己的第一篇吧。绑定自定义域名（如本站的 `blog.xiaowuleyi.com`）后，记得把「设置 → 站点链接」改成新域名——RSS / sitemap 里的绝对链接都用它。

<details>
<summary><b>推上 GitHub，开启 push 自动部署</b></summary>

```bash
git remote add origin git@github.com:<你>/bloghao-xwblog.git
git push -u origin main
```

在仓库 Settings → Secrets → Actions 添加 `CLOUDFLARE_API_TOKEN`（Workers Scripts + D1 + R2 编辑权限）与 `CLOUDFLARE_ACCOUNT_ID`，仓库内置的 `.github/workflows/deploy.yml` 会在每次 push 到 `main` 时自动执行：类型检查 → 同步 schema → 部署。

</details>

## 🧑‍💻 本地开发

```bash
npm install
npm run db:init:local   # 初始化本地 D1（.wrangler/state，与线上互不影响）
npm run dev             # http://127.0.0.1:8787
npm run typecheck       # TypeScript 类型检查，提交前必须通过
```

## 📦 目录结构

```
bloghao-xwblog/
├── src/                # Cloudflare Worker（后端 + SSR + 主题）
│   ├── index.ts        # 入口与路由（页面、图床、RSS、随机阅读）
│   ├── api.ts          # 全部 JSON API（文章/微博/友链/分类/评论/设置…）
│   ├── external.ts     # 外部发布：开放 API + Telegram 机器人 + 管理端点
│   ├── pages.ts        # 公开页 SSR（首页/微博/友链/文章/搜索…）
│   ├── collect.ts      # 公众号采集插件服务端
│   ├── auth.ts / sanitize.ts / markdown.ts / db.ts / render.ts / rss.ts
│   └── themes/         # 四套主题 + 注册表（新主题加在这里）
├── public/
│   ├── admin/          # 管理后台 SPA（原生 JS，无构建）
│   ├── site.js         # 前台交互（点赞/评论/楼中楼/折叠菜单）
│   └── plugins/        # 编辑器插件（hello-plugin / wechat-collect）
├── migration-memos/    # Memos 旧站 → 微博 的一次性迁移工具（已完成，留档）
├── docs/               # 全部文档
└── schema.sql          # D1 表结构（幂等）
```

## 📚 文档

| 文档 | 内容 |
| --- | --- |
| [docs/GUIDE.md](docs/GUIDE.md) | **使用手册**：后台导览、写文章 / 发微博全流程、评论与友链管理、采集插件、设置逐项说明 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | **部署教程**：资源创建、首次上线、自定义域名、GitHub 自动部署、备份恢复、FAQ |
| [docs/API.md](docs/API.md) | API 参考：全部公开 / 管理接口 |
| [docs/THEMES.md](docs/THEMES.md) | 主题开发指南：一套主题 = 七类页面（首页 / 文章 / 微博 / 友链 / 关于我 / 归档 / 留言板） |
| [docs/PLUGINS.md](docs/PLUGINS.md) | 插件开发指南：编辑器插件 API 与内置「公众号采集」 |
| [docs/wechat-typography-spec.md](docs/wechat-typography-spec.md) | 微信排版规范落地对照 + 体检规则表 |

## ❓ FAQ

<details>
<summary><b>workers.dev 域名访问慢或不通？</b></summary>

绑定自己的域名：Cloudflare 面板 → Workers & Pages → `xwblog` → Domains & Routes → Add Custom domain（本站即 `blog.xiaowuleyi.com`）。绑定后把「设置 → 站点链接」改成新域名（影响 RSS / sitemap 绝对链接）。
</details>

<details>
<summary><b>忘记管理员密码？</b></summary>

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM users; DELETE FROM sessions;"
```

然后重新访问 `/admin/` 创建账号，文章 / 评论 / 图片全部保留。
</details>

<details>
<summary><b>会一直免费吗？</b></summary>

Cloudflare 免费套餐：Workers 每天十万次请求、D1 五百万行读、R2 10GB 存储——对个人博客是几个月到几年的量。用超了再考虑 $5/月的付费计划，代码无需任何改动。
</details>

<details>
<summary><b>如何升级？</b></summary>

```bash
git pull          # 同步上游：git pull upstream main（上游为 lovexw/bloghao-blog）
npm install
npm run deploy    # schema 有更新时再执行一次 npx wrangler d1 execute DB --remote --file schema.sql（幂等）
```
</details>

## 🛣 路线图

- [ ] 多作者协作
- [ ] 编辑器 Markdown 快捷输入（`> ` 自动转引用等）
- [ ] 服务端插件钩子（发布 / 评论事件回调）
- [ ] 主题市场：独立主题仓库一键安装
- [ ] 图片压缩与 WebP 自动转换

## 🤝 相关仓库

- 上游原项目：[lovexw/bloghao-blog](https://github.com/lovexw/bloghao-blog)（博客号 BlogHao 官网 [bloghao.pages.dev](https://bloghao.pages.dev)）——本仓库的功能改进欢迎给上游提 Issue / PR
- 本仓库（xwblog）只承载小吴乐意博客自身的二次开发，提交信息沿用 `theme:` / `mobile:` / `feat:` / `docs:` 前缀的中文风格

## 📄 License

[MIT](LICENSE) —— 拿去用，拿去改，拿去让更多人爱上写博客。
