// Forge · app bootstrap: content loading, hash router, navigation, global events,
// service-worker registration and update prompt.

import { $, esc, ICONS, MARK, toast, copyText, setTemper } from './util.js';
import { DB, loadContent, makeCtx, refHtml, integrityReport } from './content.js';
import { store } from './store.js';
import { setDone, setPosition, getPosition, nextPosition, phases, getPhase, getReturnTo } from './engine.js';
import * as V from './views.js';
import { viewTools, viewTool, viewSettings } from './tools.js';
import { sparksFrom } from './fx.js';

export const APP_VERSION = '1.3.0';

const main = $('#main');
let currentView = null;
let lastRouteKey = '';

// ---------------------------------------------------------------- routing

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(qs || ''), key: path };
}

function resolve({ parts, query }) {
  const [a, b, c, d] = parts;
  switch (a) {
    case undefined: case 'today': return { tab: 'today', view: () => V.viewToday() };
    case 'programme': return { tab: 'programme', view: () => V.viewProgramme() };
    case 'profile': return { tab: 'programme', parent: '#/programme', view: () => V.viewProfile() };
    case 'phase':
      if (c) return { tab: 'programme', parent: `#/phase/${b}`, view: () => V.viewWeek(b, +c) };
      return { tab: 'programme', parent: '#/programme', view: () => V.viewPhase(b) };
    case 's': return { tab: 'programme', parent: `#/phase/${b}/${c}`, view: () => V.viewSession(b, +c, +d) };
    case 'play': return { tab: 'programme', parent: `#/s/${b}/${c}/${d}`, view: () => V.viewPlayer(b, +c, +d), immersive: true };
    case 'library': return { tab: 'library', view: () => V.viewLibrary(query) };
    case 'ex': return { tab: 'library', parent: '#/library', view: () => V.viewItem(b) };
    case 'rules': return { tab: 'tools', parent: '#/tools', view: () => V.viewRules() };
    case 'rule': return { tab: 'tools', parent: '#/rules', view: () => V.viewRule(b) };
    case 'tools': return { tab: 'tools', view: () => viewTools() };
    case 'tool': return { tab: 'tools', parent: '#/tools', view: () => viewTool(b, query) };
    case 'science': return { tab: 'science', view: () => V.viewScience() };
    case 'sci': return { tab: 'science', parent: '#/science', view: () => V.viewArticle(b) };
    case 'decisions': return { tab: 'science', parent: '#/science', view: () => V.viewDecisions() };
    case 'dec': return { tab: 'science', parent: '#/decisions', view: () => V.viewDecision(b) };
    case 'refs': return { tab: 'science', parent: '#/science', view: () => V.viewRefs(query) };
    case 'ref': return { tab: 'science', parent: '#/refs', view: () => V.viewRef(b) };
    case 'glossary': return { tab: 'science', parent: '#/science', view: () => V.viewGlossary() };
    case 'plan': return { tab: 'plan', parent: '#/programme', view: () => V.viewPlan(b) };
    case 'settings': return { tab: 'settings', view: () => viewSettings() };
    case 'search': return { tab: 'search', view: () => V.viewSearch(query) };
    default: return { tab: '', view: () => ({ title: 'Not found', html: '<div class="page"><h1>Not found</h1><p><a href="#/today">Go to Today</a></p></div>' }) };
  }
}

function render({ keepScroll = false } = {}) {
  const route = parseHash();
  const r = resolve(route);
  if (currentView && currentView.cleanup) {
    try { currentView.cleanup(); } catch (e) { console.error(e); }
  }
  let view;
  try {
    view = r.view();
  } catch (e) {
    console.error(e);
    view = { title: 'Error', html: `<div class="page"><div class="error-box"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div></div>` };
  }
  currentView = view;
  const scrollY = window.scrollY;
  main.innerHTML = view.html;
  document.title = `${view.title ? view.title + ' · ' : ''}Forge`;
  $('#topTitle').textContent = view.title || 'Forge';
  const back = $('#backBtn');
  back.hidden = !r.parent;
  back.dataset.parent = r.parent || '';
  document.body.classList.toggle('immersive', !!r.immersive);
  // The app takes on the oxide colour of the phase you are in.
  const pos = getPosition();
  const cur = pos && getPhase(pos.phase);
  setTemper((cur && cur.color) || 'p0');
  markNav(r.tab, route);
  if (view.after) {
    Promise.resolve(view.after(main)).catch(e => console.error(e));
  }
  if (keepScroll) window.scrollTo(0, scrollY);
  else if (route.key !== lastRouteKey) window.scrollTo(0, 0);
  lastRouteKey = route.key;
}

