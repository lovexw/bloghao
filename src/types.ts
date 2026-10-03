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

export type PostStatus = 'draft' | 'published'

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
  created_at: number
  updated_at: number
}

export interface WeiboRow {
  id: number
  content: string
  images: string
  status: PostStatus
  published_at: number | null
  created_at: number
  updated_at: number
}

export interface CommentRow {
  id: number
  post_id: number
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

export type SettingsMap = Record<string, string>
