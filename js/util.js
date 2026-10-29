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

export const ICONS = {
  today: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.6"/></svg>',
  programme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
  library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 8v8M17.5 8v8M3.5 10v4M20.5 10v4M6.5 12h11"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11h1M12 11h1M15.5 11h0M8.5 14.5h1M12 14.5h1M15.5 14.5v3M8.5 17.5h1M12 17.5h1"/></svg>',
  science: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3"/><path d="M7.5 15h9"/></svg>',
  plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c-4.4-2.6-8-6.2-8-10.3A4.7 4.7 0 0 1 12 7.6a4.7 4.7 0 0 1 8 3.1c0 4.1-3.6 7.7-8 10.3z"/></svg>',
  decisions: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7h10l3 3-3 3H5zM19 14H9"/></svg>',
  refs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/></svg>',
  glossary: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  rules: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h7"/><path d="M17 15l2 2 3-4"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
};