// ---------------------------------------------------------------- navigation chrome

const BOTTOM = [
  ['today', '#/today', 'Today', ICONS.today],
  ['programme', '#/programme', 'Programme', ICONS.programme],
  ['library', '#/library', 'Library', ICONS.library],
  ['tools', '#/tools', 'Tools', ICONS.tools],
  ['science', '#/science', 'Learn', ICONS.science],
];

function navGroups() {
  return [
    ['Train', [
      ['today', '#/today', 'Today', ICONS.today],
      ['programme', '#/programme', 'Programme', ICONS.programme],
      ...phases().map(p => [`phase:${p.id}`, `#/phase/${p.id}`, p.short ? `${p.short} · ${p.navName || p.name.replace(/^Phase \d+\s*[·:—-]\s*/, '')}` : p.name, '<span class="phase-dot" style="margin:0 3.5px;background:var(--' + (p.color || 'p1') + ')"></span>']),
      ['library', '#/library', 'Exercise library', ICONS.library],
    ]],
    ['Apply', [
      ['rules', '#/rules', 'Rules', ICONS.rules],
      ['tools', '#/tools', 'Tools', ICONS.tools],
    ]],
    ['Plan', DB.pages.map(p => [`plan:${p.id}`, `#/plan/${p.id}`, p.navTitle || p.title, ICONS.plan])],
    ['Learn', [
      ['science', '#/science', 'Science', ICONS.science],
      ['decisions', '#/decisions', 'Decision records', ICONS.decisions],
      ['refs', '#/refs', 'References', ICONS.refs],
      ['glossary', '#/glossary', 'Glossary', ICONS.glossary],
      ['profile', '#/profile', 'Profile analysis', ICONS.refs],
    ]],
    ['App', [['settings', '#/settings', 'Settings & backup', ICONS.settings]]],
  ];
}

function navLinksHtml() {
  return navGroups().map(([g, links]) => links.length
    ? `<div class="nav-group">${esc(g)}</div>${links.map(([k, href, label, icon]) => `<a href="${href}" data-nav="${esc(k)}">${icon}<span>${esc(label)}</span></a>`).join('')}`
    : '').join('');
}

function buildNav() {
  $('#sidenav').innerHTML = `<a class="brand" href="#/today">${MARK}<span>Forge</span></a><nav>${navLinksHtml()}</nav>`;
  $('#bottomnav').innerHTML = BOTTOM.map(([k, href, label, icon]) => `<a href="${href}" data-tab="${k}">${icon}<span>${label}</span></a>`).join('');
}

