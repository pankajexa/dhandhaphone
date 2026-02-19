// Doom Loop Detector — Prevents infinite retry loops
// Tracks retry counts per task key, returns abort signal after max retries

const FALLBACK_MESSAGES = {
  sms_parse_fail: {
    en: 'Could not read this SMS. Please enter the transaction manually.',
    hi: 'Yeh SMS samajh nahi aaya. Kripya transaction manually daalen.',
    ta: 'Inthach SMS puriyavillai. Transaction-ai manually podungal.',
    te: 'Ee SMS artham kaaledu. Transaction manually enter cheyandi.',
    kn: 'Ee SMS arthaagalilla. Transaction manually haaki.',
    ml: 'Ee SMS manasilayilla. Transaction manually enter cheyyuka.',
    bn: 'Ei SMS bujhte parlam na. Transaction manually din.',
    mr: 'Ha SMS samajla nahi. Transaction manually taka.',
    gu: 'Aa SMS samajhayun nathi. Transaction manually nakhho.',
    pa: 'Eh SMS samajh nahi aaya. Transaction manually pao.',
    or: 'Ei SMS bujhaa gala nahin. Transaction manually dalantu.',
  },
  voice_unclear: {
    en: 'Sorry, I could not understand the voice message. Please try again or type your message.',
    hi: 'Maaf kijiye, awaaz samajh nahi aayi. Dobara bolen ya type karein.',
    ta: 'Mannikkavum, kural puriyavillai. Meendum sollung allatu type pannunga.',
    te: 'Kshaminchanddi, voice artham kaaledu. Malli cheppandi leda type cheyandi.',
    kn: 'Kshamisi, dhwani arthaagalilla. Matte heli athava type maadi.',
    ml: 'Kshamikkuka, voice manasilayilla. Veendum parayuka allenkil type cheyyuka.',
    bn: 'Dukkhito, awaaz bujhte parlam na. Abar bolun ba type korun.',
    mr: 'Maaf kara, awaaz samajla nahi. Punha bola kiva type kara.',
    gu: 'Maaf karo, awaaz samajhayun nathi. Fari bolo ke type karo.',
    pa: 'Maafi, awaaz samajh nahi aayi. Dobara bolo ja type karo.',
    or: 'Kshama karantu, awaaz bujhaa gala nahin. Punah kahhantu ba type karantu.',
  },
  general_fail: {
    en: 'Something went wrong. Let me try a different approach.',
    hi: 'Kuch gadbad ho gayi. Dusra tarika try karta hoon.',
    ta: 'Ethavadhu thappu nadanthadhu. Vera vazhiyil try panren.',
    te: 'Emaina thappu jarigindhi. Inkoka paddhathi try chestha.',
    kn: 'Enaadho thappaagide. Bere reethi try maadthene.',
    ml: 'Enthokke thettayi. Vere vazhi try cheyyaam.',
    bn: 'Kichu golmal hoyeche. Onno upaye try kori.',
    mr: 'Kahi gadbad zali. Dusra marg try karto.',
    gu: 'Kanuk gadbad thai. Bijo rasto try karu chhu.',
    pa: 'Kujh gadbad ho gayi. Dooja tarika try karda haan.',
    or: 'Kichhi bhul heigala. Anya upaya try karuchhi.',
  },
};

class DoomLoopDetector {
  constructor() {
    this._counters = new Map();
    // Cleanup hourly
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this._counters) {
        if (now - entry.lastAttempt > 60 * 60 * 1000) {
          this._counters.delete(key);
        }
      }
    }, 60 * 60 * 1000);
    // Allow GC if unreferenced
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  /**
   * Check if a task has exceeded its retry limit.
   * @param {string} taskKey - Unique identifier for the task
   * @param {number} maxRetries - Maximum attempts before abort (default 2)
   * @returns {{ abort: boolean, count: number }}
   */
  check(taskKey, maxRetries = 2) {
    const entry = this._counters.get(taskKey) || { count: 0, lastAttempt: 0, abortedAt: 0 };

    // If previously aborted, stay aborted for 10 minutes (cooldown)
    if (entry.abortedAt && (Date.now() - entry.abortedAt) < 10 * 60 * 1000) {
      return { abort: true, count: entry.count };
    } else if (entry.abortedAt) {
      // Cooldown elapsed — reset
      this._counters.delete(taskKey);
      return { abort: false, count: 0 };
    }

    entry.count++;
    entry.lastAttempt = Date.now();
    this._counters.set(taskKey, entry);

    if (entry.count > maxRetries) {
      entry.abortedAt = Date.now();
      return { abort: true, count: entry.count };
    }
    return { abort: false, count: entry.count };
  }

  /**
   * Get localized fallback message for a scenario.
   * @param {string} scenario - sms_parse_fail, voice_unclear, general_fail
   * @param {string} lang - Language code (en, hi, ta, etc.)
   * @returns {string}
   */
  getFallback(scenario, lang = 'en') {
    const msgs = FALLBACK_MESSAGES[scenario];
    if (!msgs) return FALLBACK_MESSAGES.general_fail[lang] || FALLBACK_MESSAGES.general_fail.en;
    return msgs[lang] || msgs.en;
  }

  /**
   * Manually reset a task counter.
   * @param {string} taskKey
   */
  reset(taskKey) {
    this._counters.delete(taskKey);
  }
}

module.exports = { DoomLoopDetector, FALLBACK_MESSAGES };
