/**
 * 流式 ZIP 写入器（store 模式，不压缩）—— 纯 TS 无依赖，供「数据导出」打包用。
 *
 * 为什么这样写：
 * - Workers 内存有限（128MB），图片整包缓冲不现实，所以文件数据走「数据描述符」模式
 *   （general purpose flag bit 3）：本地头先写 0 尺寸/CRC，数据写完后补一笔 descriptor，
 *   数据即可从 R2 ReadableStream 逐块流入、边流边算 CRC，整包不过内存。
 * - store 模式对图片（本就压缩过的字节）没有体积损失，换来 ~150 行的极简实现。
 * - 文件名统一按 UTF-8（flag bit 11），支持中文 slug。
 * - 不支持 >4GB 单包 / >65535 个文件（博客规模远远用不到，超限会产出损坏包，调用方需自行控制）。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC32 增量计算：首块 seed 传 0，后续块传上一块的返回值 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = ~seed
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

const ENC = new TextEncoder()

/** DOS 时间（本地分量 2s 粒度）；zip 元数据对时区不敏感，直接用调用方给定时间 */
function dosDateTime(ts: number): { time: number; date: number } {
  // +8h 取 UTC 分量 = 北京时间（与全站口径一致）
  const d = new Date(ts + 8 * 3600_000)
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2)
  const date = Math.max(0, d.getUTCFullYear() - 1980) << 9 | (d.getUTCMonth() + 1) << 5 | d.getUTCDate()
  return { time: time & 0xffff, date: date & 0xffff }
}

interface ZipEntry {
  nameBytes: Uint8Array
  crc: number
  size: number
  time: number
  date: number
  offset: number
}

export class ZipWriter {
  private offset = 0
  private entries: ZipEntry[] = []

  constructor(private writer: WritableStreamDefaultWriter<Uint8Array>) {}

  /** 加入一个文件。data 传 Uint8Array 或 ReadableStream（如 R2 get() 的 obj.body），流式时不缓冲 */
  async add(name: string, data: Uint8Array | ReadableStream<Uint8Array>, mtime = Date.now()): Promise<void> {
    if (this.entries.length >= 65535) throw new Error('zip 文件数超出 65535 上限')
    const nameBytes = ENC.encode(name)
    const { time, date } = dosDateTime(mtime)
    const header = new Uint8Array(30 + nameBytes.length)
    const v = new DataView(header.buffer)
    v.setUint32(0, 0x04034b50, true) // local file header sig
    v.setUint16(4, 20, true) // version needed
    v.setUint16(6, 0x0808, true) // flag: bit3 数据描述符 + bit11 UTF-8 文件名
    v.setUint16(8, 0, true) // method: store
    v.setUint16(10, time, true)
    v.setUint16(12, date, true)
    // crc / sizes 为 0，真实值在数据后的 descriptor 与中央目录里
    v.setUint16(26, nameBytes.length, true)
    v.setUint16(28, 0, true)
    header.set(nameBytes, 30)
    await this.writer.write(header)
    this.offset += header.length

    let crc = 0
    let size = 0
    if (data instanceof Uint8Array) {
      crc = crc32(data)
      size = data.length
      await this.writer.write(data)
    } else {
      const reader = data.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length) {
          crc = crc32(value, crc)
          size += value.length
          await this.writer.write(value)
        }
      }
    }
    const desc = new Uint8Array(16)
    const dv = new DataView(desc.buffer)
    dv.setUint32(0, 0x08074b50, true) // data descriptor sig
    dv.setUint32(4, crc, true)
    dv.setUint32(8, size, true)
    dv.setUint32(12, size, true)
    await this.writer.write(desc)
    this.offset += size + desc.length
    this.entries.push({ nameBytes, crc, size, time, date, offset: this.offset - size - desc.length - header.length })
  }

  /** 收尾：写中央目录 + EOCD，然后关闭底层 writer */
  async close(): Promise<void> {
    const cdOffset = this.offset
    let cdSize = 0
    for (const e of this.entries) {
      const h = new Uint8Array(46 + e.nameBytes.length)
      const v = new DataView(h.buffer)
      v.setUint32(0, 0x02014b50, true) // central directory sig
      v.setUint16(4, 20, true) // version made by
      v.setUint16(6, 20, true) // version needed
      v.setUint16(8, 0x0808, true) // flags（与本地头一致）
      v.setUint16(10, 0, true) // method: store
      v.setUint16(12, e.time, true)
      v.setUint16(14, e.date, true)
      v.setUint32(16, e.crc, true)
      v.setUint32(20, e.size, true)
      v.setUint32(24, e.size, true)
      v.setUint16(28, e.nameBytes.length, true)
      v.setUint32(42, e.offset, true)
      h.set(e.nameBytes, 46)
      await this.writer.write(h)
      cdSize += h.length
    }
    const eocd = new Uint8Array(22)
    const v = new DataView(eocd.buffer)
    v.setUint32(0, 0x06054b50, true) // EOCD sig
    v.setUint16(8, this.entries.length, true)
    v.setUint16(10, this.entries.length, true)
    v.setUint32(12, cdSize, true)
    v.setUint32(16, cdOffset, true)
    await this.writer.write(eocd)
    await this.writer.close()
  }

  /** 异常收尾：中断底层流，让下载端立刻失败而不是挂到超时 */
  async abort(): Promise<void> {
    try {
      await this.writer.abort()
    } catch {
      /* 已关闭/已中断则忽略 */
    }
  }
}
