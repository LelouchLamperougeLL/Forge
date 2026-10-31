// Reading pages: plan pages, science articles, rules, decisions, references, the glossary and their index
// pages. Each opens on a forged steel plate stamped with its topic's mark; long pages get numbered sections
// and a contents list that follows you down the page (a strip under the top bar on phones, a rail beside
// the text on wide screens). Presentation only: every view passes its content through unchanged.

import { esc, ICONS, plain } from './util.js';

const svg = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

/** Topic marks, drawn like the app's other line icons. */
export const GLYPHS = {
  nutrition: svg('<path d="M3.5 11.5h17"/><path d="M4.5 11.5a7.5 7 0 0 0 15 0"/><path d="M9 21h6"/><path d="M9.5 8.5c-1-1.1.9-2.1-.1-3.6M14.5 8.5c-1-1.1.9-2.1-.1-3.6"/>'),
  supplements: svg('<rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M12 8.5v7" transform="rotate(-45 12 12)"/>'),
  sleep: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M17 3.5v3M15.5 5h3"/>'),
  activity: svg('<ellipse cx="8" cy="8" rx="2.6" ry="3.8"/><circle cx="8" cy="15" r="1.6"/><ellipse cx="16" cy="12" rx="2.6" ry="3.8"/><circle cx="16" cy="19" r="1.6"/>'),
  measure: svg('<circle cx="10" cy="10.5" r="6.5"/><circle cx="10" cy="10.5" r="2"/><path d="M10 17h11v-3.5h-4.5"/><path d="M14 17v-1.6M17.5 17v-1.6"/>'),
  safety: svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12.2 2.2 2.2 4.3-4.6"/>'),
  logging: svg('<rect x="5.5" y="3.5" width="13" height="17" rx="2"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/><path d="M3.5 7h3M3.5 12h3M3.5 17h3"/>'),
  strength: svg('<path d="M7 6.5v11M17 6.5v11M4 9.5v5M20 9.5v5M7 12h10"/>'),
  pulse: svg('<path d="M12 20s-7.5-4.4-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.6 12 20 12 20z"/><path d="M7.5 12.5h2.3l1.4-2.4 2 4.2 1.4-1.8h1.9"/>'),
  recovery: svg('<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7"/>'),
  swap: svg('<path d="M4 8h15l-3.5-3.5M20 16H5l3.5 3.5"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>'),
  gauge: ICONS.tools,
  profile: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3.5M14.5 13.5h3.5"/>'),
  // The parts of a rule.
  when: svg('<path d="M13 2.5 5.5 13.5H11l-1 8 7.5-11H12z"/>'),
  data: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4"/>'),
  example: svg('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8 7h8M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.2h.01M12 18.2h.01"/>'),
  why: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17v.01"/>'),
};

// Plan pages by id; everything else (article, rule and decision categories) by the words in its name.
const PLAN_GLYPH = { nutrition: 'nutrition', supplements: 'supplements', sleep: 'sleep', activity: 'activity', monitoring: 'measure', safety: 'safety', logging: 'logging' };
const GLYPH_WORDS = [
  [/safety|behaviour/i, 'safety'], [/supplement/i, 'supplements'], [/nutrition|protein|energy/i, 'nutrition'],
  [/sleep|circadian/i, 'sleep'], [/measure|monitor/i, 'measure'], [/muscle|strength/i, 'strength'],
  [/fitness|conditioning|athletic|aerobic/i, 'pulse'], [/recovery|flexibility|warm-up/i, 'recovery'],
  [/selection/i, 'swap'], [/structure|design/i, 'calendar'], [/effort/i, 'gauge'], [/activity/i, 'activity'],
];

export function glyphFor(name, planId = '') {
  if (PLAN_GLYPH[planId]) return GLYPHS[PLAN_GLYPH[planId]];
  const hit = GLYPH_WORDS.find(([re]) => re.test(name || ''));
  return hit ? GLYPHS[hit[1]] : ICONS.refs;
}

