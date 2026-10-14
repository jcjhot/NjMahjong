#!/bin/bash
# 南京麻将 · 后台常驻启动器（在你自己的终端里运行，关掉终端也不会停）
#
#   bash start-bg.sh          启动（已在运行则提示）
#   bash start-bg.sh restart  重启
#   bash start-bg.sh stop     停止
#   bash start-bg.sh status   查看状态
#
# 日志：/tmp/mahjong.log   PID：/tmp/mahjong.pid

cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8420}"
PIDFILE="/tmp/mahjong.pid"
LOGFILE="/tmp/mahjong.log"

# node 优先用固定的绝对路径，避免不同终端的 PATH 差异
NODE="$(command -v node || true)"
[ -x "/Users/jicj/.workbuddy/binaries/node/versions/22.22.2/bin/node" ] && \
  NODE="/Users/jicj/.workbuddy/binaries/node/versions/22.22.2/bin/node"
if [ -z "$NODE" ]; then
  echo "找不到 node，请先安装 Node.js" >&2
  exit 1
fi

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local p; p="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$p" ] || return 1
  kill -0 "$p" 2>/dev/null || return 1
  echo "$p"
}

do_stop() {
  local p
  if p="$(running_pid)"; then
    echo "停止进程 $p ..."
    kill "$p" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$p" 2>/dev/null || break
      sleep 0.3
    done
    kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null
    echo "已停止"
  else
    # PID 文件丢失时按端口兜底
    local byport
    byport="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)"
    if [ -n "$byport" ]; then
      echo "停止占用 $PORT 的进程 $byport ..."
      kill "$byport" 2>/dev/null; sleep 0.6
      kill -0 "$byport" 2>/dev/null && kill -9 "$byport" 2>/dev/null
    fi
    echo "未在运行"
  fi
  rm -f "$PIDFILE"
}

do_start() {
  local p
  if p="$(running_pid)"; then
    echo "已在运行（PID $p），端口 $PORT。要重启请执行：bash start-bg.sh restart"
    return 0
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "端口 $PORT 已被别的进程占用，请先停掉它或换 PORT=xxxx 启动" >&2
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -3 >&2
    return 1
  fi

  echo "启动中 ... 端口 $PORT，日志 $LOGFILE"
  # nohup + 重定向 + 关闭 stdin：进程脱离当前终端，关窗口不受影响
  PORT="$PORT" nohup "$NODE" server.js >> "$LOGFILE" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  disown 2>/dev/null || true

  # 等端口真正起来
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/api/ping"; then
      echo "已启动 ✓  PID $(cat "$PIDFILE")"
      echo ""
      echo "  本机:     http://localhost:$PORT"
      for ip in $(ipconfig getifaddr en0 2>/dev/null) $(ipconfig getifaddr en1 2>/dev/null); do
        echo "  同一 WiFi: http://$ip:$PORT"
      done
      echo ""
      return 0
    fi
    sleep 0.3
  done

  echo "启动失败，最近日志：" >&2
  tail -20 "$LOGFILE" >&2
  rm -f "$PIDFILE"
  return 1
}

case "${1:-start}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; sleep 0.6; do_start ;;
  status)
    if p="$(running_pid)"; then
      echo "运行中  PID $p  端口 $PORT"
    elif lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "端口 $PORT 有进程在监听，但不是本脚本启动的"
    else
      echo "未运行"
    fi
    ;;
  *) echo "用法: bash start-bg.sh [start|stop|restart|status]" ;;
esac
