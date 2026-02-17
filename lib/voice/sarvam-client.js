// Sarvam AI API client for Speech-to-Text and Text-to-Speech
// Docs: https://docs.sarvam.ai
const fs = require('fs');
const path = require('path');
require('../env'); // loads .env into process.env

const SARVAM_BASE_URL = 'https://api.sarvam.ai';

class SarvamClient {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey || process.env.SARVAM_API_KEY;
    if (!this.apiKey) {
      throw new Error('Sarvam API key required. Set SARVAM_API_KEY env var or pass to constructor.');
    }
    this.baseUrl = options.baseUrl || SARVAM_BASE_URL;
    this.sttModel = options.sttModel || 'saaras:v3';
    this.ttsModel = options.ttsModel || 'bulbul:v3';
    this.timeout = options.timeout || 30000;
  }

  /**
   * Speech-to-Text: Transcribe an audio file
   * @param {string} audioFilePath - Path to audio file (.ogg, .wav, .mp3, etc.)
   * @param {object} options - { language_code: 'auto' | 'hi-IN' | 'te-IN' | ... }
   * @returns {Promise<{ transcript: string, language_code: string, confidence: number }>}
   */
  async transcribe(audioFilePath, options = {}) {
    const languageCode = options.language_code || 'auto';

    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    // Build multipart form data manually (no external dependency)
    const boundary = '----SarvamBoundary' + Date.now();
    const fileName = path.basename(audioFilePath);
    const fileBuffer = fs.readFileSync(audioFilePath);
    const mimeType = this._getMimeType(audioFilePath);

    const parts = [];

    // File part
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`
    );
    parts.push(fileBuffer);
    parts.push('\r\n');

    // Language code part
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language_code"\r\n\r\n` +
      `${languageCode}\r\n`
    );

    // Model part
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${this.sttModel}\r\n`
    );

    parts.push(`--${boundary}--\r\n`);

    // Combine parts into a single buffer
    const bodyParts = parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p));
    const body = Buffer.concat(bodyParts);

    const response = await this._fetch(`${this.baseUrl}/speech-to-text`, {
      method: 'POST',
      headers: {
        'API-Subscription-Key': this.apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam STT error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return {
      transcript: data.transcript || '',
      language_code: data.language_code || languageCode,
      confidence: data.confidence || 0,
    };
  }

  /**
   * Text-to-Speech: Generate audio from text
   * @param {string} text - Text to synthesize (max 2500 chars)
   * @param {object} options - { language_code, speaker, pace, sample_rate, audio_format }
   * @returns {Promise<{ audio_base64: string, request_id: string }>}
   */
  async synthesize(text, options = {}) {
    const languageCode = options.language_code || 'en-IN';
    const speaker = options.speaker || 'arvind';
    const pace = options.pace || 1.0;
    const enablePreprocessing = options.enable_preprocessing !== false;

    // Sarvam TTS has a 2500 char limit per request
    if (text.length > 2500) {
      return this._synthesizeLong(text, options);
    }

    const body = JSON.stringify({
      inputs: [text],
      target_language_code: languageCode,
      speaker: speaker,
      model: this.ttsModel,
      pace: pace,
      enable_preprocessing: enablePreprocessing,
    });

    const response = await this._fetch(`${this.baseUrl}/text-to-speech`, {
      method: 'POST',
      headers: {
        'API-Subscription-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam TTS error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return {
      audio_base64: data.audios && data.audios[0] ? data.audios[0] : '',
      request_id: data.request_id || '',
    };
  }

  /**
   * Handle text longer than 2500 chars by chunking
   */
  async _synthesizeLong(text, options) {
    const chunks = this._chunkText(text, 2400);
    const audioBuffers = [];

    for (const chunk of chunks) {
      const result = await this.synthesize(chunk, options);
      if (result.audio_base64) {
        audioBuffers.push(Buffer.from(result.audio_base64, 'base64'));
      }
    }

    // Concatenate audio buffers (simple concat — works for WAV/PCM,
    // for OGG may need ffmpeg join in audio-utils.js)
    const combined = Buffer.concat(audioBuffers);
    return {
      audio_base64: combined.toString('base64'),
      request_id: 'chunked',
    };
  }

  /**
   * Translate text between Indian languages
   * @param {string} text - Source text
   * @param {string} sourceLang - Source language code (e.g. 'hi-IN')
   * @param {string} targetLang - Target language code (e.g. 'en-IN')
   * @returns {Promise<{ translated_text: string }>}
   */
  async translate(text, sourceLang, targetLang) {
    const body = JSON.stringify({
      input: text,
      source_language_code: sourceLang,
      target_language_code: targetLang,
      model: 'mayura:v1',
      enable_preprocessing: true,
    });

    const response = await this._fetch(`${this.baseUrl}/translate`, {
      method: 'POST',
      headers: {
        'API-Subscription-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam translate error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return { translated_text: data.translated_text || '' };
  }

  /**
   * Split text into chunks at sentence boundaries
   */
  _chunkText(text, maxLen) {
    const sentences = text.split(/(?<=[.!?।])\s+/);
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
      if ((current + ' ' + sentence).trim().length > maxLen) {
        if (current) chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  /**
   * Get MIME type from file extension
   */
  _getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.amr': 'audio/amr',
      '.webm': 'audio/webm',
      '.flac': 'audio/flac',
    };
    return mimeTypes[ext] || 'audio/ogg';
  }

  /**
   * Wrapper around fetch with timeout support
   */
  async _fetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Use dynamic import for node-fetch if native fetch unavailable
      const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
      const response = await fetchFn(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { SarvamClient };
