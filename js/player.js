// Guided session player: walks through warm-up -> main training -> cool-down one step at a time,
// with rest, hold and interval timers. Timers are timestamp-based, so they stay correct when the
// browser throttles background tabs, and the running timer is saved with its end time, so it carries
// on across a reload, a page the phone closed in the background, or a visit to another page.
// Screen Wake Lock, Web Audio beeps and vibration are optional progressive enhancements; everything
// works without them.

import { esc, mmss, restLabel, ICONS, toast } from './util.js';
import { store, getSettings } from './store.js';
import { effortLabel, setDone, isDone, logAsName } from './engine.js';
import { makeCtx } from './content.js';
import { sparksFrom } from './fx.js';
import { videoFor } from './video.js';

// ---------------------------------------------------------------- audio / vibration / wake lock

let audioCtx = null;
function ensureAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { audioCtx = null; }
}

/** True once the browser lets the player beep (after a reload, only when the page has been tapped). */
const audioOn = () => !!(audioCtx && audioCtx.state === 'running');

// Callers check their own setting: "Beep when a timer ends" and the last-3-seconds beeps are switched separately.
function beep(freq = 880, ms = 160, gain = 0.25) {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch (e) { /* ignore */ }
}

function endSignal() {
  if (getSettings().sound) {
    beep(988, 220);
    setTimeout(() => beep(1319, 320), 260);
  }
  if (getSettings().vibrate && navigator.vibrate) {
    try { navigator.vibrate([250, 120, 250]); } catch (e) { /* ignore */ }
  }
}

/** After a reload the browser lets the page beep (or vibrate) only once it has been tapped: say so while it matters. */
function tapHint() {
  const s = getSettings();
  if ((s.sound || s.countdownBeeps) && (window.AudioContext || window.webkitAudioContext) && !audioOn()) {
    return navigator.maxTouchPoints > 0 ? 'Tap the screen once so the timer can beep.' : 'Click anywhere once so the timer can beep.';
  }
  const ua = navigator.userActivation;
  if (s.vibrate && navigator.vibrate && /Android/i.test(navigator.userAgent) && ua && !ua.hasBeenActive) {
    return 'Tap the screen once so the timer can vibrate.';
  }
  return '';
}

let wakeLock = null;
async function acquireWakeLock() {
  if (!getSettings().wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) { wakeLock = null; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
  wakeLock = null;
}

// ---------------------------------------------------------------- timer

export class Countdown {
  /** `now` returns the time in ms: Date.now by default; the tests pass a fake clock. */
  constructor({ onTick, onEnd, now } = {}) {
    this.onTick = onTick || (() => {});
    this.onEnd = onEnd || (() => {});
    this.now = now || (() => Date.now());
    this.total = 0;
    this.remainingMs = 0;
    this.endAt = 0;
    this.running = false;
    this.lastBeep = null;
    this.handle = null;
  }
  /** Load a new duration (stops any running countdown). */
  set(seconds) {
    this.stop();
    this.total = seconds;
    this.remainingMs = seconds * 1000;
    this.onTick(this.remaining());
  }
  remaining() { return this.running ? Math.max(0, this.endAt - this.now()) / 1000 : this.remainingMs / 1000; }
  start() {
    if (this.running) return;
    if (this.remainingMs <= 0) this.remainingMs = this.total * 1000;  // restart a finished timer
    if (this.remainingMs <= 0) return;
    this.runUntil(this.now() + this.remainingMs);
  }
  /** Pick up a saved timer: running until `endAt` (ms), or paused with `remainingMs` left. */
  restore({ total, endAt = null, remainingMs = 0 }) {
    this.stop();
    this.total = total;
    if (endAt != null) { this.runUntil(endAt); return; }
    this.remainingMs = Math.max(0, remainingMs);
    this.onTick(this.remaining());
  }
  /** What to save: { total, endAt } while running, { total, remainingMs } when paused. */
  snapshot() {
    return this.running ? { total: this.total, endAt: this.endAt } : { total: this.total, remainingMs: Math.round(this.remainingMs) };
  }
  runUntil(endAt) {
    this.endAt = endAt;
    this.running = true;
    this.lastBeep = null;
    clearInterval(this.handle);
    this.handle = setInterval(() => this.tick(), 200);
    this.tick();
  }
  pause() {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.endAt - this.now());
    this.running = false;
    clearInterval(this.handle);
    this.onTick(this.remaining());
  }
  toggle() { this.running ? this.pause() : this.start(); }
  add(seconds) {
    if (this.running) this.endAt = Math.max(this.now(), this.endAt + seconds * 1000);
    else this.remainingMs = Math.max(0, this.remainingMs + seconds * 1000);
    this.total = Math.max(this.total, this.remaining());
    this.onTick(this.remaining());
  }
  tick() {
    const rem = this.remaining();
    const whole = Math.ceil(rem);
    if (getSettings().countdownBeeps && this.running && whole <= 3 && whole >= 1 && this.lastBeep !== whole) {
      this.lastBeep = whole;
      beep(660, 90, 0.18);
    }
    this.onTick(rem);
    if (rem <= 0 && this.running) {
      const endAt = this.endAt;
      this.running = false;
      clearInterval(this.handle);
      this.remainingMs = 0;
      // The owner signals the end: one noticed late (the page was asleep) is shown on the card instead.
      this.onEnd({ endAt, lateMs: Math.max(0, this.now() - endAt) });
    }
  }
  stop() { this.running = false; clearInterval(this.handle); this.lastBeep = null; }
}

