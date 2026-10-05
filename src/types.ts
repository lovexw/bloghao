export interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
}

export interface UserRow {
  id: number
  username: string
  password_hash: string
  salt: string
  display_name: string
  avatar: string
  created_at: number
  updated_at: number
}

export interface SessionUser {
  id: number
  username: string
  display_name: string
  avatar: string
}

export type PostStatus = 'draft' | 'published' | 'scheduled'

export interface PostRow {
  id: number
  slug: string
  title: string
  content: string
  summary: string
  cover: string
  tags: string
  status: PostStatus
  pinned: number
  views: number
  likes: number
  author_id: number | null
  published_at: number | null
  /** 定时发布目标时间（毫秒）；仅 scheduled 状态有值 */
  publish_at: number | null
  created_at: number
  updated_at: number
}

export interface WeiboRow {
  id: number
  content: string
  images: string
  topics: string
  status: PostStatus
  pinned: number
  likes: number
  published_at: number | null
  created_at: number
  updated_at: number
}

export interface CommentRow {
  id: number
  post_id: number
  weibo_id: number
  parent_id: number
  is_admin: number
  nickname: string
  email: string
  website: string
  content: string
  status: 'approved' | 'pending'
  ip: string
  created_at: number
}

export interface UploadRow {
  id: number
  key: string
  name: string
  mime: string
  size: number
  created_at: number
}

export interface CategoryRow {
  id: number
  name: string
  slug: string
  sort: number
  created_at: number
}

export interface FriendLinkRow {
  id: number
  name: string
  url: string
  description: string
  icon: string
  status: 'approved' | 'pending'
  sort: number
  source: 'admin' | 'user'
  ip: string
  created_at: number
  updated_at: number
}

/** 访客统计日志（visit_log 表，src/stats.ts）：只存匿名 vid，不存 IP / 原始 UA */
export interface VisitRow {
  id: number
  ts: number
  day: string
  vid: string
  path: string
  title: string
  ref: string
  dev: string
  br: string
  country: string
}

export type SettingsMap = Record<string, string>
