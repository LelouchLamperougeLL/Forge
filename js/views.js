// Page renderers. Each view returns { title, html, after?(root), cleanup? }.

import { esc, ICONS, restLabel, plain, todayISO } from './util.js';
import { DB, makeCtx, refHtml, refShort, gradeClass } from './content.js';
import {
  phases, getPhase, weekCount, weekPlan, scheduleFor, resolveSession, rxParts, effortLabel, sessionText,
  getPosition, getReturnTo, isDone, weekAdherence, phaseAdherence, KIND_LABEL, DAY_NAMES, expandPart, logAsName,
} from './engine.js';
import { renderPlayer, resumeInfo } from './player.js';
import { videoBlock, mountVideo } from './video.js';
import { GLYPHS, glyphFor, minutesToRead, fact, hero, inShort, titleHtml, toc, section, mountReading } from './reading.js';

const md = (ctx, src) => (src ? `<div class="md">${ctx.md(src)}</div>` : '');
const inlineMd = (ctx, src) => (src ? ctx.md(src).replace(/^<p>/, '').replace(/<\/p>$/, '') : '');
const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
const confChip = c => (c ? `<span class="chip badge-conf-${esc(String(c).toLowerCase())}">confidence: ${esc(c)}</span>` : '');
const certChip = c => (c ? `<span class="chip badge-cert-${esc(String(c).toLowerCase())}">${esc(c)}</span>` : '');
const phaseColor = p => `var(--${p && p.color ? p.color : 'p1'})`;
const phaseInk = p => `var(--${p && p.color ? p.color : 'p1'}-ink)`;
const listItem = (href, title, sub = '', extra = '') =>
  `<li><a class="list-item" href="${href}"><div class="li-main"><div class="li-title">${title}</div>${sub ? `<div class="li-sub">${sub}</div>` : ''}</div>${extra}<span class="li-chev">${ICONS.chevron}</span></a></li>`;

function head(eyebrow, title, lede = '') {
  return `<div class="page-head">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>`;
}

function notFound(what) {
  return { title: 'Not found', html: `<div class="page">${head('', 'Not found')}<p>${esc(what)} could not be found.</p><p><a href="#/today">Go to Today</a></p></div>` };
}

/** A tile on an index page. The summary is clamped to three lines on screen; the full text stays in the page. */
const tile = (href, title, sub = '', meta = '', glyph = '') =>
  `<a class="tile${glyph ? ' has-glyph' : ''}" href="${href}">${glyph ? `<span class="tile-glyph" aria-hidden="true">${glyph}</span>` : ''}<span class="tile-title">${title}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ''}${meta ? `<span class="tile-meta">${meta}</span>` : ''}</a>`;

/** A group of tiles on an index page, headed by its topic's mark and how many it holds. */
const hubGroup = (name, glyph, count, tiles) =>
  `<section class="hub-group"><div class="hub-head"><span class="hub-glyph" aria-hidden="true">${glyph}</span><h2>${esc(name)}</h2><span class="hub-count">${esc(count)}</span></div><div class="tiles">${tiles}</div></section>`;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sourcesFact = ctx => (ctx.order.length ? [fact(ctx.order.length, ctx.order.length === 1 ? 'source' : 'sources')] : []);

function jsDayToIdx(d = new Date()) { return (d.getDay() + 6) % 7; } // Mon = 0

/** The guided-session button's words: where the player would pick this session up again, or a fresh start. */
function playLabel(s, dayIdx) {
  const r = resumeInfo(s, dayIdx);
  return !r ? 'Start guided session' : r.finished ? 'Resume guided session · all steps done' : `Resume guided session · step ${r.step} of ${r.of}`;
}

/** The same words for a scheduled session, for js/app.js to refresh a button in place after a "done" tick. */
export function playLabelFor(phaseId, w, dayIdx) {
  const phase = getPhase(phaseId);
  const day = phase && scheduleFor(phase, w)[dayIdx];
  const s = day && day.sessionId ? resolveSession(phaseId, w, day.sessionId) : null;
  return s ? playLabel(s, dayIdx) : 'Start guided session';
}

// ---------------------------------------------------------------- shared fragments

function weekGrid(phase, w, { highlightToday = false } = {}) {
  const todayIdx = jsDayToIdx();
  return `<div class="week">${scheduleFor(phase, w).map(d => {
    if (!d.sessionId) {
      return `<div class="day rest${highlightToday && d.i === todayIdx ? ' today' : ''}"><div class="day-label">${d.dow}</div><div class="day-body"><span class="muted small">Rest${d.note ? ' · ' + esc(d.note) : ''}</span></div></div>`;
    }
    const s = DB.idx.sessions.get(d.sessionId);
    const done = isDone(phase.id, w, d.i);
    const kind = (s && s.kind) || 'strength';
    return `<div class="day kind-${esc(kind)}${highlightToday && d.i === todayIdx ? ' today' : ''}">
      <div class="day-label">${d.dow}</div>
      <div class="day-body">
        <span class="kind-tag">${esc(KIND_LABEL[kind] || kind)}${d.optional ? ' · optional' : ''}</span>
        <a class="session-link" href="#/s/${phase.id}/${w}/${d.i}">${esc(s ? s.name : d.sessionId)}</a>
        <div class="meta">${s && s.minutes ? `≈${s.minutes} min` : ''}${d.note ? ' · ' + esc(d.note) : ''}</div>
        <label class="done-toggle"><input type="checkbox" data-action="done" data-phase="${phase.id}" data-week="${w}" data-day="${d.i}" ${done ? 'checked' : ''}> done</label>
      </div></div>`;
  }).join('')}</div>`;
}

/**
 * The programme year as a strip of tempered steel: each main phase in its oxide colour, proportional
 * to its weeks, coloured up to `pos` and still grey (untempered) beyond it. `paused` marks a return
 * point (you are in an optional phase and will come back here).
 */
function temperBar(pos, { paused = false } = {}) {
  const seq = phases().filter(p => !p.optional);
  const weeksOf = p => p.timelineWeeks || p.weeks || 1;
  const total = seq.reduce((a, p) => a + weeksOf(p), 0);
  const stops = [];
  let x = 0, at = null, here = null;
  for (const p of seq) {
    const w = (100 * weeksOf(p)) / total;
    const blend = Math.min(0.8, w / 4);   // neighbouring oxide colours run into each other, as on real steel
    stops.push(`${phaseColor(p)} ${(x + blend).toFixed(2)}%`, `${phaseColor(p)} ${(x + w - blend).toFixed(2)}%`);
    if (pos && pos.phase === p.id) {
      at = x + (w * (Math.min(pos.week, weekCount(p)) - 0.5)) / weekCount(p);
      here = { p, x, w };
    }
    x += w;
  }
  const label = here
    ? `Programme year: ${paused ? 'you left' : 'you are in'} ${here.p.name}, week ${pos.week} of ${weekCount(here.p)}`
    : 'Programme year';
  return `<div class="temper${paused ? ' paused' : ''}" role="img" aria-label="${esc(label)}"
    style="--weeks:${total};--at:${(at ?? 0).toFixed(2)}%;--grad:linear-gradient(90deg, ${stops.join(', ')})">
    ${at != null ? '<span class="temper-mark"></span>' : ''}
    ${here ? `<span class="temper-span" style="left:${here.x.toFixed(2)}%;width:${here.w.toFixed(2)}%;--c:${phaseColor(here.p)}"></span>` : ''}
  </div>`;
}

