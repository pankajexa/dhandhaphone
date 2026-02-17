// Node.js wrapper for Termux:API commands
// Usage: const api = require('./termux-api'); const sms = await api.readSMS(50);

const { execFile } = require('child_process');
const path = require('path');

const BRIDGE = path.join(__dirname, 'termux-bridge.sh');

function exec(cmd, args = []) {
  return new Promise((resolve, reject) => {
    // Use bridge script approach
    execFile('bash', [BRIDGE, cmd, ...args], {
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 5, // 5MB for large SMS lists
      env: { ...process.env, LD_LIBRARY_PATH: '' }
    }, (err, stdout, stderr) => {
      if (err) {
        // Fallback: try calling command directly (some setups)
        execFile(cmd, args, { timeout: 30000 }, (err2, stdout2) => {
          if (err2) reject(new Error(`termux-api ${cmd} failed: ${err.message}`));
          else resolve(stdout2.trim());
        });
        return;
      }
      resolve(stdout.trim());
    });
  });
}

module.exports = {
  async readSMS(limit = 50) {
    const raw = await exec('termux-sms-list', ['-l', String(limit), '-t', 'inbox']);
    try { return JSON.parse(raw); }
    catch { return []; }
  },

  async sendSMS(number, text) {
    return exec('termux-sms-send', ['-n', number, text]);
  },

  async getNotifications() {
    const raw = await exec('termux-notification-list');
    try { return JSON.parse(raw); }
    catch { return []; }
  },

  async getCallLog(limit = 10) {
    const raw = await exec('termux-call-log', ['-l', String(limit)]);
    try { return JSON.parse(raw); }
    catch { return []; }
  },

  async getBatteryStatus() {
    const raw = await exec('termux-battery-status');
    try { return JSON.parse(raw); }
    catch { return { percentage: -1 }; }
  },

  async vibrate(duration = 500) {
    return exec('termux-vibrate', ['-d', String(duration)]);
  }
};
