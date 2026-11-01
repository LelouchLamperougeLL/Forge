// Pure calculation functions used by the tools. No DOM access, so they can be unit-tested
// (see tests/index.html). Rule parameters come from content/rules.json ("params"); the
// defaults below are only fallbacks and are kept in sync with that file.

import { roundTo, floorTo, mean, slope, todayISO, thousands } from './util.js';

// ---------------------------------------------------------------- strength

/** Estimated 1RM from a set. `rir` adds the reps that were left in reserve. */
export function e1rm(load, reps, rir = 0) {
  const r = Math.max(1, (+reps || 0) + (+rir || 0));
  if (!(load > 0)) return null;
  const epley = r === 1 ? load : load * (1 + r / 30);
  const brzycki = r === 1 ? load : r < 37 ? load * 36 / (37 - r) : NaN;
  const vals = [epley, brzycki].filter(Number.isFinite);
  return {
    epley, brzycki,
    mean: mean(vals),
    low: Math.min(...vals),
    high: Math.max(...vals),
    repsToFailure: r,
    reliable: r <= 10,
  };
}

/** Load expected to allow `reps` with `rir` in reserve, given an estimated 1RM (inverse Epley). */
export function loadForReps(oneRm, reps, rir = 0) {
  const r = Math.max(1, reps + rir);
  return r === 1 ? oneRm : oneRm / (1 + r / 30);
}

/**
 * Double progression: work within a rep range at a target RIR; when every working set reaches
 * the top of the range at (or easier than) the target effort, add the smallest load increment.
 *
 * input: { repMin, repMax, targetRir, increment, sets: [{load, reps, rir}], prevSets?: [...] }
 * params: { tooEasyExtraReps, reduceFraction, rirTolerance }
 */
export function doubleProgression(input, params = {}) {
  const P = { tooEasyExtraReps: 3, reduceFraction: 0.1, rirTolerance: 1, ...params };
  const { repMin, repMax, targetRir, increment } = input;
  const sets = (input.sets || []).filter(s => s && s.load > 0 && s.reps > 0);
  if (!sets.length || !(repMin > 0) || !(repMax >= repMin) || !(increment > 0)) {
    return { action: 'need-data', message: 'Enter the rep range, an increment, and at least one working set (load and reps).' };
  }
  const load = sets[0].load;
  const sameLoad = sets.every(s => Math.abs(s.load - load) < 1e-6);
  const rirs = sets.map(s => (s.rir == null || s.rir === '' ? targetRir : +s.rir));
  const meanRir = mean(rirs);
  const first = sets[0];
  const est = e1rm(first.load, first.reps, rirs[0]);
  const targetMid = Math.round((repMin + repMax) / 2);
  const notes = [];
  if (!sameLoad) notes.push('Sets used different loads; the first set\'s load is treated as the working load.');

  const out = { load, e1rm: est ? est.mean : null, notes };

  // 1. Clearly too light: blew past the range or had far more in reserve than intended.
  if (first.reps >= repMax + P.tooEasyExtraReps || rirs[0] >= targetRir + 3) {
    const suggested = est ? floorTo(loadForReps(est.mean, targetMid, targetRir), increment) : load + 2 * increment;
    return {
      ...out, action: 'increase', nextLoad: Math.max(load + increment, suggested), nextReps: `${repMin}–${repMax}`,
      message: `The load was clearly too light (set 1: ${first.reps} reps at RIR ${rirs[0]}). Jump to the suggested load and aim for ${targetMid} reps at RIR ${targetRir}.`,
    };
  }
  // 2. Top of range on every set, at or easier than the target effort -> add load.
  const allTop = sets.every(s => s.reps >= repMax);
  if (allTop && meanRir >= targetRir - P.rirTolerance) {
    return {
      ...out, action: 'increase', nextLoad: load + increment, nextReps: `${repMin}–${repMin + 2} (build back up to ${repMax})`,
      message: `All sets reached ${repMax}+ reps at about the target effort. Add ${increment} kg (or the next dumbbell/pin) next session; expect fewer reps, then build up again.`,
    };
  }
  if (allTop) {
    return {
      ...out, action: 'hold', nextLoad: load, nextReps: `${repMax} at RIR ${targetRir}`,
      message: `You reached the top of the range but harder than intended (average RIR ${meanRir.toFixed(1)} vs target ${targetRir}). Keep the load until you can hit ${repMax} reps at the target effort.`,
    };
  }
  // 3. Below the range on the first set (too heavy).
  if (first.reps < repMin) {
    const prevFailed = (input.prevSets || []).length && input.prevSets[0] && input.prevSets[0].reps < repMin &&
      Math.abs(input.prevSets[0].load - load) < 1e-6;
    const reduced = floorTo(load * (1 - P.reduceFraction), increment);
    if (prevFailed || first.reps < repMin - 2) {
      return {
        ...out, action: 'decrease', nextLoad: Math.max(increment, reduced), nextReps: `${repMin}–${repMax}`,
        message: `Set 1 fell below the range${prevFailed ? ' for a second session' : ' by a wide margin'}. Reduce the load by about ${Math.round(P.reduceFraction * 100)}% and rebuild. Check sleep, food intake and technique if this repeats on several exercises.`,
      };
    }
    return {
      ...out, action: 'hold', nextLoad: load, nextReps: `${repMin}+ on set 1`,
      message: 'Set 1 was just below the range. Keep the load once more (rest fully, check technique). If it happens again next session, reduce the load.',
    };
  }
  // 4. Within the range -> keep the load and add reps.
  const total = sets.reduce((a, s) => a + s.reps, 0);
  let stall = false;
  if ((input.prevSets || []).length) {
    const prev = input.prevSets.filter(s => s && s.reps > 0);
    const prevTotal = prev.reduce((a, s) => a + s.reps, 0);
    stall = prev.length && Math.abs(prev[0].load - load) < 1e-6 && total <= prevTotal;
  }
  return {
    ...out, action: 'hold', nextLoad: load, nextReps: `beat ${total} total reps (add 1 rep to the earliest set you can)`,
    stall,
    message: `Keep ${load} kg. Aim to add at least one rep in total while staying at about RIR ${targetRir}.` +
      (stall ? ' No improvement on the previous session: if this repeats for a third session, apply the stall rule.' : ''),
  };
}