function rolePlanTable(plan) {
  const roles = Object.keys(plan.sets || {});
  if (!roles.length) return '';
  const rows = roles.map(r => `<tr><td>${esc(r)}</td><td class="num">${esc(plan.sets[r])}</td><td>${esc(effortLabel(plan.rir[r]) || '—')}</td></tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Exercise role</th><th class="num">Sets</th><th>Effort target</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function itemSummaryLine(x) {
  if (!x) return '';
  const t = x.targets || {};
  const prim = (t.primary || []).join(', ');
  return [prim, (x.equipment || []).join(', ')].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- Today

export function viewToday() {
  const ctx = makeCtx();
  const pos = getPosition();
  const meta = DB.meta;
  if (!pos) {
    const first = phases()[0];
    return {
      title: 'Today',
      html: `<div class="page">
        ${head('Welcome', esc(meta.title || 'Your programme'), esc(meta.tagline || ''))}
        ${temperBar(null)}
        <div class="card">${md(ctx, meta.welcome)}
          <div class="row" style="margin-top:12px">
            ${first ? `<button class="btn primary" data-action="set-position" data-phase="${first.id}" data-week="1">Start ${esc(first.name)} · week 1</button>` : ''}
            <a class="btn" href="#/programme">Read the programme overview</a>
          </div>
        </div>
        <div class="grid two">
          <a class="card card-link" href="#/profile"><h3 style="margin-top:0">Your profile analysis</h3><p class="muted small">Estimates computed from your data, with methods and uncertainty; ambiguities and assumptions.</p></a>
          <a class="card card-link" href="#/plan/safety"><h3 style="margin-top:0">Safety and stop rules</h3><p class="muted small">Read before your first session.</p></a>
        </div>
        ${ctx.refsHtml()}
      </div>`,
    };
  }
  const phase = getPhase(pos.phase);
  const w = pos.week;
  const plan = weekPlan(phase, w);
  const N = weekCount(phase);
  const sched = scheduleFor(phase, w);
  const next = sched.find(d => d.sessionId && !d.optional && !isDone(phase.id, w, d.i));
  const adh = weekAdherence(phase, w);
  // Resolved for this week, so {{param}} placeholders in the summary are filled in.
  const nextS = next ? (resolveSession(phase.id, w, next.sessionId) || DB.idx.sessions.get(next.sessionId)) : null;
  const tests = plan.tests && plan.tests.length ? plan.tests : null;
  // Optional phases repeat until you leave them, so their last week advances instead of transitioning.
  const isLastWeek = w >= N && !phase.optional;
  const kind = nextS ? (nextS.kind || 'strength') : '';
  // The work panel: what to do next, on blued steel.
  const nextPanel = nextS ? `<section class="next steel" aria-label="Next session">
        <p class="next-when">Next session · ${esc(next.dow)}</p>
        <h2 class="next-name">${esc(nextS.name)}</h2>
        <p class="next-meta"><span class="kind-tag kind-${esc(kind)}">${esc(KIND_LABEL[kind] || '')}</span>${nextS.minutes ? `<span class="next-min">≈${nextS.minutes} min</span>` : ''}</p>
        ${nextS.summary ? md(ctx, nextS.summary) : ''}
        <div class="next-actions">
          <a class="btn primary big" href="#/play/${phase.id}/${w}/${next.i}">${ICONS.play} ${esc(playLabel(nextS, next.i))}</a>
          <a class="btn" href="#/s/${phase.id}/${w}/${next.i}">View &amp; transcribe</a>
        </div></section>`
    : `<section class="next steel all-done"><h2>All planned sessions done this week</h2>
        <p class="muted">Optional sessions, daily steps, sleep and nutrition still count. ${isLastWeek ? 'This is the last week of the phase: review the transition checklist.' : ''}</p></section>`;
  const side = `${plan.notes ? `<div class="card flat"><h3 style="margin-top:0">This week</h3>${md(ctx, plan.notes)}</div>` : ''}
      ${tests ? `<div class="callout warn"><div class="callout-title">Assessments due this week</div><ul>${tests.map(t => `<li>${inlineMd(ctx, t)}</li>`).join('')}</ul></div>` : ''}`;
  return {
    title: 'Today',
    html: `<div class="page today">
      <header class="today-head">
        <p class="eyebrow"><span class="phase-dot" style="background:${phaseColor(phase)}"></span>${esc(phase.name)}</p>
        <h1 class="today-week"><span>Week</span> <span class="wk-n">${w}</span> <span class="wk-of">of ${N}</span>${plan.title ? `<span class="wk-title">${esc(plan.title)}</span>` : ''}</h1>
        ${temperBar(phase.optional ? getReturnTo() : pos, { paused: !!phase.optional })}
        <p class="today-meta"><span>${adh.done} of ${adh.planned} planned sessions done this week</span><span class="today-date">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</span></p>
      </header>
      ${phase.optional ? returnCard(ctx, phase) : ''}
      <div class="today-grid">
        <div class="today-main">${nextPanel}</div>
        ${side.trim() ? `<div class="today-side">${side}</div>` : ''}
      </div>
      <div class="section-head"><h2>Week ${w} schedule</h2><a class="small" href="#/phase/${phase.id}/${w}">Week details</a></div>
      ${weekGrid(phase, w, { highlightToday: true })}
      <div class="row today-actions">
        ${isLastWeek
          ? `<a class="btn primary" href="#/tool/transition?phase=${phase.id}">Phase transition checklist</a>`
          : `<button class="btn" data-action="advance-week">Finish week ${w} → ${w < N ? `week ${w + 1}` : `repeat${N > 1 ? ` from week ${Math.min(phase.cycleTo || 1, N)}` : ''}`}</button>`}
        <a class="btn ghost" href="#/tool/checkin">Weekly check-in</a>
        <a class="btn ghost" href="#/tool/progression">Progression calculator</a>
      </div>
      ${phase.optional ? '' : switchCard()}
      ${ctx.refsHtml()}
    </div>`,
  };
}

/** Today, in the main sequence: one-tap switches into the optional phases for disrupted weeks. */
function switchCard() {
  const opts = phases().filter(p => p.optional);
  if (!opts.length) return '';
  return `<div class="card flat" style="margin-top:16px"><h3 style="margin-top:0">No gym, or a disrupted week?</h3>
    <p class="small muted">Switch for as long as you need. The app remembers this week and brings you back to it.</p>
    <ul class="list">${opts.map(p => `<li class="row between" style="padding:6px 0;flex-wrap:nowrap;gap:12px">
      <span class="small"><a href="#/phase/${p.id}"><strong>${esc(p.navName || p.name)}</strong></a>${p.switchHint ? ` · <span class="muted">${esc(p.switchHint)}</span>` : ''}</span>
      <button class="btn small" data-action="set-position" data-phase="${p.id}" data-week="1">Switch</button></li>`).join('')}</ul></div>`;
}

/** Inside an optional phase: how long you have been in it and a one-tap return to the main sequence. */
function returnCard(ctx, phase) {
  const r = getReturnTo();
  if (!r) {
    return `<div class="callout"><div class="callout-title">${esc(phase.name)} repeats until you leave it</div>
      <p>When normal training resumes, set your phase and week in <a href="#/settings">Settings</a>.</p></div>`;
  }
  const back = getPhase(r.phase);
  const days = r.left ? Math.max(0, Math.floor((Date.now() - Date.parse(r.left)) / 86400000)) : null;
  const rule = phase.returnRule ? ` ${ctx.md(`Before your first session back, read [[rule:${phase.returnRule}]].`).replace(/^<p>|<\/p>$/g, '')}` : '';
  return `<div class="callout return"><div class="callout-title">${esc(phase.navName || phase.name)}${days != null ? ` · day ${days + 1}` : ''}</div>
    <p>You left ${esc(back.short || back.name)} at week ${r.week}${r.left ? ` on ${esc(new Date(r.left).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}` : ''}.${rule}</p>
    <button class="btn primary" data-action="return-from-optional">Return to ${esc(back.short || back.name)} · week ${r.week}</button></div>`;
}

// ---------------------------------------------------------------- Programme overview

export function viewProgramme() {
  const ctx = makeCtx();
  const P = DB.programme;
  const all = phases();
  const timeline = all.filter(p => !p.optional);   // optional phases are used by choice, not part of the sequence
  const totalWeeks = timeline.reduce((a, p) => a + (p.timelineWeeks || p.weeks || 1), 0);
  const pos = getPosition();
  const here = p => (pos && pos.phase === p.id ? ' here' : '');
  const oxide = p => `--c:${phaseColor(p)};--ci:${phaseInk(p)}`;
  const bar = `<div class="phase-bar">${timeline.map(p => `<a class="${here(p).trim()}" href="#/phase/${p.id}" style="--w:${p.timelineWeeks || p.weeks};${oxide(p)}" title="${esc(p.name)}">${esc(p.short || p.name)}</a>`).join('')}</div>`;
  // Each phase as a sample of its oxide colour; the main sequence is drawn as a connected run.
  const card = p => `<li><a class="phase-card${here(p)}" href="#/phase/${p.id}" style="${oxide(p)}">
      <span class="swatch">${esc(p.short || '')}</span>
      <span class="phase-card-body"><span class="phase-card-meta">${esc(p.durationLabel || `${p.weeks} weeks`)}</span>
        <span class="phase-card-name">${esc(p.name)}</span>
        <span class="phase-card-tag">${inlineMd(ctx, p.tagline || '')}</span></span></a></li>`;
  const optional = all.filter(p => p.optional);
  const pages = DB.pages.map(pg => listItem(`#/plan/${pg.id}`, esc(pg.title), esc(plain(pg.tagline || '')))).join('');
  return {
    title: 'Programme',
    html: `<div class="page">
      ${head('Overview', esc(P.title || 'Programme'), esc(P.tagline || ''))}
      <div class="timeline">${bar}<p class="tiny muted">Timeline to scale (${totalWeeks} weeks shown${P.timelineNote ? '; ' + esc(P.timelineNote) : ''}).
        Each phase has its own temper colour, in the order steel takes them on as it is tempered (straw, gold, bronze, plum, blue); the app takes on the colour of the phase you are in.</p></div>
      ${P.overview ? `<div class="card">${md(ctx, P.overview)}</div>` : ''}
      <ol class="phase-list sequence">${timeline.map(card).join('')}</ol>
      ${optional.length ? `<p class="list-label">Optional modes</p><ul class="phase-list">${optional.map(card).join('')}</ul>` : ''}
      ${P.outcomes ? `<div class="section-head"><h2>Expected outcomes and uncertainty</h2></div><div class="card">${md(ctx, P.outcomes)}</div>` : ''}
      ${P.principles ? `<div class="section-head"><h2>Principles</h2></div><div class="card">${md(ctx, P.principles)}</div>` : ''}
      <div class="section-head"><h2>Beyond training</h2></div>
      <div class="card tight"><ul class="list">${pages}${listItem('#/profile', 'Your profile analysis', 'Estimates, ambiguities and assumptions')}</ul></div>
      ${ctx.refsHtml()}
    </div>`,
  };
}

// ---------------------------------------------------------------- Phase

export function viewPhase(id) {
  const phase = getPhase(id);
  if (!phase) return notFound(`Phase "${id}"`);
  const ctx = makeCtx();
  const N = weekCount(phase);
  const pos = getPosition();
  const list = (arr) => (arr && arr.length ? `<ul>${arr.map(x => `<li>${inlineMd(ctx, x)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>');
  const weeks = [];
  for (let w = 1; w <= N; w++) {
    const wp = weekPlan(phase, w);
    const a = weekAdherence(phase, w);
    const cur = pos && pos.phase === phase.id && pos.week === w;
    weeks.push(listItem(`#/phase/${phase.id}/${w}`, `Week ${w}${wp.title ? ' · ' + esc(wp.title) : ''}${cur ? ' <span class="chip accent">current</span>' : ''}`,
      `${a.done}/${a.planned} done${wp.deload ? ' · lighter week' : ''}${wp.tests && wp.tests.length ? ' · assessments' : ''}`));
  }
  const expected = (phase.expected || []).map(e => `<tr><td>${inlineMd(ctx, e.metric)}</td><td>${inlineMd(ctx, e.value)}</td><td>${certChip(e.certainty)}</td><td class="small">${inlineMd(ctx, e.note || '')}</td></tr>`).join('');
  const decs = (phase.decisions || []).map(d => DB.idx.decisions.get(d)).filter(Boolean)
    .map(d => listItem(`#/dec/${d.id}`, esc(d.title), confChip(d.confidence))).join('');
  const scis = (phase.science || []).map(s => DB.idx.articles.get(s)).filter(Boolean)
    .map(a => listItem(`#/sci/${a.id}`, esc(a.title), esc(plain(a.tagline || '')))).join('');
  const adh = pos && pos.phase === phase.id ? phaseAdherence(phase, pos.week) : null;
  const cur = pos && pos.phase === phase.id ? pos.week : 0;
  // The phase's weeks as plates of its oxide colour, filled up to the current week (decorative; the text says it).
  const strip = N > 1 ? `<div class="week-strip" style="--c:${phaseColor(phase)}" aria-hidden="true">${Array.from({ length: N }, (_, i) =>
    `<span class="${i + 1 < cur ? 'past' : i + 1 === cur ? 'now' : ''}"></span>`).join('')}</div>` : '';
  return {
    title: phase.short || phase.name,
    html: `<div class="page">
      ${head(`<span class="phase-dot" style="background:${phaseColor(phase)}"></span> ${esc(phase.short || '')} · ${esc(phase.durationLabel || `${N} weeks`)}`, esc(phase.name), '')}
      ${strip}
      ${pos && pos.phase === phase.id
        ? `<p class="small muted">You are in week ${pos.week}. Adherence so far: ${adh.pct ?? '–'}% of planned sessions.</p>${phase.optional ? returnCard(ctx, phase) : ''}`
        : phase.optional
          ? `<div class="row"><button class="btn small primary" data-action="set-position" data-phase="${phase.id}" data-week="1">Switch to ${esc(phase.navName || phase.name)} now</button><span class="small muted">The app remembers your current week and offers a one-tap return.</span></div>`
          : `<div class="row"><button class="btn small" data-action="set-position" data-phase="${phase.id}" data-week="1">Set as current phase (week 1)</button></div>`}
      <div class="card"><h2 style="margin-top:0">Purpose</h2>${md(ctx, phase.purpose)}</div>
      ${phase.structure ? `<div class="card"><h2 style="margin-top:0">Week and session structure</h2>${md(ctx, phase.structure)}</div>` : ''}
      <div class="section-head"><h2>Typical week</h2><span class="small muted">week 1 shown</span></div>
      ${weekGrid(phase, 1)}
      <div class="grid two" style="margin-top:14px">
        <div class="card"><h2 style="margin-top:0">Entry criteria</h2>${list(phase.entry)}</div>
        <div class="card"><h2 style="margin-top:0">Progression within the phase</h2>${md(ctx, phase.progression)}</div>
      </div>
      <div class="card"><h2 style="margin-top:0">At the end of the phase</h2>
        <h3>Advance when</h3>${list(phase.advance)}
        <h3>Repeat (all or part) when</h3>${list(phase.repeat)}
        <h3>Step back when</h3>${list(phase.regress)}
        <p><a class="btn small" href="#/tool/transition?phase=${phase.id}">Open the transition checklist</a></p>
      </div>
      ${expected ? `<div class="card"><h2 style="margin-top:0">Expected outcomes</h2><div class="table-wrap"><table><thead><tr><th>Measure</th><th>Expected change</th><th>Certainty</th><th>Notes</th></tr></thead><tbody>${expected}</tbody></table></div>${md(ctx, phase.expectedNote)}</div>` : ''}
      ${phase.nutrition ? `<div class="card"><h2 style="margin-top:0">Nutrition in this phase</h2>${md(ctx, phase.nutrition)}</div>` : ''}
      ${phase.conditioning ? `<div class="card"><h2 style="margin-top:0">Conditioning, mobility and skills</h2>${md(ctx, phase.conditioning)}</div>` : ''}
      <div class="section-head"><h2>Weeks</h2></div>
      <div class="card tight"><ul class="list">${weeks.join('')}</ul></div>
      ${decs ? `<div class="section-head"><h2>Decisions behind this phase</h2></div><div class="card tight"><ul class="list">${decs}</ul></div>` : ''}
      ${scis ? `<div class="section-head"><h2>Science</h2></div><div class="card tight"><ul class="list">${scis}</ul></div>` : ''}
      ${ctx.refsHtml()}
    </div>`,
  };
}

// ---------------------------------------------------------------- Week

export function viewWeek(id, w) {
  const phase = getPhase(id);
  if (!phase) return notFound(`Phase "${id}"`);
  const N = weekCount(phase);
  if (!(w >= 1 && w <= N)) return notFound(`Week ${w} of ${phase.name}`);
  const ctx = makeCtx();
  const plan = weekPlan(phase, w);
  const pos = getPosition();
  const isCurrent = pos && pos.phase === id && pos.week === w;
  const nav = `<div class="row between" style="margin:8px 0 14px">
    ${w > 1 ? `<a class="btn small" href="#/phase/${id}/${w - 1}">← Week ${w - 1}</a>` : '<span></span>'}
    ${w < N ? `<a class="btn small" href="#/phase/${id}/${w + 1}">Week ${w + 1} →</a>` : '<span></span>'}</div>`;
  return {
    title: `Week ${w}`,
    html: `<div class="page">
      ${head(`<a href="#/phase/${id}">${esc(phase.name)}</a>`, `Week ${w}${plan.title ? ' · ' + esc(plan.title) : ''}`)}
      ${isCurrent ? '<p><span class="chip accent">Current week</span></p>' : `<button class="btn small" data-action="set-position" data-phase="${id}" data-week="${w}">Make this my current week</button>`}
      ${nav}
      ${plan.notes ? `<div class="card">${md(ctx, plan.notes)}</div>` : ''}
      ${plan.tests && plan.tests.length ? `<div class="callout warn"><div class="callout-title">Assessments this week</div><ul>${plan.tests.map(t => `<li>${inlineMd(ctx, t)}</li>`).join('')}</ul></div>` : ''}
      <div class="section-head"><h2>Schedule</h2></div>
      ${weekGrid(phase, w)}
      <div class="section-head"><h2>Default targets this week</h2></div>
      ${rolePlanTable(plan)}
      <p class="small muted">Individual exercises may override these defaults; the session page always shows the final prescription.</p>
      ${ctx.refsHtml()}
    </div>`,
  };
}

// ---------------------------------------------------------------- Session

function drillRows(ctx, items) {
  return items.map(it => {
    const x = it.item;
    const name = x ? x.name : (it.name || it.ref);
    const details = x ? `<details><summary>How to</summary><div class="details-body md">
        ${x.summary ? ctx.md(x.summary) : ''}
        ${(x.execution || []).length ? `<ol>${x.execution.map(s => `<li>${inlineMd(ctx, s)}</li>`).join('')}</ol>` : ''}
        ${(x.cues || []).length ? `<p><strong>Cues:</strong> ${x.cues.map(c => inlineMd(ctx, c)).join(' · ')}</p>` : ''}
        <p><a href="#/ex/${esc(x.id)}">Full details</a></p></div></details>` : '';
    return `<div class="drill-row"><div style="flex:1;min-width:0">
      <div><strong>${x ? `<a href="#/ex/${esc(x.id)}">${esc(name)}</a>` : esc(name)}</strong></div>
      <div class="dose">${inlineMd(ctx, it.dose || '')}</div>
      ${it.note ? `<div class="small muted">${inlineMd(ctx, it.note)}</div>` : ''}
      ${details}</div></div>`;
  }).join('');
}

function exerciseCard(ctx, it, i, { away = false } = {}) {
  const x = it.item;
  const name = x ? x.name : (it.name || it.ref);
  const logName = logAsName(it);
  const rx = rxParts(it).map(p => `<span class="rx-item"><b>${esc(p)}</b></span>`).join('');
  const errs = x && (x.errors || []).length
    ? `<h4>Common errors</h4><ul>${x.errors.map(e => `<li><strong>${inlineMd(ctx, e.error)}</strong>${e.fix ? ' — ' + inlineMd(ctx, e.fix) : ''}</li>`).join('')}</ul>` : '';
  const alts = x && (x.alternatives || []).length
    ? `<h4>Alternatives</h4><ul>${x.alternatives.map(a => `<li>${ctx.link('ex', a.id)}${a.why ? ' — ' + inlineMd(ctx, a.why) : ''}</li>`).join('')}</ul>` : '';
  return `<div class="ex-card">
    <div class="ex-card-head"><div class="ex-index">${i + 1}${it.superset ? `<div class="tiny">${esc(it.superset)}</div>` : ''}</div>
      <div style="flex:1;min-width:0">
        <div class="ex-name">${x ? `<a href="#/ex/${esc(x.id)}" style="color:inherit">${esc(name)}</a>` : esc(name)}</div>
        ${logName ? `<div class="ex-logname">Log as: ${esc(logName)}</div>` : ''}
        <div class="rx">${rx}</div>
        ${it.warmupSets ? `<div class="small muted" style="margin-top:4px">Ramp-up sets first: ${esc(typeof it.warmupSets === 'string' ? it.warmupSets : 'see calculator')} · <a href="#/tool/warmup">calculator</a></div>` : ''}
        ${it.load ? `<div class="small" style="margin-top:6px"><strong>Load:</strong> ${inlineMd(ctx, it.load)}</div>` : ''}
        ${it.note ? `<div class="small" style="margin-top:4px"><strong>Note:</strong> ${inlineMd(ctx, it.note)}</div>` : ''}
      </div></div>
    ${x ? `<details><summary>Technique, errors, progression, alternatives</summary><div class="details-body md">
      ${x.targets ? `<p><strong>Targets:</strong> ${esc([...(x.targets.primary || []), ...(x.targets.secondary || []).map(s => s + ' (secondary)')].join(', '))}</p>` : ''}
      ${(x.setup || []).length ? `<h4>Set-up</h4><ol>${x.setup.map(s => `<li>${inlineMd(ctx, s)}</li>`).join('')}</ol>` : ''}
      ${(x.execution || []).length ? `<h4>Execution</h4><ol>${x.execution.map(s => `<li>${inlineMd(ctx, s)}</li>`).join('')}</ol>` : ''}
      ${errs}
      ${away && x.away ? `<h4>Without equipment</h4>${ctx.md(x.away)}` : ''}
      ${x.startingLoad ? `<h4>Finding your starting load</h4>${ctx.md(x.startingLoad)}` : ''}
      ${x.progression ? `<h4>Progress</h4>${ctx.md(x.progression)}` : ''}
      ${x.regression ? `<h4>Regress</h4>${ctx.md(x.regression)}` : ''}
      ${alts}
      ${x.whyChosen ? `<h4>Why this exercise</h4>${ctx.md(x.whyChosen)}` : ''}
      <p><a href="#/ex/${esc(x.id)}">Open full exercise page</a></p>
    </div></details>` : ''}
  </div>`;
}

/** On a gym strength session: where the no-equipment version is, for a day without gym access. */
function noGymHint(ctx, phase, s) {
  const away = phases().find(p => p.optional && p.noEquipment);
  if (!away || phase.optional || s.kind !== 'strength') return '';
  return `<p class="small muted">No gym today? ${ctx.link('phase', away.id, esc(away.navName || away.name))} has no-equipment sessions; for one missed day, do one of its full-body sessions and tick this one as done.</p>`;
}

export function viewSession(phaseId, w, dayIdx) {
  const phase = getPhase(phaseId);
  if (!phase) return notFound(`Phase "${phaseId}"`);
  const day = scheduleFor(phase, w)[dayIdx];
  if (!day || !day.sessionId) return notFound('That session');
  const s = resolveSession(phaseId, w, day.sessionId);
  if (!s) return notFound(`Session "${day.sessionId}"`);
  const ctx = makeCtx();
  const done = isDone(phaseId, w, dayIdx);
  const rationale = (part, label) => (s[part].rationale ? `<details><summary>Why this ${label}: rationale and evidence</summary><div class="details-body">${md(ctx, s[part].rationale)}</div></details>` : '');
  const text = sessionText(s);
  return {
    title: s.name,
    html: `<div class="page">
      ${head(`<a href="#/phase/${phaseId}/${w}">${esc(phase.short || phase.name)} · Week ${w} · ${esc(day.dow)}</a>`, esc(s.name),
        `${esc(KIND_LABEL[s.kind] || s.kind)} · planned ≈${esc(s.minutes || s.estimate)} min${s.minutes && Math.abs(s.estimate - s.minutes) > 8 ? ` (timing estimate ≈${s.estimate} min)` : ''}${day.optional ? ' · optional' : ''}`)}
      <div class="row session-actions">
        <a class="btn primary big" href="#/play/${phaseId}/${w}/${dayIdx}">${ICONS.play} ${esc(playLabel(s, dayIdx))}</a>
        <button class="btn" data-action="copy" data-copy-target="session-text">${ICONS.copy} Copy for logging app</button>
        <label class="done-toggle" style="margin-left:4px"><input type="checkbox" data-action="done" data-phase="${phaseId}" data-week="${w}" data-day="${dayIdx}" ${done ? 'checked' : ''}> done</label>
      </div>
      ${s.summary ? `<div class="card" style="margin-top:14px">${md(ctx, s.summary)}</div>` : ''}
      ${s.plan.notes ? `<div class="card flat"><h3 style="margin-top:0">This week</h3>${md(ctx, s.plan.notes)}</div>` : ''}
      ${day.note ? `<p class="small muted">${esc(day.note)}</p>` : ''}
      ${noGymHint(ctx, phase, s)}

      <div class="section-head"><h2><span class="section-num">1</span>Warm-up</h2><span class="small muted">${s.warmup.minutes ? `≈${esc(s.warmup.minutes)} min` : ''}</span></div>
      <div class="card tight">${drillRows(ctx, s.warmup.items) || '<p class="muted">None.</p>'}</div>
      ${rationale('warmup', 'warm-up')}

      <div class="section-head"><h2><span class="section-num">2</span>Main training</h2></div>
      ${s.main.items.map((it, i) => (it.timer || !it.reps ? `<div class="card tight">${drillRows(ctx, [it])}</div>` : exerciseCard(ctx, it, i, { away: !!phase.noEquipment }))).join('')}
      ${rationale('main', 'main training')}

      <div class="section-head"><h2><span class="section-num">3</span>Cool-down &amp; stretching</h2><span class="small muted">${s.cooldown.minutes ? `≈${esc(s.cooldown.minutes)} min` : ''}</span></div>
      <div class="card tight">${drillRows(ctx, s.cooldown.items) || '<p class="muted">None.</p>'}</div>
      ${rationale('cooldown', 'cool-down')}

      ${s.record ? `<div class="callout ok"><div class="callout-title">What to record in your logging app</div>${ctx.md(s.record)}</div>` : ''}
      ${s.shortVersion ? `<details><summary>Short on time? The minimum version</summary><div class="details-body">${md(ctx, s.shortVersion)}</div></details>` : ''}
      ${s.notes ? `<div class="card flat">${md(ctx, s.notes)}</div>` : ''}
      <details><summary>Plain-text version (for your logging app's notes)</summary><div class="details-body">
        <textarea id="session-text" readonly rows="14" aria-label="Session as plain text">${esc(text)}</textarea></div></details>
      ${ctx.refsHtml()}
    </div>`,
  };
}

export function viewPlayer(phaseId, w, dayIdx) {
  const phase = getPhase(phaseId);
  const day = phase && scheduleFor(phase, w)[dayIdx];
  const s = day && day.sessionId ? resolveSession(phaseId, w, day.sessionId) : null;
  if (!s) return notFound('That session');
  let cleanup = null;
  return {
    title: s.name,
    html: '<div id="player-root"></div>',
    after(root) {
      cleanup = renderPlayer(root.querySelector('#player-root'), s, dayIdx, { exitHref: `#/s/${phaseId}/${w}/${dayIdx}` });
    },
    cleanup() { if (cleanup) cleanup(); },
  };
}

// ---------------------------------------------------------------- Library

const CATEGORY_LABEL = {
  resistance: 'Resistance', bodyweight: 'Bodyweight', core: 'Core', warmup: 'Warm-up', mobility: 'Mobility',
  stretch: 'Stretch', cardio: 'Cardio', balance: 'Balance', plyometric: 'Power', agility: 'Agility', test: 'Test',
};

export function viewLibrary(query) {
  const all = [...DB.exercises, ...DB.drills];
  const cats = [...new Set(all.map(x => x.category).filter(Boolean))];
  const cat = query.get('cat') || '';
  // Typing redraws only the list, so the search box keeps its focus (and a phone keeps its keyboard open).
  const listHtml = q => all
    .filter(x => !cat || x.category === cat)
    .filter(x => !q || [x.name, x.loggingName, ...(x.aliases || []), itemSummaryLine(x)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(x => listItem(`#/ex/${x.id}`, esc(x.name), esc(itemSummaryLine(x)), `<span class="chip">${esc(CATEGORY_LABEL[x.category] || x.category || '')}</span>`)).join('') ||
    '<li class="muted" style="padding:12px">No matches.</li>';
  let t;
  return {
    title: 'Library',
    html: `<div class="page">
      ${head('Exercises and drills', 'Library', `${all.length} entries: technique, prescription, progressions and alternatives.`)}
      <div class="field"><input type="search" id="libq" placeholder="Search exercises, muscles, equipment…" value="${esc(query.get('q') || '')}" aria-label="Search the library"></div>
      <div class="chips" role="group" aria-label="Filter by category">
        <button class="chip" data-action="lib-cat" data-cat="" aria-pressed="${!cat}">All</button>
        ${cats.map(c => `<button class="chip" data-action="lib-cat" data-cat="${esc(c)}" aria-pressed="${cat === c}">${esc(CATEGORY_LABEL[c] || c)}</button>`).join('')}
      </div>
      <div class="card tight" style="margin-top:12px"><ul class="list" id="libList">
        ${listHtml((query.get('q') || '').toLowerCase())}
      </ul></div>
    </div>`,
    after(root) {
      const input = root.querySelector('#libq');
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const p = new URLSearchParams(location.hash.split('?')[1] || '');
          if (input.value) p.set('q', input.value); else p.delete('q');
          history.replaceState(history.state, '', `#/library${p.toString() ? '?' + p : ''}`);
          root.querySelector('#libList').innerHTML = listHtml(input.value.toLowerCase());
        }, 250);
      });
    },
    cleanup() { clearTimeout(t); },
  };
}

function usedIn(itemId) {
  const out = [];
  for (const [, s] of DB.idx.sessions) {
    for (const part of ['warmup', 'main', 'cooldown']) {
      if ((expandPart(s[part]).items || []).some(it => it.ref === itemId)) { out.push(s); break; }
    }
  }
  return out;
}

export function viewItem(id) {
  const x = DB.idx.items.get(id);
  if (!x) return notFound(`Exercise "${id}"`);
  const ctx = makeCtx();
  const sec = (title, body) => (body ? `<div class="card"><h2 style="margin-top:0">${title}</h2>${body}</div>` : '');
  const ol = arr => (arr && arr.length ? `<ol>${arr.map(s => `<li>${inlineMd(ctx, s)}</li>`).join('')}</ol>` : '');
  const ul = arr => (arr && arr.length ? `<ul>${arr.map(s => `<li>${inlineMd(ctx, s)}</li>`).join('')}</ul>` : '');
  const t = x.targets || {};
  const sessions = usedIn(id);
  const errs = (x.errors || []).length ? `<ul>${x.errors.map(e => `<li><strong>${inlineMd(ctx, e.error)}</strong>${e.fix ? ' — ' + inlineMd(ctx, e.fix) : ''}</li>`).join('')}</ul>` : '';
  const alts = (x.alternatives || []).length ? `<ul>${x.alternatives.map(a => `<li>${ctx.link('ex', a.id)}${a.why ? ' — ' + inlineMd(ctx, a.why) : ''}</li>`).join('')}</ul>` : '';
  let stopVideo = null;
  return {
    title: x.name,
    html: `<div class="page reading">
      ${head(esc(CATEGORY_LABEL[x.category] || x.category || ''), esc(x.name), '')}
      ${x.loggingName ? `<p class="small">Find it in your logging app as <strong>${esc(x.loggingName)}</strong>${(x.aliases || []).length ? ` (also called ${esc(x.aliases.join(', '))})` : ''}.</p>` : ''}
      <div class="chips">${(t.primary || []).map(m => chip(m, 'accent')).join('')}${(t.secondary || []).map(m => chip(m)).join('')}${x.system ? chip(x.system, 'info') : ''}${(x.equipment || []).map(e => chip(e)).join('')}${x.level ? chip(x.level) : ''}</div>
      ${videoBlock(id)}
      ${x.summary ? `<div class="card" style="margin-top:12px">${md(ctx, x.summary)}</div>` : ''}
      ${x.dose ? sec('Standard dose', md(ctx, x.dose)) : ''}
      ${sec('Set-up', ol(x.setup))}
      ${sec('Execution', ol(x.execution))}
      ${x.protocol ? sec('Protocol', ol(x.protocol)) : ''}
      ${sec('Breathing and bracing', md(ctx, x.breathing))}
      ${sec('Coaching cues', ul(x.cues))}
      ${sec('Common errors and fixes', errs)}
      ${sec('Finding your starting load', md(ctx, x.startingLoad))}
      ${sec('Judging effort', md(ctx, x.effort))}
      ${sec('Scoring and interpretation', md(ctx, x.scoring))}
      ${sec('How to progress', md(ctx, x.progression))}
      ${sec('How to regress', md(ctx, x.regression))}
      ${sec('Without equipment (Away mode)', md(ctx, x.away))}
      ${sec('Safe alternatives', alts)}
      ${sec('Why this was chosen for you', md(ctx, x.whyChosen))}
      ${sec('Mechanism', md(ctx, x.mechanism))}
      ${x.safety ? `<div class="callout warn"><div class="callout-title">Safety</div>${ctx.md(x.safety)}</div>` : ''}
      ${sec('Evidence', md(ctx, x.evidence))}
      ${sessions.length ? `<div class="card tight"><h2 style="margin:4px 0">Used in</h2><ul class="list">${sessions.map(s => `<li class="list-item"><div class="li-main"><div class="li-title">${esc(s.name)}</div></div></li>`).join('')}</ul></div>` : ''}
      ${ctx.refsHtml()}
    </div>`,
    after(root) { stopVideo = mountVideo(root); },
    cleanup() { if (stopVideo) stopVideo(); },
  };
}

// ---------------------------------------------------------------- Rules

export function viewRules() {
  const ctx = makeCtx();
  const groups = {};
  for (const r of DB.rules) (groups[r.category || 'General'] ||= []).push(r);
  return {
    title: 'Rules',
    html: `<div class="page hub">
      ${hero({ eyebrow: 'Look up and apply', title: 'Progression and adjustment rules', lede: 'Each rule is written in terms of data your logging app and tape measure record.', glyph: ICONS.rules,
        facts: [fact(DB.rules.length, 'rules'), fact(Object.keys(groups).length, 'topics'), fact(DB.rules.filter(r => r.tool).length, 'with a calculator')] })}
      ${Object.entries(groups).map(([g, rs]) => hubGroup(g, glyphFor(g), plural(rs.length, 'rule'),
        rs.map(r => tile(`#/rule/${r.id}`, esc(r.title), esc(plain(r.summary || '')), r.tool ? '<span class="chip accent">Calculator</span>' : '')).join(''))).join('')}
      ${ctx.refsHtml()}
    </div>`,
  };
}

// The parts of a rule, each with its own mark: when it applies, the steps, the data, an example, the reasoning.
const RULE_PARTS = [
  ['trigger', 'When it applies', GLYPHS.when, ''],
  ['action', 'What to do', ICONS.rules, 'steps'],
  ['data', 'Data you need', GLYPHS.data, ''],
  ['example', 'Worked example', GLYPHS.example, 'worksheet'],
  ['rationale', 'Why', GLYPHS.why, ''],
];

export function viewRule(id) {
  const r = DB.idx.rules.get(id);
  if (!r) return notFound(`Rule "${id}"`);
  const ctx = makeCtx();
  const summary = r.summary ? md(ctx, r.summary) : '';
  const parts = RULE_PARTS.filter(([k]) => r[k]);
  const body = parts.map(([k, t, glyph, cls]) => section({ id: k, n: glyph, title: t, body: md(ctx, r[k]), cls })).join('');
  const refs = ctx.refsHtml();
  return {
    title: r.title,
    html: `<div class="page longread solo">
      ${hero({ eyebrow: esc(r.category || 'Rule'), title: esc(r.title), glyph: glyphFor(r.category),
        facts: [fact(`${minutesToRead(r.summary, ...parts.map(([k]) => r[k]))} min`, 'read'), ...sourcesFact(ctx)] })}
      ${inShort('The rule', summary)}
      <div class="lr-body">${body}
        ${r.tool ? `<p class="lr-cta"><a class="btn primary" href="#/tool/${esc(r.tool)}">Open the matching calculator</a></p>` : ''}
        ${refs}
      </div>
    </div>`,
  };
}

// ---------------------------------------------------------------- Science

export function viewScience() {
  const groups = {};
  for (const a of DB.articles) (groups[a.category || 'General'] ||= []).push(a);
  const minutes = a => minutesToRead(a.summary, a.mechanisms, a.evidence, a.practice, a.uncertainties);
  return {
    title: 'Science',
    html: `<div class="page hub">
      ${hero({ eyebrow: 'Learn', title: 'The science behind the programme', lede: 'Each article starts with a plain-language summary, then mechanisms, then the evidence and references.', glyph: ICONS.science,
        facts: [fact(DB.articles.length, 'articles'), fact(DB.decisions.length, 'decisions'), fact(DB.references.length, 'references'), fact(DB.terms.length, 'terms')] })}
      <div class="tiles shelf">
        ${tile('#/decisions', 'Decision records', `${DB.decisions.length} decisions: options, evidence, confidence, what would change them.`, '', ICONS.decisions)}
        ${tile('#/refs', 'References', `${DB.references.length} sources with DOI/PMID and evidence grades.`, '', ICONS.refs)}
        ${tile('#/glossary', 'Glossary', `${DB.terms.length} terms defined.`, '', ICONS.glossary)}
      </div>
      ${Object.entries(groups).map(([g, as]) => hubGroup(g, glyphFor(g), plural(as.length, 'article'),
        as.map(a => tile(`#/sci/${a.id}`, esc(a.title), esc(plain(a.tagline || '')), `<span class="tile-min">${minutes(a)} min read</span>`)).join(''))).join('')}
      ${DB.meta.evidenceCutoff ? `<p class="small muted hub-foot">Evidence searched up to ${esc(DB.meta.evidenceCutoff)}.</p>` : ''}
    </div>`,
  };
}

// An article's layers, from plain language down to the evidence; the last two are set apart.
const LAYERS = [
  ['summary', 'In plain language', ''], ['mechanisms', 'Mechanisms', ''], ['evidence', 'Evidence', ''],
  ['practice', 'What this means for your programme', 'is-practice'], ['uncertainties', 'Uncertainties and limits', 'is-limits'],
];

export function viewArticle(id) {
  const a = DB.idx.articles.get(id);
  if (!a) return notFound(`Article "${id}"`);
  const ctx = makeCtx();
  const layers = LAYERS.filter(([k]) => a[k]);
  // The plain-language layer opens the page; the deeper layers follow as numbered sections.
  const lead = layers[0] && layers[0][0] === 'summary' ? inShort(layers[0][1], md(ctx, a.summary), 'summary') : '';
  const body = layers.filter(([k]) => !(lead && k === 'summary')).map(([k, t, cls]) => {
    const n = layers.findIndex(l => l[0] === k) + 1;
    return section({ id: k, n, title: esc(t), body: cls ? `<div class="lr-panel">${md(ctx, a[k])}</div>` : md(ctx, a[k]), cls });
  }).join('');
  const rel = a.related || {};
  const relList = [
    ...(rel.decisions || []).map(d => ctx.link('dec', d)),
    ...(rel.articles || []).map(x => ctx.link('sci', x)),
    ...(rel.items || []).map(x => ctx.link('ex', x)),
    ...(rel.plan || []).map(x => ctx.link('plan', x)),
  ];
  const refs = ctx.refsHtml('References');
  let stop = null;
  return {
    title: a.title,
    html: `<div class="page longread">
      ${hero({ eyebrow: esc(a.category || 'Science'), title: esc(a.title), lede: esc(plain(a.tagline || '')), glyph: glyphFor(a.category),
        facts: [fact(layers.length, 'layers'), fact(`${minutesToRead(...layers.map(([k]) => a[k]))} min`, 'read'), ...sourcesFact(ctx)] })}
      ${lead}
      ${toc(layers.map(([k, t]) => ({ id: k, html: esc(t) })), `#/sci/${esc(id)}`, 'Layers of this article')}
      <div class="lr-body">${body}
        ${relList.length ? `<div class="card flat related"><h2 style="margin-top:0">Related</h2><p>${relList.join(' · ')}</p></div>` : ''}
        ${refs}
      </div>
    </div>`,
    after(root) { stop = mountReading(root); },
    cleanup() { if (stop) stop(); },
  };
}

// ---------------------------------------------------------------- Decisions

export function viewDecisions() {
  const groups = {};
  for (const d of DB.decisions) (groups[d.category || 'General'] ||= []).push(d);
  const withConfidence = c => DB.decisions.filter(d => String(d.confidence || '').toLowerCase() === c).length;
  return {
    title: 'Decisions',
    html: `<div class="page hub">
      ${hero({ eyebrow: 'Transparency', title: 'Decision records', lede: 'Every significant choice: the question, the options considered, the evidence for and against each, the choice, confidence, the profile data that influenced it, and what would change it.', glyph: ICONS.decisions,
        facts: [fact(DB.decisions.length, 'decisions'), ...['high', 'moderate', 'low'].filter(withConfidence).map(c => fact(withConfidence(c), `${c} confidence`))] })}
      ${Object.entries(groups).map(([g, ds]) => hubGroup(g, glyphFor(g), plural(ds.length, 'decision'),
        ds.map(d => tile(`#/dec/${d.id}`, `<span class="tile-id">${esc(d.id)}</span> ${esc(d.title)}`, esc(plain(d.choiceSummary || '')), confChip(d.confidence))).join(''))).join('')}
    </div>`,
  };
}

export function viewDecision(id) {
  const d = DB.idx.decisions.get(id);
  if (!d) return notFound(`Decision "${id}"`);
  const ctx = makeCtx();
  const opts = (d.options || []).map(o => `<div class="option${o.chosen ? ' chosen' : ''}">
      <h3>${esc(o.name)} ${o.chosen ? '<span class="chip accent">chosen</span>' : ''}</h3>
      ${o.summary ? md(ctx, o.summary) : ''}
      <div class="pro-con"><div class="for"><div class="lbl">Evidence for</div>${md(ctx, o.for)}</div><div class="against"><div class="lbl">Evidence against</div>${md(ctx, o.against)}</div></div>
    </div>`).join('');
  const ul = arr => (arr && arr.length ? `<ul>${arr.map(s => `<li>${inlineMd(ctx, s)}</li>`).join('')}</ul>` : '');
  // Citations are numbered in the order things are rendered: the options first (above), then the rest in page order.
  const question = d.context ? md(ctx, d.context) : '';
  const reasoning = `<div class="lr-panel">${md(ctx, d.rationale)}
    ${d.confidenceNote ? `<p class="small"><strong>Confidence:</strong> ${inlineMd(ctx, d.confidenceNote)}</p>` : ''}</div>`;
  const parts = [
    ['options', 'Options considered', opts, ''],
    ['choice', 'Choice and reasoning', reasoning, 'is-practice'],
    ['data', 'Your data that influenced it', ul(d.profileData), ''],
    ['change', 'What would change this decision', ul(d.wouldChange), ''],
  ];
  const rel = d.related || {};
  const relList = [
    ...(rel.articles || []).map(x => ctx.link('sci', x)), ...(rel.decisions || []).map(x => ctx.link('dec', x)),
    ...(rel.items || []).map(x => ctx.link('ex', x)), ...(rel.rules || []).map(x => ctx.link('rule', x)),
    ...(rel.plan || []).map(x => ctx.link('plan', x)), ...(rel.phases || []).map(x => ctx.link('phase', x)),
  ];
  const refs = ctx.refsHtml('References');
  return {
    title: 'Decision',
    html: `<div class="page longread solo">
      ${hero({ eyebrow: `${esc(d.category || 'Decision')} · ${esc(d.id)}`, title: esc(d.title), glyph: glyphFor(d.category), extra: confChip(d.confidence),
        facts: [fact((d.options || []).length, 'options'), fact(`${minutesToRead(d.context, d.rationale, ...(d.options || []).flatMap(o => [o.summary, o.for, o.against]))} min`, 'read'), ...sourcesFact(ctx)] })}
      ${inShort('The question', question)}
      <div class="lr-body">
        ${parts.map(([k, t, b, cls], i) => section({ id: k, n: i + 1, title: t, body: b, cls })).join('')}
        ${relList.length ? `<div class="card flat related"><h2 style="margin-top:0">Related</h2><p>${relList.join(' · ')}</p></div>` : ''}
        ${refs}
      </div>
    </div>`,
  };
}

// ---------------------------------------------------------------- References

export function viewRefs(query) {
  // As in the library, typing redraws only the list, so the search box keeps its focus.
  const listHtml = q => DB.references
    .filter(r => !q || [r.authors, r.title, r.journal, r.year, r.doi, r.pmid].join(' ').toLowerCase().includes(q))
    .slice().sort((a, b) => String(a.authors).localeCompare(String(b.authors)) || (a.year - b.year))
    .map(r => `<div class="ref-entry">${refHtml(r)}</div>`).join('') || '<p class="muted">No matches.</p>';
  let t;
  return {
    title: 'References',
    html: `<div class="page reading">
      ${hero({ eyebrow: 'Evidence', title: 'References', glyph: ICONS.refs,
        lede: `${DB.references.length} sources. Each was located and read (abstract or full text) during research${DB.meta.evidenceCutoff ? ` up to ${esc(DB.meta.evidenceCutoff)}` : ''}; identifiers were re-checked during the audit.`,
        facts: [fact(DB.references.length, 'sources'), fact(DB.references.filter(r => r.doi || r.pmid).length, 'with a DOI or PMID')] })}
      <div class="field"><input type="search" id="refq" placeholder="Search author, title, journal, DOI, PMID…" value="${esc(query.get('q') || '')}" aria-label="Search references"></div>
      <div class="card tight" id="refList">${listHtml((query.get('q') || '').toLowerCase())}</div>
    </div>`,
    after(root) {
      const input = root.querySelector('#refq');
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          history.replaceState(history.state, '', `#/refs${input.value ? '?q=' + encodeURIComponent(input.value) : ''}`);
          root.querySelector('#refList').innerHTML = listHtml(input.value.toLowerCase());
        }, 250);
      });
    },
    cleanup() { clearTimeout(t); },
  };
}