// ---------------------------------------------------------------- step generation

function itemTitle(it) {
  return (it.item && it.item.name) || it.name || it.ref;
}

function holdSteps(section, it, t) {
  const steps = [];
  const sets = +t.sets || 1;
  const sides = t.sides ? ['Left side', 'Right side'] : [''];
  for (let s = 1; s <= sets; s++) {
    for (const side of sides) {
      steps.push({
        section, kind: 'hold', it, title: itemTitle(it),
        sub: [sets > 1 ? `Hold ${s} of ${sets}` : 'Hold', side].filter(Boolean).join(' · '),
        target: [it.dose].filter(Boolean),
        timer: { seconds: +t.seconds || 30, label: side || 'Hold' },
        autoStart: steps.length > 0, autoNext: true,
      });
    }
  }
  return steps;
}

function intervalSteps(section, it, t) {
  const steps = [];
  const add = (seconds, phase, label) => {
    if (!(seconds > 0)) return;
    steps.push({
      section, kind: 'interval', it, title: itemTitle(it), sub: label, phase,
      target: [], timer: { seconds, label }, autoStart: steps.length > 0, autoNext: true,
    });
  };
  add(+t.warmup, 'easy', t.warmupLabel || 'Easy warm-up');
  const reps = +t.reps || 0;
  for (let r = 1; r <= reps; r++) {
    add(+t.work, 'work', `${t.workLabel || 'Work'} · ${r} of ${reps}`);
    if (r < reps) add(+t.recover, 'recover', `${t.recoverLabel || 'Recover'} · ${r} of ${reps - 1}`);
  }
  add(+t.cooldown, 'easy', t.cooldownLabel || 'Easy cool-down');
  return steps;
}

function drillSteps(section, it) {
  const t = it.timer;
  if (t && typeof t === 'object' && t.type === 'hold') return holdSteps(section, it, t);
  if (t && typeof t === 'object' && t.type === 'intervals') return intervalSteps(section, it, t);
  const seconds = typeof t === 'number' ? t : t && t.type === 'countdown' ? +t.seconds : 0;
  return [{
    section, kind: 'drill', it, title: itemTitle(it), sub: '', target: [it.dose].filter(Boolean),
    timer: seconds > 0 ? { seconds, label: t && t.label ? t.label : 'Time' } : null,
  }];
}

export function buildSteps(session) {
  const steps = [];
  for (const it of session.warmup.items) steps.push(...drillSteps('Warm-up', it));

  const main = session.main.items;
  for (let i = 0; i < main.length; i++) {
    const it = main[i];
    // Timed items run their timer; items without sets (the tests on a test day) are one step each, like a drill.
    if (it.timer || !(+it.sets > 0)) { steps.push(...drillSteps('Main training', it)); continue; }
    // Consecutive items sharing a superset letter alternate set by set.
    const group = [it];
    while (it.superset && i + 1 < main.length && main[i + 1].superset === it.superset && !main[i + 1].timer) group.push(main[++i]);
    for (const g of group) {
      if (g.warmupSets) {
        steps.push({
          section: 'Main training', kind: 'ramp', it: g, title: itemTitle(g), sub: 'Ramp-up sets',
          target: [typeof g.warmupSets === 'string' ? g.warmupSets : '2–3 lighter sets of decreasing reps'],
          timer: null,
        });
      }
    }
    const maxSets = Math.max(...group.map(g => +g.sets || 0));
    for (let s = 1; s <= maxSets; s++) {
      group.forEach((g, gi) => {
        if (s > (+g.sets || 0)) return;
        const lastInGroup = gi === group.length - 1;
        const reps = g.reps != null ? `${String(g.reps).replace('-', '–')} reps${g.perSide ? ' each side' : ''}` : (g.dose || '');
        steps.push({
          section: 'Main training', kind: 'set', it: g, title: itemTitle(g),
          sub: `${group.length > 1 ? `Superset ${g.superset}${gi + 1} · ` : ''}Set ${s} of ${g.sets}`,
          target: [reps, effortLabel(g.rir), g.tempo ? `tempo ${g.tempo}` : ''].filter(Boolean),
          rest: lastInGroup ? (typeof g.rest === 'number' ? g.rest : 0) : (g.transition ?? 15),
          isLastSet: s === maxSets && lastInGroup,
        });
      });
    }
  }
  for (const it of session.cooldown.items) steps.push(...drillSteps('Cool-down & stretching', it));
  return steps;
}

