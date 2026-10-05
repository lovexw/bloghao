# xwblog（基于博客号 BlogHao 二次开发）—— 开发约定

完全跑在 Cloudflare（Workers + D1 + R2）上的轻写作博客系统。后端约 10 个 TS 文件（hono），后台为原生 JS SPA，**无构建链**：改完即生效。

## 线上站点（文档里以此为准）

- 正式地址：**https://blog.xiaowuleyi.com**（已绑定到本仓库的 Worker），后台 `/admin/`
- 官网：**https://bloghao.com**（Cloudflare Pages 项目 `bloghao`，源码在仓库 `website/`——纯静态无构建，与博客系统运行无关；Pages 默认域 bloghao.pages.dev）
- Cloudflare 资源：Worker `xwblog`、D1 `xwblog-db`、R2 `xwblog-images`（binding 均见 wrangler.jsonc）
- 使用手册 docs/GUIDE.md、部署教程 docs/DEPLOY.md——涉及访问地址、备份命令时写上面的正式域名与资源名

## 常用命令

```bash
npm run dev            # 本地开发（端口被占用时自动 +1）
npm run typecheck      # TypeScript 类型检查，提交前必须通过
npm test               # 回归测试（tests/，30+ 用例），提交前必须通过；CI（.github/workflows/ci.yml）每次推送强制执行
npm run smoke          # 本地冒烟：起 wrangler dev 逐路由断言 200（含多标签文章页回归守卫），改 SQL 拼接/渲染后必跑
npm run db:init:local  # 初始化本地 D1（.wrangler/state，幂等）
```

## 回归防线（改代码前先读，防已修好的 bug 复发）

2026-10 做过一轮全量安全/健壮性审查并修复了三类共 40+ 问题；`tests/` 里的用例与下面每条规矩一一对应。**改动相关代码时先跑 `npm test`，新增同类功能必须沿用同一模式**：

**XSS / 净化（tests/sanitize.test.ts、tests/markdown.test.ts）**

- URL 白名单校验（sanitize.ts `safeUrl`、markdown.ts `safeUrlMd`）必须**先剥离 `\t\r\n`** 再做前缀判断——URL 解析器会忽略这些字符，`jav\tascript:` 这类混淆靠原始字符串拦不住；放行出的属性值必须再经 `escAttr`（实体二次转义也是防线）
- 净化器**不放行 `id` 属性**（DOM clobbering 会打瘫评论区）；`<meta data-og-image>` 是唯一例外，改 OG 卡图功能时同步 tests/sanitize.test.ts 与 docs/API.md 白名单摘要
- markdown.ts 的 `inline()` 收到的文本已经 `escLine` 转义过，属性上下文只能用 `escQuote` 补引号，**严禁再过 `escAttr`**（会把 `&` 打成 `&amp;amp;`，含参数的链接/图片 URL 全坏）
- 图片转存（collect.ts）**只认文件魔数**（`sniffImageExt`），不信任源站 Content-Type / URL 参数；`/images/` 路由必须保留 `X-Content-Type-Options: nosniff`

**时间口径（tests/utils.test.ts）**

- SSR 端一切日期显示统一北京时间：用 `utils.ts` 的 `cstDate/fmtDate/fmtDateCN/fmtDateTime`（+8h 后取 UTC 分量），**禁止** `new Date(ts).getHours()` 这类依赖 Worker 时区（UTC）的写法——0-8 点发布的内容会显示成前一天；SQL 里按天/年聚合用 `strftime(..., ts/1000 + 28800, 'unixepoch')`；客户端 site.js 同口径（+8h + getUTC*）

**SQL / 输入（tests/utils.test.ts）**

- `LIKE` 模式里凡是 `\` 转义了 `%`/`_`，SQL 必须声明 `ESCAPE '\'`，否则转义不生效；JSON 数组列（tags/topics）匹配用 `jsonItemLikePattern`（带引号精确匹配 + 转义）
- 正文长度上限按 **UTF-8 字节**（`new TextEncoder().encode(...)`），不是字符数
- 自定义 slug 落库前过 `cleanSlug`；主题等枚举值校验用 `Object.prototype.hasOwnProperty.call(THEMES, v)`（防原型链属性穿透）

**后台交互（public/admin/，无自动化测试，靠约定）**

