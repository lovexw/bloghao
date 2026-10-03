# 墨博 MoBlog

> 一支笔，一块云上的小院。写作像发微博一样轻，排版符合公众号规范，整站跑在 Cloudflare 上。

MoBlog 是一个**完全构建在 Cloudflare 免费套餐**上的博客系统：

| 组件 | 服务 | 说明 |
| --- | --- | --- |
| 网页与 API | Cloudflare **Workers** | 服务端渲染（SSR）+ JSON API，全球边缘节点 |
| 数据 | Cloudflare **D1** | SQLite 数据库，文章/评论/设置 |
| 图床 | Cloudflare **R2** | 图片与视频存储，经 Worker 鉴权后全球加速 |
| 后台静态资源 | Workers **Static Assets** | 无需额外的 Pages 项目 |

## 特性

- ✍️ **公众号风格的写作后台**：标题、正文、封面、标签一屏完成；截图直接 `⌘/Ctrl + V` 粘贴进正文自动上传 R2；支持拖拽上传、Markdown 模式互转、自动保存草稿、一键预览。
- 🩺 **排版体检**：内置《微信公众平台编辑器插件开发规范》静态检查（固定宽度、行高叠字、`height:0`、`text-align:start/end`、`<pre>` 包正文、字体族、`!important`、嵌套层级、图片 `data-w` 等），发布前一键体检。
- 🎨 **四套主题**：`wechat` 微信公众号（默认，支持 Dark Mode）/ `paper` 纸墨 / `minimal` 极简 / `midnight` 夜航。主题即代码模块，开放注册（见 [docs/THEMES.md](docs/THEMES.md)）。
- 🧩 **编辑器插件**：`window.MoBlog.registerPlugin({...})` 即可给工具栏加按钮（见 [docs/PLUGINS.md](docs/PLUGINS.md)）。
- 🔒 **安全**：PBKDF2 密码哈希、HttpOnly 会话 Cookie、同源校验防 CSRF、HTML 白名单净化防 XSS、评论蜜罐 + 限流、上传类型/大小白名单、CSP 安全响应头。
- ⚡ **快**：SSR 直出 + 主题 CSS 内联（零额外请求），文章图片 immutable 长缓存 + ETag 304。
- 📡 **自带** RSS `/rss.xml`、sitemap `/sitemap.xml`、robots.txt、OG 分享标签。

## 5 分钟部署

详细图文步骤见 [docs/DEPLOY.md](docs/DEPLOY.md)，速览版如下：

```bash
# 0. 准备：Node 18+，并已 npm install
npm install

# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 D1 数据库与 R2 存储桶
npx wrangler d1 create moblog-db
npx wrangler r2 bucket create moblog-images

# 3. 把上一步返回的 database_id 填进 wrangler.jsonc
#    然后初始化数据库表
npx wrangler d1 execute DB --remote --file schema.sql

# 4. 部署！
npm run deploy
```

部署完成后打开 `https://moblog.<你的子域>.workers.dev/admin/`，**首次访问会引导你创建管理员**，并自动生成一篇欢迎文章。

## 本地开发

```bash
npm run db:init:local   # 初始化本地 D1（.wrangler/state）
npm run dev             # http://127.0.0.1:8787
npm run typecheck       # TS 类型检查
```

## 推上 GitHub + 自动部署

```bash
git init && git add . && git commit -m "feat: 墨博 MoBlog 初始化"
# 在 GitHub 建一个空仓库后：
git remote add origin git@github.com:<你>/moblog.git
git push -u origin main
```

仓库自带 `.github/workflows/deploy.yml`：在 GitHub 仓库 Settings → Secrets 添加 `CLOUDFLARE_API_TOKEN`（权限：D1 Edit、Workers Scripts Edit、R2 Edit、Account Settings Read）和 `CLOUDFLARE_ACCOUNT_ID`，此后每次 push 到 `main` 自动构建部署、自动同步 schema。

## 二次开发

| 想做什么 | 去哪里 |
| --- | --- |
| 新增/修改主题 | [docs/THEMES.md](docs/THEMES.md)，改 `src/themes/` |
| 给编辑器写插件 | [docs/PLUGINS.md](docs/PLUGINS.md)，改 `public/plugins/` |
| 调接口 / 自建客户端 | [docs/API.md](docs/API.md) |
| 了解排版规范的落地 | [docs/wechat-typography-spec.md](docs/wechat-typography-spec.md) |
| 部署细节 / 自定义域名 / 忘记密码 | [docs/DEPLOY.md](docs/DEPLOY.md) |

代码即文档：整个后端只有约 10 个 TypeScript 文件（`src/`），前台是一个原生 JS 单页后台（`public/admin/`），没有任何前端框架与构建链，欢迎随便改。

## 忘记密码

用命令行重置（把 `demo` 换成你的用户名、`newpassword123` 换成新密码，哈希会用同样的 PBKDF2 算法即时计算）：

```bash
npx wrangler d1 execute DB --remote --command \
  "UPDATE users SET password_hash = '', salt = '' WHERE username = 'demo'"
```

目前版本暂不支持空哈希自动重置流程，最简单的方式是删除用户后重新初始化（保留文章数据）：

```bash
npx wrangler d1 execute DB --remote --command "DELETE FROM users; DELETE FROM sessions;"
```

然后重新访问 `/admin/` 创建账号即可（文章、评论、媒体都会保留）。

## License

MIT
