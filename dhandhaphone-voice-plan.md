# DhandhaPhone Voice Plan — Phase 1 Implementation

## What We're Building

Phase 1 delivers voice notes in both directions via Telegram:
1. Owner sends voice note → Agent transcribes → processes → replies
2. Agent generates voice briefings → sends as voice note to owner
3. Owner can speak commands instead of typing

No phone calls. No real-time streaming. Just async voice notes
through the existing Telegram channel. This is the fastest path
to "the munshi listens and talks."

---

## Development Setup: Mac → Phone

### How It Works
```
YOUR MAC (development)                    ANDROID PHONE (testing)
┌──────────────────────┐                 ┌──────────────────────┐
│ VS Code / Editor     │                 │ Termux + proot       │
│ Node.js gateway code │                 │ Ubuntu environment   │
│ Sarvam API testing   │    rsync/adb    │ Node.js + Gateway    │
│ Unit tests           │ ──────────────► │ Telegram Bot running │
│ Flutter app (debug)  │                 │ Sarvam Edge (future) │
└──────────────────────┘                 └──────────────────────┘
```

### Mac Development Workflow

**Step 1: Develop & test gateway code on Mac**
```bash
# Your project structure
dhandhaphone/
├── gateway/                 # Node.js gateway (runs in Termux)
│   ├── index.js            # Main entry
│   ├── voice/              # NEW: voice processing module
│   │   ├── sarvam-client.js    # Sarvam API wrapper
│   │   ├── voice-handler.js    # Voice message routing
│   │   ├── tts-generator.js    # Text-to-speech generation
│   │   └── audio-utils.js      # Format conversion helpers
│   ├── skills/             # Business skills
│   ├── config/             # SOUL.md, HEARTBEAT.md, etc
│   ├── lib/                # Shared utilities
│   └── package.json
├── flutter-app/            # Flutter wrapper (Android UI)
│   ├── lib/
│   ├── android/
│   └── pubspec.yaml
└── scripts/
    ├── deploy-to-phone.sh  # Push code to phone
    └── test-voice.sh       # Local voice API tests
```

**Step 2: Test Sarvam APIs locally on Mac**
- Sarvam Cloud APIs work from anywhere (HTTPS REST)
- Record test audio on Mac, send to Sarvam STT, verify transcription
- Generate TTS on Mac, play audio, verify quality
- No phone needed for API development

**Step 3: Deploy to phone for integration testing**
```bash
# deploy-to-phone.sh
#!/bin/bash
# Connect Mac to phone via USB or ADB over WiFi
ADB_DEVICE="192.168.1.x:5555"  # Phone's IP

# Push gateway code to Termux environment
adb -s $ADB_DEVICE push ./gateway/ /sdcard/dhandhaphone/
adb -s $ADB_DEVICE shell "run-as com.termux cp -r /sdcard/dhandhaphone/* ~/"

# Or via SSH into Termux (more reliable)
rsync -avz ./gateway/ phone:~/dhandhaphone/gateway/

# Restart gateway on phone
ssh phone "cd ~/dhandhaphone/gateway && pm2 restart dhandhaphone"
```

**Step 4: Test on phone**
- Send voice note to Telegram bot from your primary phone
- Check logs on phone via `ssh phone "pm2 logs dhandhaphone"`
- Verify transcription accuracy
- Verify voice reply is received

### Flutter App Changes (for phone UI)

The Flutter app wrapping Termux needs minimal voice changes in Phase 1
because voice happens through Telegram, not through the Flutter UI.

**Phase 1 Flutter changes: NONE.**
Voice notes go through Telegram. The Flutter app just keeps the
gateway alive. No new Flutter UI needed.

**Phase 1.5 Flutter changes (future):**
- Record button in Flutter app for direct voice input (bypass Telegram)
- Audio playback for voice responses
- Sarvam Edge SDK integration for on-device STT/TTS

---

## File Changes Map

Every file that needs to be created or modified, organized by area:

### NEW FILES — Voice Module

```
gateway/voice/
├── sarvam-client.js        # Sarvam API wrapper (STT + TTS)
├── voice-handler.js        # Routes voice messages through pipeline
├── tts-generator.js        # Generates voice responses
├── audio-utils.js          # OGG↔WAV conversion, format handling
└── voice-config.json       # API keys, voice selection, thresholds
```

#### `gateway/voice/sarvam-client.js`
Wraps Sarvam Cloud REST APIs.

```javascript
// Core functions:
class SarvamClient {
  constructor(apiKey) { ... }

  // Speech-to-Text: Send audio file, get transcript
  async transcribe(audioFilePath, options = {}) {
    // POST /speech-to-text
    // multipart/form-data with audio file
    // Returns: { transcript, language_code, confidence }
  }

  // Text-to-Speech: Send text, get audio buffer
  async synthesize(text, options = {}) {
    // POST /text-to-speech
    // JSON body with text, language, speaker, model
    // Returns: base64 audio → save as .ogg
  }

  // Translate (bonus): For multi-language support
  async translate(text, sourceLang, targetLang) {
    // POST /translate
    // Returns: { translated_text }
  }
}
```

