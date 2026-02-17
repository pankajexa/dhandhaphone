#!/bin/bash
# Test Sarvam STT and TTS APIs from your Mac during development
# Usage: ./scripts/test-voice.sh
# Requires: SARVAM_API_KEY env var set

set -e

SARVAM_KEY="${SARVAM_API_KEY}"
BASE_URL="https://api.sarvam.ai"

if [ -z "$SARVAM_KEY" ]; then
  echo "❌ SARVAM_API_KEY not set."
  echo "   Get your key at: https://dashboard.sarvam.ai"
  echo "   Then: export SARVAM_API_KEY=your_key_here"
  exit 1
fi

echo "=== DhandhaPhone Voice API Test ==="
echo ""

# --- Test 1: TTS (Text-to-Speech) ---
echo "📢 Test 1: Text-to-Speech (English)"
TTS_RESPONSE=$(curl -s -X POST "${BASE_URL}/text-to-speech" \
  -H "API-Subscription-Key: ${SARVAM_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": ["Good morning. Yesterday your shop had total revenue of thirty-eight thousand across twelve transactions. Two payments are overdue."],
    "target_language_code": "en-IN",
    "speaker": "arvind",
    "model": "bulbul:v3",
    "enable_preprocessing": true
  }')

# Check if response has audio
if echo "$TTS_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('audios',[None])[0]" 2>/dev/null; then
  echo "$TTS_RESPONSE" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
audio = base64.b64decode(data['audios'][0])
with open('/tmp/test-tts-en.wav', 'wb') as f:
    f.write(audio)
print(f'   ✅ Generated {len(audio)} bytes of audio')
"
  # Play if on Mac
  if command -v afplay &>/dev/null; then
    echo "   🔊 Playing..."
    afplay /tmp/test-tts-en.wav 2>/dev/null || true
  fi
else
  echo "   ❌ TTS failed. Response:"
  echo "$TTS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$TTS_RESPONSE"
fi

echo ""

# --- Test 2: TTS in Hindi ---
echo "📢 Test 2: Text-to-Speech (Hindi)"
TTS_HI=$(curl -s -X POST "${BASE_URL}/text-to-speech" \
  -H "API-Subscription-Key: ${SARVAM_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": ["Suprabhat. Kal aapki dukaan mein kul revenue untalees hazaar raha, barah transactions mein."],
    "target_language_code": "hi-IN",
    "speaker": "meera",
    "model": "bulbul:v3",
    "enable_preprocessing": true
  }')

if echo "$TTS_HI" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('audios',[None])[0]" 2>/dev/null; then
  echo "$TTS_HI" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
audio = base64.b64decode(data['audios'][0])
with open('/tmp/test-tts-hi.wav', 'wb') as f:
    f.write(audio)
print(f'   ✅ Generated {len(audio)} bytes of audio')
"
  if command -v afplay &>/dev/null; then
    echo "   🔊 Playing..."
    afplay /tmp/test-tts-hi.wav 2>/dev/null || true
  fi
else
  echo "   ❌ TTS Hindi failed."
fi

echo ""

# --- Test 3: STT (Speech-to-Text) ---
echo "🎤 Test 3: Speech-to-Text"

# Check if we have a test audio file, or create one from TTS output
if [ -f "/tmp/test-tts-en.wav" ]; then
  TEST_AUDIO="/tmp/test-tts-en.wav"
  echo "   Using TTS output as STT input (round-trip test)..."
else
  echo "   No test audio available. Skipping STT test."
  echo "   To test STT: place a .wav file at /tmp/test-voice.wav"
  TEST_AUDIO=""
fi

if [ -n "$TEST_AUDIO" ]; then
  STT_RESPONSE=$(curl -s -X POST "${BASE_URL}/speech-to-text" \
    -H "API-Subscription-Key: ${SARVAM_KEY}" \
    -F "file=@${TEST_AUDIO}" \
    -F "language_code=auto" \
    -F "model=saaras:v3")

  echo "   STT Result:"
  echo "$STT_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$STT_RESPONSE"
fi

echo ""

# --- Test 4: Check available speakers ---
echo "🗣️ Test 4: Checking API connectivity..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/text-to-speech" \
  -H "API-Subscription-Key: ${SARVAM_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"inputs": ["test"], "target_language_code": "en-IN", "speaker": "arvind", "model": "bulbul:v3"}')

if [ "$HEALTH" = "200" ]; then
  echo "   ✅ Sarvam API is reachable and authenticated."
else
  echo "   ❌ API returned HTTP $HEALTH. Check your API key."
fi

echo ""
echo "=== Test Complete ==="
echo "TTS audio files saved to /tmp/test-tts-*.wav"