- 后台所有请求走 `api()`：401 会话过期已统一拦截回登录页（勿在别处重复处理，也别动 `state.user` 的判断顺序——登录表单的密码错误提示依赖它）；每个写操作按钮必须 try/catch + toast，请求期间 disabled 防连击
- 侧边栏菜单由 app.js 顶部 `MENU` 配置数组渲染（分组标签 + 待审徽标），桌面侧栏、移动端底部栏与「更多」抽屉共用同一份数据——**新增后台页面要同时登记 `MENU`、`navigate()` 与 `MOBILE_TAB_IDS`（不放底栏的会自动进抽屉）**，别再往模板里手写 `<a>`
- 插件 manifest（public/plugins/manifest.json）是对象格式 `{ id, file, title, description, version, author }`（editor.js 兼容旧字符串格式）；停用名单存 settings `pluginsDisabled`（`utils.ts cleanDisabledPlugins` 校验，id 只允许 `[A-Za-z0-9_-]`），皮肤/插件市场目录在 `public/market/catalog.json`
- 编辑器 `save()` 是串行队列（勿改回早退模式——会丢发布意图造成假成功）；新弹窗一律用现成的 `modal()`（自带 Esc 关闭与焦点管理）
- 输入框回车提交必须判 `e.isComposing || e.keyCode === 229`（中文输入法组词回车）

**部署链路**

- schema.sql 与 db.ts 的 SCHEMA_COLUMNS/SCHEMA_TABLES 是同一 schema 的两份表达：**加列/表必须两处同步**，且 cron（index.ts `scheduled()`）入口已强制先跑 ensureSchema——冷启动 isolate 不经过 fetch 中间件
- 备份表数超过 `TABLE_ROW_LIMIT` 会在文件与 TG 中告警（backup.ts），改备份逻辑别把告警删了

## Git 约定

- 本工作区同时服务**两个同源仓库**（2.0 起内容完全一致）：origin = `github.com/lovexw/bloghao-xwblog`（作者实例/开发仓库），upstream = `github.com/lovexw/bloghao`（官方发布仓库，对外开放部署）。不做这两个仓库之外的操作
- 发布流程：提交后**双推**——`git push origin main && git push upstream main`，两仓库始终指向同一提交（同分支同内容，两仓库各自维护 README 会造成同步冲突，故统一一份官方口吻文档）
- README / docs / 官网以「博客号 BlogHao」官方项目口吻书写，对两个仓库都自洽；线上地址 blog.xiaowuleyi.com 在文档中一律表述为「在线示例」
- 旧「同步上游」流程已废止（官方仓库不再单独演进），**不要**从 upstream pull 覆盖本地
- 2026-10-05 仓库整理：官方发布仓库由 bloghao-blog **改名**为 `lovexw/bloghao`（旧地址 GitHub 自动重定向）；更早的独立官网仓库已删除、内容并入 `website/`——遇到提这两个旧名字的链接/文档一律以现名为准
- 提交信息沿用 `theme:` / `mobile:` / `docs:` / `brand:` 等前缀的中文风格

## 全站移动端适配（长期约定）

任何 UI 改动——前台页面、后台管理、编辑器——都必须保证手机端可用，**移动端写作（后台编辑器）是硬要求**：

- 新增样式至少验证 390px 宽度；断点沿用现有：前台 560/480px，后台 860/700px
- 输入控件（input/textarea/select）聚焦态字号 ≥16px，否则 iOS Safari 会自动放大页面
- 底部固定栏与底部导航要处理 `env(safe-area-inset-bottom)`
- 视口 meta 保持 `viewport-fit=cover, interactive-widget=resizes-content`
- 宽内容（表格、pre）在小屏用 `overflow-x: auto` 横向滚动，不撑破容器
- 覆盖层（抽屉、弹窗）小屏下要有明确的关闭按钮，且默认不挡内容

## 结构速查

- `src/themes/`：五套主题 + `registry.ts` 注册表，新主题见 docs/THEMES.md；`wechat` 为默认主题
- `src/pages.ts` 渲染公开页，`src/api.ts` 全部 JSON API；`src/collect.ts` 是公众号采集插件的服务端（编辑器插件在 `public/plugins/`，开发文档 docs/PLUGINS.md）
- `public/admin/`：后台（app.js 路由与页面——侧栏菜单看顶部 `MENU` 配置数组，editor.js 写作编辑器，admin.css 样式）；「皮肤 / 插件」是独立页面（`#/appearance`、`#/plugins`），市场目录在 `public/market/catalog.json`
- `website/`：「博客号」官网静态页（朱砂红新版设计），部署走 Cloudflare Pages 项目 `bloghao`，**勿用 Workers assets 另起部署通道**；「博客号目录」数据在 `website/public/data/showcase.json`，上榜入口指向 bloghao 的 issues；官网 UI 改动同样过 390px 移动端检查
- 编辑器内容样式（`.ed-editor`）与文章页（`.rich`）需保持视觉一致——改一处记得镜像另一处
