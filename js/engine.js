// Programme engine: expands phase templates into concrete weeks and sessions,
// produces transcription text for a workout-logging app, and tracks position/completion.

import { DB } from './content.js';
import { store } from './store.js';
import { restLabel, plain } from './util.js';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const KIND_LABEL = {
  strength: 'Strength', cardio: 'Aerobic', intervals: 'Intervals', mixed: 'Mixed', test: 'Assessment',
  recovery: 'Recovery', skill: 'Skill', rest: 'Rest',
};

export function phases() { return DB.programme.phases || []; }
export function getPhase(id) { return DB.idx.phases.get(id); }
export function phaseIndex(id) { return phases().findIndex(p => p.id === id); }
export function weekCount(phase) { return phase ? (phase.weeks || 1) : 0; }

/** Merge the phase defaults with every week-plan entry that covers week w. */
export function weekPlan(phase, w) {
  const out = { w, sets: {}, rir: {}, params: {}, ...(phase.defaults || {}) };
  out.sets = { ...((phase.defaults || {}).sets || {}) };
  out.rir = { ...((phase.defaults || {}).rir || {}) };
  out.params = { ...((phase.defaults || {}).params || {}) };
  for (const e of phase.weekPlans || []) {
    const covers = e.w != null ? e.w === w : (w >= (e.from ?? 1) && w <= (e.to ?? Infinity));
    if (!covers) continue;
    for (const [k, v] of Object.entries(e)) {
      if (k === 'sets' || k === 'rir' || k === 'params') out[k] = { ...out[k], ...v };
      else if (k !== 'w' && k !== 'from' && k !== 'to') out[k] = v;
    }
  }
  out.w = w;
  return out;
}

/** The energy goal for week w of a phase: the week plan's own (Phase 1 weeks 1–2: calibrate), else the phase's. */
export function energyGoalAt(phase, w) {
  return phase ? (weekPlan(phase, w).energyGoal || phase.energyGoal || '') : '';
}

/** Replace {{param}} placeholders. A string that is exactly "{{x}}" returns the raw value (keeps numbers numeric). */
export function resolveValue(v, params) {
  if (typeof v === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(v);
    if (whole) return params[whole[1]] ?? v;
    return v.replace(/\{\{(\w+)\}\}/g, (m, k) => (params[k] ?? m));
  }
  if (Array.isArray(v)) return v.map(x => resolveValue(x, params));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = resolveValue(x, params);
    return o;
  }
  return v;
}

function inWeeks(item, w) {
  const f = item.weeks;
  if (!f) return true;
  if (Array.isArray(f)) return f.includes(w);
  return w >= (f.from ?? 1) && w <= (f.to ?? Infinity);
}

/** The 7-day schedule for a week: [{dow, sessionId, optional, note}] (sessionId null = rest day). */
export function scheduleFor(phase, w) {
  const plan = weekPlan(phase, w);
  // A week plan may override the phase schedule with one pattern or a list of patterns (cycled by week).
  const override = plan.schedule ? (Array.isArray(plan.schedule[0]) ? plan.schedule : [plan.schedule]) : null;
  const patterns = override || phase.schedule || [];
  const pattern = patterns.length ? patterns[(w - 1) % patterns.length] : [];
  return DAY_NAMES.map((dow, i) => {
    const d = pattern[i];
    if (!d) return { dow, i, sessionId: null };
    if (typeof d === 'string') return { dow, i, sessionId: d, optional: false };
    return { dow, i, sessionId: d.s || null, optional: !!d.optional, note: d.note || '' };
  });
}

export function rirToRpe(rir) {
  if (rir == null || rir === '' || rir === '—' || rir === '-') return '';
  const nums = String(rir).split(/[-–]/).map(s => parseFloat(s)).filter(n => Number.isFinite(n));
  if (!nums.length) return '';
  const rpe = nums.map(n => 10 - n).sort((a, b) => a - b);
  return rpe.length > 1 && rpe[0] !== rpe[rpe.length - 1] ? `${rpe[0]}–${rpe[rpe.length - 1]}` : `${rpe[0]}`;
}

