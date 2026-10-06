export interface Env {
  DB: D1Database
  IMAGES: R2Bucket
  ASSETS: Fetcher
  /** 演示站模式（wrangler.demo.jsonc 注入 "1"）：生产 Worker 不设置，见 src/demo.ts */
  DEMO_MODE?: string
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
  /** 回收站：非 NULL = 已移入回收站（毫秒），NULL = 存活（src/trash.ts） */
  deleted_at: number | null
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
  /** 回收站：非 NULL = 已移入回收站（毫秒），NULL = 存活（src/trash.ts） */
  deleted_at: number | null
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

export interface CategoryRow {
  id: number
  name: string
  slug: string
  sort: number
  created_at: number
}

/** 独立页面（pages 表）：自建页面与「关于我」（slug = 'about'） */
export interface PageRow {
  id: number
  title: string
  slug: string
  content: string
  status: 'draft' | 'published'
  show_in_nav: number
  sort: number
  created_at: number
  updated_at: number
  /** 回收站：非 NULL = 已移入回收站（毫秒），NULL = 存活（src/trash.ts） */
  deleted_at: number | null
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

export type SettingsMap = Record<string, string>
