// Re-export from shared location — Sarvam client is now in lib/sarvam/
// since it's used by both voice and document intelligence modules.
const { SarvamClient } = require('../sarvam/sarvam-client');
module.exports = { SarvamClient };