export function effortLabel(rir) {
  if (rir == null || rir === '' || rir === '—' || rir === '-') return '';
  const r = String(rir).replace('-', '–');
  const rpe = rirToRpe(rir);
  return rpe ? `RIR ${r} (RPE ${rpe})` : String(rir);
}

/**
 * A session part may reuse a shared block: {"use": "wu-lower", "add": [...items], "minutes": 9}.
 * Blocks live in programme.blocks and hold {minutes, items, rationale}; "add" appends items.
 */
export function expandPart(part) {
  if (!part) return { items: [] };
  if (!part.use) return { items: [], ...part };
  const block = (DB.programme.blocks || {})[part.use] || { items: [] };
  const { use, add, ...rest } = part;
  return { ...block, ...rest, items: [...(block.items || []), ...(add || [])], block: use };
}

/** Expand one session for a given phase/week into a fully specified object. */
export function resolveSession(phaseId, w, sessionId) {
  const phase = getPhase(phaseId);
  const tpl = DB.idx.sessions.get(sessionId);
  if (!phase || !tpl) return null;
  const plan = weekPlan(phase, w);
  const params = { ...plan.params, week: w };

  const resolvePart = (part, isMain) => {
    const src = expandPart(tpl[part]);
    const items = (src.items || []).filter(it => inWeeks(it, w)).map(raw => {
      const it = resolveValue(raw, params);
      const item = DB.idx.items.get(it.ref) || null;
      const out = { ...it, item };
      if (isMain && it.role) {
        out.sets = it.sets ?? plan.sets[it.role] ?? null;
        out.rir = it.rir ?? plan.rir[it.role] ?? null;
      }
      return out;
    }).filter(it => !(isMain && it.sets === 0));
    return { ...resolveValue(src, params), items };
  };

  const s = {
    id: sessionId, phaseId, week: w, phase, plan,
    name: tpl.name, kind: tpl.kind || 'strength', minutes: tpl.minutes, focus: resolveValue(tpl.focus, params),
    summary: resolveValue(tpl.summary, params), record: resolveValue(tpl.record, params),
    warmup: resolvePart('warmup', false),
    main: resolvePart('main', true),
    cooldown: resolvePart('cooldown', false),
    shortVersion: resolveValue(tpl.shortVersion, params),
    notes: resolveValue(tpl.notes, params),
  };
  s.estimate = estimateMinutes(s);
  return s;
}

// A session item's `logAs` overrides the exercise's logging name (e.g. a gym exercise done at home
// is logged as its "(Away)" copy so the gym history stays clean).
function itemName(it) {
  return it.logAs || (it.item && (it.item.loggingName || it.item.name)) || it.name || it.ref;
}

/** The name to show after "Log as" for a session item: its own Away name (logAs), else the exercise's logging
 *  name when it differs from the name shown; '' when there is nothing to add. Session cards and the player use it. */
export function logAsName(it) {
  const x = it && it.item;
  return (it && it.logAs) || (x && x.loggingName && x.loggingName !== x.name ? x.loggingName : '');
}

function timerSeconds(t) {
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  if (t.type === 'countdown') return +t.seconds || 0;
  if (t.type === 'hold') return (+t.seconds || 0) * (+t.sets || 1) * (t.sides ? 2 : 1) + 10 * (+t.sets || 1);
  if (t.type === 'intervals') {
    const reps = +t.reps || 0;
    return (+t.warmup || 0) + reps * (+t.work || 0) + Math.max(0, reps - 1) * (+t.recover || 0) + (+t.cooldown || 0);
  }
  return 0;
}

