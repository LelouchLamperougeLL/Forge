// Loads the JSON content files, indexes them, and builds rendering contexts
// (citation numbering, cross-links, glossary terms) for the markdown renderer.

import { esc, byId, youtubeId } from './util.js';
import { renderMarkdown, scanTokens } from './md.js';

export const CONTENT_FILES = [
  'meta', 'programme', 'exercises', 'drills', 'rules', 'plan', 'science', 'decisions', 'references', 'glossary',
];

export const DB = {
  meta: {}, programme: { phases: [], sessions: {} },
  exercises: [], drills: [], rules: [], ruleParams: {}, pages: [], articles: [], decisions: [], references: [], terms: [],
  videos: {}, videosError: null,
  idx: {},
};

/**
 * Demonstration videos (content/videos.json) are optional and the file most likely to be edited by hand,
 * so a missing or broken file never stops the app: exercise pages say what went wrong instead.
 */
async function loadVideos() {
  const url = new URL('../content/videos.json', import.meta.url).href;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(`not valid JSON: ${e.message}`); }
    const videos = data && data.videos;
    if (!videos || typeof videos !== 'object' || Array.isArray(videos)) throw new Error('it has no "videos" object');
    return { videos, error: null };
  } catch (e) {
    return { videos: {}, error: e.message };
  }
}

export async function loadContent() {
  const videosLoaded = loadVideos();
  const results = await Promise.all(CONTENT_FILES.map(async name => {
    // Resolve relative to this module so the tests page (in tests/) loads the same files.
    const url = new URL(`../content/${name}.json`, import.meta.url).href;
    let res;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch (e) {
      throw new Error(`Could not load ${url} (${e.message}). If you are offline, open the app once while online so it can be cached.`);
    }
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
    const text = await res.text();
    try {
      return [name, JSON.parse(text)];
    } catch (e) {
      throw new Error(`${url} is not valid JSON: ${e.message}`);
    }
  }));
  const raw = Object.fromEntries(results);

  DB.meta = raw.meta || {};
  DB.programme = raw.programme || { phases: [], sessions: {} };
  DB.exercises = (raw.exercises && raw.exercises.exercises) || [];
  DB.drills = (raw.drills && raw.drills.drills) || [];
  DB.rules = (raw.rules && raw.rules.rules) || [];
  DB.ruleParams = (raw.rules && raw.rules.params) || {};
  DB.pages = (raw.plan && raw.plan.pages) || [];
  DB.articles = (raw.science && raw.science.articles) || [];
  DB.decisions = (raw.decisions && raw.decisions.decisions) || [];
  DB.references = (raw.references && raw.references.references) || [];
  DB.terms = (raw.glossary && raw.glossary.terms) || [];
  const v = await videosLoaded;
  DB.videos = v.videos;
  DB.videosError = v.error;

  DB.exercises.forEach(x => { x._kind = 'exercise'; });
  DB.drills.forEach(x => { x._kind = 'drill'; });
  DB.idx = {
    items: byId([...DB.exercises, ...DB.drills]),
    phases: byId(DB.programme.phases),
    sessions: new Map(Object.entries(DB.programme.sessions || {}).map(([id, s]) => { s.id = id; return [id, s]; })),
    rules: byId(DB.rules),
    pages: byId(DB.pages),
    articles: byId(DB.articles),
    decisions: byId(DB.decisions),
    refs: byId(DB.references),
    terms: byId(DB.terms),
  };
  // Reference aliases (the same paper found under different ids during research) resolve to one entry.
  for (const r of DB.references) for (const a of r.aliases || []) {
    if (!DB.idx.refs.has(a)) DB.idx.refs.set(a, r);
  }
  // Glossary aliases resolve to their canonical term.
  for (const t of DB.terms) for (const a of t.aliases || []) {
    const key = a.toLowerCase();
    if (!DB.idx.terms.has(key)) DB.idx.terms.set(key, t);
  }
  return DB;
}

const LINK_ROUTES = {
  ex: id => `#/ex/${id}`,
  sci: id => `#/sci/${id}`,
  dec: id => `#/dec/${id}`,
  tool: id => `#/tool/${id}`,
  phase: id => `#/phase/${id}`,
  plan: id => `#/plan/${id}`,
  rule: id => `#/rule/${id}`,
  ref: id => `#/ref/${id}`,
  page: id => `#/${id}`,
};

