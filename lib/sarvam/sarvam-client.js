// Sarvam AI API client — shared between Voice and Document Intelligence
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
    this.docTimeout = options.docTimeout || 60000;
  }

  // ─────────────────────────────────────────────────────────────
  //  SPEECH-TO-TEXT
  // ─────────────────────────────────────────────────────────────

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
    const mimeType = this._getAudioMimeType(audioFilePath);

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

  // ─────────────────────────────────────────────────────────────
  //  TEXT-TO-SPEECH
  // ─────────────────────────────────────────────────────────────

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

    const combined = Buffer.concat(audioBuffers);
    return {
      audio_base64: combined.toString('base64'),
      request_id: 'chunked',
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  TRANSLATE
  // ─────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────
  //  DOCUMENT INTELLIGENCE
  // ─────────────────────────────────────────────────────────────

  /**
   * Process a document through Sarvam Vision Document Intelligence.
   * Handles the full async job lifecycle:
   *   create → upload → start → poll → download → parse
   *
   * @param {string} filePath - Path to image/PDF file
   * @param {Object} options - { language: 'en-IN', outputFormat: 'json' }
   * @returns {Object} Extracted document data { text, tables, pages, metadata }
   */
  async processDocument(filePath, options = {}) {
    const language = options.language || 'en-IN';
    const outputFormat = options.outputFormat || 'json';

    if (!fs.existsSync(filePath)) {
      throw new Error(`Document file not found: ${filePath}`);
    }

    // Step 1: Create job
    const job = await this.createDocJob(language, outputFormat);
    const jobId = job.job_id;

    // Step 2: Get upload URL
    const uploadInfo = await this.getUploadUrl(jobId);

    // Step 3: Upload file
    await this.uploadFile(uploadInfo.upload_url, filePath);

    // Step 4: Start processing
    await this.startDocJob(jobId);

    // Step 5: Poll until complete
    const status = await this.pollJobStatus(jobId, this.docTimeout);

    if (status.job_state !== 'Completed' &&
        status.job_state !== 'PartiallyCompleted') {
      throw new Error(`Document processing failed: ${status.job_state}`);
    }

    // Step 6: Download and parse output
    const output = await this.downloadJobOutput(jobId);
    return output;
  }

  /**
   * Create a document digitization job
   * @returns {Promise<{ job_id: string }>}
   */
  async createDocJob(language, outputFormat) {
    const response = await this._fetch(
      `${this.baseUrl}/doc-digitization/job/v1`, {
      method: 'POST',
      headers: {
        'API-Subscription-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        job_parameters: {
          language: language,
          output_format: outputFormat,
        }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam doc job creation failed (${response.status}): ${errText}`);
    }
    return response.json();
  }

  /**
   * Get presigned upload URL for a job
   * @returns {Promise<{ upload_url: string }>}
   */
  async getUploadUrl(jobId) {
    const response = await this._fetch(
      `${this.baseUrl}/doc-digitization/upload/${jobId}`, {
      method: 'GET',
      headers: { 'API-Subscription-Key': this.apiKey },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam upload URL failed (${response.status}): ${errText}`);
    }
    return response.json();
  }

  /**
   * Upload file to the presigned URL
   */
  async uploadFile(uploadUrl, filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const contentType = this._getDocMimeType(filePath);

    const response = await this._fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBuffer,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam file upload failed (${response.status}): ${errText}`);
    }
  }

  /**
   * Start document processing for a job
   */
  async startDocJob(jobId) {
    const response = await this._fetch(
      `${this.baseUrl}/doc-digitization/start/${jobId}`, {
      method: 'POST',
      headers: { 'API-Subscription-Key': this.apiKey },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam doc start failed (${response.status}): ${errText}`);
    }
  }

  /**
   * Poll job status until terminal state
   * @param {string} jobId
   * @param {number} timeoutMs - Max wait time (default 60s)
   * @returns {Promise<{ job_state: string }>}
   */
  async pollJobStatus(jobId, timeoutMs = 60000) {
    const startTime = Date.now();
    const pollInterval = 1000; // 1 second

    while (Date.now() - startTime < timeoutMs) {
      const response = await this._fetch(
        `${this.baseUrl}/doc-digitization/status/${jobId}`, {
        headers: { 'API-Subscription-Key': this.apiKey },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Sarvam status check failed (${response.status}): ${errText}`);
      }

      const status = await response.json();

      if (['Completed', 'PartiallyCompleted', 'Failed'].includes(status.job_state)) {
        return status;
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }
    throw new Error('Document processing timed out');
  }

  /**
   * Download job output (ZIP) and parse it
   * @returns {Object} { text, tables, pages, metadata }
   */
  async downloadJobOutput(jobId) {
    const response = await this._fetch(
      `${this.baseUrl}/doc-digitization/download/${jobId}`, {
      headers: { 'API-Subscription-Key': this.apiKey },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Sarvam download failed (${response.status}): ${errText}`);
    }

    // Response is a ZIP file — get as buffer
    const arrayBuf = await response.arrayBuffer();
    const zipBuffer = Buffer.from(arrayBuf);
    return this.parseDocOutput(zipBuffer);
  }

  /**
   * Parse the ZIP output from Sarvam Document Intelligence.
   * ZIP contains JSON, Markdown, and/or HTML files with extracted content.
   * @param {Buffer} zipBuffer
   * @returns {Object} { text, tables, pages, metadata }
   */
  parseDocOutput(zipBuffer) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const result = { text: '', tables: [], pages: [], metadata: {} };

    for (const entry of entries) {
      const content = entry.getData().toString('utf8');
      const name = entry.entryName;

      if (name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          // Merge JSON data — may contain structured fields
          if (parsed.text) result.text += parsed.text + '\n';
          if (parsed.tables) result.tables.push(...parsed.tables);
          if (parsed.pages) result.pages.push(...parsed.pages);
          if (parsed.metadata) Object.assign(result.metadata, parsed.metadata);
          // Also store raw parsed data for any fields we didn't handle
          if (parsed.content) result.text += parsed.content + '\n';
        } catch (e) {
          console.error(`Failed to parse JSON from ${name}: ${e.message}`);
        }
      } else if (name.endsWith('.md')) {
        result.text += content + '\n';
        result.tables.push(...this._extractTablesFromMd(content));
      } else if (name.endsWith('.html')) {
        result.text += this._stripHtml(content);
        result.tables.push(...this._extractTablesFromHtml(content));
      }
    }

    result.text = result.text.trim();
    return result;
  }

  // ─────────────────────────────────────────────────────────────
  //  INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────────

  /**
   * Extract tables from Markdown content.
   * Looks for pipe-delimited table syntax.
   */
  _extractTablesFromMd(mdContent) {
    const tables = [];
    const lines = mdContent.split('\n');
    let currentTable = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        // Part of a table
        const cells = trimmed
          .split('|')
          .filter(c => c.trim())
          .map(c => c.trim());

        // Skip separator rows (---|---|---)
        if (cells.every(c => /^[-:]+$/.test(c))) continue;

        if (!currentTable) {
          currentTable = { headers: cells, rows: [] };
        } else {
          currentTable.rows.push({ cells });
        }
      } else {
        // Not a table row — close any open table
        if (currentTable) {
          tables.push(currentTable);
          currentTable = null;
        }
      }
    }
    // Close trailing table
    if (currentTable) tables.push(currentTable);

    return tables;
  }

  /**
   * Extract tables from HTML content.
   * Simple regex-based extraction for <table> elements.
   */
  _extractTablesFromHtml(html) {
    const tables = [];
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tableMatch[1];
      const table = { headers: [], rows: [] };

      // Extract header cells
      const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
      let thMatch;
      while ((thMatch = thRegex.exec(tableHtml)) !== null) {
        table.headers.push(this._stripHtmlTags(thMatch[1]).trim());
      }

      // Extract rows
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      while ((trMatch = trRegex.exec(tableHtml)) !== null) {
        const rowHtml = trMatch[1];
        const cells = [];
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch;
        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
          cells.push(this._stripHtmlTags(tdMatch[1]).trim());
        }
        if (cells.length > 0) {
          table.rows.push({ cells });
        }
      }

      if (table.headers.length > 0 || table.rows.length > 0) {
        tables.push(table);
      }
    }

    return tables;
  }

  /**
   * Strip HTML tags, returning plain text
   */
  _stripHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Strip HTML tags only (no entity decoding)
   */
  _stripHtmlTags(html) {
    return html.replace(/<[^>]+>/g, '').trim();
  }

  /**
   * Split text into chunks at sentence boundaries
   */
  _chunkText(text, maxLen) {
    const sentences = text.split(/(?<=[.!?\u0964])\s+/); // \u0964 = Hindi danda
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
   * Get MIME type for audio files
   */
  _getAudioMimeType(filePath) {
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
   * Get MIME type for document files
   */
  _getDocMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'image/jpeg';
  }

  /**
   * Wrapper around fetch with timeout support
   */
  async _fetch(url, options) {
    const controller = new AbortController();
    // Use longer timeout for document operations
    const isDocOp = url.includes('doc-digitization');
    const timeoutMs = isDocOp ? this.docTimeout : this.timeout;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
