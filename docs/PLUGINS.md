# 插件开发指南

博客号编辑器内置一个极简插件系统：一个插件 = 一个 JS 文件 + manifest 里的一行。无需构建、无需重新部署后台。

## 快速上手：写一个「每日一句」按钮

1. 新建 `public/plugins/quote-of-day.js`：

```js
window.BlogHao &&
  window.BlogHao.registerPlugin({
    name: 'quote-of-day',            // 全局唯一
    title: '插入每日一句',            // 悬停提示
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 14c0-4 2-7 6-9l1 2c-2 1-3 3-3 5h3v6H6zm9 0c0-4 2-7 6-9l1 2c-2 1-3 3-3 5h3v6h-7z" fill="currentColor"/></svg>',
    onClick(ctx) {
      ctx.insertHTML(
        '<blockquote style="border-left:3px solid #07c160;padding:8px 14px;color:#666;">' +
          '今天也是适合写作的一天 ✍️' +
        '</blockquote><p><br></p>'
      )
      ctx.notify('已插入每日一句 ✅')
    },
  })
```

2. 在 `public/plugins/manifest.json` 中登记（对象格式，带元数据；`id` 建议与 `registerPlugin` 的 `name` 一致）：

```json
[
  { "id": "quote-of-day", "file": "quote-of-day.js", "title": "插入每日一句", "description": "正文里插入一枚鼓励签", "version": "1.0.0", "author": "你" }
]
```

> 兼容旧格式：纯文件名字符串数组 `["quote-of-day.js"]` 依然有效，只是后台「插件」页会缺少标题/描述/版本展示。`id` 只能包含字母、数字、`_`、`-`。

3. 刷新编辑器页面，工具栏末尾出现新按钮。

## 插件 API（`window.BlogHao`）

| 成员 | 说明 |
| --- | --- |
| `registerPlugin(def)` | 注册插件；`def = { name, title?, icon?, onClick(ctx) }`，`icon` 是 SVG 字符串 |
| `insertHTML(html)` | 在当前光标处插入 HTML（自动恢复选区、触发自动保存） |
| `getHTML()` / `setHTML(html)` | 读取 / 替换正文 HTML |
| `exec(cmd, value?)` | 执行 `document.execCommand`（如 `bold`、`formatBlock`） |
| `notify(msg)` | 弹出 toast 提示 |
| `version` | 插件 API 版本，当前 `'1.0'` |

`onClick(ctx)` 的 `ctx` 与 `window.BlogHao` 上的方法相同，直接用 `ctx.insertHTML(...)` 即可。

## 加载机制

编辑器初始化时读取 `/plugins/manifest.json`（数组，按序加载），逐个 `import('/plugins/<file>')`。单个插件加载失败只会在控制台告警，不影响编辑器与其他插件。

**启停**：后台「插件」页可以随时停用某个插件（写入 settings 的 `pluginsDisabled` 名单），编辑器加载时跳过名单内的 id，下次打开编辑器生效——不再需要手改 manifest 重新部署。

**市场**：`public/market/catalog.json` 是后台「皮肤 / 插件」页「市场」标签页的数据源（内置精选目录，`{ themes: [...], plugins: [...] }`，条目 `{ id, name, description, link }`）。收录新作品 = 往里加一条；未来切换成远程目录时前端只需换数据来源。

**建议**：插件自己的状态（如设置项）存 `localStorage`（加前缀 `bloghao-plugin-<name>-`），不要请求外部服务——CSP 与规范都鼓励完全本地化。

## 注意事项

- 插入的 HTML 会**在保存时经过服务端白名单净化**（防 XSS）：脚本、事件属性、`javascript:` 链接等会被剥除；排版类内联样式、`data-w`、`data-ignore-width`、`data-no-dark` 等规范属性会保留。
- 遵循[微信排版规范](wechat-typography-spec.md)：别插入固定宽度节点、别用 `!important`。
- 插件只影响编辑器；想改公开页展示逻辑请走[主题](THEMES.md)。

## 内置插件：公众号采集（wechat-collect）

编辑器工具栏末尾的「采集公众号文章」按钮（微信双气泡图标）：粘贴 `mp.weixin.qq.com` 的文章链接，服务端抓取正文、把配图与封面转存进 R2 图床，并生成一篇**保留原发布时间**的草稿，随后自动跳转到编辑器——核对无误后点「发布」即可。支持两种内容类型：

- **普通图文**：解析 `js_content` DOM，保留段内加粗/斜体；
- **贴图（图片消息）**：页面没有 `js_content`，数据埋在内嵌 JS 里（`parseImagePost`）——图片列表取 `picture_page_info_list` 各条目顶层的 `cdn_url`（排除 `share_cover`/`watermark_info` 等嵌套图），全文取 `window.desc`/`content_noencode`（`\x0a` 反转义后按空行分段），草稿沿用原页面版式：图片在前、文字分段在后。

服务端实现见 `src/collect.ts`（`POST /api/admin/collect/wechat`，需登录）。限制：每分钟 10 篇 / IP，单篇最多转存 30 张图，单次抓取（页面/图片）超时 15 秒，正文 ≤ 约 900KB；公众号**内嵌视频暂不支持**。

面向使用者的完整说明见 [GUIDE.md](GUIDE.md) 第 6 节。

## 路线图

后续计划（欢迎 PR）：

- 编辑器 Markdown 快捷输入钩子（输入 `> ` 自动转引用等）
- 服务端钩子（发布/评论事件回调），用于接入统计、TG 通知等
- 远程市场目录与更顺畅的安装体验（Workers 无法运行时写代码文件，主题/插件安装仍以源码方式为主）
