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
npm run dev:demo       # 演示站本地预览（自动建表+播种，见 docs/DEMO.md）
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
- sanitizeHtml 的**透传段统一过 `escapeStrayLt`**：未终结的标签前缀（`<img src=x onerror=…` 无 `>`）与未闭合 `<!--` 曾原样透传，浏览器会把后续页面标记当 img 属性（内联事件复活）或把整页吞进注释——改净化器别拆这个防护
- RSS/WXR 等 XML 输出的 `xmlEsc`/`cdata`/`rfc822` **统一来自 `src/xml.ts`**（rss.ts / sitemap / export.ts 同源），入口**统一剥控制字符**（XML 1.0 禁 U+0000-0008/000B/000C/000E-001F，CDATA 内同样非法）：一条脏数据曾能打挂整份 feed；`<loc>` 对 siteUrl 过 xmlEsc，slug 进 URL 统一 `encodeURIComponent`——别在文件里再写本地副本
- 上传常量与落库**统一走 `src/store.ts`**（`MAX_UPLOAD_BYTES`/`IMAGE_MIMES`/`imageExtOf`/`saveUpload`，api 上传、collect 采集转存、external 外部发布共用）；mime 白名单查表**必须走 `imageExtOf`**（内部 `hasOwnProperty`，`IMAGE_MIMES['constructor']` 是继承属性可穿透校验）——改体积/类型口径只改 store.ts 一处
- 公开留言三路（文章 /api/public/comments、留言板 /api/public/guestbook、微博评论）共用 api.ts 的 **`publicComment` 公共核心**（限流、蜜罐、作者回复、先审后展、TG 通知与插件广播全在里面）；新增留言形态只写细路由 + opts（文案称呼/归属列/是否收 email/website/通知上下文），别再抄整段流程
- `:id` 路由参数一律 `api.ts parseId()`（非法 404），别 `Number()` 后直传 D1——NaN bind 是 500
- PUT /admin/posts/:id 是**缺键即保留**语义（readPostPayload 的 `has` 标志）：列表页状态切换只发 `{status}`，新增部分更新字段要同步 has 列表与 PUT 赋值——冒烟「文章状态切换保留正文」守着，别改回全量覆盖

**时间口径（tests/utils.test.ts）**

- SSR 端一切日期显示统一北京时间：用 `utils.ts` 的 `cstDate/fmtDate/fmtDateCN/fmtDateTime`（+8h 后取 UTC 分量），**禁止** `new Date(ts).getHours()` 这类依赖 Worker 时区（UTC）的写法——0-8 点发布的内容会显示成前一天；SQL 里按天/年聚合用 `strftime(..., ts/1000 + 28800, 'unixepoch')`；客户端 site.js 同口径（+8h + getUTC*）
- 机器可读日期（JSON-LD 等结构化数据）用 `utils.ts` 的 `isoDate`（产出 `2026-10-05T08:30:00+08:00`，同北京时间口径），**禁止**裸 `toISOString()`（产出 UTC，0-8 点发布的 datePublished 会错位到前一天）；JSON-LD 序列化进 page() 前自动把 `<` 转 `\u003c` 防 `</script>` 逃逸，别在别处手拼 `<script type="application/ld+json">`

**SQL / 输入（tests/utils.test.ts）**

- `LIKE` 模式里凡是 `\` 转义了 `%`/`_`，SQL 必须声明 `ESCAPE '\'`，且 `\` 本身要先转义成 `\\`（搜索用 `utils.ts likePattern`，JSON 数组列用 `jsonItemLikePattern`，两函数同口径）
- 正文长度上限按 **UTF-8 字节**（`new TextEncoder().encode(...)`），不是字符数
- 自定义 slug 落库前过 `cleanSlug`；主题等枚举值校验用 `Object.prototype.hasOwnProperty.call(THEMES, v)`（防原型链属性穿透）

**后台交互（public/admin/，无自动化测试，靠约定）**

