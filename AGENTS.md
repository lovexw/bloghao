# xwblog（基于博客号 BlogHao 二次开发）—— 开发约定

完全跑在 Cloudflare（Workers + D1 + R2）上的轻写作博客系统。后端约 10 个 TS 文件（hono），后台为原生 JS SPA，**无构建链**：改完即生效。

## 常用命令

```bash
npm run dev            # 本地开发（端口被占用时自动 +1）
npm run typecheck      # TypeScript 类型检查，提交前必须通过
npm run db:init:local  # 初始化本地 D1（.wrangler/state，幂等）
```

## Git 约定

- 本工作区**只负责这一个仓库**：origin = `github.com/lovexw/bloghao-xwblog`，不做其他项目/仓库的操作
- 上游原项目：`github.com/lovexw/bloghao-blog`（remote `upstream`，可用于同步上游更新）
- 提交信息沿用 `theme:` / `mobile:` / `docs:` / `brand:` 等前缀的中文风格
- 推送即 `git push origin main`

## 全站移动端适配（长期约定）

任何 UI 改动——前台页面、后台管理、编辑器——都必须保证手机端可用，**移动端写作（后台编辑器）是硬要求**：

- 新增样式至少验证 390px 宽度；断点沿用现有：前台 560/480px，后台 860/700px
- 输入控件（input/textarea/select）聚焦态字号 ≥16px，否则 iOS Safari 会自动放大页面
- 底部固定栏与底部导航要处理 `env(safe-area-inset-bottom)`
- 视口 meta 保持 `viewport-fit=cover, interactive-widget=resizes-content`
- 宽内容（表格、pre）在小屏用 `overflow-x: auto` 横向滚动，不撑破容器
- 覆盖层（抽屉、弹窗）小屏下要有明确的关闭按钮，且默认不挡内容

## 结构速查

- `src/themes/`：四套主题 + `registry.ts` 注册表，新主题见 docs/THEMES.md；`wechat` 为默认主题
- `src/pages.ts` 渲染公开页，`src/api.ts` 全部 JSON API；`src/collect.ts` 是公众号采集插件的服务端（编辑器插件在 `public/plugins/`，开发文档 docs/PLUGINS.md）
- `public/admin/`：后台（app.js 路由与页面，editor.js 写作编辑器，admin.css 样式）
- 编辑器内容样式（`.ed-editor`）与文章页（`.rich`）需保持视觉一致——改一处记得镜像另一处
