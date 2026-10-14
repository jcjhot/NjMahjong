#!/bin/bash
# 启动南京麻将联机服务器
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8420}"
echo "启动端口: $PORT"
PORT="$PORT" exec node server.js
