// Guided session player: walks through warm-up -> main training -> cool-down one step at a time,
// with rest, hold and interval timers. Timers are timestamp-based, so they stay correct when the
// browser throttles background tabs. Screen Wake Lock, Web Audio beeps and vibration are optional
// progressive enhancements; everything works without them.

import { esc, mmss, restLabel, ICONS, toast } from './util.js';
import { store, getSettings } from './store.js';
import { effortLabel, setDone, isDone } from './engine.js';
import { makeCtx } from './content.js';

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

function beep(freq = 880, ms = 160, gain = 0.25) {
  if (!getSettings().sound || !audioCtx) return;
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
  beep(988, 220);
  setTimeout(() => beep(1319, 320), 260);
  if (getSettings().vibrate && navigator.vibrate) {
    try { navigator.vibrate([250, 120, 250]); } catch (e) { /* ignore */ }
  }
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
  constructor({ onTick, onEnd }) {
    this.onTick = onTick || (() => {});
    this.onEnd = onEnd || (() => {});
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
  remaining() { return this.running ? Math.max(0, this.endAt - Date.now()) / 1000 : this.remainingMs / 1000; }
  start() {
    if (this.running) return;
    if (this.remainingMs <= 0) this.remainingMs = this.total * 1000;  // restart a finished timer
    if (this.remainingMs <= 0) return;
    this.endAt = Date.now() + this.remainingMs;
    this.running = true;
    this.lastBeep = null;
    this.handle = setInterval(() => this.tick(), 200);
    this.tick();
  }
  pause() {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.endAt - Date.now());
    this.running = false;
    clearInterval(this.handle);
    this.onTick(this.remaining());
  }
  toggle() { this.running ? this.pause() : this.start(); }
  add(seconds) {
    if (this.running) this.endAt = Math.max(Date.now(), this.endAt + seconds * 1000);
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
      this.running = false;
      clearInterval(this.handle);
      this.remainingMs = 0;
      endSignal();
      this.onEnd();
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
    if (it.timer) { steps.push(...drillSteps('Main training', it)); continue; }
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

// ---------------------------------------------------------------- rendering

const stripP = html => html.replace(/^<p>/, '').replace(/<\/p>$/, '');

export function renderPlayer(root, session, dayIdx, { exitHref }) {
  const steps = buildSteps(session);
  const key = `player:${session.phaseId}:${session.week}:${dayIdx}`;
  const saved = store.get(key, null);
  const resumed = !!(saved && saved.sessionId === session.id && saved.idx > 0);
  let idx = resumed ? Math.min(saved.idx, steps.length) : 0;
  let resting = null;      // {seconds, nextIdx} while a rest period runs
  const doneSteps = new Set(resumed ? saved.done || [] : []);
  const ctx = makeCtx();

  const timer = new Countdown({
    onTick: rem => {
      const t = root.querySelector('#pt');
      if (t) {
        t.textContent = mmss(rem);
        t.classList.toggle('ending', rem > 0 && rem <= 3.5);
      }
      const btn = root.querySelector('[data-p="toggle"]');
      if (btn) btn.textContent = timer.running ? 'Pause' : (rem > 0 && rem < timer.total ? 'Resume' : 'Start');
    },
    onEnd: () => {
      if (resting) { const n = resting.nextIdx; go(n); return; }
      const st = steps[idx];
      if (st && st.autoNext) { doneSteps.add(idx); go(idx + 1, true); } else draw();
    },
  });

  const persist = () => store.set(key, { sessionId: session.id, idx, done: [...doneSteps], at: Date.now() });
  const loadTimer = () => {
    const st = steps[idx];
    timer.set(st && st.timer ? st.timer.seconds : 0);
  };

  function go(n, chained = false) {
    resting = null;
    idx = Math.max(0, Math.min(steps.length, n));
    persist();
    loadTimer();
    draw();
    const st = steps[idx];
    if (chained && st && st.timer && st.autoStart) timer.start();
  }

  function startRest(seconds, nextIdx) {
    idx = nextIdx;
    persist();
    resting = { seconds, nextIdx };
    timer.set(seconds);
    draw();
    if (getSettings().autoRest) timer.start();
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

  function draw() {
    const pct = steps.length ? Math.round((100 * Math.min(idx, steps.length)) / steps.length) : 100;
    let body = '';
    if (resting) {
      const next = steps[resting.nextIdx];
      body = `<div class="player-card">
        <div class="player-section">Rest</div>
        <div class="timer"><div class="t mono" id="pt">${mmss(resting.seconds)}</div>
        <div class="t-label">Next: ${esc(next ? `${next.title}${next.sub ? ' · ' + next.sub : ''}` : 'finish')}</div></div>
        ${timerControls(false)}
        ${next && next.target.length ? `<div class="player-target" style="justify-content:center">${next.target.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="player-actions"><button class="btn" data-p="prev">Back</button><button class="btn primary" data-p="skiprest">Skip rest</button></div>`;
    } else if (idx >= steps.length) {
      const done = isDone(session.phaseId, session.week, dayIdx);
      body = `<div class="player-card">
        <div class="player-section">Finished</div>
        <div class="player-title">Session complete</div>
        ${session.record ? `<p class="muted">Before you close, record your sets in your logging app:</p><div class="md">${ctx.md(session.record)}</div>` : ''}
        <div class="row" style="margin-top:14px">
          <button class="btn primary" data-p="finish">${ICONS.check} ${done ? 'Marked as done' : 'Mark session done'}</button>
          <a class="btn" href="${exitHref}">Back to session</a>
        </div></div>`;
    } else {
      const st = steps[idx];
      const item = st.it.item;
      const phaseChip = st.phase ? `<span class="interval-phase ${st.phase}">${st.phase === 'work' ? 'Work' : st.phase === 'recover' ? 'Recover' : 'Easy'}</span>` : '';
      const cues = item && (item.cues || []).length ? `<ul>${item.cues.slice(0, 5).map(c => `<li>${stripP(ctx.md(c))}</li>`).join('')}</ul>` : '';
      const howTo = item ? `<details><summary>How to do it</summary><div class="details-body md">
          ${cues}
          ${st.it.load ? `<p><strong>Load:</strong> ${stripP(ctx.md(st.it.load))}</p>` : ''}
          ${st.it.note ? `<p><strong>Note:</strong> ${stripP(ctx.md(st.it.note))}</p>` : ''}
          <p><a href="#/ex/${esc(item.id)}">Full technique, common errors and alternatives</a></p></div></details>` : '';
      const timerHtml = st.timer
        ? `<div class="timer"><div class="t mono" id="pt">${mmss(st.timer.seconds)}</div><div class="t-label">${esc(st.timer.label || '')}</div></div>${timerControls(true)}`
        : '';
      const rampLink = st.kind === 'ramp' ? '<p class="small"><a href="#/tool/warmup">Open the ramp-up set calculator</a></p>' : '';
      const primaryLabel = st.kind === 'set'
        ? (st.rest > 0 && !st.isLastSet ? `Set done · rest ${restLabel(st.rest)}` : 'Set done')
        : (st.timer && st.autoNext ? 'Skip' : 'Next');
      body = `<div class="player-card">
        <div class="row between"><div class="player-section">${esc(st.section)}</div>${phaseChip}</div>
        <div class="player-title">${esc(st.title)}</div>
        ${st.sub ? `<div class="player-sub">${esc(st.sub)}</div>` : ''}
        ${st.target.length ? `<div class="player-target">${st.target.map(t => `<span class="chip accent">${esc(t)}</span>`).join('')}</div>` : ''}
        ${timerHtml}${rampLink}
      </div>
      ${howTo}
      <div class="player-actions"><button class="btn" data-p="prev" ${idx === 0 ? 'disabled' : ''}>Back</button>
        <button class="btn primary" data-p="next">${esc(primaryLabel)}</button></div>`;
    }
    root.innerHTML = `<div class="player">
      <div class="player-top">
        <a class="btn small ghost" href="${exitHref}" aria-label="Exit player">${ICONS.close}</a>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Session progress"><span style="width:${pct}%"></span></div>
        <span class="small mono muted">${Math.min(idx + 1, steps.length)}/${steps.length}</span>
      </div>
      ${body}
      <details><summary>All steps</summary><div class="details-body">${stepListHtml()}</div></details>
      <p class="tiny muted">${'wakeLock' in navigator ? 'The screen stays on while the player is open (you can turn this off in Settings).' : 'This browser cannot keep the screen awake automatically; lengthen your screen timeout for workouts.'}</p>
    </div>`;
    timer.onTick(timer.remaining());
  }

  function onClick(e) {
    const a = e.target.closest('[data-p]');
    if (!a || !root.contains(a)) return;
    e.preventDefault();
    ensureAudio();
    const st = steps[idx];
    switch (a.dataset.p) {
      case 'toggle': timer.toggle(); break;
      case 'plus': timer.add(15); break;
      case 'minus': timer.add(-15); break;
      case 'reset': loadTimer(); break;
      case 'prev': go(idx - 1); break;
      case 'skiprest': go(resting ? resting.nextIdx : idx + 1); break;
      case 'jump': go(+a.dataset.i); break;
      case 'next':
        doneSteps.add(idx);
        if (st && st.kind === 'set' && st.rest > 0 && !st.isLastSet) startRest(st.rest, idx + 1);
        else go(idx + 1, true);
        break;
      case 'finish':
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
    }
  };
  root.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisibility);
  acquireWakeLock();
  loadTimer();
  draw();
  if (resumed) toast('Resumed where you left off');

  return () => {
    timer.stop();
    root.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibility);
    releaseWakeLock();
  };
}