function markNav(tab, route) {
  document.querySelectorAll('#bottomnav a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const [a, b] = route.parts;
  const key = a === 'phase' ? `phase:${b}` : a === 'plan' ? `plan:${b}`
    : { dec: 'decisions', ref: 'refs', sci: 'science', ex: 'library', rule: 'rules', tool: 'tools', s: 'programme', play: 'programme' }[a] || a || 'today';
  document.querySelectorAll('#sidenav a[data-nav], #sheet a[data-nav]').forEach(el => {
    if (el.dataset.nav === key) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

// ---------------------------------------------------------------- sheet (popover)

function openSheet(html, title = '') {
  const sheet = $('#sheet');
  sheet.innerHTML = `<button class="icon-btn sheet-close" type="button" data-close-sheet aria-label="Close">${ICONS.close}</button>${title ? `<h2 id="sheetTitle">${title}</h2>` : ''}${html}`;
  sheet.hidden = false;
  $('#sheetBackdrop').hidden = false;
  sheet.querySelector('[data-close-sheet]').focus();
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
}

function showMenu() {
  openSheet(`<nav class="sidenav-sheet">${navLinksHtml()}</nav>`, 'Menu');
  markNav('', parseHash());
}

// ---------------------------------------------------------------- global events

function onClick(e) {
  const t = e.target;
  if (t.closest('[data-close-sheet]') || t.id === 'sheetBackdrop') { closeSheet(); return; }
  if (t.closest('#sheet a[href^="#"]')) closeSheet();

  const cite = t.closest('a.cite[data-ref]');
  if (cite) {
    e.preventDefault();
    const r = DB.idx.refs.get(cite.dataset.ref);
    openSheet(`<p>${refHtml(r)}</p>${r && r.keyFindings ? `<div class="md small">${makeCtx().md(r.keyFindings)}</div>` : ''}<p><a class="btn small" href="#/ref/${esc(cite.dataset.ref)}">Full reference</a></p>`, 'Reference');
    return;
  }
  const term = t.closest('button.term[data-term]');
  if (term) {
    const id = term.dataset.term;
    const def = DB.idx.terms.get(id) || DB.idx.terms.get(id.toLowerCase());
    openSheet(def ? `<div class="md">${makeCtx().md(def.definition)}</div><p class="small"><a href="#/glossary">Glossary</a></p>` : '<p>Definition not found.</p>', esc(def ? def.term : id));
    return;
  }
  const act = t.closest('[data-action]');
  if (!act) return;
  const action = act.dataset.action;
  if (action === 'set-position') {
    setPosition(act.dataset.phase, +act.dataset.week);
    store.requestPersistence();
    toast('Current position saved');
    if (location.hash === '#/today' || location.hash === '') render(); else location.hash = '#/today';
  } else if (action === 'advance-week') {
    const pos = getPosition();
    const n = pos && nextPosition(pos);
    // A cyclic phase starting over gets fresh "done" ticks for the weeks it repeats.
    if (n) {
      sparksFrom(act, { count: 18, reach: 80 });
      setPosition(n.phase, n.week, { fresh: n.phase === pos.phase && n.week <= pos.week }); toast(`Now in week ${n.week}`); render();
    }
  } else if (action === 'return-from-optional') {
    const r = getReturnTo();
    if (r) {
      setPosition(r.phase, r.week);
      const p = getPhase(r.phase);
      toast(`Back to ${(p && p.short) || r.phase}, week ${r.week}`);
      if (location.hash === '#/today' || location.hash === '') render(); else location.hash = '#/today';
    }
  } else if (action === 'copy') {
    const el = document.getElementById(act.dataset.copyTarget);
    copyText(el ? el.value || el.textContent : '').then(ok => toast(ok ? 'Copied: paste into your logging app' : 'Copy failed: select the text manually'));
  } else if (action === 'lib-cat') {
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    if (act.dataset.cat) p.set('cat', act.dataset.cat); else p.delete('cat');
    history.replaceState(null, '', `#/library${p.toString() ? '?' + p : ''}`);
    render({ keepScroll: true });
  }
}

function onChange(e) {
  const t = e.target;
  if (t.matches('input[data-action="done"]')) {
    if (t.checked) sparksFrom(t);
    setDone(t.dataset.phase, +t.dataset.week, +t.dataset.day, t.checked);
    toast(t.checked ? 'Marked done' : 'Unmarked');
    if (parseHash().parts[0] === 'today' || !parseHash().parts.length) render({ keepScroll: true });
  }
}

// ---------------------------------------------------------------- service worker

function showUpdateBanner(reg) {
  const b = $('#banner');
  b.innerHTML = '<span>An updated version of the app is ready.</span><button class="btn small primary" type="button" id="updBtn">Reload to update</button>';
  b.hidden = false;
  $('#updBtn').addEventListener('click', () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  });
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;
  // Development escape hatch: ?nosw unregisters the worker so edited files load directly.
  if (new URLSearchParams(location.search).has('nosw')) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !window.__forgeUpdating) return;
      reloading = true;
      location.reload();
    });
    $('#banner').addEventListener('click', e => { if (e.target.id === 'updBtn') window.__forgeUpdating = true; }, true);
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  } catch (e) {
    console.warn('Service worker registration failed:', e);
  }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window.__forgeInstallPrompt = e;
});

// ---------------------------------------------------------------- start

async function start() {
  try {
    await loadContent();
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="page"><div class="error-box"><h2>Could not load the programme</h2><p>${esc(e.message)}</p>
      <p><button class="btn" onclick="location.reload()">Try again</button></p></div></div>`;
    registerSW();
    return;
  }
  buildNav();
  window.addEventListener('hashchange', () => render());
  window.addEventListener('forge:rerender', () => render({ keepScroll: true }));
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $('#menuBtn').addEventListener('click', showMenu);
  $('#searchBtn').addEventListener('click', () => { location.hash = '#/search'; });
  // "Up" navigation to the parent page; the browser/OS back button still walks history.
  $('#backBtn').addEventListener('click', () => { location.hash = $('#backBtn').dataset.parent || '#/today'; });
  if (!location.hash) history.replaceState(null, '', '#/today');
  render();
  registerSW();
  // Surface content problems to the console for anyone editing the content files.
  const problems = integrityReport();
  if (problems.length) console.warn(`Content integrity: ${problems.length} problem(s)`, problems);
  window.__forge = { DB, APP_VERSION, integrityReport };
}

start();
