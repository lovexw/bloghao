# docker-poc 实机排练战报（2026-10-06）

> 目的：验证「一台服务器 + 一个容器跑 N 个完全独立的博客」能否承接真实生产。
> 结果：**甲骨文 ARM 实机全链路跑通，线上验收 45/45，抓出并修复 5 个真 bug**，
> 全部沉淀为冒烟断言（20/20）与本文档。业务代码（src/）零改动。

## 最终形态

```
访客 → Cloudflare 橙云（灵活 SSL，边缘缓存图片）
     → 甲骨文 A1 ARM（Ubuntu 20.04，11Gi RAM，Docker 27.5.1）
       → 1Panel openresty :80 反代 poc.xiaowuleyi.com（Host 头透传）
         → 127.0.0.1:8787 容器（node:26-alpine，~70MB 镜像）
           → /data/tenants/poc.xiaowuleyi.com/{blog.db, uploads/}
```

与既有服务完全共存：openresty(80)、xray(443)、vaultwarden、memos、
uptime-kuma、waline、mysql、qinglong 全程未动。容器只绑回环，公网摸不到。

## 时间线：每一步踩了什么

| # | 现象 | 定位 | 修复（commit） |
|---|---|---|---|
| 1 | 首次构建失败：`Could not resolve "hono"` | esbuild 从**导入文件**（/app/src）向上找依赖，hono 装在 docker-poc/node_modules 不在解析链上；本地能过是因为仓库根有完整 node_modules | root package.json 装到 /app 根（`--omit=dev` 只装 hono）`e2551a4` |
| 2 | `Could not resolve "./shims/d1"` | Docker `COPY` 对目录是**拷内容不拷目录本身**，shims 被摊平进上一层 | 显式 `COPY docker-poc/shims/ ./docker-poc/shims/` `e2551a4` |
| 3 | `bind: address already in use`（80 被占） | 这台是 1Panel 管理机：openresty 占 80、xray 占 443 | compose 加 `XWLBLOG_BIND`，容器绑 127.0.0.1 由面板反代 `4128340` |
| 4 | 容器崩溃循环 `EACCES mkdir /data/tenants/...` | **entrypoint 用 `find -user` 判属主是错的**：find 无匹配也退出 0（退出码只反映操作错误），`! find ...` 恒为假 → chown 永不执行；真机 bind mount 是 root 属主 | 改 `stat -c %u` 与 node uid 比较后递归 chown `130b3eb` |
| 5 | 浏览器 502 | 容器挂了（#4），openresty 反代无上游可代理 | 随 #4 解决 |
| 6 | 后台整页空白，`/admin.css`、`/app.js` 全 404 | 静态层在 `/admin`（无斜杠）**直接直出 index.html**，页面里相对路径 `./admin.css` 解析成 `/admin.css`；wrangler assets 会 301 补斜杠，我没对齐 | 目录无斜杠 → 301 补斜杠，冒烟加断言 `8d4a952` |
| 7 | 创建管理员报「跨站请求被拒绝」 | api.ts 同源校验拿浏览器 `Origin`（https）与 `c.req.url.origin` 全等比较；适配层拼 URL 只看 `X-Forwarded-Proto`——CF 灵活 SSL 下它是**回源段 http**，scheme 错位被误判跨站 | 新增 `resolveScheme`：Origin（host 一致时）→ CF-Visitor（CF 注入的访客侧 scheme，灵活 SSL 下也是 https）→ XFP → http；cookie 的 Secure 摘留同源判定 `c0230c0` |

**本地为什么测不出**：本地仓库根有完整 node_modules（掩盖 #1#2）；本地无 docker（#3#4 不可测）；本地无 CF/灵活 SSL（#7 不可测）；macOS bind mount 权限宽松（#4 在 Mac 上永远不会触发）。结论：**适配层代码必须真机验收**——冒烟是防线，但防线只覆盖它覆盖的地方。

（诚实记录：验收脚本曾报「回收站列表不含软删文章」1 条 FAIL，复核后确认是**脚本拿 slug 匹配、接口返回 label 字段**的断言笔误，应用行为正确；教训是冒烟断言写之前先看真实响应结构。）

## 线上验收明细（45/45）

- **公开页**：首页/归档/友链/留言板/关于/微博/搜索/RSS/sitemap/robots/favicon 全 200；随机路径 404；sitemap URL 为 https 域名
- **静态层**：`/admin`→301→`/admin/`；app.js、admin.css 正确 MIME
- **安全**：未登录 admin API 一律 401；前台 CSP 头在位；图片 nosniff + ETag 304；settings 接口无明文 token 泄漏；跨站 Origin 仍 403（CSRF 防线未被适配层拆掉）
- **登录**：200，会话 cookie 正确带 Secure（CF-Visitor 判定生效）
- **写链路**：传图 → 发文 → 首页/文章页/RSS 同步可见
- **回收站**：软删 → 前台消失 → 列表在 → 恢复 → 前台回来 → 彻底删除 → 列表清空
- **缓存/性能**：图片进 CF 边缘（cf-cache-status: REVALIDATED）；首页 TTFB ≈ 0.72s（免费版经圣何塞回源的正常水平）
- **无痕**：测试文章/图片/回收站记录全部彻底清理

## 容量测算（本机 11Gi ARM，与 1Panel 全家桶共存）

实测：3 租户单进程 RSS 64MB → 每租户增量 ~7MB；单页渲染 1~3ms CPU（同步 SQLite + ARM N1 + 本地盘）。

| 规模 | 进程内存 | CPU 峰值 | 瓶颈 |
|---|---|---|---|
| 100 站 | ~0.75GB | <0.5 核 | 无——舒适区间 |
| 300 站 | ~2.5GB | ~1 核 | 免费层 200GB 磁盘被图片（0.5~2GB/站）吃满；00:30 串行备份开始变长 |
| 500 站 | ~4GB | ~2 核 | 建议换 24GB A1 顶配 + 付费扩盘 |

- **真天花板是磁盘上的图片，不是 CPU/内存**；纯文字站本机几百个都行
- 每分钟 cron 扫 100 租户 ≈ 1~3s，无感；备份窗口站多后需改分批/并行（见遗留）
- 再往上不堆硬件，**拆机**：租户即目录，rsync 单租户目录到新机 + 改 DNS 即完成搬迁

## 遗留清单

- [ ] 后台改掉验收用的临时密码
- [ ] 明早验证备份 cron 首跑：`ls docker-poc/data/poc.xiaowuleyi.com/uploads/backups/`（北京时间 00:30 触发）
- [ ] CF Cache Rule 缓存 `/images/*`（图片基本全命中边缘）
- [ ] openresty 加 `location /images/` 直出 `data/<域名>/uploads/`，图片不再过应用
- [ ] 站数上百后：备份改分批/并行；租户热加载（免重启开新站）
- [ ] Ubuntu 20.04 已 EOL，择机升 24.04（不影响 POC 运行）
- [ ] 正式 HTTPS 可升级为源站证书 + 完全（严格）——443 与 xray 共存需 SNI 分流，暂缓不阻塞
