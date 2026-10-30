// Small shared helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);
}

export function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }

export function roundTo(x, step) {
  if (!step || step <= 0) return x;
  return Math.round(x / step) * step;
}

export function floorTo(x, step) {
  if (!step || step <= 0) return x;
  return Math.floor(x / step + 1e-9) * step;
}

/** Format a number with fixed decimals, dropping a trailing ".0" when decimals = 1. */
export function fmt(x, decimals = 0) {
  if (x == null || !Number.isFinite(x)) return '–';
  const s = x.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.0+$/, '') : s;
}

export function fmtSigned(x, decimals = 1) {
  if (x == null || !Number.isFinite(x)) return '–';
  return (x > 0 ? '+' : x < 0 ? '−' : '±') + fmt(Math.abs(x), decimals);
}

/** Seconds -> "m:ss" (or "h:mm:ss"). */
export function mmss(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Human-friendly duration for prescriptions: 90 -> "1:30", 120 -> "2 min", 45 -> "45 s". */
export function restLabel(seconds) {
  if (seconds == null || seconds === '') return '';
  if (typeof seconds === 'string') return seconds;
  if (seconds < 60) return `${seconds} s`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return mmss(seconds);
}

export function pluralise(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
export function mean(arr) { return arr.length ? sum(arr) / arr.length : NaN; }

/** Ordinary least-squares slope of y on x. */
export function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? NaN : num / den;
}

export function uniq(arr) { return [...new Set(arr)]; }

export function byId(arr) {
  const m = new Map();
  for (const x of arr || []) if (x && x.id) m.set(x.id, x);
  return m;
}

/** Plain-text version of a markdown-lite string (for search and clipboard text). */
export function plain(md) {
  return String(md ?? '')
    .replace(/\[@[^\]]+\]/g, '')
    .replace(/\[\[\w+:[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[\w+:([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/[*`^]/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^!?>\s?/gm, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/** Give the app a phase's oxide colour (html[data-temper]); see the colour notes at the top of app.css. */
export function setTemper(key) {
  const root = document.documentElement;
  if (root.dataset.temper !== key) root.dataset.temper = key;
  syncThemeColor();
}

/** Match the browser/OS chrome (Android status bar, installed-app title bar) to the page background. */
export function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && document.body) meta.setAttribute('content', getComputedStyle(document.body).backgroundColor);
}

export function toast(message, ms = 2400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// Brand mark: a steel anvil whose face carries the current phase's oxide colour (see .mark-face in app.css).
export const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><path class="mark-body" d="M1.5 10.2C4.6 9.6 7.6 9.4 10.4 9.4V8.2H30.5V9.7C30.5 11.6 29.2 12.9 27.3 13.3L22.3 14.3V17.9C22.3 19.1 23.1 20.1 24.2 20.5L27.5 21.6V25.5H8.7V21.6L12 20.5C13.1 20.1 13.9 19.1 13.9 17.9V15.2C9.4 14.8 5.1 13.2 1.5 10.2Z"/><path class="mark-face" d="M10.4 8.2H30.5V10.3H10.4Z"/></svg>';

export const ICONS = {
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.56 7.21C3.79 6.78 5.95 6.64 7.97 6.64V5.77H22.44V6.85C22.44 8.22 21.5 9.16 20.14 9.44L16.54 10.16V12.76C16.54 13.62 17.11 14.34 17.9 14.63L20.28 15.42V18.23H6.74V15.42L9.12 14.63C9.91 14.34 10.49 13.62 10.49 12.76V10.81C7.25 10.52 4.15 9.37 1.56 7.21Z"/></svg>',
  programme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 19.5h17"/><path d="M5.5 16v-2.5M10 16V10M14.5 16V7.5M19 16V4.5"/></svg>',
  library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6.5v11M17 6.5v11M4 9.5v5M20 9.5v5M7 12h10"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.8 17.5a8.5 8.5 0 1 1 16.4 0"/><path d="m12 16.6 4-5.1"/><circle cx="12" cy="17" r="1.4"/></svg>',
  science: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3.5h5M10.5 3.5v5.8l-5.2 8.7a1.7 1.7 0 0 0 1.5 2.5h10.4a1.7 1.7 0 0 0 1.5-2.5l-5.2-8.7V3.5"/><path d="M7.7 15h8.6"/></svg>',
  plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.4-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z"/></svg>',
  decisions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5.5 6.5H16l2.5 2.5L16 11.5H5.5zM18.5 14H8l-2.5 2.5L8 19h10.5"/></svg>',
  refs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M14.5 3.5V7H18M9 11.5h6M9 15h6M9 18.5h3.5"/></svg>',
  glossary: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5A2 2 0 0 1 7 3h12v14.5H7a2 2 0 0 0-2 2zM5 19.5a2 2 0 0 0 2 2h12"/><path d="M9 7.5h6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20"/><circle cx="15" cy="7" r="2.5"/><circle cx="9" cy="17" r="2.5"/></svg>',
  rules: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h9M4 18h6"/><path d="m15 16.5 2.2 2.2L21 14"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
};

// One icon per tool (tools page).
export const TOOL_ICONS = {
  progression: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 17 5.5-5.5 4 3.5 7.5-8"/><path d="M15 7h5.5v5.5"/></svg>',
  warmup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 13.5 6-6 6 6M6 19l6-6 6 6"/></svg>',
  e1rm: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3.5v3M12 17.5v3"/></svg>',
  checkin: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 10a4.6 4.6 0 0 1 7 0M12 10.6l1.6-2"/></svg>',
  energy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.9 3 5.2 5.4 5.2 10.2a5.2 5.2 0 0 1-10.4 0c0-2.4 1.3-3.9 2.4-5 .3 1.6 1 2.5 2 2.9-.6-3-.3-5.6.8-8.1z"/></svg>',
  bodycomp: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="12" r="6.5"/><circle cx="10" cy="12" r="2"/><path d="M10 5.5h10.5V11h-4"/></svg>',
  transition: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/></svg>',
  breaks: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/></svg>',
  intensity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12.5h4l2.2-4.5 3.3 9 2.3-4.5h7.2"/></svg>',
  running: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="18" r="2"/><circle cx="18.5" cy="6" r="2"/><path d="M7.4 17.3c3.6-1 3-5.3 5.6-6.6 2.2-1.1 3.6-1.9 4.3-3" stroke-dasharray="2.2 2.4"/></svg>',
};