// ---------------------------------------------------------------- saved progress

// A session left part-way is picked up again within this time. Older progress belongs to an earlier pass
// through a week that repeats (Maintenance mode, Away mode, Phase 4), so the session starts over.
export const RESUME_HOURS = 12;
// A saved timer that ended, or was paused, longer ago than this is not put back: its step opens as new.
// It counts from the end, so a long timer that is still running is always picked up.
export const TIMER_KEEP_MIN = 30;
// An end noticed later than this (the page was asleep or closed) is shown on the card rather than signalled.
const LATE_MS = 2000;

/** The steps' shape (kinds, timers, rests): a saved timer is put back only onto the same steps. */
export function stepsShape(steps) {
  const s = steps.map(st => `${st.kind}:${st.timer ? st.timer.seconds : ''}:${st.autoStart ? 'a' : ''}:${st.rest || ''}`).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return `${steps.length}.${h.toString(36)}`;
}

/** True when saved progress is recent enough, and for the same session, to pick up again: a step past the
 *  first, or a timer started on the first. */
export function canResume(saved, sessionId, now = Date.now()) {
  return !!(saved && saved.sessionId === sessionId && (saved.idx > 0 || (saved.v === 2 && !!saved.timer)) &&
    now - (saved.at || 0) < RESUME_HOURS * 3600000);
}

/**
 * A run of holds or interval blocks moves on by itself: a step that ends (autoNext) starts the next one
 * (autoStart) at that moment. Given that step `idx` ended at `endAt`, where the run stands at `now`:
 * { idx, done, endAt } (endAt: when the step now running ends) or, when the run is over,
 * { idx: the step after it, done, endAt: null, endedAt: when its last block ended }.
 */
export function advanceRun(steps, idx, endAt, now) {
  const done = [];
  let i = idx, end = endAt;
  for (;;) {
    done.push(i);
    const next = steps[i + 1];
    if (!(next && next.autoStart && next.timer)) return { idx: i + 1, done, endAt: null, endedAt: end };
    i += 1;
    end += next.timer.seconds * 1000;
    if (end > now) return { idx: i, done, endAt: end, endedAt: null };
  }
}

/** The saved timer if it can be trusted: the same steps, sensible numbers, on a step that has it. */
function savedTimer(saved, idx, steps, now) {
  const t = saved.v === 2 && saved.shape === stepsShape(steps) ? saved.timer : null;
  if (!t || typeof t !== 'object' || !(t.total > 0 && t.total <= 21600)) return null;
  if (Number.isFinite(t.endAt)) {
    if (t.endAt - now > t.total * 1000 + 2000) return null;      // the clock went back: what is left is unknown
  } else if (!(t.remainingMs >= 0 && t.remainingMs <= t.total * 1000)) return null;
  if (t.kind === 'rest') return t.nextIdx === idx ? t : null;    // a rest may lead into any kind of step
  if (t.kind === 'step') return steps[idx] && steps[idx].timer ? t : null;
  return null;
}

/**
 * Where saved progress stands at `now`: the step, the steps done, the rest or timer to put back, and a note on
 * what happened while you were away. Entries from before 1.5.0, and timers that cannot be trusted, give the step
 * as before. Returns { idx, done, rest, timer, note, moved }:
 *   rest  { seconds, nextIdx } when the rest screen reopens
 *   timer { total, endAt } (running) or { total, remainingMs } (paused); null: the step's timer loads as new
 *   note  { kind: 'rest' | 'timer', endedAt } | { kind: 'run', title, endedAt } | { kind: 'running' } | null
 *   moved true when a run of holds or blocks moved on, so the new position must be saved
 */
