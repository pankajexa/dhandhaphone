// Audio format conversion utilities
// Handles OGG/WAV/MP3 conversion between Telegram and Sarvam APIs
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Save base64-encoded audio to a file
 * @param {string} base64Audio - Base64 encoded audio data
 * @param {string} outputPath - Path to save the file
 * @returns {string} outputPath
 */
function base64ToFile(base64Audio, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buffer = Buffer.from(base64Audio, 'base64');
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Read a file and return as base64 string
 * @param {string} filePath - Path to audio file
 * @returns {string} base64 encoded content
 */
function fileToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
}

/**
 * Convert audio to OGG Opus format (required by Telegram for voice notes)
 * Requires ffmpeg installed
 * @param {string} inputPath - Input audio file (any format)
 * @param {string} outputPath - Output .ogg file path (optional)
 * @returns {string} path to the OGG file
 */
function convertToOgg(inputPath, outputPath) {
  if (!outputPath) {
    outputPath = inputPath.replace(/\.[^.]+$/, '.ogg');
  }

  // If already OGG, just copy
  if (inputPath.endsWith('.ogg') && inputPath !== outputPath) {
    fs.copyFileSync(inputPath, outputPath);
    return outputPath;
  }

  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -c:a libopus -b:a 48k -ar 48000 "${outputPath}" 2>/dev/null`,
      { timeout: 30000 }
    );
    return outputPath;
  } catch (error) {
    console.error('ffmpeg conversion failed:', error.message);
    // If ffmpeg fails and input is already OGG, use as-is
    if (inputPath.endsWith('.ogg')) {
      return inputPath;
    }
    throw new Error('Audio conversion failed. Is ffmpeg installed?');
  }
}

/**
 * Convert audio to WAV format (useful for some STT engines)
 * @param {string} inputPath - Input audio file
 * @param {string} outputPath - Output .wav file path (optional)
 * @returns {string} path to the WAV file
 */
function convertToWav(inputPath, outputPath) {
  if (!outputPath) {
    outputPath = inputPath.replace(/\.[^.]+$/, '.wav');
  }

  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -ar 16000 -ac 1 -f wav "${outputPath}" 2>/dev/null`,
      { timeout: 30000 }
    );
    return outputPath;
  } catch (error) {
    console.error('WAV conversion failed:', error.message);
    throw new Error('Audio conversion to WAV failed. Is ffmpeg installed?');
  }
}

/**
 * Get audio duration in seconds
 * @param {string} filePath - Path to audio file
 * @returns {number} duration in seconds
 */
function getAudioDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}" 2>/dev/null`,
      { timeout: 10000 }
    );
    const duration = parseFloat(result.toString().trim());
    if (!isNaN(duration)) return Math.ceil(duration);
  } catch { /* fallback below */ }

  // Fallback: estimate from file size
  // ~16KB per second for Opus at standard quality
  try {
    const stats = fs.statSync(filePath);
    return Math.max(1, Math.ceil(stats.size / 16000));
  } catch {
    return 5; // default 5 seconds
  }
}

/**
 * Ensure temp directory exists
 * @param {string} dirPath - Directory to create
 */
function ensureTempDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Clean up old temp audio files (>1 hour old)
 * Call periodically to prevent disk bloat
 * @param {string} dirPath - Temp directory to clean
 */
function cleanupTempFiles(dirPath) {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);

  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs < oneHourAgo) {
        fs.unlinkSync(filePath);
      }
    }
  } catch { /* ignore cleanup errors */ }
}

/**
 * Check if ffmpeg is available
 * @returns {boolean}
 */
function checkFfmpeg() {
  try {
    execSync('which ffmpeg', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  base64ToFile,
  fileToBase64,
  convertToOgg,
  convertToWav,
  getAudioDuration,
  ensureTempDir,
  cleanupTempFiles,
  checkFfmpeg,
};