**Key API details:**
- Base URL: `https://api.sarvam.ai`
- Auth header: `API-Subscription-Key: <key>`
- STT accepts: MP3, WAV, OGG, AAC, M4A, AMR, WebM, FLAC
- TTS returns: base64 encoded audio (configurable format)
- Telegram voice notes arrive as .ogg (opus codec)
- Telegram expects .ogg for voice note replies

#### `gateway/voice/voice-handler.js`
The main voice pipeline orchestrator.

```javascript
// Pipeline:
// 1. Receive voice message from Telegram
// 2. Download .ogg file
// 3. Send to Sarvam STT → get transcript
// 4. Pass transcript to agent (same as text message)
// 5. Get agent response text
// 6. Decide: text reply or voice reply?
// 7. If voice: send to Sarvam TTS → get audio
// 8. Send voice note back via Telegram

class VoiceHandler {
  constructor(sarvamClient, agent) { ... }

  async handleVoiceMessage(voiceMessage) {
    // voiceMessage = Telegram voice message object
    // Contains: file_id, duration, mime_type

    // Step 1: Download audio from Telegram
    const audioPath = await this.downloadVoice(voiceMessage.file_id);

    // Step 2: Transcribe
    const result = await this.sarvam.transcribe(audioPath);
    const transcript = result.transcript;
    const confidence = result.confidence;

    // Step 3: Log transcription for owner transparency
    // "🎤 Suna: <transcript>"
    // (Only show if confidence > 0.7, otherwise ask to repeat)

    // Step 4: Process as normal text message
    const response = await this.agent.process(transcript);

    // Step 5: Decide response format
    const replyAsVoice = this.shouldReplyVoice(response, voiceMessage);

    // Step 6: Send response
    if (replyAsVoice) {
      const audioBuffer = await this.sarvam.synthesize(
        response.text,
        { speaker: this.voiceConfig.defaultSpeaker }
      );
      await this.sendVoiceNote(audioBuffer);
    } else {
      await this.sendText(response.text);
    }
  }

  shouldReplyVoice(response, originalMessage) {
    // Reply as voice when:
    // - Owner sent a voice note (match their mode)
    // - Response is a briefing (>100 chars)
    // - Owner has voice_preference: "always" in profile

    // Reply as text when:
    // - Short confirmation ("✅ ₹5,000 logged")
    // - Contains numbers/data the owner needs to reference
    // - Owner has voice_preference: "text_only"
    // - Error messages

    // Default: mirror the input format
    return originalMessage.isVoice && response.text.length > 50;
  }
}
```

#### `gateway/voice/tts-generator.js`
Handles proactive voice generation (briefings, alerts).

```javascript
class TTSGenerator {
  constructor(sarvamClient) { ... }

  // Generate morning/evening briefing as voice note
  async generateBriefing(briefingText, language) {
    // Clean text for speech:
    // - Replace "₹" with "rupees" (or keep, Sarvam handles it)
    // - Replace emoji with nothing
    // - Replace "C-001" back to real names (de-anonymize first!)
    // - Break into chunks if >2500 chars (Sarvam limit)

    const cleanText = this.prepareForSpeech(briefingText);
    const audio = await this.sarvam.synthesize(cleanText, {
      speaker: this.getSpeakerForLanguage(language),
      pace: 0.95,  // slightly slower for briefings
    });
    return audio;
  }

  prepareForSpeech(text) {
    return text
      .replace(/✅|🚨|💰|📊|🔋/g, '')  // strip emoji
      .replace(/\*\*/g, '')              // strip markdown bold
      .replace(/\n- /g, '. ')           // bullets to sentences
      .replace(/\n/g, '. ')             // newlines to pauses
      .trim();
  }

  getSpeakerForLanguage(lang) {
    // Map language preference to Sarvam Bulbul v3 voice
    // Sarvam supports 11 languages with 35+ speakers
    // Verify exact speaker IDs from Sarvam dashboard
    const speakers = {
      'en': 'arvind',        // English (Indian accent)
      'hi': 'meera',         // Hindi
      'hinglish': 'meera',   // Hinglish → Hindi voice handles it
      'bn': 'aditi',         // Bengali
      'gu': 'nisha',         // Gujarati
      'kn': 'suresh',        // Kannada
      'ml': 'amala',         // Malayalam
      'mr': 'rohini',        // Marathi
      'or': 'priya',         // Odia
      'pa': 'harpreet',      // Punjabi
      'ta': 'nila',          // Tamil
      'te': 'padma',         // Telugu
    };
    // NOTE: These are placeholder names. Actual speaker IDs
    // must be verified from Sarvam API docs / dashboard.
    // Run: curl https://api.sarvam.ai/text-to-speech/speakers
    return speakers[lang] || 'arvind';  // default to English voice
  }
}
```

#### `gateway/voice/audio-utils.js`
Format conversion between Telegram and Sarvam.

