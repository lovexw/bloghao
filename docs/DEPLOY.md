# 博客号 BlogHao 完整部署教程

从零开始，把你的博客部署到 Cloudflare（全程可使用免费套餐）。

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
npx wrangler d1 create bloghao-db
```

输出大致如下：

```toml
[[d1_databases]]
binding = "DB"
database_name = "bloghao-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**把 `database_id` 复制**，打开 `wrangler.jsonc`，替换：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "bloghao-db",
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
npx wrangler r2 bucket create bloghao-images
```

> R2 免费额度：10GB 存储 / 每月 100 万次读、1000 万次写，个人博客绰绰有余。
> 不需要给桶开公开访问——图片统一通过你的 Worker 的 `/images/xxx` 路径带缓存头输出，桶保持私有更安全。

`wrangler.jsonc` 里的 `"bucket_name": "bloghao-images"` 若改名请同步修改。

## 3. 首次部署

```bash
npm run deploy
```

成功后 wrangler 会输出你的访问地址，例如：

```
Published bloghao v1.0.0
https://bloghao.<你的子域>.workers.dev
```

## 4. 初始化管理员

浏览器打开：

```
https://你的域名/admin/
```

首次访问会显示「创建管理员」页面：

1. 填用户名（2-24 位字母数字）、密码（≥ 8 位）、昵称
2. 点击「创建并进入」
3. 系统自动生成一篇欢迎文章，你可以在后台删掉它，开始写自己的第一篇

> 该入口只在数据库没有任何用户时开放，之后重复访问就是普通登录页。

## 5. 基本设置

后台 →「设置」：

- **站点名称 / 描述 / 页脚**：出现在首页头部、浏览器标题、RSS
- **站点链接**：填写最终访问域名（如 `https://blog.example.com`），用于 RSS 和 sitemap 里的绝对链接
- **外观**：四套主题即点即换
- **评论**：可开关留言、可开启「先审后展」

## 6. 绑定自定义域名（可选）

方法一（面板操作，推荐）：Cloudflare Dashboard → Workers & Pages → `bloghao` → Settings → Domains & Routes → **Add → Custom domain**，填入你托管在同一 Cloudflare 账号下的域名（如 `blog.example.com`），证书自动签发。

方法二（命令行）：在 `wrangler.jsonc` 增加后重新 `npm run deploy`：

```jsonc
"routes": [{ "pattern": "blog.example.com", "custom_domain": true }]
```

绑定后记得把「设置 → 站点链接」更新为新域名。

## 7. 推上 GitHub + push 自动部署

```bash
git init
git add .
git commit -m "feat: 博客号 BlogHao 初始化"
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
3. 之后每次 push 到 `main`，GitHub Actions 会自动：安装依赖 → 执行 schema.sql（幂等）→ `wrangler deploy`

## 8. 日常运维备忘

| 事项 | 命令 / 操作 |
| --- | --- |
| 看实时日志 | `npx wrangler tail` |
| 手动备份 D1（导出 SQL） | `npx wrangler d1 export bloghao-db --remote --output=backup.sql` |
| 恢复备份 | `npx wrangler d1 execute bloghao-db --remote --file=backup.sql` |
| 浏览数据 | Dashboard → Storage & Databases → D1 → bloghao-db → Console |
| 重置管理员（清空用户重新创建） | `npx wrangler d1 execute DB --remote --command "DELETE FROM users; DELETE FROM sessions;"`，再访问 `/admin/` |
| 查看图片占用量 | Dashboard → R2 → bloghao-images，或后台「媒体」页 |

## 9. 本地开发

```bash
npm run db:init:local   # 初始化 .wrangler/state 下的本地 D1
npm run dev             # http://127.0.0.1:8787（本地 D1/R2 全模拟，不花钱）
npm run typecheck       # TypeScript 类型检查
```

本地与线上行为一致（同一套 Workers runtime）。上传的测试图片存放在本地模拟的 R2 里，不会占用线上额度。

## 10. 常见问题

**Q：部署时报 `database_id` 无效？**
A：确认你填的是 `wrangler d1 create` 返回的 UUID，且 `database_name` 与实际一致。

**Q：访问首页 500？**
A：多半是没执行 `d1 execute DB --remote --file schema.sql`，或 `wrangler.jsonc` 里 D1 的 binding 名被改了（必须叫 `DB`）。

**Q：图片上传失败？**
A：确认 R2 桶名与 `wrangler.jsonc` 一致；确认文件类型是 JPG/PNG/WebP/GIF 或 MP4/WebM，且 ≤ 25MB。

**Q：workers.dev 域名在国内访问慢/被墙？**
A：workers.dev 域名在部分地区不稳定，绑定一个自己的域名（第 6 步）通常即可解决。

**Q：想改端口/项目名？**
A：项目名改 `wrangler.jsonc` 的 `name`；本地端口 `npm run dev -- --port 9000`。
