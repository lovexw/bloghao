# 插件开发指南

墨博编辑器内置一个极简插件系统：一个插件 = 一个 JS 文件 + manifest 里的一行。无需构建、无需重新部署后台。

## 快速上手：写一个「每日一句」按钮

1. 新建 `public/plugins/quote-of-day.js`：

```js
window.MoBlog &&
  window.MoBlog.registerPlugin({
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

2. 在 `public/plugins/manifest.json` 中登记：

```json
["hello-plugin.js", "quote-of-day.js"]
```

3. 刷新编辑器页面，工具栏末尾出现新按钮。

## 插件 API（`window.MoBlog`）

| 成员 | 说明 |
| --- | --- |
| `registerPlugin(def)` | 注册插件；`def = { name, title?, icon?, onClick(ctx) }`，`icon` 是 SVG 字符串 |
| `insertHTML(html)` | 在当前光标处插入 HTML（自动恢复选区、触发自动保存） |
| `getHTML()` / `setHTML(html)` | 读取 / 替换正文 HTML |
| `exec(cmd, value?)` | 执行 `document.execCommand`（如 `bold`、`formatBlock`） |
| `notify(msg)` | 弹出 toast 提示 |
| `version` | 插件 API 版本，当前 `'1.0'` |

`onClick(ctx)` 的 `ctx` 与 `window.MoBlog` 上的方法相同，直接用 `ctx.insertHTML(...)` 即可。

## 加载机制

编辑器初始化时读取 `/plugins/manifest.json`（数组，按序加载），逐个 `import('/plugins/<文件名>')`。单个插件加载失败只会在控制台告警，不影响编辑器与其他插件。

**建议**：插件自己的状态（如设置项）存 `localStorage`（加前缀 `moblog-plugin-<name>-`），不要请求外部服务——CSP 与规范都鼓励完全本地化。

## 注意事项

- 插入的 HTML 会**在保存时经过服务端白名单净化**（防 XSS）：脚本、事件属性、`javascript:` 链接等会被剥除；排版类内联样式、`data-w`、`data-ignore-width`、`data-no-dark` 等规范属性会保留。
- 遵循[微信排版规范](wechat-typography-spec.md)：别插入固定宽度节点、别用 `!important`。
- 插件只影响编辑器；想改公开页展示逻辑请走[主题](THEMES.md)。

## 路线图

后续计划（欢迎 PR）：

- 编辑器 Markdown 快捷输入钩子（输入 `> ` 自动转引用等）
- 服务端钩子（发布/评论事件回调），用于接入统计、TG 通知等
- 后台「插件管理」页：一键启停，无需手改 manifest