```javascript
// Telegram sends: .ogg (opus codec)
// Sarvam STT accepts: .ogg, .mp3, .wav, etc (ogg works directly!)
// Sarvam TTS returns: base64 audio (configurable format)
// Telegram expects: .ogg for voice notes

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Convert Sarvam TTS output to Telegram-compatible .ogg
function base64ToOgg(base64Audio, outputPath) {
  const buffer = Buffer.from(base64Audio, 'base64');
  fs.writeFileSync(outputPath, buffer);
  // If Sarvam returns wav/mp3, convert to ogg:
  // execSync(`ffmpeg -i ${outputPath} -c:a libopus ${outputPath}.ogg`);
  return outputPath;
}

// Get audio duration for Telegram metadata
function getAudioDuration(filePath) {
  // Use ffprobe if available, or estimate from file size
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
    );
    return parseFloat(result.toString().trim());
  } catch {
    // Estimate: ~16KB per second for opus at standard quality
    const stats = fs.statSync(filePath);
    return Math.ceil(stats.size / 16000);
  }
}

// Ensure ffmpeg is available (needed on Termux)
function checkDependencies() {
  try {
    execSync('which ffmpeg');
    return true;
  } catch {
    console.warn('ffmpeg not found. Install: pkg install ffmpeg');
    return false;
  }
}
```

#### `gateway/voice/voice-config.json`
```json
{
  "sarvam_api_key": "${SARVAM_API_KEY}",
  "sarvam_base_url": "https://api.sarvam.ai",
  "default_model_tts": "bulbul:v3",
  "default_model_stt": "saaras:v3",
  "tts_pace": 1.0,
  "tts_sample_rate": 22050,
  "tts_audio_format": "ogg",
  "stt_language": "auto",
  "min_confidence_threshold": 0.6,
  "voice_reply_min_length": 50,
  "voice_reply_max_length": 2500,
  "briefing_voice_enabled": true,
  "temp_audio_dir": "/tmp/dhandhaphone-audio",

  "supported_languages": {
    "en":  { "stt_code": "en-IN", "tts_code": "en-IN",  "label": "English" },
    "hi":  { "stt_code": "hi-IN", "tts_code": "hi-IN",  "label": "Hindi" },
    "bn":  { "stt_code": "bn-IN", "tts_code": "bn-IN",  "label": "Bengali" },
    "gu":  { "stt_code": "gu-IN", "tts_code": "gu-IN",  "label": "Gujarati" },
    "kn":  { "stt_code": "kn-IN", "tts_code": "kn-IN",  "label": "Kannada" },
    "ml":  { "stt_code": "ml-IN", "tts_code": "ml-IN",  "label": "Malayalam" },
    "mr":  { "stt_code": "mr-IN", "tts_code": "mr-IN",  "label": "Marathi" },
    "or":  { "stt_code": "or-IN", "tts_code": "or-IN",  "label": "Odia" },
    "pa":  { "stt_code": "pa-IN", "tts_code": "pa-IN",  "label": "Punjabi" },
    "ta":  { "stt_code": "ta-IN", "tts_code": "ta-IN",  "label": "Tamil" },
    "te":  { "stt_code": "te-IN", "tts_code": "te-IN",  "label": "Telugu" }
  },

  "language_ui_strings": {
    "en": { "heard": "Heard", "processing": "Processing...", "repeat": "Could you say that again?" },
    "hi": { "heard": "Suna", "processing": "Sun raha hoon...", "repeat": "Dobara bol dijiye?" },
    "te": { "heard": "Vinna", "processing": "Vintunna...", "repeat": "Malli cheppandi?" },
    "ta": { "heard": "Kettadhu", "processing": "Kelkiren...", "repeat": "Mendum sollungal?" },
    "kn": { "heard": "Kelide", "processing": "Kelistiddene...", "repeat": "Matte heli?" },
    "bn": { "heard": "Shunlam", "processing": "Shunchhi...", "repeat": "Abar bolun?" },
    "gu": { "heard": "Sambhalyu", "processing": "Sambhali rahyo chhu...", "repeat": "Farthi bolo?" },
    "mr": { "heard": "Aikla", "processing": "Aiktoy...", "repeat": "Parat sanga?" },
    "ml": { "heard": "Kettu", "processing": "Kelkkunnu...", "repeat": "Veendum parayoo?" },
    "or": { "heard": "Sunili", "processing": "Sunuchu...", "repeat": "Aau thare kahile?" },
    "pa": { "heard": "Suneya", "processing": "Sun riha haan...", "repeat": "Dobara dasso?" }
  }
}
```

### MODIFIED FILES — Existing Code

#### 1. `gateway/index.js` (Main Entry)
**Add:** Voice handler initialization and Telegram voice message routing.

```diff
+ const { VoiceHandler } = require('./voice/voice-handler');
+ const { SarvamClient } = require('./voice/sarvam-client');
+ const { TTSGenerator } = require('./voice/tts-generator');

  // Initialize
+ const sarvam = new SarvamClient(config.sarvam_api_key);
+ const voiceHandler = new VoiceHandler(sarvam, agent);
+ const ttsGenerator = new TTSGenerator(sarvam);

  // Telegram message handler
  bot.on('message', async (msg) => {
+   // Voice message handling
+   if (msg.voice || msg.audio) {
+     await voiceHandler.handleVoiceMessage(msg);
+     return;
+   }
+
    // Existing text message handling...
  });
```

#### 2. `config/SOUL.md` — Voice Personality Directives
**Add** new section after "## Response Length":

