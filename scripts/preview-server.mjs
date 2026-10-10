/** 静态预览服务器（仅本地截图用）：.preview/*.html + 真实的 /site.js /favicon.svg */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const port = Number(process.env.PORT || 8899)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    let p = decodeURIComponent(url.pathname)
    if (p === '/') p = '/home.html'
    if (p === '/site.js') p = '/public/site.js'
    if (p === '/favicon.svg') p = '/public/favicon.svg'
    const file = normalize(join(root, '.preview', p))
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`preview server: http://127.0.0.1:${port}/`))
