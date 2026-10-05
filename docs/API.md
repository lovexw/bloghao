# API 参考

所有接口前缀 `/api`，JSON 交互。管理接口需要会话 Cookie（浏览器登录后台后自动携带）。

写爬虫/客户端时注意：非 GET 请求必须**同源**携带 `Origin` 头或直接不携带，跨源一律 403。

## 公开接口

### GET /api/health
`{"ok":true,"time":...}`

### GET /api/public/posts?page=1&limit=10&tag=生活
已发布文章分页（摘要视图），返回 `{items, total, page, totalPages}`，`items` 元素含 `slug/title/summary/cover/tags/published_at/views/likes/pinned`。

> 列表排序（最新/最多阅读/最多点赞/最多留言/随机）目前只由 SSR 页面（首页 / 分类 / 搜索）使用，本接口固定按最新（置顶优先）返回。

### POST /api/public/comments
文章留言。Body：

```json
{ "slug": "hello-bloghao", "nickname": "路人甲", "content": "写得真好", "link": "" }
```

- `link` 是蜜罐字段，正常客户端永远传空字符串/不传
- 受限流（同 IP 10 分钟 5 条）与站点「开启留言 / 先审后展」设置约束
- `nickname` ≤ 24 字，`content` ≤ 1000 字，均为纯文本存储
- **作者回复（楼中楼）**：登录管理员携带 `parentId`（被回复的评论 id）即以作者身份回复，免昵称、免限流、绕过「关闭留言」开关、直接展示并带「作者」徽标；未登录携带 `parentId` 一律 403
- 响应 `{ok:true}` 或 `{ok:true, pending:true}`（先审后展开启时，前端据此刻意不刷新）

### POST /api/public/like/:slug
Body `{"delta": 1}` 或 `{"delta": -1}`，返回 `{"ok":true,"likes":7}`。计数不会为负。

### POST /api/public/like/weibo/:id
微博点赞，同上。

### POST /api/public/guestbook
留言板留言（`/guestbook` 页）。Body 与规则同 `POST /api/public/comments`（`nickname` / `content` / 蜜罐 `link` / 限流 / 审核），无 `slug`；管理员带 `parentId` 即以作者身份回复（楼中楼）。存储上留言板留言是 `post_id = 0 AND weibo_id = 0` 的评论。响应 `{ok, pending?}`。

### GET /api/public/weibo/:id/comments
微博的已展示评论（平铺 ASC，最多 200 条），元素含 `id/parent_id/is_admin/nickname/content/created_at`；前端按 `parent_id` 组装楼中楼。响应 `{comments, allowComments}`。

### POST /api/public/weibo/:id/comments
微博评论。规则同 `POST /api/public/comments`（蜜罐 / 限流 / 审核 / 管理员 `parentId` 回复），`nickname`/`content` 约束一致。

### POST /api/public/links/apply
友链申请（访客提交，进入待审核）。Body：

```json
{ "name": "朋友的博客", "url": "blog.example.com", "description": "一句话介绍", "link": "" }
```

- `link` 为蜜罐字段；同 IP 10 分钟限 3 次
- `url` 自动补全 `https://` 前缀并做 URL 规整，非法返回错误；同名网址去重
- `name` ≤ 40 字，`description` ≤ 120 字；成功入库 `status='pending'`、`source='user'`

## 认证

### GET /api/auth/state
`{"needsSetup": true, "user": null}` —— `needsSetup=true` 表示尚无任何用户，可调用 setup。

### POST /api/auth/setup （仅首次）
```json
{ "username": "demo", "password": "至少8位", "displayName": "小吴" }
```
创建管理员 + 欢迎文章，响应 Set-Cookie 会话（30 天）。

### POST /api/auth/login
`{ "username", "password" }`。同 IP 10 分钟内最多尝试 10 次。

### POST /api/auth/logout
销毁会话。

## 管理接口（需登录）

### GET /api/admin/stats
概览统计：`{posts, views, likes, drafts, pendingComments, pendingLinks, uploads:{count,bytes}, recent:[…]}`