```markdown
## Voice Behavior

When the owner sends a voice note:
1. Transcribe it silently. Show "🎤 Heard: <transcript>" for transparency.
   Use the owner's language for the label:
   - English: "🎤 Heard:"
   - Hindi/Hinglish: "🎤 Suna:"
   - Telugu: "🎤 Vinna:"
   - Tamil: "🎤 Kettadhu:"
   - Kannada: "🎤 Kelide:"
   - Other: "🎤 Heard:"
2. If transcription seems wrong (low confidence), ask in THEIR language:
   - EN: "Did I hear that right? '<transcript>' — say again if not."
   - HI: "Yeh sahi suna? '<transcript>' — dobara bol dijiye."
   - TE: "Idi correct ga vinnana? '<transcript>' — malli cheppandi."
3. Process the transcript exactly like a text message.

When replying with voice:
- ALWAYS match the owner's language from profile.json
- Keep voice replies under 30 seconds (~80-100 words)
- For numbers: let Sarvam handle pronunciation naturally
- For names: pronounce as the owner said them
- For confirmations: text is fine ("✅ ₹5,000 logged"), skip voice
- For briefings: voice preferred (owner can listen hands-free)

When to reply voice vs text:
- Owner sent voice → reply voice (mirror their mode)
- Briefing or summary → voice (hands-free listening)
- Short confirmation → text (faster to glance at)
- Data/numbers they'll reference → text (easier to re-read)
- Error or clarification → text (precision matters)

Voice persona: You sound like a helpful, competent office assistant.
Not robotic. Not overly enthusiastic. Calm, clear, respectful.
Adapt formality to the owner's own style — if they're casual,
be slightly more casual. If they're formal, match that.
```

#### 3. `config/HEARTBEAT.md` — Voice Briefings
**Add** voice briefing generation to morning/evening heartbeat:

```markdown
## Check 6: Voice Briefing (Morning 8 AM / Evening 8 PM)

If current time matches briefing schedule AND briefing_voice_enabled:
1. Generate briefing text (existing daily-intel skill)
2. Read owner's language_preference from profile.json
3. Convert to voice via Sarvam TTS in that language
4. Send as voice note to Telegram
5. Also send text version as follow-up message

Greeting templates by language:
- English: "Good morning [name]. Here's your daily update..."
- Hindi: "Suprabhat [name] ji. Kal ka hisaab..."
- Telugu: "Shubhodayam [name] garu. Ninna business update..."
- Tamil: "Kaalavanakkam [name]. Netru nadantha update..."
- Kannada: "Shubhodaya [name] avare. Ninne business update..."
- Gujarati: "Suprabhat [name] bhai. Gai kaal nu update..."
- Bengali: "Suprabhat [name] da. Gotokal er update..."
- Marathi: "Suprabhat [name]. Kalcha business update..."

Briefing should be under 60 seconds of audio (~150-180 words).
```

#### 4. `skills/money-tracker/SKILL.md` — Voice Input
**Add** section for voice-based transaction entry:

```markdown
## Voice Transaction Entry

When owner speaks a transaction (via voice note):

English examples:
- "Got fifteen thousand from Reddy for the order" → ₹15,000 credit from Reddy
- "Paid rent today, forty-two thousand" → ₹42,000 debit, category: rent
- "Three clients today, five thousand each" → ₹15,000 revenue (3 × ₹5,000)

Hindi/Hinglish examples:
- "Aaj do order aaye, ek ka saat hazaar ek ka nau hazaar" → ₹7,000 + ₹9,000
- "Staff salary de di, total sixty thousand" → ₹60,000 debit, category: salary

Telugu examples:
- "Ravi nundi padi velu vachindi" → ₹10,000 credit from Ravi
- "Supplier ki iravai idu velu ichanu" → ₹25,000 debit to supplier

Tamil examples:
- "Inniki moonu customer, total patinaiyaayiram" → ₹15,000 revenue
- "Electrician ku aaru aayiram kuduthen" → ₹6,000 debit for electrician

Voice parsing rules:
- Sarvam STT outputs numbers in digits ("5000" not "paanch hazaar")
  in most cases — verify during testing
- If ambiguous amount or party: confirm before logging
  EN: "₹15,000 from Reddy as credit? ✅ or ❌"
  HI: "₹15,000 Reddy se credit? ✅ ya ❌"
- Multiple transactions in one voice note: process each separately
```

#### 5. `skills/people-memory/SKILL.md` — Voice Contact Mentions
**Add** section:

```markdown
## Voice-Mentioned Contacts

When owner mentions a person by name in a voice note, check contacts:
- Known contact → use existing entry
- Unknown name → create new contact with just the name
  - "Someone called Meera placed an order" → new contact "Meera"
  - Details fill in over time from future mentions

Voice-specific: Sarvam STT may spell names differently across languages.
Use fuzzy matching on contact names (Levenshtein distance ≤ 2).
Examples of variations to handle:
- "Reddy" vs "Reddi" vs "రెడ్డి"
- "Murugan" vs "Murugan" vs "முருகன்"
- "Patel" vs "Patell"
- English pronunciation vs regional spelling
All should match the same contact.
```

