import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropCoverDupBlock, imagePostBlocks, mmbizAssetId, parseImagePost, parseMeta } from '../src/collect.ts'
// 魔数识别与转存已下沉 store.ts（采集与粘贴净化共用）
import { sniffImageExt } from '../src/store.ts'

// ── 图片类型只认魔数（回归：曾信任源站 Content-Type / URL wx_fmt，
//    可把 HTML/SVG 以图片身份转存进站点源，形成存储型 XSS）──
const buf = (bytes: number[]) => Uint8Array.from(bytes).buffer
const str = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

test('四种白名单图片的魔数正确识别', () => {
  assert.equal(sniffImageExt(buf([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'jpg')
  assert.equal(sniffImageExt(buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png')
  assert.equal(sniffImageExt(buf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'gif') // GIF89a
  assert.equal(sniffImageExt(buf([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])), 'gif') // GIF87a
  assert.equal(sniffImageExt(buf([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'webp')
})

test('HTML/SVG/文本/伪 RIFF 一律拒收', () => {
  assert.equal(sniffImageExt(str('<html><script>alert(1)</script></html>')), null)
  assert.equal(sniffImageExt(str('<?xml version="1.0"?><svg onload="alert(1)">')), null)
  assert.equal(sniffImageExt(str('hello world')), null)
  assert.equal(sniffImageExt(buf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])), null) // RIFF 但非 WEBP
  assert.equal(sniffImageExt(new ArrayBuffer(0)), null)
})

// ── 贴图（图片消息，item_show_type=8）解析（回归：这类页面没有 js_content，
//    数据埋在内嵌 JS 里，此前直接报「没有抓到文章正文」）──
// 结构对照真实贴图页：图片列表 picture_page_info_list、全文 window.desc /
// content_noencode（\x0a 转义）、标题 window.msg_title、作者 nick_name
const IMAGE_POST_HTML = `<!doctype html>
<html><head>
<meta property="og:title" content="1.第一条被截断的长标题" />
<meta property="og:image" content="https://mmbiz.qpic.cn/mmbiz_jpg/COVER/0?wx_fmt=jpeg" />
<meta name="author" content="测试账号" />
<meta name="description" content="1.第一条\\x0a\\x0a2.第二条" />
</head><body>
<script>
window.item_show_type = '8' || '';
window.ct = '1790499600' || '';
window.msg_title = window.title = '1.第一条被截断的长标题' || '';
window.desc = window.desc || '';
window.cgiData = {
  nick_name: '测试账号',
  picture_page_info_list: [
    {
      cdn_url: 'https://mmbiz.qpic.cn/mmbiz_jpg/IMG1/0?wx_fmt=jpeg',
      width: '1080' * 1,
      height: '1440' * 1,
      crop_info: '{\\x22u\\x22:\\x22https://mmbiz.qpic.cn/x[1]\\x22}',
      share_cover: { cdn_url: 'https://mmbiz.qpic.cn/sz_mmbiz_jpg/SHARECOVER/0?wx_fmt=jpeg' },
      watermark_info: { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_jpg/WATERMARK/0?wx_fmt=jpeg' },
    },
    {
      cdn_url: 'https://mmbiz.qpic.cn/mmbiz_png/IMG2/0?wx_fmt=png',
      width: '1080' * 1,
      height: '810' * 1,
    },
  ],
};
window.desc = "1.第一条\\x0a\\x0a2.第二条，带\\"引号\\"的文本";
window.content_noencode = '1.第一条\\x0a\\x0a2.第二条，带\\"引号\\"的文本';
</script>
</body></html>`

test('贴图页解析：图片只取条目顶层 cdn_url，全文反转义，标题/作者齐全', () => {
  const post = parseImagePost(IMAGE_POST_HTML)
  assert.ok(post)
  assert.equal(post.title, '1.第一条被截断的长标题')
  assert.equal(post.account, '测试账号')
  // share_cover / watermark_info 等嵌套对象的图、crop_info 字符串里的 URL 必须排除
  assert.deepEqual(post.images, [
    'https://mmbiz.qpic.cn/mmbiz_jpg/IMG1/0?wx_fmt=jpeg',
    'https://mmbiz.qpic.cn/mmbiz_png/IMG2/0?wx_fmt=png',
  ])
  // \x0a 反转义为换行，\" 还原为引号；window.desc 与 content_noencode 等长时任取其一
  assert.equal(post.text, '1.第一条\n\n2.第二条，带"引号"的文本')
})

test('贴图块组装：图片在前、文字按空行分段、段内单换行保留', () => {
  const post = parseImagePost(IMAGE_POST_HTML)!
  const blocks = imagePostBlocks({ ...post, text: `${post.text}\n\n3.第三条\n带段内换行` })
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['img', 'img', 'text', 'text', 'text']
  )
  assert.equal(blocks[0].src, 'https://mmbiz.qpic.cn/mmbiz_jpg/IMG1/0?wx_fmt=jpeg')
  assert.equal(blocks[1].src, 'https://mmbiz.qpic.cn/mmbiz_png/IMG2/0?wx_fmt=png')
  assert.equal(blocks[2].text, '1.第一条')
  assert.equal(blocks[3].text, '2.第二条，带"引号"的文本')
  assert.equal(blocks[4].text, '3.第三条\n带段内换行')
})

test('贴图页没有 window.desc 时回退 og:description（\\x0a 字面量反转义），作者回退 window.name', () => {
  const html = `<html><head>
<meta property="og:description" content="只有图片\\x0a\\x0a和说明文字" />
<meta property="og:image" content="https://mmbiz.qpic.cn/mmbiz_jpg/ONLY/0?wx_fmt=jpeg" />
</head><body><script>
window.item_show_type = "8";
window.name = "兜底账号";
window.cgiData = { picture_page_info_list: [
  { cdn_url: 'https://mmbiz.qpic.cn/mmbiz_jpg/ONLY/0?wx_fmt=jpeg', width: '100' * 1, height: '100' * 1 }
] };
</script></body></html>`
  const post = parseImagePost(html)
  assert.ok(post)
  assert.equal(post.text, '只有图片\n\n和说明文字')
  assert.equal(post.account, '兜底账号')
  assert.deepEqual(post.images, ['https://mmbiz.qpic.cn/mmbiz_jpg/ONLY/0?wx_fmt=jpeg'])
})

test('普通图文 / 视频页 / 空页面不是贴图，parseImagePost 返回 null', () => {
  const article =
    '<html><body><div id="js_content"><p>正文段落，长度超过六十个字符的一段的文字，用于确保去标签后长度达标，这样才不会被当成异常页面处理。</p></div>' +
    `<script>window.item_show_type = '1' || '';</script></body></html>`
  assert.equal(parseImagePost(article), null)
  assert.equal(parseImagePost('<html><body>环境异常</body></html>'), null)
  assert.equal(parseImagePost(''), null)
})

test('parseMeta 发布时间兼容单引号 window.ct（贴图）与双引号 var ct（图文），秒/毫秒都识别', () => {
  assert.equal(parseMeta(IMAGE_POST_HTML).publishedAt, 1790499600000)
  assert.equal(parseMeta('var ct = "1696000000";').publishedAt, 1696000000000)
  assert.equal(parseMeta('var ct = "1696000000000";').publishedAt, 1696000000000)
  assert.equal(parseMeta("var ct = '';").publishedAt, null)
})

test('parseMeta 图文元信息：标题/作者/封面照旧', () => {
  const meta = parseMeta(IMAGE_POST_HTML)
  assert.equal(meta.cover, 'https://mmbiz.qpic.cn/mmbiz_jpg/COVER/0?wx_fmt=jpeg')
  assert.equal(parseMeta('var nickname = htmlDecode("测试号");').account, '测试号')
})

// ── 封面去重（回归：公众号封面常是正文首图的衍生裁切，同媒体 ID 不同尺寸/格式段，
//    字符串比对认不出，导致封面图在文章页一图两现）──
test('mmbizAssetId：同媒体不同格式/尺寸/CDN 前缀认成同一 ID，非微信图返回空', () => {
  assert.equal(mmbizAssetId('https://mmbiz.qpic.cn/mmbiz_jpg/ABC123/640?wx_fmt=jpeg'), 'ABC123')
  // 封面裁切：png 段 + 无尺寸参数；正文原图：jpg 段 + 640——ID 相同即同一张
  assert.equal(mmbizAssetId('https://mmbiz.qpic.cn/mmbiz_png/ABC123/0?wx_fmt=png'), 'ABC123')
  assert.equal(mmbizAssetId('https://szmmbiz.qpic.cn/mmbiz_jpg/ABC123/640?wx_fmt=jpeg&wxfrom=5'), 'ABC123')
  assert.equal(mmbizAssetId('https://mmbiz.qpic.cn/mmbiz/ABC123/640'), 'ABC123')
  assert.equal(mmbizAssetId('https://mmbiz.qpic.cn/mmbiz_gif/DEF-456_7/0'), 'DEF-456_7')
  assert.equal(mmbizAssetId('https://mmbiz.qpic.cn/other/ABC123/640'), '')
  assert.equal(mmbizAssetId('https://cdn.example.com/img/a.jpg'), '')
  assert.equal(mmbizAssetId(''), '')
})

test('dropCoverDupBlock：正文里与封面同媒体的图块被去掉（只去第一张），其余原序保留', () => {
  const cover = 'https://mmbiz.qpic.cn/mmbiz_png/COVERID/0?wx_fmt=png'
  const blocks = [
    { type: 'text' as const, text: '开篇两段闲聊。' },
    { type: 'img' as const, src: 'https://mmbiz.qpic.cn/mmbiz_jpg/COVERID/640?wx_fmt=jpeg' }, // 封面的裁切源
    { type: 'text' as const, text: '中间一段。' },
    { type: 'img' as const, src: 'https://mmbiz.qpic.cn/mmbiz_jpg/OTHERID/640?wx_fmt=jpeg' },
  ]
  const kept = dropCoverDupBlock(blocks, cover)
  assert.equal(kept.length, 3)
  assert.equal(kept[0].type, 'text')
  assert.ok(kept.every((b) => b.src !== 'https://mmbiz.qpic.cn/mmbiz_jpg/COVERID/640?wx_fmt=jpeg'))
  // 无封面 / 非微信封面 / 无同媒体图：原样返回
  assert.equal(dropCoverDupBlock(blocks, '').length, 4)
  assert.equal(dropCoverDupBlock(blocks, 'https://cdn.example.com/c.jpg').length, 4)
  assert.equal(dropCoverDupBlock(blocks, 'https://mmbiz.qpic.cn/mmbiz_jpg/NOPE/0').length, 4)
  // 封面对应正文中间的图：去掉那张，前后文保留
  const mid = dropCoverDupBlock(blocks, 'https://mmbiz.qpic.cn/mmbiz_png/OTHERID/0?wx_fmt=png')
  assert.equal(mid.length, 3)
  assert.equal(mid[2].src, undefined)
})