export function resumePoint(saved, steps, now = Date.now()) {
  const idx = Math.min(Math.max(0, Math.floor(+saved.idx || 0)), steps.length);
  const done = Array.isArray(saved.done) ? saved.done : [];
  const plain = { idx, done, rest: null, timer: null, note: null, moved: false };
  const t = savedTimer(saved, idx, steps, now);
  if (!t) return plain;
  const keep = TIMER_KEEP_MIN * 60000;
  const rest = t.kind === 'rest' ? { seconds: t.total, nextIdx: idx } : null;
  if (t.endAt == null) {                                          // paused
    return now - (saved.at || 0) > keep ? plain : { ...plain, rest, timer: { total: t.total, remainingMs: t.remainingMs } };
  }
  if (t.endAt > now) return { ...plain, rest, timer: { total: t.total, endAt: t.endAt } };   // still running
  if (rest) return now - t.endAt > keep ? plain : { ...plain, note: { kind: 'rest', endedAt: t.endAt } };
  const st = steps[idx];
  if (!st.autoNext) {                                             // a drill's timer stays on its step at 0:00
    return now - t.endAt > keep ? plain : { ...plain, timer: { total: t.total, remainingMs: 0 }, note: { kind: 'timer', title: st.title, endedAt: t.endAt } };
  }
  const r = advanceRun(steps, idx, t.endAt, now);
  if (!r.endAt && now - r.endedAt > keep) return plain;
  const doneAll = [...new Set([...done, ...r.done])];
  return r.endAt
    ? { idx: r.idx, done: doneAll, rest: null, timer: { total: steps[r.idx].timer.seconds, endAt: r.endAt }, note: { kind: 'running', title: st.title }, moved: true }
    : { idx: r.idx, done: doneAll, rest: null, timer: null, note: { kind: 'run', title: st.title, endedAt: r.endedAt }, moved: true };
}

/** Saved progress for `session`, moved on to `now`, or null when the player would start afresh: step 1 with nothing
 *  left to put back, or a session you finished and have ticked done. */
function resumeFrom(saved, session, steps, dayIdx, now = Date.now()) {
  if (!canResume(saved, session.id, now)) return null;
  const p = resumePoint(saved, steps, now);
  if (!(p.idx > 0 || p.timer)) return null;
  if (p.idx >= steps.length && isDone(session.phaseId, session.week, dayIdx)) return null;
  return p;
}

const playerKey = (session, dayIdx) => `player:${session.phaseId}:${session.week}:${dayIdx}`;

/** For the start buttons: where the guided player would pick this session up ({ step, of }, 1-based), or null. */
export function resumeInfo(session, dayIdx, now = Date.now()) {
  if (!session || !session.phaseId) return null;
  const steps = buildSteps(session);
  const p = resumeFrom(store.get(playerKey(session, dayIdx), null), session, steps, dayIdx, now);
  return p ? { step: Math.min(p.idx + 1, steps.length), of: steps.length, finished: p.idx >= steps.length } : null;
}

