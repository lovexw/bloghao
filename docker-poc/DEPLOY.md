# Docker 自托管部署指南

目标：一台便宜 VPS 上跑通完整生产链路，预计 30~60 分钟。已在甲骨文 ARM 实机
按本清单排练通过（时间线、根因与验收明细见 `REHEARSAL-REPORT.md`），照做即可。

## 0. 选服务器（结论回顾）

| 项 | 建议 |
|---|---|
| 配置 | 4核8G / 200G NVMe 舒适跑 100 站；2核4G 是下限（POC 实测 3 租户单进程 RSS 64MB，百站内存约 1~2GB） |
| 地域 | 访客主要在大陆 → 香港或国内；国内服务器要求域名备案（100 个域名是体力活），香港免备案、延迟尚可 |
| 系统 | Ubuntu 22.04/24.04 或 Debian 12 |
| 带宽 | CF 边缘缓存命中后 10~30Mbps 够用；国内机器注意带宽计费方式 |

## 1. 装 Docker

```bash
curl -fsSL https://get.docker.com | sh
```

国内机器拉镜像慢时，给 Docker 配镜像加速器（各云厂商都有文档）。

## 2. 上代码 + 改租户配置

代码上服务器：`git clone`（配 deploy key）或本地 `tar` 打包 `scp` 上去，二选一。

**tenants.json 必须改**：`*.localhost` 域名只在本地有意义，服务器上换成真实域名：

```json
{
  "blog1.你的域名.com": { "demo": false }
}
```

> ⚠ `demo: true` 的租户会自动播种公示账号（demo / demo1234）的演示内容，
> 公开服务器上要么删掉、要么明确当展示站用。

## 3. 起服务

```bash
cd docker-poc
XWLBLOG_PORT=80 docker compose up --build -d
```

排练期把容器直接挂 80（配合第 4 步的「灵活 SSL」，Cloudflare 才能回源到源站）；
正式期改回 8787 并在前面加 Caddy。

Linux 上宿主目录属主不用管——容器入口 `entrypoint.sh` 首次启动会自动把
`./data` 修成 node 用户所有（只递归一次，之后跳过）。

## 4. Cloudflare 侧

1. 域名 A 记录指向服务器 IP，**开橙云**（代理）
2. SSL/TLS 加密模式：排练期设「**灵活**」（访客 HTTPS → CF → 源站 HTTP:80，最快跑通）
3. Cache Rule：`/images/*` 与静态资源设边缘缓存——这是源站带宽的核心解药
4. 排练通过后升级：上 Caddy 终结 TLS + 源站证书，SSL 模式改「**完全（严格）**」

## 5. 验证

- 浏览器开 `https://你的域名` → 应看到博客页
- 服务器上 `docker compose ps`（状态 healthy/up）、`docker compose logs -f` 看请求日志
- 访问 `/admin/` 走首装流程创建管理员，发一篇文章、传一张图
- 在 Cloudflare 控制台看缓存命中率是否随图片访问上升

## 已有 1Panel / openresty 的机器（80 被占用）

容器改绑本机回环，公网流量由面板的 openresty 按域名分流：

```bash
XWLBLOG_BIND=127.0.0.1 docker compose up -d     # 只监听 127.0.0.1:8787，公网摸不到
```

1Panel 里：网站 → 创建网站 → 反向代理 → 域名填你的站点域名（如 `blog1.你的域名.com`）、
代理地址 `http://127.0.0.1:8787`。确认生成的反代配置带
`proxy_set_header Host $host;`（多租户路由靠 Host 头识别站点，丢了会全部 404）。

Cloudflare 照旧橙云解析到本机 IP；回源走 openresty 的 80（灵活 SSL）。
443 被其他服务占用时不要抢，灵活 SSL 只需要源站 80。

## 6. 排练通过后要做的事

- **Caddy 反代**：TLS 终结 + `/images/*` 直接吐 `data/<域名>/uploads/` 目录（带
  `Cache-Control: immutable`，连应用都不过）+ 应用挂 127.0.0.1:8787
- **备份**：每晚 cron 把 `data/` 打包推 S3/B2（应用内备份 cron 也会在各租户
  `uploads/backups/` 留滚动快照，双保险）
- **监控**：Uptime-Kuma 拨测各域名，异常 TG 通知
- **安全**：云安全组只放 22/80/443；改 SSH 密钥登录
- **升级**：`git pull && XWLBLOG_PORT=80 docker compose up --build -d`——
  换一次镜像，全部租户原子升级；数据卷不动