#### 6. `skills/daily-intel/SKILL.md` — Voice Briefing Format
**Add** section:

```markdown
## Voice Briefing Format

When generating a briefing that will be spoken aloud (TTS), adjust:

DO:
- Use natural spoken language matching owner's preference
- Keep sentences short (8-12 words each)
- Pause between sections: use period instead of bullet points
- Use connecting phrases natural to the language:
  - EN: "also", "on top of that", "most importantly"
  - HI: "aur", "iske alava", "sabse important"
  - TE: "inka", "mundu ga", "mukhyam ga"
  - TA: "athoda", "mukkiyamana vishayam"

DON'T:
- Use emoji (stripped before TTS anyway)
- Use tables or formatted data
- List more than 5 items (attention span in audio is shorter)
- Include file paths, JSON, or technical details
- Say anonymized IDs like "C-001" — always use real names in voice

Example briefings by language:

English (salon owner in Bangalore):
"Good morning Priya. Yesterday you had twelve appointments,
total revenue thirty-eight thousand. Your best service was
hair colouring at fourteen thousand. Two clients have overdue
balances — Ananya owes six thousand from last week, and
Divya's three thousand is ten days old. You're running low on
L'Oreal hair colour, might want to reorder today."

Telugu (kirana store owner in Vizag):
"Shubhodayam Ramesh garu. Ninna mee shop lo total
ebbhai rendu velu ammaru, iravai aidu transactions lo.
Supplier Lakshmi Traders ki padi idu velu pending undi.
Rice stock takkuva ga undi, rendu moodhu rojulu lo
aipothundi. Order cheyamantara?"

Tamil (tiffin service in Chennai):
"Kaalavanakkam Lakshmi. Netru moonu pathu order vandhadhu,
total irupathu aaru aayiram. Swiggy la pathinezhlu order,
Zomato la pathinmoonu. Sambar powder stock kuravaa irukku,
naalaikku order pannum."
```

### NEW FILES — Scripts & Tooling

#### `scripts/test-voice.sh` — Test Sarvam APIs from Mac
```bash
#!/bin/bash
# Test Sarvam STT and TTS from your Mac during development

SARVAM_KEY="${SARVAM_API_KEY}"
BASE_URL="https://api.sarvam.ai"

echo "=== Testing Sarvam STT ==="
# Record 5 seconds of audio (Mac)
echo "Recording 5 seconds... speak now!"
rec /tmp/test-voice.wav rate 16k trim 0 5 2>/dev/null || \
  afrecord -d 5 -f WAVE -c 1 /tmp/test-voice.wav 2>/dev/null

# Send to Sarvam
curl -s -X POST "${BASE_URL}/speech-to-text" \
  -H "API-Subscription-Key: ${SARVAM_KEY}" \
  -F "file=@/tmp/test-voice.wav" \
  -F "language_code=auto" \
  -F "model=saaras:v3" | jq .

echo ""
echo "=== Testing Sarvam TTS ==="
curl -s -X POST "${BASE_URL}/text-to-speech" \
  -H "API-Subscription-Key: ${SARVAM_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": ["Good morning. Yesterday your shop had total revenue of thirty-eight thousand across twelve transactions."],
    "target_language_code": "en-IN",
    "speaker": "arvind",
    "model": "bulbul:v3",
    "enable_preprocessing": true
  }' | jq -r '.audios[0]' | base64 -d > /tmp/test-tts.wav

echo "Playing TTS output..."
afplay /tmp/test-tts.wav 2>/dev/null || play /tmp/test-tts.wav
echo "Done!"
```

#### `scripts/deploy-to-phone.sh` — Sync code to Android
```bash
#!/bin/bash
# Deploy gateway code from Mac to Android phone
# Requires: ADB or SSH to Termux

PHONE_IP="${PHONE_IP:-192.168.1.100}"
PHONE_USER="u0_a100"  # Termux user
REMOTE_DIR="~/dhandhaphone/gateway"
LOCAL_DIR="./gateway"

echo "📱 Deploying to phone at ${PHONE_IP}..."

# Method 1: SSH (preferred — set up termux-openssh first)
if ssh -q -o ConnectTimeout=3 phone exit 2>/dev/null; then
  echo "Using SSH..."
  rsync -avz --exclude 'node_modules' \
    "${LOCAL_DIR}/" "phone:${REMOTE_DIR}/"
  ssh phone "cd ${REMOTE_DIR} && npm install --production 2>/dev/null"
  ssh phone "cd ${REMOTE_DIR} && pm2 restart dhandhaphone || pm2 start index.js --name dhandhaphone"
  echo "✅ Deployed via SSH. Check logs: ssh phone 'pm2 logs dhandhaphone'"

# Method 2: ADB (fallback)
elif adb devices | grep -q "${PHONE_IP}"; then
  echo "Using ADB..."
  adb push "${LOCAL_DIR}/" "/sdcard/dhandhaphone-sync/"
  adb shell "
    proot-distro login ubuntu -- bash -c '
      cp -r /sdcard/dhandhaphone-sync/* ~/dhandhaphone/gateway/
      cd ~/dhandhaphone/gateway
      npm install --production
      pm2 restart dhandhaphone
    '
  "
  echo "✅ Deployed via ADB."

else
  echo "❌ Cannot reach phone. Check:"
  echo "   - Phone IP: ${PHONE_IP}"
  echo "   - SSH: 'ssh phone' working?"
  echo "   - ADB: 'adb connect ${PHONE_IP}:5555'"
  exit 1
fi
```

