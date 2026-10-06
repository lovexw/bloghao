#!/bin/sh
# xwblog POC 容器入口：以 root 起步修好数据卷属主，随即降权到 node(uid 1000) 跑应用。
#
# 为什么要这一步：Linux 服务器上 compose 首次 up 时，bind mount 的宿主目录由 Docker
# 以 root 创建，直接 USER node 会 EACCES；macOS 的 Docker Desktop 对 bind mount
# 权限宽松，本地测试测不出这个坑。做法与官方 postgres 镜像同款：root 只负责 chown，
# 应用进程始终以非 root 运行。
#
# 属主检查用 find -user（BSD/GNU/BusyBox 三家通吃）；顶层目录已属 node 时跳过
# 递归 chown——大图床（百万文件级）重启不做全量扫描。
set -e
DATA_DIR="${TENANTS_DIR:-/data/tenants}"
mkdir -p "$DATA_DIR"
# 注意不能用 find 判断属主：find 没匹配到也退出 0（退出码只反映操作错误，
# 不反映有没有找到），「! find -user node」永远为假——真机 bind mount（root 属主）
# 上 chown 会被跳过，容器崩溃循环 EACCES（甲骨文服务器实测踩过）。
# 用 stat 比对 uid：顶层不是 node 的（首次挂载/被 root 动过）才递归修，之后跳过，
# 百万文件级大图床重启不做全量扫描。BusyBox stat 兼容 alpine。
if [ "$(stat -c %u "$DATA_DIR")" != "$(id -u node)" ]; then
  echo "[entrypoint] 修正数据卷属主 → node:node（仅首次或属主变化时递归）"
  chown -R node:node "$DATA_DIR" || echo "[entrypoint] chown 失败，仍尝试以 node 启动"
fi
exec su-exec node:node "$@"
