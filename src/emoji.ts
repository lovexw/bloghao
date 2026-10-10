/**
 * 微信默认表情（文本码体系）：编辑器/发布器插入 [微笑] 这类文本码，渲染层替换成站内小图。
 *
 * 图片资产：public/emoji/{codepoint}.png，来自 Twemoji（CC-BY 4.0，(c) Twitter/X 与其他贡献者，
 * 归属声明见 public/emoji/README.md）——微信官方自绘图为腾讯版权资产，本仓库不内置；
 * 文本码沿用微信习惯用语，图用码点最接近的开源 emoji 近似。
 *
 * 单一来源：本表是唯一的码→图映射（api.ts /admin/emoji 端点下发、客户端 site.js 与 editor.js
 * 运行时拉取）；tests/emoji.test.ts 守表完整性（码点格式 + PNG 文件存在）与渲染行为。
 */

/** 微信默认表情文本码 → Twemoji 码点（键顺序 = 面板展示顺序） */
export const WECHAT_EMOJI: Record<string, string> = {
  微笑: '1f60a',
  撇嘴: '1f61e',
  色: '1f60d',
  发呆: '1f610',
  得意: '1f60e',
  流泪: '1f622',
  害羞: '1f633',
  闭嘴: '1f910',
  睡: '1f634',
  大哭: '1f62d',
  尴尬: '1f605',
  发怒: '1f621',
  调皮: '1f61c',
  呲牙: '1f601',
  惊讶: '1f632',
  难过: '1f625',
  囧: '1f623',
  抓狂: '1f92f',
  吐: '1f92e',
  偷笑: '1f60f',
  可爱: '1f970',
  白眼: '1f644',
  傲慢: '1f611',
  饥饿: '1f924',
  困: '1f62a',
  惊恐: '1f628',
  流汗: '1f613',
  憨笑: '1f606',
  大兵: '1f920',
  奋斗: '1f4aa',
  咒骂: '1f92c',
  疑问: '2753',
  嘘: '1f92b',
  晕: '1f4ab',
  折磨: '1f62b',
  衰: '1f915',
  骷髅: '1f480',
  敲打: '1f528',
  再见: '1f44b',
  擦汗: '1f60c',
  抠鼻: '1f443',
  鼓掌: '1f44f',
  糗大了: '1f975',
  坏笑: '1f921',
  右哼哼: '1f624',
  鄙视: '1f612',
  委屈: '1f97a',
  快哭了: '1f629',
  阴险: '1f608',
  亲亲: '1f618',
  可怜: '1f979',
  笑脸: '1f642',
  生病: '1f912',
  脸红: '263a',
  破涕为笑: '1f602',
  恐惧: '1f626',
  失望: '1f614',
  无语: '1f636',
  嘿哈: '1f92d',
  捂脸: '1f926',
  奸笑: '1f609',
  机智: '1f913',
  皱眉: '1f641',
  耶: '1f91e',
  吃瓜: '1f349',
  加油: '1f4e3',
  汗: '1f4a7',
  天啊: '1f631',
  Emm: '1f914',
  社会社会: '1f576',
  旺柴: '1f436',
  好的: '1f44c',
  打脸: '1f4a5',
  哇: '1f929',
  翻白眼: '1f644',
  666: '1f525',
  让我看看: '1f440',
  叹气: '1f62e-200d-1f4a8',
  苦涩: '1f972',
  裂开: '1f643',
  哈欠: '1f971',
  嘴唇: '1f48b',
  爱心: '2764',
  心碎: '1f494',
  拥抱: '1f917',
  强: '1f44d',
  弱: '1f44e',
  握手: '1f91d',
  胜利: '270c',
  抱拳: '1f64f',
  勾引: '1f449',
  拳头: '270a',
  OK: '1f197',
  合十: '1f64f',
  啤酒: '1f37a',
  咖啡: '2615',
  面: '1f35c',
  饭: '1f35a',
  猪头: '1f437',
  玫瑰: '1f339',
  凋谢: '1f940',
  菜刀: '1f52a',
  炸弹: '1f4a3',
  便便: '1f4a9',
  月亮: '1f319',
  太阳: '2600',
  庆功: '1f389',
  礼物: '1f381',
  红包: '1f9e7',
  发: '1f4b0',
  福: '1f004',
  烟花: '1f386',
  爆竹: '1f9e8',
  猪: '1f416',
  跳跳: '1f430',
  发抖: '1f976',
  转圈: '1f300',
}

/** 站内表情图路径前缀（public/emoji/ 由 wrangler assets 直出） */
export const EMOJI_BASE = '/emoji/'

/** 表情小图的内联样式：随文本流内嵌，主题可用 .wxq-emoji 类覆盖 */
const EMOJI_STYLE = 'width:1.4em;height:1.4em;vertical-align:-0.2em;'

/** 文本码 token：[名称]，名称里排除属性/实体特征字符（= ; & < > " ' / \）——
 * 这些字符只会出现在标签或实体上下文里，纯文本码（中文/字母/数字）不含 */
const EMOJI_TOKEN_RE = /\[([^\[\]=;&<>"'/\\\n]{1,12})\]/g

/** 单张表情 img（esc 后的 alt 文本由调用方保证——本函数只在转义后的文本上运行） */
export function emojiImgHtml(codepoint: string, escapedToken: string): string {
  return `<img class="wxq-emoji" style="${EMOJI_STYLE}" src="${EMOJI_BASE}${codepoint}.png" alt="${escapedToken}" loading="lazy">`
}

/**
 * 把转义后文本/净化后 HTML 里的 [微笑] 替换成表情 img。
 * 输入必须是 esc()/sanitizeHtml() 的产物（纯文本码与中文不会被转义改变）。
 * 防属性上下文误替换：扫描时跟踪 <> 标签内外（sanitize 产物含真实标签，属性值里的 <> 已被
 * escAttr 转义为实体），只在文本节点替换；查表用 hasOwnProperty（防原型链属性当文本码），
 * 查不到原样保留。替换产物不再参与状态跟踪（img 自带 <>，拼进输出即可）。
 */
export function replaceEmoji(input: string): string {
  let out = ''
  let last = 0
  let inTag = false
  for (const m of input.matchAll(EMOJI_TOKEN_RE)) {
    const between = input.slice(last, m.index)
    for (const ch of between) {
      if (ch === '<') inTag = true
      else if (ch === '>') inTag = false
    }
    out += between + (inTag ? m[0] : emojiTokenHtml(m[0]))
    last = m.index + m[0].length
  }
  return out + input.slice(last)
}

function emojiTokenHtml(escapedToken: string): string {
  const name = escapedToken.slice(1, -1)
  // 表里查得到才替换（name 已被 token 正则排除了属性特征字符，安全）
  if (!Object.prototype.hasOwnProperty.call(WECHAT_EMOJI, name)) return escapedToken
  return emojiImgHtml(WECHAT_EMOJI[name], escapedToken)
}