### NEW FILES — Termux Dependencies

#### `scripts/phone-setup-voice.sh`
Run once on the Android phone to install voice dependencies:

```bash
#!/bin/bash
# Run inside Termux/Ubuntu on the phone
# Installs voice processing dependencies

echo "📦 Installing voice dependencies..."

# ffmpeg for audio conversion
apt-get update
apt-get install -y ffmpeg

# sox for audio utilities (optional but useful)
apt-get install -y sox

# Verify
echo "=== Checking dependencies ==="
ffmpeg -version | head -1
node --version
echo "npm packages..."
cd ~/dhandhaphone/gateway
npm install node-fetch form-data

echo "✅ Voice dependencies installed."
echo ""
echo "=== Sarvam API Key Setup ==="
echo "Add to your .env file:"
echo "SARVAM_API_KEY=your_key_here"
echo ""
echo "Get free ₹1,000 credits at: https://dashboard.sarvam.ai"
```

---

## Telegram Bot API — Voice Message Handling

### Receiving Voice Notes

Telegram sends voice messages as `voice` objects:
```json
{
  "message_id": 123,
  "from": { "id": 456, "first_name": "Owner" },
  "voice": {
    "file_id": "AwACAgIAAxkBAAI...",
    "file_unique_id": "AgAD...",
    "duration": 8,
    "mime_type": "audio/ogg",
    "file_size": 12345
  }
}
```

**Download the audio:**
```javascript
// Using grammY (OpenClaw's Telegram library)
const file = await bot.api.getFile(msg.voice.file_id);
const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
// Download to temp file
const response = await fetch(url);
const buffer = await response.buffer();
fs.writeFileSync('/tmp/voice-input.ogg', buffer);
```

### Sending Voice Notes

```javascript
// Send voice note reply
await bot.api.sendVoice(chatId, new InputFile(audioBuffer), {
  caption: "🔊",  // optional caption
  duration: audioDuration,
});
```

### Voice Note Limits
- Telegram max voice note: 1 hour (practically unlimited)
- Typical owner voice note: 5-30 seconds
- Our voice replies: aim for 10-30 seconds max
- Telegram downloads: ~100KB/s on 4G (8 sec voice = ~32KB, instant)

---

## Sarvam API Integration Details

### Getting Started
1. Sign up: https://dashboard.sarvam.ai
2. Get API key (free ₹1,000 credits)
3. Test with curl before writing code

### STT Endpoint
```
POST https://api.sarvam.ai/speech-to-text
Headers:
  API-Subscription-Key: <key>
Body: multipart/form-data
  file: <audio file>
  language_code: "auto" (auto-detect) or "hi-IN", "te-IN", etc
  model: "saaras:v3"
  with_timestamps: false (set true if needed)

Response:
{
  "transcript": "Got twenty thousand from the Reddy order",
  "language_code": "en-IN",
  "confidence": 0.94
}
```

**Cost:** ₹30/hour = ₹0.50/minute = ₹0.008/second
- Average voice note (10 sec) = ₹0.08
- 50 voice notes/day = ₹4/day = ₹120/month per user

### TTS Endpoint
```
POST https://api.sarvam.ai/text-to-speech
Headers:
  API-Subscription-Key: <key>
  Content-Type: application/json
Body:
{
  "inputs": ["Text to speak"],
  "target_language_code": "hi-IN",
  "speaker": "meera",
  "model": "bulbul:v3",
  "pace": 1.0,
  "enable_preprocessing": true
}

Response:
{
  "audios": ["<base64 encoded audio>"],
  "request_id": "..."
}
```

**Cost:** ₹15/10,000 characters = ₹0.0015/char
- Average reply (100 chars) = ₹0.15
- 30 voice replies/day = ₹4.50/day = ₹135/month per user

**Combined voice cost: ~₹255/month per active user (cloud only)**
**With Sarvam Edge (Phase 1.5): ₹0**

### Speaker Voices Available (Bulbul v3)
Verify exact speaker IDs from Sarvam docs, these are likely names:
- Hindi: meera (female), arvind (male)
- Telugu: padma (female), suresh (male)
- Tamil: nila (female), kumar (male)
- English (Indian): ananya (female), rohan (male)
- ... 35+ voices across 11 languages

### Promotional Period
Sarvam is offering **unlimited TTS API access through Feb 28, 2026**.
We should use this window to test extensively and cache common phrases.

---

## Implementation Schedule

### Week 1: API Integration & Basic Pipeline

**Day 1-2: Sarvam API Setup**
- [ ] Create Sarvam account, get API key
- [ ] Run `test-voice.sh` on Mac — verify STT works with Hindi/Hinglish
- [ ] Test TTS with sample briefing text — verify voice quality
- [ ] Test with noisy audio (record in a shop-like environment)
- [ ] Document actual API response format (might differ from docs)