/** Ramp-up (warm-up) sets before the first working set of an exercise. */
export function rampSets(workLoad, opts = {}) {
  const { minLoad = 0, step = 2.5, scheme } = opts;
  const S = scheme || [
    { pct: 0.5, reps: 8 },
    { pct: 0.7, reps: 4 },
    { pct: 0.85, reps: 2, minWork: 60 },
  ];
  if (!(workLoad > 0)) return [];
  const out = [];
  let last = -Infinity;
  for (const s of S) {
    if (s.minWork && workLoad < s.minWork) continue;
    let load = Math.max(minLoad, roundTo(workLoad * s.pct, step));
    if (load >= workLoad) continue;
    if (load <= last) continue;
    out.push({ load, reps: s.reps, pct: s.pct });
    last = load;
  }
  if (!out.length) out.push({ load: Math.max(minLoad, roundTo(workLoad * 0.5, step)), reps: 8, pct: 0.5 });
  return out;
}

// ---------------------------------------------------------------- energy and body composition

export function bmrMifflin({ weightKg, heightCm, age, sex }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5);
}
export function bmrKatch(ffmKg) { return 370 + 21.6 * ffmKg; }
export function bmrCunningham(ffmKg) { return 500 + 22 * ffmKg; }

/**
 * Energy and macronutrient targets.
 * input: { weightKg, heightCm, age, sex, bfPct?, pal, goalPct, proteinGkg, fatGkg, fibrePer1000 }
 */