- 后台所有请求走 `api()`：401 会话过期已统一拦截回登录页（勿在别处重复处理，也别动 `state.user` 的判断顺序——登录表单的密码错误提示依赖它）；每个写操作按钮必须 try/catch + toast，请求期间 disabled 防连击
- 设置页「保存全部」的 body **不带 theme 键**（主题只在皮肤页管理；服务端 PUT 对 body 里存在的 key 一律写入——历史上带了就曾把皮肤静默重置成 wechat）；分类/媒体页等操作后的列表刷新统一 `navigate()`，别直调 `viewX()` 绕过防串页守卫
- 后台 SPA 经 wrangler assets 直出不经过 Worker，CSP 靠 admin/index.html 的 **meta 兜底**（前台在 pages.ts baseHeaders）：后台模板/弹窗里**禁止新增内联事件属性（onclick 等）与内联 `<script>`**，交互一律 addEventListener
- 操作回调里刷新列表统一 `navigate()`（自带 pendingRoute/navSeq 防串页守卫），别直接 `viewX()`——慢响应会把用户从新页面拽回旧页面
- editor.js 的 `plugins` 数组是模块级：`mountEditor` 开头清空 + `renderPluginButtons` 按停用名单过滤（ES module import 有缓存，只靠「不 import」卸不掉已加载插件）；路由离开编辑器调 `disposeEditor()` 摘除全局监听与挂起定时器
- settings 的三个密钥（externalToken/telegramBotToken/telegramWebhookSecret）**GET 与 PUT 响应都打码**，明文只在生成时返回一次；新增敏感键记得进 `SECRET_SETTINGS`
- 侧边栏菜单由 app.js 顶部 `MENU` 配置数组渲染（分组标签 + 待审徽标），桌面侧栏、移动端底部栏与「更多」抽屉共用同一份数据——**新增后台页面要同时登记 `MENU`、`navigate()` 与 `MOBILE_TAB_IDS`（不放底栏的会自动进抽屉）**，别再往模板里手写 `<a>`
- 插件 manifest（public/plugins/manifest.json）是对象格式 `{ id, file, title, description, version, author }`（editor.js 兼容旧字符串格式）；停用名单存 settings `pluginsDisabled`（`utils.ts cleanDisabledPlugins` 校验，id 只允许 `[A-Za-z0-9_-]`），皮肤/插件市场目录在 `public/market/catalog.json`
- 编辑器 `save()` 是串行队列（勿改回早退模式——会丢发布意图造成假成功）；新弹窗一律用现成的 `modal()`（自带 Esc 关闭与焦点管理）
- 输入框回车提交必须判 `e.isComposing || e.keyCode === 229`（中文输入法组词回车）

**前台 site.js 兼容（全文件是一个 IIFE，一处解析错误全站交互瘫痪）**

- 保持 ES5 风格（var/function）：**禁用 lookbehind 正则**（`(?<!…)` Safari ≤ 16.3 解析期抛 SyntaxError）——微博话题正则用捕获组消费前导字符的写法，改正则先跑 tests 外的 18 用例对照（与服务端 weiboTextHtml 同口径）
- **禁止裸调 localStorage**：隐私加固浏览器访问该属性即抛 SecurityError，一律走 `storeGet/storeSet`（内部 try/catch）

**演示站（tests/demo.test.ts，docs/DEMO.md）**

- 演示站只在 `DEMO_MODE` 下活（wrangler.demo.jsonc 注入，生产 Worker 不带）：所有 demo 分支必须走 `utils.ts isDemo()`（`'0'`/缺省必须为假，勿写成 truthy 宽判）；`src/demo.ts` 由 index.ts 动态 import，生产 isolate 不执行
- 种子内容（demo-posts/demo-content/demo-images）是确定性生成：改内容后 tests/demo.test.ts 守不变量——slug 唯一干净、正文无 script/id/内联事件、评论树父子时序合法、正文图片引用必须存在于 demoImages()
- 两个 D1 坑都在 demo 里踩过并修掉：单条 SQL 变量上限 100（多行 INSERT 每条最多 10 行×9 列）；settings 写入必须 `.run()` 收尾，裸 `await db.prepare().bind()` 是空操作不报错
- demo 冷启动靠 `ensureTables()` 执行打进 bundle 的 schema.sql（生产建表靠部署时 d1 execute，演示站必须能从空库自己长出来）——改 schema.sql 两处（表/列定义与 db.ts 迁移清单）同步时，演示站自动跟随，无需额外动作

**部署链路**

