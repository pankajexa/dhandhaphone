// lib/network-guard.js — Network allowlist for DhandhaPhone
// Monkey-patches globalThis.fetch to block all outbound requests except to allowed domains.
// Load early (via env.js) to enforce before any module makes network calls.
'use strict';

const { URL } = require('url');

// ═══════════════════════════════════════════════════════════════════
// ALLOWED DOMAINS — the ONLY hosts the agent can contact
// ═══════════════════════════════════════════════════════════════════

const ALLOWED_DOMAINS = new Set([
  // Sarvam AI — voice STT/TTS + document intelligence
  'api.sarvam.ai',

  // Telegram — download voice messages and photos only
  'api.telegram.org',

  // Sarvam doc-digitization uses presigned S3 URLs for upload
  // These are *.s3.amazonaws.com or *.s3.*.amazonaws.com
  // Handled via suffix match below

  // Localhost — onboarding wizard, health checks
  'localhost',
  '127.0.0.1',
]);

// Suffix-matched domains (for presigned S3 upload URLs from Sarvam)
const ALLOWED_SUFFIXES = [
  '.s3.amazonaws.com',
  '.s3.ap-south-1.amazonaws.com',
];

// The LLM server is called by OpenClaw, not by our code.
// If the FastAPI router is self-hosted, add its domain here via addAllowedDomain().

let _enabled = true;
let _logBlocked = true;
let _originalFetch = null;

// ═══════════════════════════════════════════════════════════════════
// DOMAIN CHECKING
// ═══════════════════════════════════════════════════════════════════

function isAllowed(urlString) {
  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase();

    // Exact match
    if (ALLOWED_DOMAINS.has(host)) return true;

    // Suffix match (for S3 presigned URLs)
    for (const suffix of ALLOWED_SUFFIXES) {
      if (host.endsWith(suffix)) return true;
    }

    return false;
  } catch {
    // Malformed URL — block it
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// FETCH WRAPPER
// ═══════════════════════════════════════════════════════════════════

function guardedFetch(urlOrRequest, options) {
  const url = typeof urlOrRequest === 'string'
    ? urlOrRequest
    : (urlOrRequest && urlOrRequest.url ? urlOrRequest.url : String(urlOrRequest));

  if (!isAllowed(url)) {
    const host = (() => {
      try { return new URL(url).hostname; } catch { return url; }
    })();

    if (_logBlocked) {
      console.error(`[NetworkGuard] BLOCKED outbound request to: ${host}`);
    }

    return Promise.reject(new Error(
      `[NetworkGuard] Blocked: ${host} is not in the allowed domains list. ` +
      `Only these domains are permitted: ${[...ALLOWED_DOMAINS].join(', ')}`
    ));
  }

  return _originalFetch(urlOrRequest, options);
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Install the network guard. Call once at startup.
 * Patches globalThis.fetch to route through the allowlist.
 */
function activate() {
  if (_originalFetch) return; // Already activated

  _originalFetch = globalThis.fetch;
  if (typeof _originalFetch !== 'function') {
    // Node < 18 or fetch not available — nothing to patch
    console.warn('[NetworkGuard] fetch not available, guard not installed');
    return;
  }

  globalThis.fetch = guardedFetch;
}

/**
 * Disable the guard (e.g., for testing).
 */
function deactivate() {
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
    _originalFetch = null;
  }
}

/**
 * Add a domain to the allowlist at runtime.
 * Use for the LLM server if it's remote.
 * @param {string} domain - e.g., 'api.anthropic.com'
 */
function addAllowedDomain(domain) {
  ALLOWED_DOMAINS.add(domain.toLowerCase());
}

/**
 * Remove a domain from the allowlist.
 * @param {string} domain
 */
function removeAllowedDomain(domain) {
  ALLOWED_DOMAINS.delete(domain.toLowerCase());
}

/**
 * Get the current allowlist (for diagnostics).
 * @returns {string[]}
 */
function getAllowedDomains() {
  return [...ALLOWED_DOMAINS];
}

/**
 * Toggle logging of blocked requests.
 * @param {boolean} enabled
 */
function setLogging(enabled) {
  _logBlocked = enabled;
}

module.exports = {
  activate,
  deactivate,
  addAllowedDomain,
  removeAllowedDomain,
  getAllowedDomains,
  isAllowed,
  setLogging,
  ALLOWED_DOMAINS,
};
