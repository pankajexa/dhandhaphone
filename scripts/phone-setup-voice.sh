#!/bin/bash
# Run this ONCE on the Android phone (inside Termux/proot Ubuntu)
# Installs all voice processing dependencies
# Usage: bash phone-setup-voice.sh

set -e

echo "📦 DhandhaPhone Voice Setup"
echo "==========================="
echo ""

# Detect environment
if [ -f /etc/os-release ] && grep -q "Ubuntu" /etc/os-release; then
  PKG_MANAGER="apt-get"
  echo "📍 Running inside proot Ubuntu"
elif command -v pkg &>/dev/null; then
  PKG_MANAGER="pkg"
  echo "📍 Running inside Termux"
else
  echo "⚠️ Unknown environment. Trying apt-get..."
  PKG_MANAGER="apt-get"
fi

# Install ffmpeg (audio conversion)
echo ""
echo "1️⃣ Installing ffmpeg..."
if command -v ffmpeg &>/dev/null; then
  echo "   ✅ ffmpeg already installed: $(ffmpeg -version 2>&1 | head -1)"
else
  $PKG_MANAGER update -y
  $PKG_MANAGER install -y ffmpeg
  echo "   ✅ ffmpeg installed"
fi

# Install sox (audio utilities — optional but useful)
echo ""
echo "2️⃣ Installing sox (optional audio tools)..."
if command -v sox &>/dev/null; then
  echo "   ✅ sox already installed"
else
  $PKG_MANAGER install -y sox 2>/dev/null || echo "   ⚠️ sox not available, skipping (not critical)"
fi

# Verify Node.js
echo ""
echo "3️⃣ Checking Node.js..."
if command -v node &>/dev/null; then
  echo "   ✅ Node.js $(node --version)"
else
  echo "   ❌ Node.js not found! Install first:"
  echo "      $PKG_MANAGER install nodejs"
  exit 1
fi

# Install Node.js dependencies for voice module
echo ""
echo "4️⃣ Installing Node.js dependencies..."
cd ~/dhandhaphone 2>/dev/null || cd "$(dirname "$0")/.."

if [ -f package.json ]; then
  npm install --production
  echo "   ✅ npm dependencies installed"
else
  echo "   ⚠️ No package.json found. Creating minimal one..."
  cat > package.json << 'PKGJSON'
{
  "name": "dhandhaphone",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "node-fetch": "^2.7.0"
  }
}
PKGJSON
  npm install --production
  echo "   ✅ package.json created and dependencies installed"
fi

# Create temp audio directory
echo ""
echo "5️⃣ Creating temp audio directory..."
mkdir -p /tmp/dhandhaphone-audio
echo "   ✅ /tmp/dhandhaphone-audio created"

# Sarvam API key setup
echo ""
echo "6️⃣ Sarvam API Key Setup"
if [ -n "$SARVAM_API_KEY" ]; then
  echo "   ✅ SARVAM_API_KEY is set"
else
  echo "   ⚠️ SARVAM_API_KEY not set."
  echo ""
  echo "   Get your free API key:"
  echo "   1. Go to https://dashboard.sarvam.ai"
  echo "   2. Sign up (free ₹1,000 credits)"
  echo "   3. Copy your API key"
  echo "   4. Add to your environment:"
  echo ""
  echo "   echo 'export SARVAM_API_KEY=your_key_here' >> ~/.bashrc"
  echo "   source ~/.bashrc"
fi

# Summary
echo ""
echo "==========================="
echo "✅ Voice setup complete!"
echo ""
echo "Dependencies:"
ffmpeg -version 2>&1 | head -1 || echo "  ffmpeg: not installed"
echo "  Node.js: $(node --version 2>/dev/null || echo 'not installed')"
echo "  npm: $(npm --version 2>/dev/null || echo 'not installed')"
echo ""
echo "Next steps:"
echo "  1. Set SARVAM_API_KEY (if not done)"
echo "  2. Deploy code: ./scripts/deploy-to-phone.sh"
echo "  3. Test voice: send a voice note to your Telegram bot"