- schema.sql 与 db.ts 的 SCHEMA_COLUMNS/SCHEMA_TABLES 是同一 schema 的两份表达：**加列/表必须两处同步**，且 cron（index.ts `scheduled()`）入口已强制先跑 ensureSchema——冷启动 isolate 不经过 fetch 中间件
- 「关于我」→ 页面系统的播种在 ensureSchema 末尾：以 settings 记账位 `pagesSeeded` 防重复（页面删了也不复活），改迁移逻辑别破坏这个幂等性
- 导出 zip 是流式生成（zip.ts 用数据描述符，图片从 R2 边流边算 CRC）——改导出逻辑别把图片改成整包缓冲，Workers 内存扛不住；新表记得手动加进 backup.ts 的 BACKUP_TABLES
- 备份表数超过 `TABLE_ROW_LIMIT` 会在文件与 TG 中告警（backup.ts），改备份逻辑别把告警删了
- 一键闭站（src/closed.ts，index.ts 挂中间件）的白名单是「关站后自己进得去」的底线：`/admin`、`/api/admin`、`/api/auth`、`/api/meta`、`/api/health`、`/images` 必须放行，其余（页面 / RSS / sitemap / 公开 API）一律 503 + Retry-After（保搜索收录），已登录管理员放行预览——tests/site-status.test.ts 与冒烟「一键闭站链路」守着，动入口中间件先跑；灰度开关是 render.ts 往 `<html>` 注入 `filter:grayscale(100%)`，filter 会改 fixed 后代的定位基准，新主题引入 fixed 元素时先复查

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

- `src/themes/`：五套主题 + `registry.ts` 注册表（八类页面参数是导出的命名类型 `HomeData`/`PostData`/…，新增主题或字段只改 registry 一处；五主题 × 八页面渲染回归在 tests/themes.test.ts，改主题先跑）；`wechat` 为默认主题
- `src/pages.ts` 渲染公开页（含独立页面 `/page/:slug`，pages 表承载，`about` 页渲染在 `/about`）；`src/api.ts` 全部 JSON API；`src/collect.ts` 是公众号采集插件的服务端（编辑器插件在 `public/plugins/`，开发文档 docs/PLUGINS.md）；`src/export.ts` + `src/zip.ts` + `src/html-md.ts` 是数据导出（Markdown 包流式打 zip、WXR）；`src/closed.ts` 是一键闭站 / 灰度（settings `siteClosed` / `siteGrayscale`，独立成模块是为了 Node 测试能导入——index.ts 会级联加载主题 CSS）；`src/hooks.ts` 是服务端插件钩子（总线 + 注册表 + 官方示例三合一，发布/评论事件与页脚注入，插件失败必须吞掉不影响主流程，启停存 settings `serverPluginsDisabled`）
- `src/demo.ts` + `demo-content.ts` / `demo-posts.ts` / `demo-images.ts`：官方演示站引擎（独立 wrangler.demo.jsonc，DEMO_MODE 门控）——空库自播种、每 2 小时 cron 清库重灌、演示守卫（登录页公示 demo 账号、禁改密码、禁闭站、禁外发通知、全站 noindex）；种子内容确定性生成，文档 docs/DEMO.md
- `public/admin/`：后台（app.js 路由与页面——侧栏菜单看顶部 `MENU` 配置数组，editor.js 写作编辑器，admin.css 样式）；「皮肤 / 插件」是独立页面（`#/appearance`、`#/plugins`），市场目录在 `public/market/catalog.json`
- `website/`：「博客号」官网静态页（朱砂红新版设计），部署走 Cloudflare Pages 项目 `bloghao`，**勿用 Workers assets 另起部署通道**；「博客号目录」数据在 `website/public/data/showcase.json`，上榜入口指向 bloghao 的 issues；官网 UI 改动同样过 390px 移动端检查
- 编辑器内容样式（`.ed-editor`）与文章页（`.rich`）需保持视觉一致——改一处记得镜像另一处
- 前台微博卡管理（编辑 / 置顶 / 删除，site.js 末段）：管理按钮由 `render.ts weiboCards` 仅在 `adminName`（⟺ 管理员登录）时渲染，**访客 HTML 里不存在**；写操作复用 `/api/admin/weibo*`（session 鉴权）——`PUT` 是全量更新，**必须带原 images 否则配图被清**、必须显式传 `status:'published'` 否则会转草稿；编辑保存后的就地渲染（wbTextHtml / imgsClass）与后端 `weiboTextHtml / weiboImageGrid` 同口径，改正则或网格分列规则要两边同步；编辑态切换显隐用内联 `style.display`（主题 CSS 的 display 会盖掉 `[hidden]`）