**Day 3-4: Voice Module Core**
- [ ] Create `sarvam-client.js` with STT and TTS methods
- [ ] Create `audio-utils.js` with format conversion
- [ ] Create `voice-handler.js` with basic pipeline
- [ ] Unit test: audio file → transcript → response → audio file
- [ ] All tested on Mac with mock Telegram messages

**Day 5: Telegram Integration**
- [ ] Add voice message handler to gateway `index.js`
- [ ] Handle `msg.voice` events from Telegram bot
- [ ] Download voice files from Telegram API
- [ ] Send voice replies back as `sendVoice`
- [ ] Test end-to-end on Mac (using Telegram test bot)

### Week 2: Quality & Phone Deployment

**Day 6-7: Voice Response Logic**
- [ ] Implement `shouldReplyVoice()` decision logic
- [ ] Add voice personality to `SOUL.md`
- [ ] Update `money-tracker` for voice transaction parsing
- [ ] Update `people-memory` for voice name matching
- [ ] Implement briefing voice generation in `daily-intel`

**Day 8: Phone Deployment**
- [ ] Set up `deploy-to-phone.sh` workflow
- [ ] Run `phone-setup-voice.sh` on phone (install ffmpeg)
- [ ] Deploy gateway to phone, verify Telegram connection
- [ ] Install Sarvam API key on phone environment

**Day 9-10: Integration Testing on Phone**
- [ ] Send voice notes from primary phone → verify transcription
- [ ] Test in Hindi, Hinglish, English, Telugu
- [ ] Test noisy audio (fan running, traffic, shop ambience)
- [ ] Test voice briefing generation (morning + evening)
- [ ] Test voice transaction entry (English, Hindi, Telugu, Tamil)
- [ ] Test code-mixed audio ("Last month ka total kitna hai?")
- [ ] Measure latency end-to-end (voice in → voice out)
- [ ] Fix edge cases, deploy fixes

---

## Error Handling

### Transcription Failures
```
IF Sarvam STT returns error or empty transcript:
  → Respond in owner's language_preference:
    EN: "🎤 Couldn't catch that clearly. Could you say it again?"
    HI: "🎤 Awaaz sahi se nahi sun paya. Dobara bol sakte hain?"
    TE: "🎤 Sariga vinaledhu. Malli cheppagalara?"
  → Log the audio file path for debugging

IF confidence < 0.6:
  → Show transcript and ask for confirmation in owner's language
  → Wait for owner confirmation before processing

IF Sarvam API is down:
  → Queue the voice note with timestamp
  → EN: "🎤 Voice processing is busy right now. Your message is
         queued, will process shortly."
  → Retry every 5 minutes, process when API is back
```

### TTS Failures
```
IF Sarvam TTS returns error:
  → Fall back to text response (always works)
  → EN: "📝 Couldn't generate voice reply, here's the text:"
  → Log error for debugging

IF generated audio is corrupted or empty:
  → Fall back to text
  → Never send empty/broken audio to owner
```

### Network Issues
```
IF no internet (phone offline):
  → Queue voice notes for processing when online
  → Text responses still work from local data
  → EN: "📵 No internet right now. Your voice message is saved,
         will process when back online."

IF slow connection:
  → Set API timeout to 30 seconds
  → For TTS: generate in background, send when ready
  → For STT: show "🎤 Processing..." immediately
```

---

## Voice UX Guidelines

### Transcription Transparency
Always show what was heard. This builds trust.

English example:
```
Owner sends voice: "Got twenty thousand from the Reddy order"
Agent shows: "🎤 Heard: Got 20,000 from the Reddy order"
Agent processes: logs ₹20,000 credit from Reddy
Agent replies: "✅ Reddy — ₹20,000 credit logged."
```

Telugu example:
```
Owner sends voice: "Supplier ki padi velu ichanu"
Agent shows: "🎤 Vinna: Supplier ki 10,000 ichanu"
Agent processes: logs ₹10,000 debit to supplier
Agent replies: "✅ Supplier — ₹10,000 debit logged."
```

Code-mixed example:
```
Owner sends voice: "Last month's rent pay chesanu, forty-two thousand"
Agent shows: "🎤 Heard: Last month's rent pay chesanu, 42,000"
Agent processes: logs ₹42,000 debit, category: rent
Agent replies: "✅ Rent — ₹42,000 logged."
```

### Confirmation for Financial Actions
ALWAYS confirm money-related voice commands before acting:

```
Owner says: "Log fifty thousand payment to Lakshmi Traders"
Agent: "🎤 Heard: 50,000 payment to Lakshmi Traders
       ₹50,000 debit to Lakshmi Traders? ✅ / ❌"
```

```
Owner says (Telugu): "Ravi ki aaru laksha transfer cheyyi"
Agent: "🎤 Vinna: Ravi ki 6,00,000 transfer
       ⚠️ I can't make transfers, but should I log it?
       ₹6,00,000 debit to Ravi? ✅ / ❌"
```
(DhandhaPhone never actually transfers money — only logs)

