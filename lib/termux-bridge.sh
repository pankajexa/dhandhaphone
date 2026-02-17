#!/bin/bash
# Bridge script to call Termux:API from inside proot Ubuntu
# Usage: ./termux-bridge.sh <command> [args...]
# Example: ./termux-bridge.sh termux-sms-list -l 50 -t inbox

TERMUX_BIN="/host-rootfs/data/data/com.termux/files/usr/bin"

if [ ! -d "$TERMUX_BIN" ]; then
  # Fallback: try direct path (some proot setups mount differently)
  TERMUX_BIN="/data/data/com.termux/files/usr/bin"
fi

CMD="$1"
shift

if [ -x "$TERMUX_BIN/$CMD" ]; then
  exec "$TERMUX_BIN/$CMD" "$@"
else
  echo "{\"error\": \"Command $CMD not found at $TERMUX_BIN\"}" >&2
  exit 1
fi