export function energyTargets(input) {
  const { weightKg, heightCm, age, sex, bfPct, pal } = input;
  if (!(weightKg > 0 && heightCm > 0 && age > 0 && pal > 0)) return null;
  const bmrs = { mifflin: bmrMifflin({ weightKg, heightCm, age, sex }) };
  if (bfPct > 0 && bfPct < 60) {
    const ffm = weightKg * (1 - bfPct / 100);
    bmrs.katch = bmrKatch(ffm);
    bmrs.cunningham = bmrCunningham(ffm);
  }
  const vals = Object.values(bmrs);
  const bmr = mean(vals);
  const tdee = bmr * pal;
  const palLow = Math.max(1.2, pal - 0.1), palHigh = pal + 0.1;
  const tdeeLow = Math.min(...vals) * palLow * 0.95;   // equations alone carry roughly ±5-10% individual error
  const tdeeHigh = Math.max(...vals) * palHigh * 1.05;
  const target = tdee * (1 + (input.goalPct || 0) / 100);
  const protein = (input.proteinGkg ?? 1.8) * weightKg;
  const fat = (input.fatGkg ?? 0.8) * weightKg;
  const carbs = Math.max(0, (target - protein * 4 - fat * 9) / 4);
  const fibre = ((input.fibrePer1000 ?? 14) * target) / 1000;
  return { bmrs, bmr, tdee, tdeeLow, tdeeHigh, target, protein, fat, carbs, fibre };
}

const log10 = Math.log10;

/** US Navy circumference equation (Hodgdon & Beckett 1984), inputs in cm. */
export function navyBodyFat({ sex, heightCm, neckCm, waistCm, hipCm }) {
  if (sex === 'female') {
    if (!(waistCm + hipCm - neckCm > 0)) return null;
    return 495 / (1.29579 - 0.35004 * log10(waistCm + hipCm - neckCm) + 0.22100 * log10(heightCm)) - 450;
  }
  if (!(waistCm - neckCm > 0)) return null;
  return 495 / (1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm)) - 450;
}

/** Relative fat mass (Woolcott & Bergman 2018). */
export function relativeFatMass({ sex, heightCm, waistCm }) {
  if (!(heightCm > 0 && waistCm > 0)) return null;
  return (sex === 'female' ? 76 : 64) - 20 * (heightCm / waistCm);
}

/** BMI-based estimate (Deurenberg et al. 1991); sex: male = 1. */
export function deurenbergBodyFat({ sex, age, weightKg, heightCm }) {
  const bmi = weightKg / (heightCm / 100) ** 2;
  return 1.2 * bmi + 0.23 * age - 10.8 * (sex === 'female' ? 0 : 1) - 5.4;
}

export function ffmi({ weightKg, heightCm, bfPct }) {
  const h = heightCm / 100;
  const ffm = weightKg * (1 - bfPct / 100);
  const value = ffm / (h * h);
  return { ffm, ffmi: value, normalised: value + 6.1 * (1.8 - h) };
}

// ---------------------------------------------------------------- body-weight trend

/**
 * Trend from dated weights: 7-day means and a least-squares rate over the last `windowDays`.
 * entries: [{date: 'YYYY-MM-DD', kg}]. With `weekly`, each entry is already a weekly average (from a scale
 * app), so three of them spanning about two weeks are enough; single daily weigh-ins need eight.
 */