### 文章
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/posts?status=all\|published\|scheduled\|draft&q=关键词&page=1&limit=20` | 列表（不含 content；元素附 `tagList`、`categoryName`） |
| POST | `/api/admin/posts` | 新建 |
| GET | `/api/admin/posts/:id` | 详情（含 content、categoryId） |
| PUT | `/api/admin/posts/:id` | 更新（autosave 用；已发布时间不会被草稿保存抹掉） |
| POST | `/api/admin/posts/:id/pin` | Body `{pinned:true/false}` |
| DELETE | `/api/admin/posts/:id` | 删除（连带评论与分类关联） |
| GET | `/api/admin/tags` | 全站标签聚合（编辑器补全用，见下方「标签」） |

文章 Body 字段：

```json
{
  "title": "标题",
  "content": "<p>富文本 HTML，服务端会白名单净化</p>",
  "summary": "摘要，可空",
  "cover": "/images/u/202610/xxx.jpg",
  "tags": ["生活", "Cloudflare"],
  "categoryId": 1,
  "status": "draft | published | scheduled",
  "publishAt": 1791121500000,
  "pinned": false,
  "slug": "留空自动生成，可自定义"
}
```

约束：title ≤ 150 字；content ≤ 1MB；tags ≤ 8 个、每个 ≤ 20 字；cover 必须以 `/` 或 `http(s)://` 开头；`categoryId` 为 null/空表示未分类，不存在分类 id 时被忽略。`status:"scheduled"` 时 `publishAt` 为毫秒时间戳（到点由每分钟 Cron 翻成 published 并把 `published_at` 设为该时刻，同时推 Telegram；转 published/draft 时 `publishAt` 自动清空）。

### 微博（随手记）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/weibo?status=all\|published\|draft&page=1&limit=20` | 列表（置顶优先；元素附 `imageList`、`topicList`、`commentCount`） |
| POST | `/api/admin/weibo` | 新建（发布或存草稿） |
| PUT | `/api/admin/weibo/:id` | 更新（转回草稿会自动取消置顶） |
| POST | `/api/admin/weibo/:id/pin` | Body `{pinned:true/false}` |
| DELETE | `/api/admin/weibo/:id` | 删除（连带其下评论） |

微博 Body 字段：

```json
{
  "content": "文字内容，可含 #话题#",
  "images": ["/images/u/202610/xxx.jpg"],
  "status": "published | draft"
}
```

约束：`content` ≤ 5000 字；`images` ≤ 9 张、只接受站内 `/images/` 与 `http(s)` 外链；`content` 与 `images` 不能同时为空；**话题不接受直传**——服务端从正文 `#话题#`（兼容 `#话题` 与 `#层级/标签`）自动提取；置顶最多 3 条，草稿不能置顶。

### 友情链接
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/links?status=all\|approved\|pending` | 列表（不回传提交者 ip；附 `pending` 计数、`source: admin\|user`） |
| POST | `/api/admin/links` | 手动添加（默认 `status:'approved'`） |
| POST | `/api/admin/links/fetch-icon` | Body `{url}`，抓取目标站 favicon 存 R2 → `{icon:"/images/u/fav/…"}` |
| POST | `/api/admin/links/:id/approve` | 收录（pending → approved）；无图标时后台异步补抓，不卡响应 |
| POST | `/api/admin/links/:id/refresh-icon` | 重新抓取图标 |
| POST | `/api/admin/links/reorder` | Body `{id, dir:"up"\|"down"}`，按当前顺序交换后整体回写 sort |
| PUT | `/api/admin/links/:id` | 编辑（含改状态：传 `status:'pending'` 即「隐藏」） |
| DELETE | `/api/admin/links/:id` | 删除 |

链接 Body 字段与约束：

```json
{ "name": "站名", "url": "https://…", "description": "简介", "icon": "/images/u/fav/… 或 https://…", "status": "approved | pending", "sort": 0 }
```

`name` ≤ 40 字；`url` 自动补全 `https://` 并规整；`description` ≤ 120 字；`icon` 只接受站内 `/images/` 与 `http(s)` 外链（防 `javascript:` 注入），留空前台用站名首字图标；服务端抓取图标时仅收 ICO/PNG/JPG/WebP/GIF、单文件 ≤ 300KB、超时 6 秒。