/** Rough duration estimate used to check sessions fit the available time window. */
export function estimateMinutes(s) {
  const P = DB.ruleParams.timing || {};
  const workPerSet = P.secondsPerSet ?? 45;
  const transition = P.transitionSeconds ?? 60;
  const rampSet = P.rampSetSeconds ?? 60;
  let sec = 0;
  for (const it of s.warmup.items) sec += timerSeconds(it.timer) || (P.drillSeconds ?? 45);
  const main = s.main.items;
  for (let i = 0; i < main.length; i++) {
    const it = main[i];
    if (it.timer) { sec += timerSeconds(it.timer); continue; }
    // Consecutive items with the same superset letter alternate set by set, exactly as the
    // player runs them: a short transition between partners, the full rest after the last one.
    const group = [it];
    while (it.superset && i + 1 < main.length && main[i + 1].superset === it.superset && !main[i + 1].timer) group.push(main[++i]);
    const rounds = Math.max(...group.map(g => +g.sets || 0));
    const last = group[group.length - 1];
    const rest = typeof last.rest === 'number' ? last.rest : 90;
    for (const g of group) {
      sec += (+g.sets || 0) * workPerSet * (g.perSide ? 2 : 1);
      if (g.warmupSets) sec += (P.rampSets ?? 2) * rampSet;
    }
    sec += rounds * (group.length - 1) * (P.supersetTransitionSeconds ?? 15);
    sec += Math.max(0, rounds - 1) * rest + transition;
  }
  for (const it of s.cooldown.items) sec += timerSeconds(it.timer) || (P.drillSeconds ?? 45);
  return Math.round(sec / 60);
}

export function rxParts(it) {
  const parts = [];
  if (it.sets != null && it.reps != null) parts.push(`${it.sets} × ${String(it.reps).replace('-', '–')}${it.perSide ? ' each side' : ''}`);
  else if (it.dose) parts.push(it.dose);
  const eff = effortLabel(it.rir);
  if (eff) parts.push(eff);
  if (it.rest != null && it.rest !== '') parts.push(`rest ${restLabel(it.rest)}`);
  if (it.tempo) parts.push(`tempo ${it.tempo}`);
  return parts;
}

/** Plain text suitable for pasting into a logging app's routine notes. */
export function sessionText(s) {
  const L = [];
  L.push(`${s.phase.short || s.phase.name} · Week ${s.week} · ${s.name} (≈${s.minutes || s.estimate} min)`);
  if (s.warmup.items.length) {
    L.push('', `WARM-UP (≈${s.warmup.minutes || ''} min)`.replace(' (≈ min)', ''));
    for (const it of s.warmup.items) L.push(`- ${itemName(it)}: ${it.dose || ''}`.trimEnd());
  }
  if (s.main.items.length) {
    L.push('', 'MAIN');
    s.main.items.forEach((it, i) => {
      const ss = it.superset ? ` [superset ${it.superset}]` : '';
      L.push(`${i + 1}. ${itemName(it)} — ${rxParts(it).join(', ')}${ss}`);
      if (it.warmupSets) L.push(`   Ramp-up sets first (${typeof it.warmupSets === 'string' ? it.warmupSets : 'see warm-up set calculator'})`);
      if (it.load) L.push(`   Load: ${plain(it.load)}`);
      if (it.note) L.push(`   Note: ${plain(it.note)}`);
    });
  }
  if (s.cooldown.items.length) {
    L.push('', `COOL-DOWN & STRETCHING (≈${s.cooldown.minutes || ''} min)`.replace(' (≈ min)', ''));
    for (const it of s.cooldown.items) L.push(`- ${itemName(it)}: ${it.dose || ''}`.trimEnd());
  }
  if (s.record) L.push('', `RECORD: ${plain(s.record)}`);
  return L.join('\n');
}

// ---------- Position and completion (stored locally) ----------

export function getPosition() {
  const pos = store.get('position', null);
  if (pos && getPhase(pos.phase)) {
    const max = weekCount(getPhase(pos.phase));
    return { phase: pos.phase, week: Math.min(Math.max(1, pos.week || 1), max) };
  }
  return null;
}

/**
 * Move to a phase and week. Entering an optional phase (Away mode, Maintenance mode) from the main
 * sequence remembers where you were, so you can return in one tap; any other move clears that.
 * `fresh` (and every new visit to an optional phase) archives the target phase's "done" ticks from
 * that week on, so a repeated or restarted block does not show the previous pass as done.
 */