function citedIn(refId) {
  const hits = [];
  const r0 = DB.idx.refs.get(refId);
  const ids = [refId, ...((r0 && r0.aliases) || [])];
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match "@id" only as a whole token, so "@Smith2020" does not match "@Smith2020_b".
  const patterns = ids.map(id => new RegExp('@' + escRe(id) + '(?![\\w-])'));
  const has = s => typeof s === 'string' && patterns.some(re => re.test(s));
  const deep = (node, seen = new Set()) => {
    if (node == null) return false;
    if (typeof node === 'string') return has(node);
    if (typeof node !== 'object' || seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(v => deep(v, seen));
    if ((node.refs || []).some(x => ids.includes(x))) return true;
    return Object.entries(node).some(([k, v]) => !k.startsWith('_') && deep(v, seen));
  };
  DB.articles.forEach(a => deep(a) && hits.push(['sci', a.id]));
  DB.decisions.forEach(d => deep(d) && hits.push(['dec', d.id]));
  [...DB.exercises, ...DB.drills].forEach(x => deep(x) && hits.push(['ex', x.id]));
  DB.pages.forEach(p => deep(p) && hits.push(['plan', p.id]));
  DB.rules.forEach(r => deep(r) && hits.push(['rule', r.id]));
  return hits;
}

export function viewRef(id) {
  const r = DB.idx.refs.get(id);
  if (!r) return notFound(`Reference "${id}"`);
  const ctx = makeCtx();
  const hits = citedIn(id);
  const v = r.verification || {};
  return {
    title: refShort(r),
    html: `<div class="page reading">
      ${hero({ eyebrow: esc(r.type || 'Reference'), title: esc(r.title), glyph: ICONS.refs, compact: true,
        facts: hits.length ? [fact(hits.length, hits.length === 1 ? 'page cites it' : 'pages cite it')] : [] })}
      <div class="card"><p>${refHtml(r, { link: false })}</p>
        <dl class="kv">
          ${r.population ? `<dt>Population</dt><dd>${esc(r.population)}</dd>` : ''}
          ${r.size ? `<dt>Size</dt><dd>${esc(r.size)}</dd>` : ''}
          ${r.grade ? `<dt>Certainty</dt><dd><span class="chip ${gradeClass(r.grade)}">${esc(r.grade)}</span> ${esc(r.gradeReason || '')}</dd>` : ''}
          ${r.verifiedVia ? `<dt>Read via</dt><dd>${esc(r.verifiedVia)}</dd>` : ''}
          ${v.status ? `<dt>Audit</dt><dd>${esc(v.status)}${v.notes ? ' — ' + esc(v.notes) : ''}</dd>` : ''}
        </dl></div>
      ${r.keyFindings ? `<div class="card"><h2 style="margin-top:0">Key findings (summarised)</h2>${md(ctx, r.keyFindings)}</div>` : ''}
      ${r.limitations ? `<div class="card"><h2 style="margin-top:0">Limitations</h2>${md(ctx, r.limitations)}</div>` : ''}
      ${hits.length ? `<div class="card"><h2 style="margin-top:0">Cited in</h2><p>${hits.map(([t, x]) => ctx.link(t, x)).join(' · ')}</p></div>` : ''}
    </div>`,
  };
}

// ---------------------------------------------------------------- Glossary, plan pages, profile

export function viewGlossary() {
  const ctx = makeCtx();
  const terms = DB.terms.slice().sort((a, b) => a.term.localeCompare(b.term));
  // Grouped under their first letter, with a bar to jump between letters and a box to find a term.
  const letter = t => { const c = t.term.trim().charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
  const groups = new Map();
  for (const t of terms) { const L = letter(t); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(t); }
  const entry = t => `<div class="gl-term" id="term-${esc(t.id)}"><h3 class="ref-title">${esc(t.term)}${(t.aliases || []).length ? ` <span class="gl-aka">(${esc(t.aliases.join(', '))})</span>` : ''}</h3>${md(ctx, t.definition)}</div>`;
  const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  return {
    title: 'Glossary',
    html: `<div class="page reading">
      ${hero({ eyebrow: 'Definitions', title: 'Glossary', lede: 'Terms from exercise physiology, sports nutrition and biomechanics, defined for a biochemist.', glyph: ICONS.glossary,
        facts: [fact(terms.length, 'terms')] })}
      <div class="gl-tools no-print">
        <div class="field"><input type="search" id="glq" placeholder="Find a term…" aria-label="Find a term" autocomplete="off"></div>
        <nav class="az" aria-label="Jump to a letter">${[...groups.keys()].map(L => `<a href="#/glossary" data-letter="${esc(L)}">${esc(L)}</a>`).join('')}</nav>
      </div>
      <p class="muted gl-none" role="status" hidden>No term matches that.</p>
      ${[...groups].map(([L, ts]) => `<section class="gl-group" data-letter="${esc(L)}"><h2 class="gl-letter">${esc(L)}</h2>${ts.map(entry).join('')}</section>`).join('')}
      ${ctx.refsHtml()}
    </div>`,
    after(root) {
      const input = root.querySelector('#glq');
      const none = root.querySelector('.gl-none');
      // Finding a term hides the others for the moment; clearing the box shows them all again.
      const find = () => {
        const q = input.value.trim().toLowerCase();
        let shown = 0;
        root.querySelectorAll('.gl-group').forEach(g => {
          let n = 0;
          g.querySelectorAll('.gl-term').forEach(t => { const hit = !q || t.textContent.toLowerCase().includes(q); t.hidden = !hit; if (hit) n++; });
          g.hidden = !n;
          shown += n;
        });
        none.hidden = shown > 0;
      };
      input.addEventListener('input', find);
      root.querySelector('.az').addEventListener('click', e => {
        const a = e.target.closest('[data-letter]');
        if (!a) return;
        e.preventDefault();
        if (input.value) { input.value = ''; find(); }
        const g = root.querySelector(`.gl-group[data-letter="${CSS.escape(a.dataset.letter)}"]`);
        if (g) g.scrollIntoView({ behavior: motion(), block: 'start' });
      });
    },
  };
}

export function viewPlan(id) {
  const p = DB.idx.pages.get(id);
  if (!p) return notFound(`Page "${id}"`);
  const ctx = makeCtx();
  const secs = p.sections || [];
  const summary = p.summary ? md(ctx, p.summary) : '';
  const body = secs.map((s, i) => section({ id: s.id, n: i + 1, title: titleHtml(s.title), body: md(ctx, s.body) })).join('');
  const refs = ctx.refsHtml('References');
  let stop = null;
  return {
    title: p.title,
    html: `<div class="page longread">
      ${hero({ eyebrow: 'Plan', title: esc(p.title), lede: esc(plain(p.tagline || '')), glyph: glyphFor(p.title, p.id),
        facts: [fact(secs.length, secs.length === 1 ? 'section' : 'sections'), fact(`${minutesToRead(p.summary, ...secs.map(s => s.body))} min`, 'read'), ...sourcesFact(ctx)] })}
      ${inShort('In short', summary)}
      ${secs.length > 1 ? toc(secs.map(s => ({ id: s.id, html: titleHtml(s.title) })), `#/plan/${esc(id)}`) : ''}
      <div class="lr-body">${body}${refs}</div>
    </div>`,
    after(root) { stop = mountReading(root); },
    cleanup() { if (stop) stop(); },
  };
}

export function viewProfile() {
  const ctx = makeCtx();
  const pa = DB.meta.profileAnalysis || {};
  const secs = (pa.sections || []).map((s, i) => {
    // Titles are numbered already ("1 · Your data"): the number goes on the plate.
    const m = /^(\d+)\s*·\s*(.*)$/.exec(s.title || '');
    return { id: s.id || `part-${i + 1}`, n: m ? +m[1] : i + 1, title: m ? m[2] : s.title || '', numbered: !!m, body: s.body };
  });
  const body = secs.map(s => section({ id: s.id, n: s.n, title: `${s.numbered ? '<span class="sr-only">· </span>' : ''}${esc(s.title)}`, body: md(ctx, s.body) })).join('');
  const refs = ctx.refsHtml('References');
  let stop = null;
  return {
    title: 'Profile analysis',
    html: `<div class="page longread">
      ${hero({ eyebrow: 'Step 1', title: 'Your profile analysis', lede: 'Your data, the estimates computed from it (with methods and uncertainty), and how ambiguities were resolved.', glyph: GLYPHS.profile,
        facts: [fact(secs.length, 'sections'), fact(`${minutesToRead(...secs.map(s => s.body))} min`, 'read'), ...sourcesFact(ctx)] })}
      ${secs.length > 1 ? toc(secs.map(s => ({ id: s.id, html: esc(s.title) })), '#/profile') : ''}
      <div class="lr-body">${body}${refs}</div>
    </div>`,
    after(root) { stop = mountReading(root); },
    cleanup() { if (stop) stop(); },
  };
}

// ---------------------------------------------------------------- Search

export function viewSearch(query) {
  const q = (query.get('q') || '').trim();
  const lc = q.toLowerCase();
  const results = [];
  if (lc.length >= 2) {
    const hit = (title, body) => title.toLowerCase().includes(lc) ? 2 : body.toLowerCase().includes(lc) ? 1 : 0;
    const add = (type, href, title, body, score) => score && results.push({ type, href, title, score });
    [...DB.exercises, ...DB.drills].forEach(x => add('Exercise', `#/ex/${x.id}`, x.name, '', hit([x.name, x.loggingName, ...(x.aliases || [])].join(' '), JSON.stringify(x))));
    DB.articles.forEach(a => add('Science', `#/sci/${a.id}`, a.title, '', hit(a.title, JSON.stringify(a))));
    DB.decisions.forEach(d => add('Decision', `#/dec/${d.id}`, d.title, '', hit(d.title, JSON.stringify(d))));
    DB.rules.forEach(r => add('Rule', `#/rule/${r.id}`, r.title, '', hit(r.title, JSON.stringify(r))));
    DB.pages.forEach(p => add('Plan', `#/plan/${p.id}`, p.title, '', hit(p.title, JSON.stringify(p))));
    DB.terms.forEach(t => add('Glossary', `#/glossary`, t.term, '', hit([t.term, ...(t.aliases || [])].join(' '), t.definition || '')));
    phases().forEach(p => add('Phase', `#/phase/${p.id}`, p.name, '', hit(p.name, JSON.stringify(p))));
    DB.references.forEach(r => add('Reference', `#/ref/${r.id}`, `${refShort(r)}: ${r.title}`, '', hit(`${r.authors} ${r.title}`, `${r.journal} ${r.doi} ${r.pmid}`)));
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }
  return {
    title: 'Search',
    html: `<div class="page">
      ${head('', 'Search')}
      <form id="searchForm" role="search"><div class="field"><input type="search" id="sq" value="${esc(q)}" placeholder="Search everything…" aria-label="Search everything" autofocus></div></form>
      ${q ? `<p class="small muted">${results.length} result${results.length === 1 ? '' : 's'}</p>` : ''}
      <div class="card tight search-results"><ul class="list">${results.slice(0, 120).map(r => listItem(r.href, esc(r.title), esc(r.type))).join('') || (q ? '<li class="muted" style="padding:12px">No matches.</li>' : '<li class="muted" style="padding:12px">Type at least two characters.</li>')}</ul></div>
    </div>`,
    after(root) {
      const input = root.querySelector('#sq');
      root.querySelector('#searchForm').addEventListener('submit', e => { e.preventDefault(); });
      let t;
      input.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          history.replaceState(history.state, '', `#/search?q=${encodeURIComponent(input.value)}`);
          window.dispatchEvent(new Event('forge:rerender'));
        }, 300);
      });
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
  };
}

export { DAY_NAMES, todayISO, restLabel };
