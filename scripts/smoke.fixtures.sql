-- 冒烟测试夹具（幂等，由 scripts/smoke.mjs 每次运行前执行）
-- 固定高位 id + smoke- 前缀 slug，避免与真实数据冲突；INSERT OR REPLACE 保证重复运行不报错
-- smoke-multi-tag 带 3 个标签：专门守住 relatedPosts 多标签 OR 拼接这条路径（曾因误删 join(' OR ') 全线 500）
INSERT OR REPLACE INTO posts (id, slug, title, content, summary, tags, status, pinned, views, published_at, created_at, updated_at) VALUES
  (990001, 'smoke-multi-tag', '冒烟测试：多标签文章', '<p>冒烟测试夹具正文。</p>', '冒烟测试夹具摘要', '["冒烟测试","测试标签甲","测试标签乙"]', 'published', 0, 1, 1767225600000, 1767225600000, 1767225600000),
  (990002, 'smoke-no-tag', '冒烟测试：无标签文章', '<p>冒烟测试夹具正文。</p>', '冒烟测试夹具摘要', '[]', 'published', 0, 1, 1767225600000, 1767225600000, 1767225600000);