/** Minutes to read some markdown at an unhurried 230 words a minute. */
export function minutesToRead(...sources) {
  const words = sources.map(s => plain(Array.isArray(s) ? s.join(' ') : s || '')).join(' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** One fact for the plate: a number set in the numeral face and what it counts. */
export const fact = (value, label) => [value, label];

/**
 * The page's opening plate. `title`, `eyebrow`, `lede` and `extra` (chips under the lede) are HTML (escape
 * them first); `facts` is a list of [value, label].
 */
export function hero({ eyebrow = '', title, lede = '', glyph = ICONS.refs, facts = [], extra = '', compact = false }) {
  return `<header class="hero steel${compact ? ' compact' : ''}">
    <span class="hero-engrave" aria-hidden="true">${glyph}</span>
    <div class="hero-top"><span class="hero-stamp" aria-hidden="true">${glyph}</span>${eyebrow ? `<p class="hero-eyebrow">${eyebrow}</p>` : ''}</div>
    <h1>${title}</h1>
    ${lede ? `<p class="hero-lede">${lede}</p>` : ''}
    ${extra ? `<div class="hero-extra">${extra}</div>` : ''}
    ${facts.length ? `<p class="hero-facts">${facts.map(([v, k]) => `<span><b>${esc(v)}</b> ${esc(k)}</span>`).join('')}</p>` : ''}
  </header>`;
}

/**
 * The page in brief, set apart from the detail below it. `html` is already rendered; with an `id` it also
 * counts as the page's first section (an article's plain-language layer).
 */
export const inShort = (label, html, id = '') => (html
  ? `<div class="inshort"${id ? ` id="sec-${esc(id)}" data-sec="${esc(id)}"` : ''}><p class="inshort-label${id ? ' lr-t' : ''}">${label}</p>${html}</div>`
  : '');

// A section title of the form "Creatine monohydrate: keep" carries a verdict; it is shown as a badge.
const VERDICT = /^(keep|optional|remove|avoid|do not|don’t|don't|stop)\b/i;
export function splitVerdict(title) {
  const i = String(title).indexOf(': ');
  if (i < 1) return null;
  const verdict = title.slice(i + 2);
  const m = VERDICT.exec(verdict);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return { name: title.slice(0, i), verdict, tone: w === 'keep' ? 'ok' : w === 'optional' ? 'info' : 'danger' };
}

/** A section title as HTML, with a verdict badge when it has one (the text stays the same). */
export function titleHtml(title) {
  const v = splitVerdict(title);
  return v ? `${esc(v.name)}<span class="sr-only">:</span> <span class="verdict ${v.tone}">${esc(v.verdict)}</span>` : esc(title);
}

/**
 * Contents for a long page. `items`: [{ id, html }] in page order; `base` is the page's own route, so each
 * entry also works as a link (…?s=<id> opens the page at that section).
 */
export function toc(items, base, label = 'On this page') {
  return `<nav class="toc no-print" aria-label="${esc(label)}">
    <p class="toc-label">${esc(label)}</p>
    <ol>${items.map((s, i) => `<li><a href="${base}?s=${esc(s.id)}" data-scroll="${esc(s.id)}"><span class="toc-n">${i + 1}</span><span class="toc-t">${s.html}</span></a></li>`).join('')}</ol>
  </nav>
  <div class="toc-strip no-print" aria-hidden="true">
    <button type="button" class="toc-strip-btn" data-toc-top tabindex="-1"><span class="toc-n"></span><span class="toc-strip-t"></span><span class="toc-strip-all">Contents</span></button>
    <span class="toc-strip-bar"></span>
  </div>`;
}

/** A numbered section of a long page (`n` may be a glyph plate's HTML instead of a number). */
export function section({ id, n, title, body, cls = '' }) {
  const plate = n == null ? '' : typeof n === 'number' ? `<span class="lr-n">${n}</span>` : `<span class="lr-n glyph" aria-hidden="true">${n}</span>`;
  return `<section class="lr-sec${cls ? ' ' + cls : ''}" id="sec-${esc(id)}" data-sec="${esc(id)}"><h2 class="lr-h">${plate}<span class="lr-t">${title}</span></h2>${body}</section>`;
}

/**
 * Wire up a long page: contents links scroll to their section, the contents mark where you are, and on
 * phones a strip under the top bar names the section you are reading. Returns a cleanup function.
 */
export function mountReading(root) {
  const page = root.querySelector('.longread');
  if (!page) return null;
  const secs = [...page.querySelectorAll('[data-sec]')];
  const links = new Map([...page.querySelectorAll('.toc a[data-scroll]')].map(a => [a.dataset.scroll, a]));
  const contents = page.querySelector('.toc');
  const strip = page.querySelector('.toc-strip');
  const topbar = document.querySelector('.topbar');
  const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const go = (id, behavior = motion()) => {
    const t = page.querySelector(`#sec-${CSS.escape(id)}`);
    if (t) t.scrollIntoView({ behavior, block: 'start' });
  };
  const onClick = e => {
    const a = e.target.closest('[data-scroll]');
    if (a && page.contains(a)) { e.preventDefault(); go(a.dataset.scroll); return; }
    if (e.target.closest('[data-toc-top]') && contents) contents.scrollIntoView({ behavior: motion(), block: 'start' });
  };
  let current = null;
  let queued = false;
  const update = () => {
    queued = false;
    const top = topbar ? topbar.getBoundingClientRect().bottom : 0;
    // The section you are reading is the last one whose heading has passed under the bars.
    const line = top + (strip ? strip.offsetHeight : 0) + 24;
    let cur = null;
    for (const s of secs) { if (s.getBoundingClientRect().top <= line) cur = s; else break; }
    if (cur !== current) {
      if (current && links.get(current.dataset.sec)) links.get(current.dataset.sec).removeAttribute('aria-current');
      current = cur;
      if (current && links.get(current.dataset.sec)) links.get(current.dataset.sec).setAttribute('aria-current', 'true');
      if (strip) {
        strip.querySelector('.toc-n').textContent = current ? String(secs.indexOf(current) + 1) : '';
        strip.querySelector('.toc-strip-t').innerHTML = current ? current.querySelector('.lr-t').innerHTML : '';
      }
    }
    if (strip) {
      strip.style.setProperty('--strip-top', `${Math.round(top)}px`);
      const past = contents ? contents.getBoundingClientRect().bottom < top : true;
      strip.classList.toggle('on', !!current && past);
      const max = document.documentElement.scrollHeight - innerHeight;
      strip.style.setProperty('--p', max > 0 ? Math.min(1, scrollY / max).toFixed(3) : '0');
    }
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  page.addEventListener('click', onClick);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
  // …?s=<id> opens the page at that section, unless you are coming back to a place you had scrolled to.
  const s = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  if (s) requestAnimationFrame(() => { if (scrollY < 4) go(s, 'auto'); });
  return () => {
    page.removeEventListener('click', onClick);
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
  };
}
