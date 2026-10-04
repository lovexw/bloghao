import type { SessionUser } from './types'

const enc = new TextEncoder()
const PBKDF2_ITERATIONS = 100_000 // Workers 上限即 10 万次

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const s = salt ?? randomToken(16)
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(s), iterations: PBKDF2_ITERATIONS },
    key,
    256
  )
  const hash = Array.from(new Uint8Array(bits), (x) => x.toString(16).padStart(2, '0')).join('')
  return { hash, salt: s }
}

export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export const SESSION_COOKIE = 'bloghao_session'
const SESSION_TTL = 30 * 24 * 3600 * 1000 // 30 天

export function getCookie(req: Request, name: string): string | null {
  const h = req.headers.get('Cookie') || ''
  for (const part of h.split(/; */)) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return part.slice(i + 1).trim()
      }
    }
  }
  return null
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomToken(32)
  const expires = Date.now() + SESSION_TTL
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, expires, Date.now())
    .run()
  return token
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
}

export async function getSessionUser(db: D1Database, req: Request): Promise<SessionUser | null> {
  const token = getCookie(req, SESSION_COOKIE)
  if (!token) return null
  return db
    .prepare(
      'SELECT u.id, u.username, u.display_name, u.avatar FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?'
    )
    .bind(token, Date.now())
    .first<SessionUser>()
}

export async function destroySession(db: D1Database, req: Request): Promise<void> {
  const token = getCookie(req, SESSION_COOKIE)
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
}

/** 清理已过期会话（随每晚备份 cron 跑一次即可），防止 sessions 表无限增长 */
export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run()
}

/**
 * 简单内存限流（按隔离实例生效，尽力而为）。
 * key => 每窗口最多 limit 次。
 */
const buckets = new Map<string, { n: number; reset: number }>()
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const e = buckets.get(key)
  if (!e || e.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs })
    if (buckets.size > 5000) {
      // 防止 Map 无限增长
      for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k)
    }
    return true
  }
  if (e.n >= limit) return false
  e.n++
  return true
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  )
}