function lookup(type, id) {
  switch (type) {
    case 'ex': return DB.idx.items.get(id);
    case 'sci': return DB.idx.articles.get(id);
    case 'dec': return DB.idx.decisions.get(id);
    case 'phase': return DB.idx.phases.get(id);
    case 'plan': return DB.idx.pages.get(id);
    case 'rule': return DB.idx.rules.get(id);
    case 'ref': return DB.idx.refs.get(id);
    case 'term': return DB.idx.terms.get(id) || DB.idx.terms.get(id.toLowerCase());
    default: return { title: id };
  }
}

export function itemTitle(type, id) {
  const x = lookup(type, id);
  if (!x) return id;
  return x.name || x.title || x.term || id;
}

export function refShort(r) {
  if (!r) return '';
  const first = String(r.authors || '').split(',')[0].trim().split(/\s+/)[0] || 'Anon';
  const etal = String(r.authors || '').includes(',') ? ' et al.' : '';
  return `${first}${etal} ${r.year || ''}`.trim();
}

/**
 * Create a rendering context. Citations are numbered in order of first appearance,
 * so one context should be shared by everything rendered on a single page.
 */
export function makeCtx(opts = {}) {
  const order = [];
  const missing = [];
  const ctx = {
    hOffset: opts.hOffset ?? 1,
    order,
    missing,
    cite(ids) {
      const parts = ids.map(id => {
        const r = DB.idx.refs.get(id);
        if (!r) {
          missing.push({ type: 'ref', id });
          return `<a class="cite missing" href="#/refs" title="Missing reference: ${esc(id)}">?</a>`;
        }
        const canonical = r.id;
        let n = order.indexOf(canonical);
        if (n === -1) { order.push(canonical); n = order.length - 1; }
        return `<a class="cite" href="#/ref/${esc(canonical)}" data-ref="${esc(canonical)}" title="${esc(refShort(r))}">${n + 1}</a>`;
      });
      return `<span class="cites">${parts.join('<span class="tiny">,</span>')}</span>`;
    },
    // `label` arrives already HTML-escaped from the inline renderer.
    link(type, id, label) {
      const target = lookup(type, id);
      if (type === 'term') {
        if (!target) missing.push({ type, id });
        return `<button type="button" class="term" data-term="${esc(id)}">${label || esc(target ? target.term : id)}</button>`;
      }
      const route = LINK_ROUTES[type];
      if (!route) return label || esc(id);
      if (!target && type !== 'page' && type !== 'tool') missing.push({ type, id });
      const text = label || esc(itemTitle(type, id));
      return `<a class="xref${target || type === 'page' || type === 'tool' ? '' : ' missing'}" href="${route(id)}">${text}</a>`;
    },
    md(src) { return renderMarkdown(src, ctx); },
    refsHtml(title = 'References cited on this page') {
      if (!order.length) return '';
      const items = order.map(id => `<li id="cite-${esc(id)}">${refHtml(DB.idx.refs.get(id))}</li>`).join('');
      return `<section class="card flat"><h2>${esc(title)}</h2><ol class="ref-list">${items}</ol></section>`;
    },
  };
  return ctx;
}

/** Full formatted reference with identifiers. */
export function refHtml(r, { link = true } = {}) {
  if (!r) return '<span class="muted">Unknown reference</span>';
  const ids = [];
  if (r.doi) ids.push(`DOI <a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener noreferrer">${esc(r.doi)}</a>`);
  if (r.pmid) ids.push(`PMID <a href="https://pubmed.ncbi.nlm.nih.gov/${esc(r.pmid)}/" target="_blank" rel="noopener noreferrer">${esc(r.pmid)}</a>`);
  if (!r.doi && !r.pmid && r.url) ids.push(`<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">link</a>`);
  const vol = [r.volume, r.pages].filter(Boolean).join(':');
  const title = link ? `<a href="#/ref/${esc(r.id)}">${esc(r.title)}</a>` : esc(r.title);
  const badges = [
    r.type ? `<span class="chip">${esc(r.type)}</span>` : '',
    r.grade ? `<span class="chip ${gradeClass(r.grade)}">evidence: ${esc(r.grade)}</span>` : '',
  ].join(' ');
  return `${esc(r.authors)} (${esc(r.year)}). ${title}. <em>${esc(r.journal || '')}</em>${vol ? ' ' + esc(vol) : ''}. ${ids.join(' · ')} ${badges}`;
}

