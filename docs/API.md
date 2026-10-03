# API 参考

所有接口前缀 `/api`，JSON 交互。管理接口需要会话 Cookie（浏览器登录后台后自动携带）。

写爬虫/客户端时注意：非 GET 请求必须**同源**携带 `Origin` 头或直接不携带，跨源一律 403。

## 公开接口

### GET /api/health
`{"ok":true,"time":...}`

### GET /api/public/posts?page=1&limit=10&tag=生活
已发布文章分页（摘要视图），返回 `{items, total, page, totalPages}`，`items` 元素含 `slug/title/summary/cover/tags/published_at/views/likes/pinned`。

### POST /api/public/comments
留言。Body：

```json
{ "slug": "hello-moblog", "nickname": "路人甲", "content": "写得真好", "link": "" }
```

- `link` 是蜜罐字段，正常客户端永远传空字符串/不传
- 受限流（同 IP 10 分钟 5 条）与站点「开启留言 / 先审后展」设置约束
- `nickname` ≤ 24 字，`content` ≤ 1000 字，均为纯文本存储

### POST /api/public/like/:slug
Body `{"delta": 1}` 或 `{"delta": -1}`，返回 `{"ok":true,"likes":7}`。计数不会为负。

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
概览统计：`{posts, views, likes, drafts, pendingComments, uploads:{count,bytes}, recent:[…]}`

### 文章
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/posts?status=all\|published\|draft&q=关键词&page=1&limit=20` | 列表（不含 content） |
| POST | `/api/admin/posts` | 新建 |
| GET | `/api/admin/posts/:id` | 详情（含 content） |
| PUT | `/api/admin/posts/:id` | 更新（autosave 用） |
| POST | `/api/admin/posts/:id/pin` | Body `{pinned:true/false}` |
| DELETE | `/api/admin/posts/:id` | 删除（连带评论） |
| GET | `/api/admin/tags` | 全站标签聚合（编辑器补全用） |

文章 Body 字段：

```json
{
  "title": "标题",
  "content": "<p>富文本 HTML，服务端会白名单净化</p>",
  "summary": "摘要，可空",
  "cover": "/images/u/202610/xxx.jpg",
  "tags": ["生活", "Cloudflare"],
  "status": "draft | published",
  "pinned": false,
  "slug": "留空自动生成，可自定义"
}
```

约束：title ≤ 150 字；content ≤ 1MB；tags ≤ 8 个、每个 ≤ 20 字；cover 必须以 `/` 或 `http(s)://` 开头。

### 上传 / 媒体
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/upload` | multipart，字段名 `file`；图片 JPG/PNG/WebP/GIF、视频 MP4/WebM；≤ 25MB；返回 `{url:"/images/u/...", key, mime, size}` |
| GET | `/api/admin/uploads?page=1` | 媒体列表（每页 24） |
| DELETE | `/api/admin/uploads?key=u/202610/xxx.png` | 从 R2 与索引中删除 |

### 评论
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/comments?status=all\|pending\|approved&page=1` | 列表（含文章标题/slug） |
| PUT | `/api/admin/comments/:id` | Body `{status:"approved"\|"pending"}`（通过 / 隐藏） |
| DELETE | `/api/admin/comments/:id` | 删除 |

### 设置 / 账号 / 工具
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / PUT | `/api/admin/settings` | 可写键：`siteName, siteDescription, siteUrl, footerText, theme, allowComments, moderateComments, postsPerPage, about`；`theme` 必须是已注册主题 id |
| PUT | `/api/admin/password` | Body `{oldPassword, newPassword}` |
| POST | `/api/admin/tools/md` | Body `{md}` → `{html}`，Markdown 渲染 |
| POST | `/api/admin/tools/sanitize` | Body `{html}` → `{html}`，白名单净化（粘贴用） |

### GET /api/meta/themes
已注册主题列表 `{themes:[{id,name,description}]}`。

## HTML 白名单（净化器摘要）

- 保留：`p br hr h1-h6 blockquote pre code ul ol li a img video source strong em u s del ins mark sup sub small span section div figure figcaption table thead tbody tfoot tr th td caption details summary abbr cite q kbd samp`
- 丢弃（连同内容）：`script style iframe svg math form input button select textarea template link meta base object embed …`
- 链接仅允许 `http(s) / mailto / 站内相对 / #锚点`；`data:`/`javascript:` 一律拒绝
- 内联样式仅保留排版属性（颜色/字号/行高/间距/边框/对齐等）；`url()` 只接受站内 `/` 开头路径；`!important` 被剥除
- 规范属性 `data-w / data-ignore-width / data-no-dark / data-ignore-dm` 原样保留
