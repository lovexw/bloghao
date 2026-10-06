#!/usr/bin/env bash
# xwblog 自托管 POC 冒烟：起服务 → 演示租户 → 真实租户全链路 → 跨租户隔离
# 用法：cd docker-poc && npm run smoke   （或 bash smoke.sh）
set -euo pipefail
cd "$(dirname "$0")"

# 冒烟走本机回环：绕开继承来的 HTTP(S) 代理（否则 curl 把请求交给代理，
# 代理解析不了 *.localhost 主机名，一律回 502）
export NO_PROXY='*' no_proxy='*'
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy 2>/dev/null || true

PORT="${PORT:-8787}"
BASE="http://127.0.0.1:${PORT}"
PASS=0
FAIL=0

# 本目录没装过依赖时才装（esbuild 一个包，不碰主工程）
[ -x node_modules/.bin/esbuild ] || npm install --no-audit --no-fund

echo "==> 打包"
npm run --silent build

echo "==> SigV4 签名自检（AWS 官方测试向量）"
node dist/server.js --selftest

echo "==> 启动服务（端口 ${PORT}）"
node dist/server.js >server.smoke.log 2>&1 &
SERVER_PID=$!
trap 'kill ${SERVER_PID} 2>/dev/null || true' EXIT

# 等 /api/health 就绪
for i in $(seq 1 60); do
  if curl -sf -H 'Host: main.localhost' "${BASE}/api/health" >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && { echo "服务 60 秒内没起来，server.smoke.log："; tail -50 server.smoke.log; exit 1; }
  sleep 1
done

check() { # check <名称> <期望> <实际>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"
  else FAIL=$((FAIL+1)); echo "FAIL  $1（期望 $2，实际 $3）"; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' --resolve "$1:${PORT}:127.0.0.1" "http://$1:${PORT}$2"; }

echo "==> 基础链路"
check "main 租户 health"          200 "$(code main.localhost /api/health)"
check "demo 租户 health"          200 "$(code demo.localhost /api/health)"
check "t1 租户 health"            200 "$(code t1.localhost /api/health)"
check "未登记域名 404"            404 "$(code nobody.localhost /api/health)"
check "后台 SPA 静态直出"         200 "$(code main.localhost /admin/)"
check "后台无斜杠 301 补斜杠（防相对路径资源 404）" 301 "$(code main.localhost /admin)"
check "demo 租户 RSS"             200 "$(code demo.localhost /rss.xml)"
check "main 租户首页（空库也能渲染）" 200 "$(code main.localhost /)"

echo "==> 演示租户播种"
DEMO_HOME=$(curl -s --resolve "demo.localhost:${PORT}:127.0.0.1" "http://demo.localhost:${PORT}/")
check "demo 首页含种子文章链接" 1 "$(printf '%s' "$DEMO_HOME" | { grep -o '/post/' || true; } | wc -l | awk '{print ($1>0)?1:0}')"

echo "==> 真实租户：注册 → 登录 → 发文 → 传图"
JAR=$(mktemp)
SETUP=$(curl -s -o /dev/null -w '%{http_code}' --resolve "main.localhost:${PORT}:127.0.0.1" -c "$JAR" -H 'Content-Type: application/json' -d '{"username":"owner","password":"password123","displayName":"站长"}' http://main.localhost:${PORT}/api/auth/setup)
check "首次创建管理员（重跑时已存在也算过）" 1 "$([ "$SETUP" = 200 ] || [ "$SETUP" = 403 ] && echo 1 || echo 0)"
check "登录"           200 "$(curl -s -o /dev/null -w '%{http_code}' --resolve "main.localhost:${PORT}:127.0.0.1" -b "$JAR" -c "$JAR" -H 'Content-Type: application/json' -d '{"username":"owner","password":"password123"}' http://main.localhost:${PORT}/api/auth/login)"
check "带同源 Origin 的 POST 放行（模拟 CF 灵活 SSL 后的浏览器）" 200 "$(curl -s -o /dev/null -w '%{http_code}' --resolve "main.localhost:${PORT}:127.0.0.1" -b "$JAR" -H 'Origin: http://main.localhost:8787' -H 'Content-Type: application/json' -d '{"username":"owner","password":"password123"}' http://main.localhost:${PORT}/api/auth/login)"
check "跨站 Origin 仍被拒绝（CSRF 防线未被适配层拆掉）" 403 "$(curl -s -o /dev/null -w '%{http_code}' --resolve "main.localhost:${PORT}:127.0.0.1" -b "$JAR" -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{"username":"owner","password":"password123"}' http://main.localhost:${PORT}/api/auth/login)"

CREATE=$(curl -s --resolve "main.localhost:${PORT}:127.0.0.1" -b "$JAR" -H 'Content-Type: application/json' \
  -d '{"title":"POC 冒烟文章","content":"<p>来自 docker-poc 的文章，正文配图稍后上传。</p>","status":"published","tags":["poc"]}' \
  http://main.localhost:${PORT}/api/admin/posts)
SLUG=$(printf '%s' "$CREATE" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).post?.slug||JSON.parse(s).slug||'')}catch{console.log('')}})")
check "创建文章拿到 slug" 1 "$([ -n "$SLUG" ] && echo 1 || echo 0)"
check "main 租户文章页"   200 "$(code main.localhost "/post/$SLUG")"
check "t1 租户看不到 main 的文章（隔离）" 404 "$(code t1.localhost "/post/$SLUG")"

# 1x1 PNG
PNG=$(mktemp --suffix=.png 2>/dev/null || mktemp).png
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$PNG"
UP=$(curl -s --resolve "main.localhost:${PORT}:127.0.0.1" -b "$JAR" -F "file=@${PNG};type=image/png" http://main.localhost:${PORT}/api/admin/upload)
KEY=$(printf '%s' "$UP" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).key||'')}catch{console.log('')}})")
check "上传图片拿到 key" 1 "$([ -n "$KEY" ] && echo 1 || echo 0)"
check "图片回读 200 + PNG" 200 "$(curl -s -o /dev/null -w '%{http_code}' --resolve "main.localhost:${PORT}:127.0.0.1" "http://main.localhost:${PORT}/images/$KEY")"
check "t1 租户看不到 main 的图（R2 隔离）" 404 "$(code t1.localhost "/images/$KEY")"

check "main 租户 sitemap" 200 "$(code main.localhost /sitemap.xml)"

kill ${SERVER_PID} 2>/dev/null || true
echo
echo "结果：PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" = 0 ]
