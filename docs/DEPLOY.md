# 博客号 BlogHao 完整部署教程

从零开始，把这套博客部署到 Cloudflare（全程可使用免费套餐）。

> 在线示例：**https://blog.xiaowuleyi.com**（作者实例；Worker 名 `xwblog`，数据库 `xwblog-db`，图床桶 `xwblog-images`，与仓库内 wrangler.jsonc 一致）。给自己部署一套时，资源名可以原样沿用，也可以自行替换——与你的 wrangler.jsonc 保持一致即可。

## 0. 准备工作

- 一个 Cloudflare 账号（免费版即可）：[dash.cloudflare.com](https://dash.cloudflare.com) 注册
- 本机安装 Node.js 18 或更高版本
- 本项目代码（clone 或 fork 后下载）

```bash
cd bloghao
npm install
npx wrangler login   # 会打开浏览器授权，登录你的 Cloudflare 账号
npx wrangler whoami  # 确认登录成功
```

## 1. 创建 D1 数据库

```bash
npx wrangler d1 create xwblog-db
```

输出大致如下：

```toml
[[d1_databases]]
binding = "DB"
database_name = "xwblog-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**把 `database_id` 复制**，打开 `wrangler.jsonc`，替换（仓库里已填的是本站自己的 id，部署你自己的副本时换成你的）：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "xwblog-db",
    "database_id": "粘贴你的 database_id"
  }
]
```

然后初始化表结构（幂等，可重复执行）：

```bash
npx wrangler d1 execute DB --remote --file schema.sql
```

## 2. 创建 R2 存储桶（图床）

```bash
npx wrangler r2 bucket create xwblog-images
```

> R2 免费额度：10GB 存储 / 每月 100 万次读、1000 万次写，个人博客绰绰有余。
> 不需要给桶开公开访问——图片统一通过你的 Worker 的 `/images/xxx` 路径带缓存头输出，桶保持私有更安全。

`wrangler.jsonc` 里的 `"bucket_name": "xwblog-images"` 若改名请同步修改。

## 3. 首次部署

```bash
npm run deploy
```

成功后 wrangler 会输出你的访问地址，例如：

```
Published xwblog v1.0.0
https://xwblog.<你的子域>.workers.dev
```

## 4. 初始化管理员

浏览器打开：

```
https://你的域名/admin/
```

首次访问会显示「创建管理员」页面：

1. 填用户名（2-24 位字母、数字、_ 或 -）、密码（≥ 8 位）、昵称
2. 点击「创建并进入」
3. 系统自动生成一篇欢迎文章，你可以在后台删掉它，开始写自己的第一篇

> 该入口只在数据库没有任何用户时开放，之后重复访问就是普通登录页。

## 5. 基本设置

后台 →「设置」：

- **站点名称 / 描述 / 页脚**：出现在首页刊头、浏览器标题、RSS
- **站点链接**：填写最终访问域名（本站即 `https://blog.xiaowuleyi.com`），用于 RSS 和 sitemap 里的绝对链接。绑定了自定义域名就**务必填上**
- **站点头像 / 网站图标**：都从后台上传、存进 R2 图床，改即时生效
- **外观**：四套主题即点即换
- **评论**：可开关留言、可开启「先审后展」

## 6. 绑定自定义域名

workers.dev 域名在国内部分地区不稳定，正式使用建议绑一个自己的域名（本站绑的就是 `blog.xiaowuleyi.com`）。**前提**：这个域名已托管在同一个 Cloudflare 账号下（即域名的 DNS 由 Cloudflare 管理）。

方法一（面板操作，推荐）：Cloudflare Dashboard → Workers & Pages → `xwblog` → Settings → Domains & Routes → **Add → Custom domain**，填入 `blog.你的域名.com`，证书自动签发，几分钟内生效。

方法二（命令行）：在 `wrangler.jsonc` 增加后重新 `npm run deploy`：

```jsonc
"routes": [{ "pattern": "blog.xiaowuleyi.com", "custom_domain": true }]
```

绑定完成后还有一步别漏：后台「设置 → 站点链接」改成新域名（如 `https://blog.xiaowuleyi.com`）——RSS、sitemap、OG 分享卡里的绝对链接都取这个值。

## 7. 推上 GitHub + push 自动部署

```bash
git init
git add .
git commit -m "feat: bloghao 初始化"
# GitHub 上新建空仓库后：
git remote add origin git@github.com:<你>/bloghao.git
git branch -M main
git push -u origin main
```

仓库已内置 `.github/workflows/deploy.yml`。要启用它：

1. Cloudflare 面板 → My Profile → API Tokens → Create Token → 使用「Edit Cloudflare Workers」模板，并**额外勾选 D1 Edit 与 R2 Edit 权限**
2. GitHub 仓库 → Settings → Secrets and variables → Actions，添加两个 secret：
   - `CLOUDFLARE_API_TOKEN`：上一步的令牌
   - `CLOUDFLARE_ACCOUNT_ID`：面板首页右侧可以看到
3. 之后每次 push 到 `main`，GitHub Actions 会自动：类型检查 → 安装依赖 → 执行 schema.sql（幂等）→ `wrangler deploy`。另有内置的 `ci.yml` 与部署并行，跑类型检查 + 回归测试（`tests/` 30+ 用例），防止已修复的 bug 悄悄复发

## 8. 日常运维备忘

| 事项 | 命令 / 操作 |
| --- | --- |
| 看实时日志 | `npx wrangler tail` |
| 手动备份 D1（导出 SQL） | `npx wrangler d1 export xwblog-db --remote --output=backup.sql` |
| 恢复备份 | `npx wrangler d1 execute xwblog-db --remote --file=backup.sql` |
| 浏览数据 | Dashboard → Storage & Databases → D1 → xwblog-db → Console |
| 重置管理员（清空用户重新创建） | `npx wrangler d1 execute DB --remote --command "DELETE FROM users; DELETE FROM sessions;"`，再访问 `/admin/` |
| 查看图片占用量 | Dashboard → R2 → xwblog-images，或后台「媒体」页 / 概览页 |

## 9. 本地开发

```bash
npm run db:init:local   # 初始化 .wrangler/state 下的本地 D1
npm run dev             # http://127.0.0.1:8787（本地 D1/R2 全模拟，不花钱）
npm run typecheck       # TypeScript 类型检查，提交前必须通过
npm test                # 回归测试（tests/，30+ 用例），提交前必须通过
npm run smoke           # 本地冒烟：起 wrangler dev 逐路由断言 200，改 SQL 拼接/渲染后必跑
```

本地与线上行为一致（同一套 Workers runtime）。上传的测试图片存放在本地模拟的 R2 里，不会占用线上额度。

## 10. 常见问题

**Q：部署时报 `database_id` 无效？**
A：确认你填的是 `wrangler d1 create` 返回的 UUID，且 `database_name` 与实际一致（本仓库为 `xwblog-db`）。

**Q：访问首页 500？**
A：多半是没执行 `d1 execute DB --remote --file schema.sql`，或 `wrangler.jsonc` 里 D1 的 binding 名被改了（必须叫 `DB`）。

**Q：图片上传失败？**
A：确认 R2 桶名与 `wrangler.jsonc` 一致（`xwblog-images`）；确认文件类型是 JPG/PNG/WebP/GIF 或 MP4/WebM，且 ≤ 25MB。

**Q：workers.dev 域名在国内访问慢/被墙？**
A：绑定一个自己的域名（第 6 步）通常即可解决，本站的 `blog.xiaowuleyi.com` 就是这么来的。

**Q：绑定自定义域名后 RSS / 分享卡片里还是旧的 workers.dev 链接？**
A：把后台「设置 → 站点链接」改成新域名并保存。

**Q：想改端口/项目名？**
A：项目名改 `wrangler.jsonc` 的 `name`；本地端口 `npm run dev -- --port 9000`。

## 11. 附：官网（bloghao.com）是怎么部署的（维护者备忘）

博客号官网是与博客系统互相独立的纯静态站点，源码在仓库 `website/` 目录，部署在 Cloudflare **Pages** 项目 `bloghao`（即 bloghao.pages.dev），自定义域绑定为 `bloghao.com`：

- **改动发布**：修改 `website/public/` 后 push 到 GitHub，Pages 项目连着 `bloghao` 仓库（构建输出目录 `website/public`）会自动部署；也可手动 `cd website && npx wrangler pages deploy public`
- **「博客号目录」**：数据在 `website/public/data/showcase.json`，访客通过官网入口向 [bloghao](https://github.com/lovexw/bloghao) 提 Issue 申请上榜，审核通过后把站点加进 JSON 即可
- **在线示例**：官网指向的演示站（bloghao-blog.0471666.workers.dev）是引擎的另一套独立 Worker 部署，专供访客体验；作者实例 blog.xiaowuleyi.com 不作演示用
- 官网与本博客 Worker 互不影响，部署 / 回滚都在 Workers & Pages 的 `bloghao` 项目里操作
