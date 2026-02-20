#!/usr/bin/env node
// lib/voice/tts-cli.js — Simple CLI for Sarvam TTS
// Usage: node workspace/lib/voice/tts-cli.js "text to speak" [language_code] [output_path]
// Output: path to generated audio file
'use strict';

const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'env')); // load .env

const { SarvamClient } = require(path.join(__dirname, '..', 'sarvam', 'sarvam-client'));

// Speaker map by language (bulbul:v3 voices)
const SPEAKERS = {
  'en-IN': 'shubh', 'hi-IN': 'shubh', 'bn-IN': 'shubh',
  'gu-IN': 'shubh', 'kn-IN': 'shubh', 'ml-IN': 'shubh',
  'mr-IN': 'shubh', 'or-IN': 'shubh', 'pa-IN': 'shubh',
  'ta-IN': 'shubh', 'te-IN': 'shubh',
};

async function main() {
  const text = process.argv[2];
  const lang = process.argv[3] || 'en-IN';
  const outputPath = process.argv[4] || `/tmp/dhandhaphone-audio/tts-${Date.now()}.wav`;

  if (!text) {
    console.error('Usage: node tts-cli.js "text" [language_code] [output_path]');
    process.exit(1);
  }

  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  try {
    const client = new SarvamClient();
    const result = await client.synthesize(text, {
      language_code: lang,
      speaker: SPEAKERS[lang] || 'shubh',
      pace: 1.0,
    });

    if (!result.audio_base64) {
      console.error(JSON.stringify({ error: 'No audio generated' }));
      process.exit(1);
    }

    fs.writeFileSync(outputPath, Buffer.from(result.audio_base64, 'base64'));
    console.log(JSON.stringify({ path: outputPath, language: lang }));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
