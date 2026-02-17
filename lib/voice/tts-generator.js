// Text-to-Speech generator for proactive briefings and voice replies
const fs = require('fs');
const path = require('path');
const { base64ToFile, getAudioDuration, ensureTempDir } = require('./audio-utils');

const TEMP_DIR = '/tmp/dhandhaphone-audio';

class TTSGenerator {
  constructor(sarvamClient, options = {}) {
    this.sarvam = sarvamClient;
    this.config = options.config || require('./voice-config.json');
    this.pace = this.config.tts_pace || 1.0;
    ensureTempDir(TEMP_DIR);
  }

  /**
   * Generate a voice briefing (morning/evening)
   * @param {string} briefingText - The briefing text from business-briefing skill
   * @param {string} language - Owner's language code (e.g. 'hi', 'te', 'ta')
   * @returns {Promise<{ audioPath: string, duration: number } | null>}
   */
  async generateBriefing(briefingText, language) {
    const cleanText = this.prepareForSpeech(briefingText);
    const speaker = this.getSpeakerForLanguage(language);
    const langCode = this._getLangCode(language);

    try {
      const result = await this.sarvam.synthesize(cleanText, {
        language_code: langCode,
        speaker: speaker,
        pace: 0.95, // slightly slower for briefings — easier to follow
      });

      if (!result.audio_base64) {
        return null;
      }

      const outputPath = path.join(TEMP_DIR, `briefing-${Date.now()}.ogg`);
      base64ToFile(result.audio_base64, outputPath);

      const duration = getAudioDuration(outputPath);
      return { audioPath: outputPath, duration };

    } catch (error) {
      console.error('Briefing TTS error:', error.message);
      return null;
    }
  }

  /**
   * Generate a voice alert (fraud, large payment, etc.)
   * @param {string} alertText - Alert text
   * @param {string} language - Owner's language code
   * @returns {Promise<{ audioPath: string, duration: number } | null>}
   */
  async generateAlert(alertText, language) {
    const cleanText = this.prepareForSpeech(alertText);
    const speaker = this.getSpeakerForLanguage(language);
    const langCode = this._getLangCode(language);

    try {
      const result = await this.sarvam.synthesize(cleanText, {
        language_code: langCode,
        speaker: speaker,
        pace: 1.0,
      });

      if (!result.audio_base64) {
        return null;
      }

      const outputPath = path.join(TEMP_DIR, `alert-${Date.now()}.ogg`);
      base64ToFile(result.audio_base64, outputPath);

      const duration = getAudioDuration(outputPath);
      return { audioPath: outputPath, duration };

    } catch (error) {
      console.error('Alert TTS error:', error.message);
      return null;
    }
  }

  /**
   * Clean text for speech synthesis
   * Strips emoji, markdown, and formats for natural speech
   */
  prepareForSpeech(text) {
    return text
      // Strip emoji (common Unicode ranges)
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // emoticons
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // misc symbols
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // transport
      .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // flags
      .replace(/[\u{2600}-\u{26FF}]/gu, '')      // misc symbols
      .replace(/[\u{2700}-\u{27BF}]/gu, '')      // dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')      // variation selectors
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // supplemental
      // Strip markdown formatting
      .replace(/\*\*/g, '')            // bold
      .replace(/\*/g, '')             // italic
      .replace(/`[^`]*`/g, '')        // inline code
      .replace(/```[\s\S]*?```/g, '') // code blocks
      .replace(/#+\s/g, '')           // headers
      // Convert list formatting to speech
      .replace(/\n[-•]\s/g, '. ')     // bullets to sentences
      .replace(/\n\d+\.\s/g, '. ')    // numbered lists to sentences
      .replace(/\n━+/g, '.')          // horizontal rules
      .replace(/\|/g, ', ')           // table separators
      // Clean up whitespace
      .replace(/\n+/g, '. ')          // newlines to pauses
      .replace(/\s+/g, ' ')           // collapse whitespace
      .replace(/\.\s*\./g, '.')       // double periods
      .trim();
  }

  /**
   * Get appropriate Sarvam speaker voice for a language
   * NOTE: These are placeholder names — verify actual speaker IDs
   * from Sarvam API docs or run:
   *   curl https://api.sarvam.ai/text-to-speech/speakers
   */
  getSpeakerForLanguage(lang) {
    const speakers = {
      'en': 'arvind',
      'hi': 'meera',
      'bn': 'aditi',
      'gu': 'nisha',
      'kn': 'suresh',
      'ml': 'amala',
      'mr': 'rohini',
      'or': 'priya',
      'pa': 'harpreet',
      'ta': 'nila',
      'te': 'padma',
    };
    return speakers[lang] || 'arvind';
  }

  /**
   * Map short language code to Sarvam TTS language code
   */
  _getLangCode(lang) {
    const langMap = this.config.supported_languages || {};
    const entry = langMap[lang];
    return entry ? entry.tts_code : 'en-IN';
  }
}

module.exports = { TTSGenerator };
