/**
 * 示例插件：文末小尾巴
 * 演示博客号编辑器插件 API —— 加载后会在工具栏出现一个按钮，
 * 点击即在正文末尾插入一段「— 完 —」签名区。
 *
 * 开发文档见 docs/PLUGINS.md
 */
window.BlogHao &&
  window.BlogHao.registerPlugin({
    name: 'hello-sign',
    title: '插入文末小尾巴',
    icon:
      '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 17h16M4 12h10M4 7h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    onClick: function (ctx) {
      ctx.insertHTML(
        '<section style="margin-top:36px;text-align:center;color:#999999;font-size:14px;line-height:1.8;">— 完 —<br>感谢阅读，欢迎在留言区聊聊 🙂</section>'
      )
      ctx.notify('已插入文末小尾巴 ✅')
    },
  })