export function weightTrend(entries, windowDays = 21, { weekly = false } = {}) {
  const pts = (entries || [])
    .filter(e => e && e.date && e.kg > 0)
    .map(e => ({ t: Date.parse(e.date + 'T12:00:00'), kg: +e.kg, date: e.date }))
    .filter(e => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const lastT = pts[pts.length - 1].t;
  const win = pts.filter(p => p.t > lastT - windowDays * 86400000);
  const days = win.map(p => (p.t - win[0].t) / 86400000);
  const kgPerDay = win.length >= 2 ? slope(days, win.map(p => p.kg)) : NaN;
  const recent = pts.filter(p => p.t > lastT - 7 * 86400000);
  const prior = pts.filter(p => p.t <= lastT - 7 * 86400000 && p.t > lastT - 14 * 86400000);
  const avg7 = mean(recent.map(p => p.kg));
  const avgPrev7 = prior.length ? mean(prior.map(p => p.kg)) : NaN;
  const spanDays = win.length ? (win[win.length - 1].t - win[0].t) / 86400000 : 0;
  return {
    n: pts.length, nWindow: win.length, spanDays,
    avg7, avgPrev7, weekly,
    kgPerWeek: kgPerDay * 7,
    pctPerWeek: Number.isFinite(kgPerDay) && avg7 > 0 ? (kgPerDay * 7 / avg7) * 100 : NaN,
    enough: weekly ? win.length >= 3 && spanDays >= 12 : win.length >= 8 && spanDays >= 13,
  };
}

/**
 * Compare the observed rate with the target band (% of body weight per week) and suggest an
 * intake change. kcalPerKg approximates the energy content of tissue change; it is a rough
 * guide, which is why changes are capped and repeated only after 2+ further weeks of data.
 */
export function energyAdjustment(trend, band, opts = {}) {
  const { kcalPerKg = 7700, maxStep = 250, minStep = 100, tolerancePct = 0 } = opts;
  if (!trend || !trend.enough || !Number.isFinite(trend.pctPerWeek)) {
    return { action: 'wait', kcal: 0, message: trend && trend.weekly
      ? 'Need at least 3 weekly averages covering 2 weeks before adjusting intake.'
      : 'Need at least 2 weeks with 8 or more weigh-ins before adjusting intake.' };
  }
  const [lo, hi] = band; // e.g. [-0.5, -0.25] for slow loss
  const rate = trend.pctPerWeek;
  if (rate >= lo && rate <= hi) {
    return { action: 'keep', kcal: 0, message: `Rate ${rate.toFixed(2)}%/week is inside the target band (${lo} to ${hi}%/week). Keep intake unchanged.` };
  }
  // Small deviations are within the noise of a 2-3 week trend: re-check rather than react.
  if (rate >= lo - tolerancePct && rate <= hi + tolerancePct) {
    return { action: 'recheck', kcal: 0, message: `Rate ${rate.toFixed(2)}%/week is just outside the target band (${lo} to ${hi}%/week) but within normal noise. Keep intake unchanged and re-check in 2 weeks; change only if it is still outside.` };
  }
  const targetRate = rate < lo ? lo : hi;
  const deltaKgPerWeek = ((targetRate - rate) / 100) * trend.avg7;
  let kcal = (deltaKgPerWeek * kcalPerKg) / 7;
  const sign = Math.sign(kcal);
  kcal = sign * Math.min(maxStep, Math.max(minStep, Math.abs(kcal)));
  kcal = Math.round(kcal / 50) * 50;
  return {
    action: kcal > 0 ? 'increase' : 'decrease', kcal,
    message: `Rate ${rate.toFixed(2)}%/week is ${rate < lo ? 'below' : 'above'} the target band (${lo} to ${hi}%/week). ` +
      `${kcal > 0 ? 'Increase' : 'Reduce'} average daily intake by about ${Math.abs(kcal)} kcal, then reassess after 2–3 weeks.`,
  };
}

// ---------------------------------------------------------------- calibration and kept targets

const DAY_MS = 86400000;
const noonT = iso => Date.parse(`${iso}T12:00:00`);     // local noon, as weightTrend does
const isoOf = t => todayISO(new Date(t));
const r2 = x => Math.round(x * 100) / 100;
const round5 = x => Math.round(x / 5) * 5;
const round10 = x => Math.round(x / 10) * 10;

/**
 * The calibration window: the last `days` days ending on the latest weigh-in, its weeks, the fitted trend and the
 * week-on-week change (nutrition plan: "fit the weight trend across all 14 days, or compare the average of days 8-14
 * with days 1-7"). Intake is averaged from `from` to `intakeTo`, the day before the last weigh-in, whose food log is
 * not finished. Each week needs `minPerWeek` weigh-ins (one weekly average) and they must cover the window: the first
 * within its first 3 days. Returns null without weigh-ins.
 */
export function calibrationWindow(entries, { days = 14, weekly = false, minPerWeek = 3 } = {}) {
  const pts = (entries || []).filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.kg > 0)
    .map(e => ({ date: e.date, kg: +e.kg, t: noonT(e.date) })).filter(p => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (!pts.length) return null;
  const to = pts[pts.length - 1].date;
  const startT = noonT(to) - (days - 1) * DAY_MS;
  const from = isoOf(startT);
  const win = pts.filter(p => p.date >= from && p.date <= to).map(p => ({ ...p, day: Math.round((p.t - startT) / DAY_MS) }));
  const nBlocks = Math.max(1, Math.floor(days / 7));
  const blocks = Array.from({ length: nBlocks }, (_, b) => {
    const inB = win.filter(p => Math.min(nBlocks - 1, Math.floor(p.day / 7)) === b);
    return {
      from: isoOf(startT + b * 7 * DAY_MS), to: isoOf(startT + (b === nBlocks - 1 ? days - 1 : b * 7 + 6) * DAY_MS), n: inB.length,
      meanKg: inB.length ? mean(inB.map(p => p.kg)) : NaN, meanDay: inB.length ? mean(inB.map(p => p.day)) : NaN,
    };
  });
  const spanDays = win.length ? win[win.length - 1].day - win[0].day : 0;
  // Weekly averages: one a week, at least 5 days apart (the dates a scale app gives them can drift by a day or two).
  const enough = weekly ? win.length >= nBlocks && spanDays >= 5 * (nBlocks - 1)
    : blocks.every(b => b.n >= minPerWeek) && spanDays >= days - 3;
  const fit = win.length >= 2 ? slope(win.map(p => p.day), win.map(p => p.kg)) * 7 : NaN;
  const first = blocks[0], last = blocks[nBlocks - 1];
  const halves = nBlocks > 1 && first.n && last.n && last.meanDay > first.meanDay
    ? (last.meanKg - first.meanKg) / ((last.meanDay - first.meanDay) / 7) : NaN;
  return {
    from, to, days, n: win.length, spanDays, blocks: blocks.map(({ meanDay, ...b }) => b), enough,
    firstDate: win.length ? win[0].date : null,    // the first weigh-in inside the window (intake starts there)
    kgPerWeek: Number.isFinite(fit) ? r2(fit) : null,
    halvesKgPerWeek: Number.isFinite(halves) ? r2(halves) : null,
    intakeTo: isoOf(noonT(to) - DAY_MS),
    endKg: last.n ? Math.round(last.meanKg * 10) / 10 : null,
  };
}

/** Nutrition plan arithmetic: maintenance ≈ mean logged intake + (kg lost per week × kcalPerKg/7), or minus if you
 *  gained; within ±flatKgPerWeek the intake is the maintenance (the page's flat rule, applied literally). */
export function maintenanceFromTrend(intakeKcal, kgPerWeek, { kcalPerKg = 7700, flatKgPerWeek = 0.1 } = {}) {
  if (!(intakeKcal > 0) || !Number.isFinite(kgPerWeek)) return null;
  const intake = Math.round(intakeKcal), k = r2(kgPerWeek);
  const flat = Math.abs(k) <= flatKgPerWeek + 1e-9;
  const correction = flat ? 0 : Math.round(-k * kcalPerKg / 7);
  return { intake, kgPerWeek: k, flat, correction, kcal: intake + correction };
}

/** "2,450 + 220 = 2,670" (one number when there is no correction). */
export function maintenanceSum(r) {
  if (!r) return '';
  if (!r.correction) return thousands(r.kcal);
  return `${thousands(r.intake)} ${r.correction > 0 ? '+' : '−'} ${thousands(Math.abs(r.correction))} = ${thousands(r.kcal)}`;
}

/** Kept kcal and protein targets: maintenance plus an offset inside the goal's kcalRange (null: the middle), protein
 *  from the basis weight. kcal figures are rounded to 10. Returns null without a basis weight. */
export function dailyTargets({ maintenanceKcal, goal, offset = null, basisKg }, E = {}) {
  if (!goal || !(basisKg > 0)) return null;
  const range = Array.isArray(goal.kcalRange) && goal.kcalRange.length === 2 ? [...goal.kcalRange].sort((a, b) => a - b) : null;
  const hasM = maintenanceKcal > 0;
  const off = range && hasM ? Math.round(Number.isFinite(offset) ? offset : (range[0] + range[1]) / 2) : null;
  const gkg = Array.isArray(goal.proteinGkg) ? goal.proteinGkg : [E.proteinGkg || 1.8, E.proteinGkg || 1.8];
  const kcal = off != null ? round10(maintenanceKcal + off) : null;
  const kcalLow = range && hasM ? round10(maintenanceKcal + range[0]) : null;
  const kcalHigh = range && hasM ? round10(maintenanceKcal + range[1]) : null;
  return {
    range, offset: off, kcal, kcalLow, kcalHigh,
    inRange: kcal != null ? kcal >= kcalLow && kcal <= kcalHigh : null,    // judged on the figures shown
    middle: off != null && off === Math.round((range[0] + range[1]) / 2),
    protein: {
      low: round5(gkg[0] * basisKg), high: round5(gkg[1] * basisKg), floor: round5((E.proteinFloorGkg || 1.6) * basisKg),
      perMeal: Math.round((E.proteinPerMealGkg || 0.4) * basisKg),
    },
  };
}

/** The content's reminders: re-calibrate after recalibrateWeeks[0] weeks or a recalibrateKg move of the 7-day average,
 *  recompute protein after a proteinRecomputeKg move (differences rounded to 0.01 kg first). */
export function targetReminders({ maintenance, basisKg, avg7, today }, C = {}) {
  const weeksAt = ((C.recalibrateWeeks || [4])[0]) * 7;
  const moved = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) * 100) / 100 : NaN);
  let recalibrate = null, protein = null;
  if (maintenance) {
    const days = Math.round((noonT(today) - noonT(maintenance.to)) / DAY_MS);
    const kg = moved(avg7, maintenance.endKg);
    const byTime = days >= weeksAt, byWeight = Math.abs(kg) >= (C.recalibrateKg || 2);
    if (byTime || byWeight) recalibrate = { byTime, byWeight, weeks: Math.floor(days / 7), kgMoved: Number.isFinite(kg) ? kg : null };
  }
  const pk = moved(avg7, basisKg);
  if (Math.abs(pk) >= (C.proteinRecomputeKg || 2)) protein = { kgMoved: pk };
  return { recalibrate, protein };
}