export function setPosition(phase, week, { fresh = false } = {}) {
  const prev = getPosition();
  const target = getPhase(phase);
  const now = new Date().toISOString();
  if (target && target.optional) {
    if (prev && !getPhase(prev.phase).optional) store.set('returnTo', { phase: prev.phase, week: prev.week, left: now });
    if (prev && prev.phase !== phase) fresh = true;
  } else {
    store.remove('returnTo');
  }
  if (fresh) archiveDone(phase, week);
  store.set('position', { phase, week, since: now });
  store.update('history', [], h => [...h, { at: now, phase, week }].slice(-200));
}

/** Where to go back to when leaving an optional phase: {phase, week, left} or null. */
export function getReturnTo() {
  const r = store.get('returnTo', null);
  const p = r && getPhase(r.phase);
  return p && !p.optional ? { phase: r.phase, week: Math.min(Math.max(1, r.week || 1), weekCount(p)), left: r.left || null } : null;
}

const doneKey = (phaseId, w, dayIdx) => `${phaseId}:${w}:${dayIdx}`;

/** Move a phase's "done" ticks from `fromWeek` on into an archive (kept in backups, no longer shown). */
export function archiveDone(phaseId, fromWeek = 1) {
  const done = store.get('done', {});
  const moved = Object.keys(done).filter(k => {
    const [p, w] = k.split(':');
    return p === phaseId && +w >= fromWeek;
  });
  if (!moved.length) return 0;
  const at = new Date().toISOString();
  store.update('doneArchive', [], a => [...a, ...moved.map(key => ({ key, at: done[key], archivedAt: at }))].slice(-2000));
  store.update('done', {}, d => {
    const next = { ...d };
    for (const k of moved) delete next[k];
    return next;
  });
  return moved.length;
}

export function isDone(phaseId, w, dayIdx) {
  return !!store.get('done', {})[doneKey(phaseId, w, dayIdx)];
}

export function setDone(phaseId, w, dayIdx, value) {
  store.update('done', {}, d => {
    const next = { ...d };
    if (value) next[doneKey(phaseId, w, dayIdx)] = new Date().toISOString();
    else delete next[doneKey(phaseId, w, dayIdx)];
    return next;
  });
}

/** Planned (non-optional) sessions and how many are marked done, for one week. */
export function weekAdherence(phase, w) {
  const days = scheduleFor(phase, w).filter(d => d.sessionId && !d.optional);
  const done = days.filter(d => isDone(phase.id, w, d.i)).length;
  return { planned: days.length, done };
}

/** Adherence across weeks 1..uptoWeek of a phase. */
export function phaseAdherence(phase, uptoWeek) {
  let planned = 0, done = 0;
  for (let w = 1; w <= uptoWeek; w++) {
    const a = weekAdherence(phase, w);
    planned += a.planned;
    done += a.done;
  }
  return { planned, done, pct: planned ? Math.round((100 * done) / planned) : null };
}

export function nextPosition(pos) {
  const p = getPhase(pos.phase);
  if (pos.week < weekCount(p)) return { phase: p.id, week: pos.week + 1 };
  // Optional phases (Away mode, Maintenance mode) are entered and left by choice, never by sequence.
  const nextPhase = p.optional ? null : sequentialNeighbour(p.id, +1);
  if (nextPhase) return { phase: nextPhase.id, week: 1 };
  // Cyclic phases repeat; `cycleTo` lets an introductory first week be skipped on later cycles.
  return p.cyclic ? { phase: p.id, week: Math.min(p.cycleTo || 1, weekCount(p)) } : null;
}

/** The next (+1) or previous (-1) phase in the main sequence, skipping optional phases. */
export function sequentialNeighbour(id, dir) {
  const all = phases();
  for (let i = phaseIndex(id) + dir; i >= 0 && i < all.length; i += dir) {
    if (!all[i].optional) return all[i];
  }
  return null;
}