/** How long ago, in the player's notes: "just now", "40 s ago", "3 min ago". */
export function agoLabel(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ago` : 'over an hour ago';
}

/** The line on the card after you come back: what the timers did while you were away. */
export function awayNote(note, now = Date.now()) {
  if (note.kind === 'running') return `${note.title} kept running while you were away. This is the part running now.`;
  return `${note.kind === 'rest' ? 'Rest' : note.title} ended ${agoLabel(now - note.endedAt)}.`;
}

// Leaving the player for another page of the app (an exercise page, search) with a timer running keeps one
// alarm for its end (for a run of holds or interval blocks, the end of the run): the usual signal and a message
// with a way back. Being on Today, the session page or another session counts as stopping, both when you leave
// and when the alarm is due; so does ticking the session done. Nothing survives a reload; the player is right
// when it opens again.
let awayAlarm = 0;
function clearAwayAlarm() { clearTimeout(awayAlarm); awayAlarm = 0; }
const stoppingRoute = () => { const route = location.hash.replace(/^#\/?/, ''); return route === '' || /^(today|s|play)(\/|$)/.test(route); };
function armAwayAlarm({ endAt, rest, title, phaseId, week, dayIdx }, href) {
  clearAwayAlarm();
  if (stoppingRoute()) return;
  const ms = endAt - Date.now();
  if (!(ms > 0)) return;
  awayAlarm = setTimeout(() => {
    awayAlarm = 0;
    if (stoppingRoute() || isDone(phaseId, week, dayIdx)) return;
    // Noticed late while you are looking (the page was asleep): say when it ended, as the player does, without a beep.
    const lateMs = Date.now() - endAt;
    const late = lateMs > LATE_MS && document.visibilityState === 'visible';
    if (!late) endSignal();
    const what = rest ? 'Rest' : title;
    const msg = late ? `${what} ended ${agoLabel(lateMs)}.` : rest ? 'Rest over.' : `Timer finished: ${title}.`;
    const show = () => toast(msg, 10000, { label: 'Back to the player', run: () => { location.hash = href; } });
    // Never replace an Undo that is on screen: show this once that has gone.
    const t = document.getElementById('toast');
    if (t && t.classList.contains('show') && t.classList.contains('has-action')) setTimeout(show, 6500); else show();
  }, ms);
}

// ---------------------------------------------------------------- rendering

const stripP = html => html.replace(/^<p>/, '').replace(/<\/p>$/, '');

export function renderPlayer(root, session, dayIdx, { exitHref }) {
  const steps = buildSteps(session);
  const shape = stepsShape(steps);
  const key = playerKey(session, dayIdx);
  const playHref = `#/play/${session.phaseId}/${session.week}/${dayIdx}`;
  const saved = store.get(key, null);
  // Saved progress is moved on to now; a session you finished and ticked done starts afresh.
  const from = resumeFrom(saved, session, steps, dayIdx);
  if (saved && !from) store.remove(key);
  let idx = 0;
  let resting = null;      // {seconds, nextIdx} while a rest period runs
  let note = null;         // what the timers did while you were away; shown until you press a button
  let savedAt = 0;         // when progress was last saved
  const doneSteps = new Set();
  const ctx = makeCtx();
  clearAwayAlarm();

  const timer = new Countdown({
    onTick: rem => {
      const t = root.querySelector('#pt');
      if (t) {
        t.textContent = mmss(rem);
        t.classList.toggle('ending', rem > 0 && rem <= 3.5);
      }
      // The ring's arc is the fraction of time left.
      const ring = root.querySelector('.ring');
      if (ring) ring.style.setProperty('--f', timer.total > 0 ? Math.max(0, Math.min(1, rem / timer.total)).toFixed(4) : '0');
      const btn = root.querySelector('[data-p="toggle"]');
      if (btn) btn.textContent = timer.running ? 'Pause' : (rem > 0 && rem < timer.total ? 'Resume' : 'Start');
      // The "tap the screen" line goes once the timer can be heard (or felt).
      const tap = root.querySelector('.player-tap');
      if (tap && !tapHint()) tap.remove();
      // A demo sheet opened from the rest card says how the rest stands (js/app.js, js/video.js): counting,
      // paused part-way, not started (as the Start/Resume button decides), or over.
      const clock = document.querySelector('#sheet:not([hidden]) [data-player-clock]');
      if (clock) {
        const t = `<span class="mono">${mmss(rem)}</span>`;
        clock.innerHTML = `Next exercise · ${!resting ? 'rest over' : timer.running ? `rest left ${t}`
          : rem > 0 && rem < timer.total ? `rest paused · ${t} left` : `rest not started · ${t}`}`;
      }
    },
    onEnd: ({ endAt, lateMs }) => {
      if (lateMs > LATE_MS) {
        // Noticed late (the page was asleep): work out where things stand now, exactly as when the player
        // opens, and signal only if you are not looking.
        if (document.visibilityState === 'hidden') endSignal();
        const ended = resting ? { kind: 'rest', nextIdx: resting.nextIdx, total: timer.total, endAt } : { kind: 'step', total: timer.total, endAt };
        apply(resumePoint({ v: 2, shape, idx, done: [...doneSteps], at: savedAt, timer: ended }, steps));
        return;
      }
      endSignal();
      if (resting) { go(resting.nextIdx); return; }
      const st = steps[idx];
      if (st && st.autoNext) {
        // The next block starts when this one ended, not when the end was noticed.
        const r = advanceRun(steps, idx, endAt, Date.now());
        r.done.forEach(i => doneSteps.add(i));
        go(r.idx, { endAt: r.endAt });
      } else draw();
    },
  });

  // `at` is your last action in the player (the 12-hour resume window counts from it): a catch-up keeps it.
  const persist = ({ keepAt = false } = {}) => {
    if (!keepAt) savedAt = Date.now();
    store.set(key, { v: 2, sessionId: session.id, idx, done: [...doneSteps], shape, at: savedAt, timer: timerState() });
  };
  const loadTimer = () => {
    const st = steps[idx];
    timer.set(st && st.timer ? st.timer.seconds : 0);
  };

  /** The timer to save: a rest, or the step's own timer once started (one never started loads as new anyway). */
  function timerState() {
    if (resting) return { kind: 'rest', nextIdx: resting.nextIdx, ...timer.snapshot() };
    const st = steps[idx];
    if (!st || !st.timer) return null;
    const s = timer.snapshot();
    return s.endAt == null && s.total === st.timer.seconds && s.remainingMs === s.total * 1000 ? null : { kind: 'step', ...s };
  }

  /** Put the player where `p` (from resumePoint) says things stand. */
  function apply(p) {
    idx = p.idx;
    resting = p.rest;
    note = p.note;
    p.done.forEach(i => doneSteps.add(i));
    if (p.timer) timer.restore(p.timer); else loadTimer();
    if (p.moved) persist({ keepAt: true });
    draw();
  }

  function go(n, { chained = false, endAt = null, note: why = null } = {}) {
    resting = null;
    note = why;
    idx = Math.max(0, Math.min(steps.length, n));
    const st = steps[idx];
    if (endAt != null && st && st.timer) timer.restore({ total: st.timer.seconds, endAt });   // started when the last block ended
    else {
      loadTimer();
      if (chained && st && st.timer && st.autoStart) timer.start();
    }
    persist();     // after the timer is settled, so a started block is saved with its end time
    draw();
  }

  function startRest(seconds, nextIdx) {
    idx = nextIdx;
    note = null;
    resting = { seconds, nextIdx };
    timer.set(seconds);
    if (getSettings().autoRest) timer.start();
    persist();
    draw();
  }

  function stepListHtml() {
    let html = '<ol class="list step-list">';
    let sec = '';
    steps.forEach((s, i) => {
      if (s.section !== sec) { sec = s.section; html += `<li class="eyebrow" style="margin-top:10px;border:0">${esc(sec)}</li>`; }
      const cls = i === idx ? 'current' : doneSteps.has(i) ? 'done' : '';
      html += `<li style="border:0"><a href="#" class="${cls}" data-p="jump" data-i="${i}"><span class="mono">${i + 1}</span><span>${esc(s.title)}${s.sub ? ' · ' + esc(s.sub) : ''}</span></a></li>`;
    });
    return html + '</ol>';
  }

  function timerControls(withReset) {
    return `<div class="timer-controls">
      <button class="btn" data-p="minus" aria-label="Subtract 15 seconds">−15 s</button>
      <button class="btn primary" data-p="toggle">Start</button>
      <button class="btn" data-p="plus" aria-label="Add 15 seconds">+15 s</button>
      ${withReset ? '<button class="btn ghost" data-p="reset">Reset</button>' : ''}
    </div>`;
  }

  /**
   * A step's target. Sets: the rep range set large (readable from arm's length), effort and tempo as
   * chips. Drills, holds and intervals: the dose as text, which can be a full sentence.
   */
  function targetHtml(st, { compact = false } = {}) {
    if (!st.target.length) return '';
    if (st.kind === 'set') {
      const m = compact ? null : /^(.+?)\s+(reps(?: each side)?)$/.exec(st.target[0]);
      const chips = m ? st.target.slice(1) : st.target;
      return `${m ? `<div class="player-rx"><span class="rx-n">${esc(m[1])}</span><span class="rx-u">${esc(m[2])}</span></div>` : ''}
        ${chips.length ? `<div class="player-target">${chips.map(t => `<span class="chip accent">${esc(t)}</span>`).join('')}</div>` : ''}`;
    }
    return st.target.map(t => `<p class="player-dose">${esc(t)}</p>`).join('');
  }

  /** The name to log a step under in the logging app, as on session cards: main-training sets and ramp-ups. */
  function logAsHtml(st) {
    const name = st && (st.kind === 'set' || st.kind === 'ramp') ? logAsName(st.it) : '';
    if (!name) return '';
    return `<p class="player-logas">Log as: <b>${esc(name)}</b>${st.kind === 'ramp' ? ', marked as warm-up sets' : ''}</p>`;
  }

  /** The movement's demonstration video, opened in a sheet over the player by js/app.js (the timer keeps running). */
  function demoButton(st, { rest = false } = {}) {
    const item = st && st.it.item;
    if (!item || !videoFor(item.id)) return '';
    return `<button class="btn small player-demo" type="button" data-demo="${esc(item.id)}"${rest ? ' data-demo-rest' : ''} aria-haspopup="dialog">${ICONS.play}<span>Demo</span><span class="sr-only"> video: ${esc(st.title)}${rest ? ', next exercise' : ''}</span></button>`;
  }

  /** "How to do it" for a step: its cues and the session's load and note. On the rest card it is the next step's. */
  function howToHtml(st, { rest = false, open = false } = {}) {
    const item = st && st.it.item;
    if (!item) return '';
    const cues = (item.cues || []).length ? `<ul>${item.cues.slice(0, 5).map(c => `<li>${stripP(ctx.md(c))}</li>`).join('')}</ul>` : '';
    return `<details class="player-howto"${open ? ' open' : ''}><summary>${rest ? `How to do it: ${esc(st.title)}` : 'How to do it'}</summary><div class="details-body md">
        ${cues}
        ${st.it.load ? `<p><strong>Load:</strong> ${stripP(ctx.md(st.it.load))}</p>` : ''}
        ${st.it.note ? `<p><strong>Note:</strong> ${stripP(ctx.md(st.it.note))}</p>` : ''}
        <p><a href="#/ex/${esc(item.id)}">Full technique, common errors and alternatives</a></p></div></details>`;
  }

  /** True on an exercise's first step in this session. */
  const isFirstOf = i => steps.findIndex(s => s.it === steps[i].it) === i;

  function draw() {
    const pct = steps.length ? Math.round((100 * Math.min(idx, steps.length)) / steps.length) : 100;
    const hint = timer.running ? tapHint() : '';
    const tapHtml = hint ? `<p class="player-tap">${esc(hint)}</p>` : '';
    const awayHtml = note ? `<p class="player-away" role="status">${esc(awayNote(note))}</p>` : '';
    let body = '';
    if (resting) {
      const next = steps[resting.nextIdx];
      // You log the set you just finished during the rest; everything else on the card is about the next step.
      const prev = steps[resting.nextIdx - 1];
      const logged = prev && prev.kind === 'set' ? logAsName(prev.it) : '';
      const demo = next ? demoButton(next, { rest: true }) : '';
      body = `<div class="player-card steel is-rest">
        <div class="player-head"><div class="player-section">Rest</div>${demo ? `<div class="player-head-end">${demo}</div>` : ''}</div>
        ${logged ? `<p class="player-logas">Log this set as: <b>${esc(logged)}</b></p>` : ''}
        <div class="timer"><div class="ring cooling"><div class="t mono" id="pt">${mmss(resting.seconds)}</div></div></div>
        <p class="player-next">Next: ${next ? `<strong>${esc(next.title)}</strong>${next.sub ? ' · ' + esc(next.sub) : ''}` : 'finish'}</p>
        ${timerControls(false)}${tapHtml}
        ${next ? targetHtml(next, { compact: true }) : ''}
      </div>
      ${next ? howToHtml(next, { rest: true, open: isFirstOf(resting.nextIdx) }) : ''}
      <div class="player-actions"><button class="btn" data-p="prev">Back</button><button class="btn primary" data-p="skiprest">Skip rest</button></div>`;
    } else if (idx >= steps.length) {
      const done = isDone(session.phaseId, session.week, dayIdx);
      body = `<div class="player-card steel player-finish">
        <div class="player-section">Finished</div>
        ${awayHtml}
        <div class="player-title">Session complete</div>
        ${session.record ? `<p class="muted">Before you close, record your sets in your logging app:</p><div class="md">${ctx.md(session.record)}</div>` : ''}
        <div class="row" style="margin-top:18px">
          <button class="btn primary big" data-p="finish">${ICONS.check} ${done ? 'Marked as done' : 'Mark session done'}</button>
          <a class="btn big" href="${exitHref}">Back to session</a>
        </div></div>`;
    } else {
      const st = steps[idx];
      const phaseChip = st.phase ? `<span class="interval-phase ${st.phase}">${st.phase === 'work' ? 'Work' : st.phase === 'recover' ? 'Recover' : 'Easy'}</span>` : '';
      const demo = demoButton(st);
      // Work and holds burn in the phase colour; recovery is cool steel; easy stretches are neutral.
      const ringKind = st.phase === 'recover' ? ' recover' : st.phase === 'easy' ? ' easy' : '';
      const timerHtml = st.timer
        ? `<div class="timer"><div class="ring${ringKind}"><div class="t mono" id="pt">${mmss(st.timer.seconds)}</div></div><div class="t-label">${esc(st.timer.label || '')}</div></div>${timerControls(true)}`
        : '';
      const rampLink = st.kind === 'ramp' ? '<p class="small"><a href="#/tool/warmup">Open the ramp-up set calculator</a></p>' : '';
      const primaryLabel = st.kind === 'set'
        ? (st.rest > 0 && !st.isLastSet ? `Set done · rest ${restLabel(st.rest)}` : 'Set done')
        : (st.timer && st.autoNext ? 'Skip' : 'Next');
      body = `<div class="player-card steel is-${esc(st.kind)}">
        <div class="player-head"><div class="player-section">${esc(st.section)}</div>${demo ? `<div class="player-head-end">${phaseChip}${demo}</div>` : phaseChip}</div>
        ${awayHtml}
        <div class="player-title">${esc(st.title)}</div>
        ${st.sub ? `<div class="player-sub">${esc(st.sub)}</div>` : ''}
        ${logAsHtml(st)}
        ${targetHtml(st)}
        ${timerHtml}${tapHtml}${rampLink}
      </div>
      ${howToHtml(st)}
      <div class="player-actions"><button class="btn" data-p="prev" ${idx === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn primary" data-p="next">${esc(primaryLabel)}</button></div>`;
    }
    // The week's own instructions (e.g. fewer sets, more reps in reserve) override the usual targets: open at the start.
    const notes = session.plan && session.plan.notes;
    const weekHtml = notes ? `<details class="player-week"${idx === 0 && !resting ? ' open' : ''}><summary>This week</summary><div class="details-body md">${ctx.md(notes)}</div></details>` : '';
    root.innerHTML = `<div class="player">
      <div class="player-top">
        <a class="btn small ghost" href="${exitHref}" aria-label="Exit player">${ICONS.close}</a>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Session progress"><span style="width:${pct}%"></span></div>
        <span class="player-count">${Math.min(idx + 1, steps.length)}/${steps.length}</span>
      </div>
      ${body}
      ${weekHtml}
      <details><summary>All steps</summary><div class="details-body">${stepListHtml()}</div></details>
      <p class="tiny muted player-note">${'wakeLock' in navigator ? 'The screen stays on while the player is open (you can turn this off in Settings).' : 'This browser cannot keep the screen awake automatically; lengthen your screen timeout for workouts.'}</p>
    </div>`;
    timer.onTick(timer.remaining());
  }

  function onClick(e) {
    // The rest card's Demo opens a sheet (js/app.js, after this handler): then say how the rest stands in it.
    if (e.target.closest('[data-demo-rest]')) setTimeout(() => timer.onTick(timer.remaining()));
    const a = e.target.closest('[data-p]');
    if (!a || !root.contains(a)) return;
    e.preventDefault();
    if (note) { note = null; const n = root.querySelector('.player-away'); if (n) n.remove(); }
    const st = steps[idx];
    switch (a.dataset.p) {
      case 'toggle': timer.toggle(); persist(); break;
      case 'plus': timer.add(15); persist(); break;
      case 'minus': timer.add(-15); persist(); break;
      case 'reset': loadTimer(); persist(); break;
      case 'prev': go(idx - 1); break;
      case 'skiprest': go(resting ? resting.nextIdx : idx + 1); break;
      case 'jump': go(+a.dataset.i); break;
      case 'next':
        doneSteps.add(idx);
        if (st && st.kind === 'set') sparksFrom(a, { count: 7, reach: 48 });
        if (st && st.kind === 'set' && st.rest > 0 && !st.isLastSet) startRest(st.rest, idx + 1);
        else go(idx + 1, { chained: true });
        break;
      case 'finish':
        sparksFrom(a, { count: 26, reach: 110, spread: 200 });
        setDone(session.phaseId, session.week, dayIdx, true);
        store.remove(key);
        toast('Session marked as done');
        draw();
        break;
      default: break;
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      acquireWakeLock();
      if (timer.running) timer.tick(); else timer.onTick(timer.remaining());
      const el = root.querySelector('.player-away');
      if (el && note) el.textContent = awayNote(note);
    }
  };
  // After a reload the browser allows sound only once the page has been tapped: any tap or key, anywhere on the
  // page (the top bar too), turns it on. If the page has been tapped already, it can start now.
  const onAnyInput = () => ensureAudio();
  root.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('click', onAnyInput, true);
  document.addEventListener('keydown', onAnyInput, true);
  if (!navigator.userActivation || navigator.userActivation.hasBeenActive) ensureAudio();
  acquireWakeLock();
  if (from) {
    savedAt = saved.at || 0;
    apply(from);
    toast('Resumed where you left off');
  } else {
    loadTimer();
    draw();
  }

  return () => {
    const st = steps[idx];
    const endAt = timer.running && !resting && st && st.autoNext ? advanceRun(steps, idx, timer.endAt, Infinity).endedAt : timer.endAt;
    const ending = timer.running ? { endAt, rest: !!resting, title: st ? st.title : '', phaseId: session.phaseId, week: session.week, dayIdx } : null;
    timer.stop();
    root.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('click', onAnyInput, true);
    document.removeEventListener('keydown', onAnyInput, true);
    releaseWakeLock();
    if (ending) armAwayAlarm(ending, playHref);
  };
}
