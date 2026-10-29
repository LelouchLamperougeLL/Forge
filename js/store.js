// Local persistence. Everything stays on this device (localStorage), namespaced "forge:".
// Falls back to an in-memory map if storage is unavailable (e.g. blocked site data),
// and offers a JSON backup/restore because browsers can clear storage.

const NS = 'forge:';
const memory = new Map();
let usable = true;

try {
  const probe = NS + '__probe';
  localStorage.setItem(probe, '1');
  localStorage.removeItem(probe);
} catch (e) {
  usable = false;
}

const listeners = new Set();

export const store = {
  get usable() { return usable; },

  get(key, fallback) {
    try {
      const raw = usable ? localStorage.getItem(NS + key) : memory.get(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },

  set(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (usable) localStorage.setItem(NS + key, raw);
      else memory.set(key, raw);
    } catch (e) {
      memory.set(key, raw);
      console.warn('Storage write failed; keeping value in memory only.', e);
      return false;
    }
    listeners.forEach(fn => fn(key, value));
    return true;
  },

  update(key, fallback, fn) {
    const next = fn(this.get(key, fallback));
    this.set(key, next);
    return next;
  },

  remove(key) {
    try { if (usable) localStorage.removeItem(NS + key); } catch (e) { /* ignore */ }
    memory.delete(key);
    listeners.forEach(fn => fn(key, undefined));
  },

  keys() {
    const out = new Set(memory.keys());
    if (usable) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(NS)) out.add(k.slice(NS.length));
        }
      } catch (e) { /* ignore */ }
    }
    return [...out].sort();
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Build a backup object with every stored key. */
  exportAll(appVersion) {
    const data = {};
    for (const k of this.keys()) data[k] = this.get(k);
    return { app: 'forge', format: 1, appVersion, exportedAt: new Date().toISOString(), data };
  },

  /** Validate a backup object; returns a list of problems (empty when valid). */
  validateBackup(obj) {
    const problems = [];
    if (!obj || typeof obj !== 'object') problems.push('File is not a JSON object.');
    else {
      if (obj.app !== 'forge') problems.push('This is not a Forge backup file.');
      if (obj.format !== 1) problems.push(`Unsupported backup format: ${obj.format}.`);
      if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) problems.push('Backup has no data section.');
    }
    return problems;
  },

  /** Restore a backup. mode "replace" clears existing data first; "merge" overwrites only keys present in the backup. */
  importAll(obj, mode = 'replace') {
    const problems = this.validateBackup(obj);
    if (problems.length) throw new Error(problems.join(' '));
    if (mode === 'replace') for (const k of this.keys()) this.remove(k);
    let n = 0;
    for (const [k, v] of Object.entries(obj.data)) { this.set(k, v); n++; }
    return n;
  },

  clearAll() { for (const k of this.keys()) this.remove(k); },

  /** Ask the browser not to evict our storage under pressure (Chromium grants this for installed apps). */
  async requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* ignore */ }
    return false;
  },

  async persistenceState() {
    try {
      if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted();
    } catch (e) { /* ignore */ }
    return null;
  },
};

// Default settings shape (merged with whatever is stored).
export const DEFAULT_SETTINGS = {
  theme: 'system',        // 'system' | 'light' | 'dark'
  sound: true,            // beeps at timer end
  vibrate: true,          // vibration at timer end (Android)
  autoRest: true,         // start the rest timer automatically after "Set done"
  wakeLock: true,         // keep the screen on in the guided player
  countdownBeeps: true,   // short beeps for the last 3 seconds
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
}

export function setSetting(key, value) {
  return store.update('settings', {}, s => ({ ...s, [key]: value }));
}
