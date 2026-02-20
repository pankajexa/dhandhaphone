#!/usr/bin/env node
// lib/voice/stt-cli.js — Simple CLI for Sarvam STT
// Usage: node workspace/lib/voice/stt-cli.js /path/to/audio.ogg [language_code]
// Output: JSON { transcript, language_code, confidence }
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'env')); // load .env

const { SarvamClient } = require(path.join(__dirname, '..', 'sarvam', 'sarvam-client'));

async function main() {
  const audioPath = process.argv[2];
  const lang = process.argv[3] || 'auto';

  if (!audioPath) {
    console.error('Usage: node stt-cli.js <audio-file> [language_code]');
    process.exit(1);
  }

  try {
    const client = new SarvamClient();
    const result = await client.transcribe(audioPath, { language_code: lang });
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