export function gradeClass(g) {
  return { high: 'ok', moderate: 'info', low: 'warn', 'very low': 'danger' }[String(g).toLowerCase()] || '';
}

/** Walk every content string and report unresolved citations or links. */
export function integrityReport() {
  const problems = [];
  const seen = new Set();
  const check = (src, where) => {
    const { refs, links } = scanTokens(src);
    for (const id of refs) if (!DB.idx.refs.has(id)) problems.push(`${where}: missing reference "${id}"`);
    for (const l of links) {
      if (l.type === 'page' || l.type === 'tool') continue;
      if (!lookup(l.type, l.id)) problems.push(`${where}: broken link [[${l.type}:${l.id}]]`);
    }
  };
  const walk = (node, where) => {
    if (node == null) return;
    if (typeof node === 'string') { check(node, where); return; }
    if (typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, where));
    else for (const [k, v] of Object.entries(node)) if (!k.startsWith('_')) walk(v, where);
  };
  walk(DB.programme, 'programme');
  DB.exercises.forEach(x => walk(x, `exercise ${x.id}`));
  DB.drills.forEach(x => walk(x, `drill ${x.id}`));
  DB.rules.forEach(x => walk(x, `rule ${x.id}`));
  DB.pages.forEach(x => walk(x, `plan ${x.id}`));
  DB.articles.forEach(x => walk(x, `science ${x.id}`));
  DB.decisions.forEach(x => walk(x, `decision ${x.id}`));
  DB.terms.forEach(x => walk(x, `glossary ${x.id}`));
  walk(DB.meta, 'meta');

  // Structural checks: sessions reference real items and blocks, schedules reference real sessions.
  const blocks = DB.programme.blocks || {};
  for (const [bid, b] of Object.entries(blocks)) {
    for (const it of b.items || []) if (it.ref && !DB.idx.items.has(it.ref)) problems.push(`block ${bid}: unknown item "${it.ref}"`);
  }
  for (const [sid, s] of DB.idx.sessions) {
    for (const part of ['warmup', 'main', 'cooldown']) {
      const p = s[part];
      if (!p) { problems.push(`session ${sid}: missing ${part}`); continue; }
      if (p.use && !blocks[p.use]) problems.push(`session ${sid}: unknown block "${p.use}" in ${part}`);
      for (const it of [...(p.items || []), ...(p.add || [])]) {
        if (it.ref && !DB.idx.items.has(it.ref)) problems.push(`session ${sid}: unknown item "${it.ref}" in ${part}`);
      }
    }
  }
  for (const p of DB.programme.phases || []) {
    for (const wk of p.schedule || []) for (const d of wk) {
      const sid = d && (typeof d === 'string' ? d : d.s);
      if (sid && !DB.idx.sessions.has(sid)) problems.push(`phase ${p.id}: schedule references unknown session "${sid}"`);
    }
    for (const id of p.decisions || []) if (!DB.idx.decisions.has(id)) problems.push(`phase ${p.id}: unknown decision ${id}`);
    for (const id of p.science || []) if (!DB.idx.articles.has(id)) problems.push(`phase ${p.id}: unknown science article ${id}`);
  }
  for (const x of [...DB.exercises, ...DB.drills]) {
    for (const a of x.alternatives || []) if (a.id && !DB.idx.items.has(a.id)) problems.push(`item ${x.id}: unknown alternative "${a.id}"`);
  }
  for (const d of DB.decisions) for (const id of d.refs || []) if (!DB.idx.refs.has(id)) problems.push(`decision ${d.id}: unknown ref ${id}`);
  for (const a of DB.articles) for (const id of a.refs || []) if (!DB.idx.refs.has(id)) problems.push(`science ${a.id}: unknown ref ${id}`);

  // Demonstration videos: each entry belongs to a library item and names a usable YouTube video.
  if (DB.videosError) problems.push(`videos.json could not be read: ${DB.videosError}`);
  for (const [key, v] of Object.entries(DB.videos || {})) {
    if (!DB.idx.items.has(key)) problems.push(`videos.json: "${key}" is not an exercise or drill id`);
    if (!v || !youtubeId(v.id)) problems.push(`videos.json: ${key} has no valid YouTube video id`);
    else if (!v.title || !v.channel) problems.push(`videos.json: ${key} needs a title and a channel`);
  }
  return problems;
}