### Voice Note Length Awareness
```
IF voice note > 60 seconds:
  → Still transcribe fully
  → But reply in text (too much info for voice response)
  → Summarize key actions taken

IF voice note < 2 seconds:
  → Likely accidental
  → "🎤 Bahut chhota voice note tha. Kuch kehna chahte the?"
```

### Language Switching
Owners naturally switch languages. Sarvam auto-detects. We match.
```
Message 1 (voice, English): "How much did we make today?"
Reply (voice, English): "Today's revenue is thirty-eight thousand
across twelve transactions."

Message 2 (text, Hinglish): "Kal ka collection batao"
Reply (text, Hinglish): "Kal total ₹45,200 aaya, 18 transactions."

Message 3 (voice, Telugu): "Ee week entha ammamu?"
Reply (voice, Telugu): "Ee week lo total 2,15,000 ammaru."
```

Code-mixing within a single message is common and expected:
- "Please check last week ka total revenue"
- "Ninna total entha, and any pending payments?"
- Sarvam handles this natively — no special handling needed

---

## Cost Optimization Strategies

### Phase 1 (Cloud Only)
1. **Cache common TTS phrases** — "✅ logged", greetings, etc.
   Pre-generate and reuse. Saves ~30% TTS costs.

2. **Skip TTS for short responses** — Under 50 chars = text only.
   "✅ ₹5,000 logged" doesn't need voice.

3. **Batch briefings** — Generate one briefing audio, don't re-generate
   if owner asks for it again within the hour.

4. **Compress audio** — Use lowest acceptable quality for STT.
   8kHz is fine (Sarvam is optimized for it). Don't upsample.

### Phase 1.5 (Edge Migration)
When Sarvam Edge SDK is available:
1. Move ALL voice note STT to on-device → ₹0
2. Move ALL briefing TTS to on-device → ₹0
3. Keep cloud as fallback only → ~₹10-20/month per user

---

## Testing Checklist

### Mac Tests (before phone deployment)
- [ ] `sarvam-client.js` STT with English audio file
- [ ] `sarvam-client.js` STT with Hindi audio file
- [ ] `sarvam-client.js` STT with Telugu audio file
- [ ] `sarvam-client.js` STT with Tamil audio file
- [ ] `sarvam-client.js` STT with code-mixed audio (Hinglish, Tenglish)
- [ ] `sarvam-client.js` TTS with English text
- [ ] `sarvam-client.js` TTS with Hindi text
- [ ] `sarvam-client.js` TTS with Telugu text
- [ ] `sarvam-client.js` TTS with Tamil text
- [ ] Verify all 11 language speakers are accessible via API
- [ ] `voice-handler.js` pipeline: audio → transcript → response → audio
- [ ] `audio-utils.js` ogg → wav conversion
- [ ] `audio-utils.js` base64 → ogg conversion
- [ ] `tts-generator.js` briefing text cleanup (all languages)
- [ ] Language detection accuracy: send 5 samples per language
- [ ] Error handling: API timeout, empty response, invalid audio

### Phone Tests (integration)
- [ ] Voice note received from Telegram → transcribed correctly
- [ ] Transcript shown to owner in detected language
- [ ] Transaction extracted from voice (test in English, Hindi, Telugu)
- [ ] Voice reply sent back as Telegram voice note
- [ ] Voice reply plays correctly on owner's phone
- [ ] Morning briefing generated in owner's language at 8 AM
- [ ] Evening summary generated in owner's language at 8 PM
- [ ] Noisy audio (shop / traffic / kitchen) transcribed acceptably
- [ ] Test all Sarvam-supported languages the team can verify
- [ ] Code-mixed audio handled properly (English + regional language)
- [ ] Low confidence → asks for repetition in correct language
- [ ] API failure → graceful fallback to text
- [ ] Offline → queues voice notes for later processing
- [ ] Battery/resource impact acceptable (check RAM/CPU)

### User Experience Tests
- [ ] Send 10 voice notes per language (varied accents, noise levels)
- [ ] Count: how many transcribed correctly on first try?
- [ ] Target: >85% first-try accuracy for clear speech
- [ ] Measure: voice note sent → response received latency
- [ ] Target: <5 seconds for voice reply, <3 seconds for text reply
- [ ] Listen: does each language TTS voice sound natural?
- [ ] Test: do numbers, currency, dates sound correct in each language?
- [ ] Test: can someone unfamiliar with the system understand briefings?

---

## What Comes After Phase 1

### Phase 1.5: Sarvam Edge Migration (Week 3-4)
- Download Sarvam Edge models to phone (~544MB total)
- Replace Sarvam Cloud API calls with on-device inference
- Keep cloud as fallback for unsupported languages
- Cost drops to ~₹0 for voice processing

### Phase 2: Direct Voice (no Telegram) (Month 2)
- Flutter app mic button for direct voice input
- Always-listening mode (wake word: "Munshi ji")
- Voice output through phone speaker
- Works even without Telegram

### Phase 3: Phone Calls (Month 2-3)
- Exotel SIP trunk for Indian phone number
- LiveKit Agents for real-time voice pipeline
- Inbound: answer calls, share info, take orders
- Outbound: payment reminders, order placement
- Sarvam Cloud streaming APIs (not Edge — real-time needs cloud)