### 分类
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/categories` | 列表（附 `post_count` 文章计数） |
| POST | `/api/admin/categories` | Body `{name, slug?, sort?}`；slug 留空用名称，支持字母/数字/中文/短横线 |
| PUT | `/api/admin/categories/:id` | 编辑（名称与 slug 均不可重复） |
| DELETE | `/api/admin/categories/:id` | 删除（关联文章变为未分类，文章不受影响） |

`name` ≤ 20 字。单分类模型：一篇文章最多属于一个分类（`post_categories.post_id` 为主键）。

### 标签
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/tags` | 文章实际用到的标签 + 分类页预建标签（count 0），按使用次数排序，最多 200 个 |
| POST | `/api/admin/tags` | Body `{name}`，预建标签（≤ 20 字，不可重名） |
| DELETE | `/api/admin/tags/:name` | 删除标签，并从所有文章的 tags 中移除 |

### 上传 / 媒体
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/upload` | multipart，字段名 `file`；图片 JPG/PNG/WebP/GIF（favicon 另允许 ICO）、视频 MP4/WebM；≤ 25MB；限频 60 次/分钟/IP；返回 `{url:"/images/u/...", key, mime, size}`（前端上传前自动压缩大图，API 直传不压缩） |
| POST | `/api/admin/og-image` | multipart，字段名 `file`；仅 PNG（编辑器 canvas 生成的 1200×630 分享卡图），存 R2 `og/` 目录；返回 `{url:"/images/og/...", key}` |
| GET | `/api/admin/uploads?page=1` | 媒体列表（每页 24） |
| DELETE | `/api/admin/uploads?key=u/202610/xxx.png` | 从 R2 与索引中删除 |

### 评论
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/comments?status=all\|pending\|approved&type=all\|post\|weibo&page=1` | 列表（`type` 拆分文章评论 / 微博评论 / 留言板（`guestbook`）；附文章标题/slug、微博内容、父评论昵称） |
| PUT | `/api/admin/comments/:id` | Body `{status:"approved"\|"pending"}`（通过 / 隐藏） |
| POST | `/api/admin/comments/:id/replies` | Body `{content}`，以作者身份回复该评论（文章/微博/留言板通用），挂在同一顶层评论下，直接展示并带「作者」徽标 |
| DELETE | `/api/admin/comments/:id` | 删除（连带其下的回复） |

### 设置 / 账号 / 工具
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / PUT | `/api/admin/settings` | 可写键：`siteName, siteDescription, siteUrl, footerText, avatarUrl, faviconUrl, theme, allowComments, moderateComments, notifyNewComment, rssFullText, backupEnabled, postsPerPage, about, externalToken, telegramBotToken, telegramAllowFrom, telegramWebhookSecret`；`theme` 必须是已注册主题 id；`avatarUrl`/`faviconUrl` 只接受站内 `/images/` 与 `http(s)` 外链；`externalToken`/`telegramBotToken`/`telegramWebhookSecret` 为敏感项，GET 返回打码（`••••••••`），PUT 收到打码占位符视为保持原值 |
| PUT | `/api/admin/password` | Body `{oldPassword, newPassword}`（8-64 位） |
| POST | `/api/admin/tools/md` | Body `{md}` → `{html}`，Markdown 渲染 |
| POST | `/api/admin/tools/sanitize` | Body `{html}` → `{html}`，白名单净化（粘贴用） |

### 采集（公众号文章）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/collect/wechat` | Body `{url}`，仅接受 `https://mp.weixin.qq.com/s/...`；服务端抓取正文，配图与封面转存 R2，生成**保留原文发布时间**的草稿；返回 `{ok, post, account, images}`。限频 10 次/分钟/IP；单篇最多转存 30 张图、单图 ≤ 25MB、正文 ≤ ~900KB。编辑器插件「采集公众号文章」调用（见 docs/PLUGINS.md） |

### 外部发布（管理）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/external/token` | 生成并保存新的开放 API Token（旧的立即失效），返回 `{ok, token}` |
| POST | `/api/admin/external/telegram/webhook` | 校验 Bot Token（getMe）→ 首次自动生成 Webhook 密钥 → 调 Telegram setWebhook；返回 `{ok, bot:"@name", webhookUrl}`。需先通过设置接口保存 `telegramBotToken` |

外部发布相关设置键（可经 `PUT /api/admin/settings` 写入）：`externalToken`（开放 API 密钥，空 = 接口关闭，建议用上面的专用端点生成）、`telegramBotToken`、`telegramAllowFrom`（逗号分隔的 Chat ID 白名单）、`telegramWebhookSecret`（Webhook 密钥，建议由专用端点自动生成）、`notifyNewComment`（`1`/`0`，新留言推送到 Telegram，目标为白名单第一个 Chat ID）。

