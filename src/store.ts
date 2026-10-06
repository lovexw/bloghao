/**
 * 上传常量与 R2 图床落库：api.ts 手动上传 / collect.ts 公众号采集转存 / external.ts 外部发布共用。
 * 常量与白名单只此一份——此前三份拷贝曾漂移出行为差异（image/jpg 别名、ico），改口径一处生效。
 */
import type { Env } from './types'

/** 上传体积上限（手动上传与各转存链路同口径） */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** 图片 mime → 扩展名白名单。ico 供 favicon 上传；image/jpg 是部分客户端发的
 *  非标准别名一并放行；不放行 SVG——同源直接打开 SVG 可执行脚本，有存储 XSS 风险 */
export const IMAGE_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

/** 白名单查表：必须走 hasOwnProperty（IMAGE_MIMES['constructor'] 是继承属性，truthy 可穿透校验） */
export function imageExtOf(mime: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(IMAGE_MIMES, mime) ? IMAGE_MIMES[mime] : undefined
}

/** 字节进 R2 图床并登记 uploads 表，返回站内地址。
 *  ext/mime 由调用方先过白名单（imageExtOf）或魔数识别（collect.sniffImageExt）；
 *  dir 为图床目录（普通上传 u/，OG 卡图 og/），年月子目录由这里统一拼 */
export async function saveUpload(
  env: Env,
  buf: ArrayBuffer,
  mime: string,
  name: string,
  ext: string,
  dir = 'u'
): Promise<string> {
  const now = new Date()
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const key = `${dir}/${ym}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
  await env.IMAGES.put(key, buf, {
    httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000, immutable' },
  })
  await env.DB.prepare('INSERT INTO uploads (key, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(key, name.slice(0, 120), mime, buf.byteLength, Date.now())
    .run()
  return `/images/${key}`
}
