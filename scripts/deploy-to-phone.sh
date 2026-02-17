#!/bin/bash
# Deploy DhandhaPhone gateway code from Mac to Android phone
# Requires: SSH access to Termux or ADB
# Usage: ./scripts/deploy-to-phone.sh

set -e

PHONE_IP="${PHONE_IP:-192.168.1.100}"
PHONE_SSH_HOST="${PHONE_SSH_HOST:-phone}"
REMOTE_DIR="~/dhandhaphone"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "📱 DhandhaPhone Deploy"
echo "   Local:  ${LOCAL_DIR}"
echo "   Remote: ${REMOTE_DIR}"
echo ""

# Method 1: SSH (preferred)
if ssh -q -o ConnectTimeout=3 "${PHONE_SSH_HOST}" exit 2>/dev/null; then
  echo "🔗 Connected via SSH to ${PHONE_SSH_HOST}"

  echo "📦 Syncing files..."
  rsync -avz \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.env' \
    --exclude '/tmp' \
    --exclude '*.md' \
    --exclude 'scripts/' \
    "${LOCAL_DIR}/lib/" "${PHONE_SSH_HOST}:${REMOTE_DIR}/lib/"

  rsync -avz \
    --exclude 'node_modules' \
    "${LOCAL_DIR}/skills/" "${PHONE_SSH_HOST}:${REMOTE_DIR}/skills/"

  rsync -avz \
    "${LOCAL_DIR}/config/" "${PHONE_SSH_HOST}:${REMOTE_DIR}/config/"

  echo "📥 Installing dependencies..."
  ssh "${PHONE_SSH_HOST}" "cd ${REMOTE_DIR} && npm install --production 2>/dev/null || true"

  echo "🔄 Restarting gateway..."
  ssh "${PHONE_SSH_HOST}" "cd ${REMOTE_DIR} && pm2 restart dhandhaphone 2>/dev/null || pm2 start lib/voice/voice-handler.js --name dhandhaphone 2>/dev/null || echo 'pm2 not found, restart manually'"

  echo ""
  echo "✅ Deployed via SSH."
  echo "   Check logs: ssh ${PHONE_SSH_HOST} 'pm2 logs dhandhaphone'"

# Method 2: ADB
elif command -v adb &>/dev/null && adb devices | grep -q device; then
  echo "🔗 Connected via ADB"

  echo "📦 Pushing files to /sdcard/dhandhaphone-sync/..."
  adb push "${LOCAL_DIR}/lib/" "/sdcard/dhandhaphone-sync/lib/"
  adb push "${LOCAL_DIR}/skills/" "/sdcard/dhandhaphone-sync/skills/"
  adb push "${LOCAL_DIR}/config/" "/sdcard/dhandhaphone-sync/config/"

  echo "📥 Copying into Termux environment..."
  adb shell "
    if [ -d /data/data/com.termux/files/home ]; then
      cp -r /sdcard/dhandhaphone-sync/* /data/data/com.termux/files/home/dhandhaphone/ 2>/dev/null
      echo 'Files copied to Termux home'
    else
      echo 'Termux home not accessible. Copy manually from /sdcard/dhandhaphone-sync/'
    fi
  "

  echo ""
  echo "✅ Deployed via ADB."
  echo "   Open Termux and run: cd ~/dhandhaphone && pm2 restart dhandhaphone"

else
  echo "❌ Cannot reach phone."
  echo ""
  echo "Setup options:"
  echo ""
  echo "SSH (recommended):"
  echo "  1. Install openssh in Termux: pkg install openssh"
  echo "  2. Start sshd in Termux: sshd"
  echo "  3. Add to ~/.ssh/config on Mac:"
  echo "     Host phone"
  echo "       HostName ${PHONE_IP}"
  echo "       User u0_a100"
  echo "       Port 8022"
  echo ""
  echo "ADB:"
  echo "  1. Enable USB debugging on phone"
  echo "  2. Connect: adb connect ${PHONE_IP}:5555"
  echo ""
  exit 1
fi