### 备份
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/backup` | 手动触发一次全量备份（与每晚 Cron 同一逻辑）：全部业务表导成 JSON 存进 R2 `backups/` 目录，返回 `{ok, key, bytes}`（开关关闭时 `skipped:true`）。结果同时写入设置 `lastBackupAt` / `lastBackupKey` / `lastBackupBytes`。Cron 由 wrangler.jsonc `triggers.crons` 配置（北京时间 00:30），失败时经 Telegram 提醒站长 |

### GET /api/meta/themes
已注册主题列表 `{themes:[{id,name,description}]}`。

## 外部接口（Token 鉴权，供 Telegram 机器人 / 第三方工具调用）

鉴权方式二选一（只认请求头，避免 Token 进访问日志）：`Authorization: Bearer <token>` 或 `X-Auth-Token: <token>`。Token 在后台「设置 → 外部发布」生成，空 Token = 接口关闭。

### GET /api/external/weibo
连通性测试，返回 `{ok, site, usage}`。

### POST /api/external/weibo
发布一条微博。`Content-Type: application/json` 与 `multipart/form-data` 均可：

```json
{ "content": "文字，可含 #话题#", "images": ["https://外链 或 /images/站内 或 data:image/…;base64,…"], "status": "published | draft" }
```

multipart 字段：`content`、`status`、`images`（文件，可重复；也接受图片地址字符串）。`status` 缺省为 `published`。

- 约束与后台一致：`content` ≤ 5000 字、图片 ≤ 9 张（JPG/PNG/WebP/GIF，上传文件 ≤ 25MB，存 R2）、文字与图片不能同时为空
- 返回 `{ok, id, url, status, images}`，`url` 形如 `https://站点/weibo?wb=<id>#wb-<id>`（`?wb=` 让 /weibo 服务端定位到该条所在页，锚点才能落到具体那条微博）
- 错误：401 无效 Token；422 内容为空 / 图片超限 / 格式不支持；429 限频（30 次/分钟/Token）
- 话题不接受直传，服务端从正文提取（同微博管理接口）

### POST /api/telegram/webhook
Telegram Bot API 的 Webhook 接收端，由 Telegram 服务器调用（校验 `X-Telegram-Bot-Api-Secret-Token` 请求头，密钥由后台一键设置生成并经 setWebhook 的 `secret_token` 下发；旧的 `?secret=` 绑定方式仍兼容，重新点一次「一键设置 Webhook」即切换为纯 header）。行为：

- 白名单外会话：回复其 Chat ID 与授权提示，不落库；`/start`、`/help` 回复使用说明
- 文字 / 图片 / 图片+caption（白名单会话）→ 发布为微博，图片经 Bot API 下载后转存 R2；成功后回复微博链接
- 相册（同 `media_group_id`）缓冲合并为一条微博（缓冲表 `tg_buffer`，几秒无新图即发布）
- `/draft 文字` 存草稿；其余指令回复可用指令说明
- 限频 20 次/分钟/Chat

## HTML 白名单（净化器摘要）

- 保留：`p br hr h1-h6 blockquote pre code ul ol li a img video source strong b em i u s del ins mark sup sub small span section div figure figcaption table thead tbody tfoot tr th td caption details summary abbr cite q kbd samp wbr`
- 丢弃（连同内容）：`script style iframe svg math form input button select textarea template link meta base object embed …`；`id` 属性一律剥除（防 DOM clobbering）
- 唯一例外：`<meta data-og-image="/images/…">` 原样保留（编辑器生成的 OG 分享卡图标记，仅限站内路径）
- 链接仅允许 `http(s) / mailto / 站内相对 / #锚点`（校验前剥离 tab/换行，`jav&#9;ascript:` 之类混淆无法绕过）；`data:`/`javascript:` 一律拒绝
- 内联样式仅保留排版属性（颜色/字号/行高/间距/边框/对齐等）；`url()` 只接受站内 `/` 开头路径；`!important` 被剥除
- 规范属性 `data-w / data-ignore-width / data-no-dark / data-ignore-dm` 原样保留