/** Runs of position-history entries ({at, phase, week}) whose phase matches isAway, as local dates: [{from, to}],
 *  to being the date of the first entry after the run (null while still in it). */
export function phaseSpans(history, isAway) {
  const spans = [];
  let open = null;
  for (const e of Array.isArray(history) ? history : []) {
    const t = e ? Date.parse(e.at) : NaN;
    if (!Number.isFinite(t)) continue;      // an unreadable entry (a hand-edited backup) is skipped
    const date = isoOf(t);
    if (isAway(e.phase)) { if (!open) open = { from: date, to: null }; }
    else if (open) { open.to = date; spans.push(open); open = null; }
  }
  if (open) spans.push(open);
  return spans;
}

/** After the latest finished Away span of at least one night (a switch undone the same day is not a trip):
 *  { returned, resumes } while today is before returned + days, else null. */
export function awaySettle(spans, today, days = 7) {
  const done = (spans || []).filter(s => s && s.to && s.to > s.from);
  if (!done.length) return null;
  const returned = done[done.length - 1].to;
  const resumes = isoOf(noonT(returned) + days * DAY_MS);
  return today < resumes ? { returned, resumes } : null;
}

// ---------------------------------------------------------------- heart rate

export function hrMax(age) {
  return { tanaka: 208 - 0.7 * age, fox: 220 - age };
}

/** Heart-rate zone from %HRR (Karvonen) when resting HR is known, else from %HRmax. */
export function hrZone(age, restingHr, loPct, hiPct) {
  const max = hrMax(age).tanaka;
  if (restingHr > 30 && restingHr < 120) {
    const hrr = max - restingHr;
    return { lo: restingHr + hrr * loPct, hi: restingHr + hrr * hiPct, method: 'HRR' };
  }
  return { lo: max * loPct, hi: max * hiPct, method: 'HRmax' };
}

// ---------------------------------------------------------------- breaks and running

/** Adjustments after time off, driven by rules.json params.breaks: [{maxDays, loadPct, setsDelta, advice}]. */
export function breakAdjustment(daysOff, table) {
  const rows = (table || []).slice().sort((a, b) => a.maxDays - b.maxDays);
  const row = rows.find(r => daysOff <= r.maxDays) || rows[rows.length - 1];
  return row || null;
}

/** Longest single run allowed today, given the longest run in the last 30 days (spike rule). */
export function runSpikeLimit(longestLast30, maxIncrease = 0.1) {
  if (!(longestLast30 > 0)) return null;
  return longestLast30 * (1 + maxIncrease);
}
