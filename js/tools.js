// Tool pages (calculators, check-in tracker, transition checklist) and the Settings page.

import { esc, fmt, fmtSigned, todayISO, toast, downloadFile, readFileAsText, ICONS, TOOL_ICONS, setTemper, syncThemeColor } from './util.js';
import { DB, makeCtx, integrityReport } from './content.js';
import { store, getSettings, setSetting } from './store.js';
import {
  doubleProgression, rampSets, e1rm, loadForReps, energyTargets, navyBodyFat, relativeFatMass,
  deurenbergBodyFat, ffmi, weightTrend, energyAdjustment, hrMax, hrZone, breakAdjustment, runSpikeLimit,
} from './calc.js';
import { phases, getPhase, weekCount, getPosition, setPosition, getReturnTo, phaseAdherence, nextPosition, sequentialNeighbour } from './engine.js';

const P = () => DB.ruleParams || {};
const profile = () => (DB.meta && DB.meta.profile) || {};
const num = v => (v === '' || v == null ? NaN : +v);
const head = (eyebrow, title, lede = '') =>
  `<div class="page-head">${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>`;

function field(id, label, value, { type = 'number', step = 'any', hint = '', min, max, attrs = '' } = {}) {
  return `<div class="field"><label for="${id}">${label}</label>
    <input type="${type}" id="${id}" name="${id}" value="${esc(value ?? '')}" ${type === 'number' ? `inputmode="decimal" step="${step}"` : ''} ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} ${attrs}>
    ${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
}

function select(id, label, options, value, hint = '') {
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${id}">
    ${options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
}

/** Persist the form's inputs under tool:<id> and call compute() on every change. */
function bindForm(root, id, compute) {
  const form = root.querySelector('form.tool-form');
  if (!form) return;
  const save = () => {
    const data = {};
    for (const el of form.elements) if (el.name) data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    store.set(`tool:${id}`, data);
    compute(data);
  };
  form.addEventListener('input', save);
  form.addEventListener('change', save);
  form.addEventListener('submit', e => e.preventDefault());
  save();
}

const saved = id => store.get(`tool:${id}`, {});

// ---------------------------------------------------------------- tool index

export const TOOLS = [
  { id: 'progression', title: 'Progression calculator', desc: 'Next session\'s load and reps from what you logged (double progression).' },
  { id: 'warmup', title: 'Ramp-up set calculator', desc: 'Warm-up sets for your first working load.' },
  { id: 'e1rm', title: 'Estimated 1RM and load table', desc: 'Strength estimate from a set; loads for other rep targets.' },
  { id: 'checkin', title: 'Weekly check-in', desc: 'Body-weight trend, waist trend and the energy-intake adjustment rule.' },
  { id: 'energy', title: 'Energy and macronutrient targets', desc: 'Starting targets with uncertainty, before calibration from your weight trend.' },
  { id: 'bodycomp', title: 'Body-composition estimates', desc: 'Circumference equations, waist-to-height ratio and FFMI, with error ranges.' },
  { id: 'transition', title: 'Phase transition checklist', desc: 'Advance, repeat or step back at the end of a phase.' },
  { id: 'breaks', title: 'Returning after a break', desc: 'How to adjust loads and volume after missed training.' },
  { id: 'intensity', title: 'Cardio intensity guide', desc: 'Effort zones by RPE, talk test and (optional) heart rate.' },
  { id: 'running', title: 'Run progression check', desc: 'Longest run allowed today under the single-session spike rule.' },
];

export function viewTools() {
  return {
    title: 'Tools',
    html: `<div class="page">
      ${head('Apply the rules', 'Tools', 'Lightweight helpers. Logging happens in your workout app; these turn what you logged into decisions.')}
      <div class="grid two">${TOOLS.map(t => `<a class="card card-link tool-tile" href="#/tool/${t.id}"><span class="tool-icon">${TOOL_ICONS[t.id] || ICONS.tools}</span><div><h3>${esc(t.title)}</h3><p class="small muted" style="margin:0">${esc(t.desc)}</p></div></a>`).join('')}</div>
      <p style="margin-top:14px"><a class="btn" href="#/rules">${ICONS.rules} All progression and adjustment rules</a></p>
    </div>`,
  };
}

export function viewTool(id, query) {
  const fn = {
    progression: toolProgression, warmup: toolWarmup, e1rm: toolE1rm, checkin: toolCheckin, energy: toolEnergy,
    bodycomp: toolBodycomp, transition: toolTransition, breaks: toolBreaks, intensity: toolIntensity, running: toolRunning,
  }[id];
  if (!fn) return { title: 'Tool', html: `<div class="page">${head('', 'Unknown tool')}<p><a href="#/tools">All tools</a></p></div>` };
  return fn(query);
}

// ---------------------------------------------------------------- progression

function toolProgression() {
  const s = saved('progression');
  const inc = (P().progression || {}).increments || [];
  const rows = [0, 1, 2, 3, 4].map(i => `<tr>
      <td class="mono">${i + 1}</td>
      <td><input type="number" inputmode="decimal" step="any" name="l${i}" value="${esc(s['l' + i] ?? '')}" aria-label="Set ${i + 1} load (kg)"></td>
      <td><input type="number" inputmode="numeric" step="1" name="r${i}" value="${esc(s['r' + i] ?? '')}" aria-label="Set ${i + 1} reps"></td>
      <td><input type="number" inputmode="decimal" step="0.5" name="q${i}" value="${esc(s['q' + i] ?? '')}" aria-label="Set ${i + 1} RIR"></td></tr>`).join('');
  return {
    title: 'Progression',
    html: `<div class="page reading">
      ${head('Tool', 'Progression calculator', 'Enter the working sets you logged for one exercise. RIR = repetitions in reserve (RPE 8 = RIR 2). Leave RIR blank if you did not rate it.')}
      <form class="tool-form card">
        <div class="form-grid four">
          ${field('repMin', 'Rep range: min', s.repMin ?? 8, { step: 1 })}
          ${field('repMax', 'Rep range: max', s.repMax ?? 12, { step: 1 })}
          ${field('targetRir', 'Target RIR', s.targetRir ?? 2, { step: 0.5 })}
          ${field('increment', 'Load increment (kg)', s.increment ?? 2.5, { hint: inc.length ? 'See guide below' : '' })}
        </div>
        <div class="table-wrap"><table><thead><tr><th>Set</th><th>Load (kg)</th><th>Reps</th><th>RIR</th></tr></thead><tbody>${rows}</tbody></table></div>
        <details><summary>Previous session (optional, enables stall detection)</summary><div class="details-body">
          <div class="form-grid">${field('pl', 'Previous load (kg)', s.pl)}${field('pr', 'Previous set-1 reps', s.pr, { step: 1 })}</div>
          ${field('ptotal', 'Previous total reps (all sets)', s.ptotal, { step: 1 })}
        </div></details>
      </form>
      <div id="out" aria-live="polite"></div>
      ${inc.length ? `<details><summary>Choosing the increment</summary><div class="details-body"><ul>${inc.map(x => `<li><strong>${esc(x.label)}</strong>: ${esc(x.value)}</li>`).join('')}</ul></div></details>` : ''}
      <p><a href="#/rule/double-progression">Read the full rule and its rationale</a></p>
    </div>`,
    after(root) {
      bindForm(root, 'progression', d => {
        const sets = [0, 1, 2, 3, 4].map(i => ({ load: num(d['l' + i]), reps: num(d['r' + i]), rir: d['q' + i] === '' ? null : num(d['q' + i]) }))
          .filter(x => x.load > 0 && x.reps > 0);
        let prevSets = [];
        if (num(d.pl) > 0 && num(d.pr) > 0) {
          prevSets = [{ load: num(d.pl), reps: num(d.pr) }];
          const total = num(d.ptotal);
          if (total > num(d.pr)) prevSets.push({ load: num(d.pl), reps: total - num(d.pr) });
        }
        const r = doubleProgression({
          repMin: num(d.repMin), repMax: num(d.repMax), targetRir: num(d.targetRir), increment: num(d.increment), sets, prevSets,
        }, P().progression || {});
        const out = root.querySelector('#out');
        if (r.action === 'need-data') { out.innerHTML = `<div class="result muted">${esc(r.message)}</div>`; return; }
        const cls = { increase: 'ok', hold: '', decrease: 'warn' }[r.action] || '';
        out.innerHTML = `<div class="callout ${cls}">
          <div class="callout-title">${r.action === 'increase' ? 'Increase load' : r.action === 'decrease' ? 'Reduce load' : 'Keep the load'}</div>
          <div class="row" style="gap:18px;margin:6px 0">
            <div class="stat"><span class="k">Next load</span><span class="v">${fmt(r.nextLoad, 2)} kg</span></div>
            <div class="stat"><span class="k">Rep target</span><span class="v" style="font-size:1rem">${esc(r.nextReps)}</span></div>
            ${r.e1rm ? `<div class="stat"><span class="k">e1RM (set 1)</span><span class="v">${fmt(r.e1rm, 1)} kg</span></div>` : ''}
          </div>
          <p>${esc(r.message)}</p>
          ${(r.notes || []).map(n => `<p class="small">${esc(n)}</p>`).join('')}
          ${r.stall ? '<p class="small"><a href="#/rule/stall">Apply the stall rule</a></p>' : ''}
        </div>`;
      });
    },
  };
}

// ---------------------------------------------------------------- ramp-up sets

function toolWarmup() {
  const s = saved('warmup');
  return {
    title: 'Ramp-up sets',
    html: `<div class="page reading">
      ${head('Tool', 'Ramp-up set calculator', 'Lighter sets before the first working set rehearse the movement and prepare the tissues without causing fatigue.')}
      <form class="tool-form card"><div class="form-grid three">
        ${field('work', 'First working load (kg)', s.work ?? 40)}
        ${field('minLoad', 'Lightest possible load (kg)', s.minLoad ?? 20, { hint: 'Empty barbell 20; lightest dumbbell or pin otherwise' })}
        ${field('step', 'Smallest jump (kg)', s.step ?? 2.5)}
      </div></form>
      <div id="out" aria-live="polite"></div>
      <p class="small muted">Rest about a minute between ramp-up sets; they should feel easy (far from failure). Not needed for isolation exercises once the joint is already warm.</p>
      <p><a href="#/rule/ramp-up">Rule and rationale</a></p>
    </div>`,
    after(root) {
      bindForm(root, 'warmup', d => {
        const sets = rampSets(num(d.work), { minLoad: num(d.minLoad) || 0, step: num(d.step) || 2.5, scheme: P().rampScheme });
        root.querySelector('#out').innerHTML = sets.length
          ? `<div class="table-wrap"><table><thead><tr><th>Ramp-up set</th><th class="num">Load (kg)</th><th class="num">Reps</th></tr></thead><tbody>
            ${sets.map((x, i) => `<tr><td>${i + 1}</td><td class="num">${fmt(x.load, 2)}</td><td class="num">${x.reps}</td></tr>`).join('')}
            <tr><td><strong>Working sets</strong></td><td class="num"><strong>${fmt(num(d.work), 2)}</strong></td><td class="num">as prescribed</td></tr></tbody></table></div>`
          : '<div class="result muted">Enter a working load.</div>';
      });
    },
  };
}

// ---------------------------------------------------------------- e1RM

function toolE1rm() {
  const s = saved('e1rm');
  return {
    title: 'Estimated 1RM',
    html: `<div class="page reading">
      ${head('Tool', 'Estimated 1RM and load table', 'An estimate of the heaviest single repetition you could lift, from a submaximal set. Most useful as a trend; you never need to test a true 1RM in this programme.')}
      <form class="tool-form card"><div class="form-grid three">
        ${field('load', 'Load (kg)', s.load ?? 50)}
        ${field('reps', 'Reps completed', s.reps ?? 8, { step: 1 })}
        ${field('rir', 'Reps in reserve', s.rir ?? 2, { step: 0.5 })}
      </div></form>
      <div id="out" aria-live="polite"></div>
      <p class="small muted">Epley and Brzycki equations applied to reps + RIR (estimated reps to failure). Accuracy falls above ~10 reps to failure and differs between exercises and people; treat values as ±5–10%.</p>
    </div>`,
    after(root) {
      bindForm(root, 'e1rm', d => {
        const r = e1rm(num(d.load), num(d.reps), num(d.rir) || 0);
        const out = root.querySelector('#out');
        if (!r) { out.innerHTML = '<div class="result muted">Enter load and reps.</div>'; return; }
        const targets = [[5, 2], [6, 2], [8, 2], [10, 2], [12, 2], [15, 2]];
        out.innerHTML = `<div class="result"><div class="row" style="gap:20px">
            <div class="stat"><span class="k">Estimated 1RM</span><span class="v">${fmt(r.mean, 1)} kg</span></div>
            <div class="stat"><span class="k">Range of equations</span><span class="v" style="font-size:1rem">${fmt(r.low, 1)}–${fmt(r.high, 1)} kg</span></div>
            <div class="stat"><span class="k">Reps to failure</span><span class="v">${r.repsToFailure}</span></div></div>
            ${r.reliable ? '' : '<p class="small">More than 10 estimated reps to failure: the estimate is less reliable.</p>'}</div>
          <div class="table-wrap"><table><thead><tr><th>Target</th><th class="num">Suggested load (kg)</th></tr></thead><tbody>
          ${targets.map(([reps, rir]) => `<tr><td>${reps} reps at RIR ${rir}</td><td class="num">${fmt(loadForReps(r.mean, reps, rir), 1)}</td></tr>`).join('')}
          </tbody></table></div>`;
      });
    },
  };
}

// ---------------------------------------------------------------- energy

function toolEnergy() {
  const pr = profile();
  const E = P().energy || {};
  const s = saved('energy');
  const goals = E.goals || [{ id: 'maintain', label: 'Maintain', pct: 0 }];
  const pals = E.pal || [{ value: 1.6, label: '1.6' }];
  return {
    title: 'Energy targets',
    html: `<div class="page reading">
      ${head('Tool', 'Energy and macronutrient targets', 'A starting estimate only. Prediction equations carry individual errors of roughly ±10%, so the weekly check-in recalibrates intake from your actual weight trend.')}
      <form class="tool-form card">
        <div class="form-grid four">
          ${field('weight', 'Body weight (kg)', s.weight ?? pr.weightKg ?? 77)}
          ${field('height', 'Height (cm)', s.height ?? pr.heightCm ?? 181)}
          ${field('age', 'Age (years)', s.age ?? pr.age ?? 31, { step: 1 })}
          ${field('bf', 'Body fat % (optional)', s.bf ?? pr.bfEstimate ?? '', { hint: 'From the body-composition tool' })}
        </div>
        ${select('pal', 'Physical activity level (PAL)', pals.map(p => ({ value: p.value, label: p.label })), s.pal ?? (E.defaultPal || pals[0].value))}
        ${select('goal', 'Goal for this phase', goals.map(g => ({ value: g.id, label: g.label })), s.goal ?? (E.defaultGoal || goals[0].id))}
        <div class="form-grid three">
          ${field('protein', 'Protein (g/kg/day)', s.protein ?? (E.proteinGkg || 1.8), { hint: E.proteinHint || '' })}
          ${field('fat', 'Fat (g/kg/day)', s.fat ?? (E.fatGkg || 0.8))}
          ${field('fibre', 'Fibre (g per 1000 kcal)', s.fibre ?? (E.fibrePer1000 || 14))}
        </div>
      </form>
      <div id="out" aria-live="polite"></div>
      <p><a href="#/plan/nutrition">Nutrition plan</a> · <a href="#/tool/checkin">Weekly check-in</a></p>
    </div>`,
    after(root) {
      bindForm(root, 'energy', d => {
        const goal = goals.find(g => g.id === d.goal) || goals[0];
        const r = energyTargets({
          weightKg: num(d.weight), heightCm: num(d.height), age: num(d.age), sex: 'male', bfPct: num(d.bf),
          pal: num(d.pal), goalPct: goal.pct || 0, proteinGkg: num(d.protein), fatGkg: num(d.fat), fibrePer1000: num(d.fibre),
        });
        const out = root.querySelector('#out');
        if (!r) { out.innerHTML = '<div class="result muted">Fill in weight, height, age and PAL.</div>'; return; }
        const bmrRows = Object.entries(r.bmrs).map(([k, v]) => `<tr><td>${esc({ mifflin: 'Mifflin–St Jeor', katch: 'Katch–McArdle (uses FFM)', cunningham: 'Cunningham (uses FFM)' }[k])}</td><td class="num">${fmt(v)}</td></tr>`).join('');
        out.innerHTML = `<div class="result">
          <div class="row" style="gap:22px">
            <div class="stat"><span class="k">Maintenance (TDEE)</span><span class="v">${fmt(Math.round(r.tdee / 10) * 10)} kcal</span><span class="tiny muted">plausible ${fmt(r.tdeeLow)}–${fmt(r.tdeeHigh)}</span></div>
            <div class="stat"><span class="k">Target · ${esc(goal.label)}</span><span class="v">${fmt(Math.round(r.target / 50) * 50)} kcal</span></div>
          </div></div>
          <div class="table-wrap"><table><thead><tr><th>Daily target</th><th class="num">Grams</th><th class="num">kcal</th></tr></thead><tbody>
            <tr><td>Protein</td><td class="num">${fmt(r.protein)}</td><td class="num">${fmt(r.protein * 4)}</td></tr>
            <tr><td>Fat</td><td class="num">${fmt(r.fat)}</td><td class="num">${fmt(r.fat * 9)}</td></tr>
            <tr><td>Carbohydrate (remainder)</td><td class="num">${fmt(r.carbs)}</td><td class="num">${fmt(r.carbs * 4)}</td></tr>
            <tr><td>Fibre</td><td class="num">≥ ${fmt(r.fibre)}</td><td class="num">–</td></tr>
          </tbody></table></div>
          <details><summary>Resting energy estimates</summary><div class="details-body"><div class="table-wrap"><table><tbody>${bmrRows}</tbody></table></div>
          <p class="small muted">TDEE = mean resting estimate × PAL. The plausible range combines the spread of equations, PAL ±0.1 and ±5% individual error.</p></div></details>
          ${goal.note ? `<p class="small">${esc(goal.note)}</p>` : ''}`;
      });
    },
  };
}

// ---------------------------------------------------------------- check-in

function toolCheckin() {
  const E = P().energy || {};
  const goals = E.goals || [];
  const pos = getPosition();
  const phaseGoal = pos ? (getPhase(pos.phase).energyGoal || '') : '';
  const s = saved('checkin');
  return {
    title: 'Check-in',
    html: `<div class="page reading">
      ${head('Tool', 'Weekly check-in', 'Weigh daily (or most days) under the standard protocol, enter the numbers here or weekly averages from your scale app, and measure your waist every 2 weeks. Decisions use trends, never single readings.')}
      <div class="card"><h2 style="margin-top:0">Add a weigh-in</h2>
        <form id="wform" class="form-grid three" style="align-items:end">
          ${field('wdate', 'Date', todayISO(), { type: 'date' })}
          ${field('wkg', 'Weight (kg)', '', { attrs: 'required placeholder="77.0"' })}
          <div class="field"><button class="btn primary" type="submit">Add</button></div>
        </form>
        <details><summary>Paste many at once</summary><div class="details-body">
          <p class="small muted">One per line: <code>2026-11-02, 77.4</code></p>
          <textarea id="bulk" rows="5" aria-label="Paste weigh-ins"></textarea>
          <button class="btn small" id="bulkAdd" type="button">Add pasted values</button></div></details>
      </div>
      <div class="card"><h2 style="margin-top:0">Add waist measurements</h2>
        <form id="waform" class="form-grid four" style="align-items:end">
          ${field('wadate', 'Date', todayISO(), { type: 'date' })}
          ${field('navel', 'Waist at navel (cm)', '')}
          ${field('natural', 'Narrowest waist (cm)', '')}
          <div class="field"><button class="btn primary" type="submit">Add</button></div>
        </form>
      </div>
      <form class="tool-form card">${select('goal', 'Target band for this phase', goals.map(g => ({ value: g.id, label: `${g.label} (${g.band ? g.band.join(' to ') + ' %/week' : 'n/a'})` })), s.goal || phaseGoal || (goals[0] && goals[0].id))}</form>
      <div id="out" aria-live="polite"></div>
      <div class="card tight"><h2 style="margin:6px 0">Recent entries</h2><div id="entries"></div></div>
      <p><a href="#/rule/energy-adjustment">The adjustment rule and why it works this way</a> · <a href="#/plan/monitoring">Measurement protocols</a></p>
    </div>`,
    after(root) {
      const weights = () => store.get('weights', []);
      const waists = () => store.get('waist', []);
      const upsertWeight = (date, kg) => store.update('weights', [], arr => {
        const next = arr.filter(e => e.date !== date);
        next.push({ date, kg });
        return next.sort((a, b) => a.date.localeCompare(b.date));
      });
      const render = (data) => {
        const goal = goals.find(g => g.id === data.goal) || goals[0];
        const tr = weightTrend(weights(), (E.trendWindowDays || 21));
        const adj = goal && goal.band ? energyAdjustment(tr, goal.band, E.adjust || {}) : null;
        const wa = waists();
        let waistHtml = '';
        if (wa.length >= 2) {
          const last = wa[wa.length - 1];
          const ref = wa.slice().reverse().find(x => (Date.parse(last.date) - Date.parse(x.date)) / 86400000 >= 25) || wa[0];
          const dn = last.navel && ref.navel ? last.navel - ref.navel : NaN;
          waistHtml = `<div class="stat"><span class="k">Waist (navel) change</span><span class="v">${fmtSigned(dn, 1)} cm</span><span class="tiny muted">since ${esc(ref.date)}</span></div>`;
        }
        const out = root.querySelector('#out');
        out.innerHTML = tr ? `<div class="result"><div class="row" style="gap:22px">
            <div class="stat"><span class="k">7-day average</span><span class="v">${fmt(tr.avg7, 1)} kg</span></div>
            <div class="stat"><span class="k">Trend</span><span class="v">${fmtSigned(tr.kgPerWeek, 2)} kg/wk</span><span class="tiny muted">${Number.isFinite(tr.pctPerWeek) ? fmtSigned(tr.pctPerWeek, 2) + ' %/wk' : ''} · ${tr.nWindow} weigh-ins over ${fmt(tr.spanDays)} days</span></div>
            ${waistHtml}</div></div>
          ${adj ? `<div class="callout ${adj.action === 'keep' ? 'ok' : adj.action === 'wait' || adj.action === 'recheck' ? '' : 'warn'}"><div class="callout-title">${adj.action === 'wait' ? 'Not enough data yet' : adj.action === 'keep' ? 'On target' : adj.action === 'recheck' ? 'Borderline: re-check in 2 weeks' : 'Adjust intake'}</div><p>${esc(adj.message)}</p>${goal && goal.note ? `<p class="small">${esc(goal.note)}</p>` : ''}</div>` : ''}`
          : '<div class="result muted">No weigh-ins yet.</div>';
        const rows = weights().slice(-28).reverse().map(e => `<tr><td>${esc(e.date)}</td><td class="num">${fmt(e.kg, 1)}</td><td><button class="btn small ghost" data-del-w="${esc(e.date)}" aria-label="Delete ${esc(e.date)}">✕</button></td></tr>`).join('');
        const wrows = wa.slice(-12).reverse().map(e => `<tr><td>${esc(e.date)}</td><td class="num">${fmt(e.navel, 1)}</td><td class="num">${fmt(e.natural, 1)}</td><td><button class="btn small ghost" data-del-wa="${esc(e.date)}" aria-label="Delete waist ${esc(e.date)}">✕</button></td></tr>`).join('');
        root.querySelector('#entries').innerHTML =
          (rows ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">kg</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No weigh-ins.</p>') +
          (wrows ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Navel (cm)</th><th class="num">Narrowest (cm)</th><th></th></tr></thead><tbody>${wrows}</tbody></table></div>` : '');
      };
      let current = saved('checkin');
      bindForm(root, 'checkin', d => { current = d; render(d); });
      root.querySelector('#wform').addEventListener('submit', e => {
        e.preventDefault();
        const date = root.querySelector('#wdate').value;
        const kg = num(root.querySelector('#wkg').value);
        if (!date || !(kg > 20 && kg < 300)) { toast('Enter a date and a weight in kg'); return; }
        upsertWeight(date, kg);
        root.querySelector('#wkg').value = '';
        toast('Weigh-in saved');
        render(current);
      });
      root.querySelector('#bulkAdd').addEventListener('click', () => {
        let n = 0;
        for (const line of root.querySelector('#bulk').value.split(/\n/)) {
          const m = /(\d{4}-\d{2}-\d{2})\s*[,;\t ]\s*(\d+(?:[.,]\d+)?)/.exec(line);
          if (m) { const kg = +m[2].replace(',', '.'); if (kg > 20 && kg < 300) { upsertWeight(m[1], kg); n++; } }
        }
        root.querySelector('#bulk').value = '';
        toast(`${n} weigh-in${n === 1 ? '' : 's'} added`);
        render(current);
      });
      root.querySelector('#waform').addEventListener('submit', e => {
        e.preventDefault();
        const date = root.querySelector('#wadate').value;
        const navel = num(root.querySelector('#navel').value);
        const natural = num(root.querySelector('#natural').value);
        if (!date || !(navel > 40 || natural > 40)) { toast('Enter a date and at least one waist value'); return; }
        store.update('waist', [], arr => [...arr.filter(x => x.date !== date), { date, navel: navel || null, natural: natural || null }].sort((a, b) => a.date.localeCompare(b.date)));
        root.querySelector('#navel').value = '';
        root.querySelector('#natural').value = '';
        toast('Waist saved');
        render(current);
      });
      root.querySelector('#entries').addEventListener('click', e => {
        const w = e.target.closest('[data-del-w]');
        const wa = e.target.closest('[data-del-wa]');
        if (w) store.update('weights', [], arr => arr.filter(x => x.date !== w.dataset.delW));
        if (wa) store.update('waist', [], arr => arr.filter(x => x.date !== wa.dataset.delWa));
        if (w || wa) render(current);
      });
    },
  };
}

// ---------------------------------------------------------------- body composition

function toolBodycomp() {
  const pr = profile();
  const s = saved('bodycomp');
  const see = P().bodycompSEE || {};
  return {
    title: 'Body composition',
    html: `<div class="page reading">
      ${head('Tool', 'Body-composition estimates', 'Circumference and BMI-based equations estimate body fat with individual errors of several percentage points. Use one method consistently and watch its trend; do not compare different methods.')}
      <form class="tool-form card"><div class="form-grid three">
        ${field('weight', 'Weight (kg)', s.weight ?? pr.weightKg ?? 77)}
        ${field('height', 'Height (cm)', s.height ?? pr.heightCm ?? 181)}
        ${field('age', 'Age', s.age ?? pr.age ?? 31, { step: 1 })}
        ${field('neck', 'Neck (cm)', s.neck ?? pr.neckCm ?? 38, { hint: 'Just below the larynx' })}
        ${field('navel', 'Waist at navel (cm)', s.navel ?? pr.waistNavelCm ?? 86)}
        ${field('natural', 'Narrowest waist (cm)', s.natural ?? pr.waistNaturalCm ?? 81)}
      </div></form>
      <div id="out" aria-live="polite"></div>
      <p><a href="#/plan/monitoring">Measurement protocols and what the scale can and cannot tell you</a></p>
    </div>`,
    after(root) {
      bindForm(root, 'bodycomp', d => {
        const base = { sex: 'male', heightCm: num(d.height), weightKg: num(d.weight), age: num(d.age) };
        const navy = navyBodyFat({ ...base, neckCm: num(d.neck), waistCm: num(d.navel) });
        const rfm = relativeFatMass({ ...base, waistCm: num(d.navel) });
        const rfmNat = relativeFatMass({ ...base, waistCm: num(d.natural) });
        const deur = deurenbergBodyFat(base);
        const ests = [navy, rfm, deur].filter(Number.isFinite);
        const mid = ests.length ? ests.reduce((a, b) => a + b, 0) / ests.length : NaN;
        const f = Number.isFinite(mid) ? ffmi({ weightKg: base.weightKg, heightCm: base.heightCm, bfPct: mid }) : null;
        const whtr = num(d.navel) / num(d.height);
        const bmi = base.weightKg / (base.heightCm / 100) ** 2;
        const row = (name, v, e, note = '') => `<tr><td>${name}</td><td class="num">${Number.isFinite(v) ? fmt(v, 1) + ' %' : '–'}</td><td class="num">${e ? '±' + esc(e) : ''}</td><td class="small">${note}</td></tr>`;
        root.querySelector('#out').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Method</th><th class="num">Body fat</th><th class="num">Typical error</th><th>Notes</th></tr></thead><tbody>
            ${row('US Navy (neck + navel waist)', navy, see.navy, 'Track this one over time')}
            ${row('Relative fat mass (navel waist)', rfm, see.rfm, `${fmt(rfmNat, 1)} % with the narrowest waist`)}
            ${row('Deurenberg (BMI, age, sex)', deur, see.deurenberg, 'Cannot see muscle gain; ignore once training')}
          </tbody></table></div>
          <div class="result"><div class="row" style="gap:20px">
            <div class="stat"><span class="k">BMI</span><span class="v">${fmt(bmi, 1)}</span></div>
            <div class="stat"><span class="k">Waist-to-height</span><span class="v">${fmt(whtr, 3)}</span><span class="tiny muted">${whtr < 0.5 ? 'below 0.5' : '0.5 or above'}</span></div>
            ${f ? `<div class="stat"><span class="k">FFM (at ${fmt(mid, 1)} %)</span><span class="v">${fmt(f.ffm, 1)} kg</span></div>
            <div class="stat"><span class="k">FFMI</span><span class="v">${fmt(f.ffmi, 1)}</span><span class="tiny muted">normalised ${fmt(f.normalised, 1)}</span></div>` : ''}
          </div></div>`;
      });
    },
  };
}

// ---------------------------------------------------------------- transition checklist

function toolTransition(query) {
  const ctx = makeCtx();
  const pos = getPosition();
  const pid = query.get('phase') || (pos && pos.phase) || (phases()[0] && phases()[0].id);
  const phase = getPhase(pid);
  if (!phase) return { title: 'Transition', html: `<div class="page">${head('Tool', 'Phase transition checklist')}<p>No phase selected.</p></div>` };
  const key = `transition:${phase.id}`;
  const state = store.get(key, {});
  const adh = phaseAdherence(phase, pos && pos.phase === phase.id ? pos.week : weekCount(phase));
  const need = (P().transition || {}).minAdherencePct ?? 80;
  const crit = (arr, group) => (arr || []).map((c, i) => {
    const k = `${group}${i}`;
    return `<label class="check"><input type="checkbox" data-k="${k}" ${state[k] ? 'checked' : ''}><span>${ctx.md(c).replace(/^<p>|<\/p>$/g, '')}</span></label>`;
  }).join('');
  const nextP = phase.optional ? null : sequentialNeighbour(phase.id, +1);
  const prevP = phase.optional ? null : sequentialNeighbour(phase.id, -1);
  return {
    title: 'Transition',
    html: `<div class="page reading">
      ${head('Tool', `Transition checklist · ${esc(phase.name)}`)}
      <div class="chips" style="margin-bottom:12px">${phases().map(p => `<a class="chip ${p.id === phase.id ? 'accent' : ''}" href="#/tool/transition?phase=${p.id}">${esc(p.short || p.name)}</a>`).join('')}</div>
      <div class="result"><div class="stat"><span class="k">Session adherence (from your "done" ticks)</span><span class="v">${adh.pct ?? '–'} %</span><span class="tiny muted">${adh.done} of ${adh.planned} planned sessions · threshold ${need} %</span></div></div>
      <div class="card"><h2 style="margin-top:0">Advance if all of these are true</h2>${crit(phase.advance, 'a') || '<p class="muted">—</p>'}</div>
      <div class="card"><h2 style="margin-top:0">Repeat if any of these apply</h2>${crit(phase.repeat, 'r') || '<p class="muted">—</p>'}</div>
      <div class="card"><h2 style="margin-top:0">Step back if any of these apply</h2>${crit(phase.regress, 'g') || '<p class="muted">—</p>'}</div>
      <div id="verdict" aria-live="polite"></div>
      ${ctx.refsHtml()}
    </div>`,
    after(root) {
      const verdict = () => {
        const st = store.get(key, {});
        const aAll = (phase.advance || []).every((_, k) => st[`a${k}`]);
        const rAny = (phase.repeat || []).some((_, k) => st[`r${k}`]);
        const gAny = (phase.regress || []).some((_, k) => st[`g${k}`]);
        let html;
        if (phase.optional) {
          const r = getReturnTo();
          const back = r && getPhase(r.phase);
          html = `<div class="callout"><div class="callout-title">${esc(phase.name)} repeats until you leave it</div>
            <p>${back ? `When normal training resumes, return to ${esc(back.short || back.name)} · week ${r.week}, where you left off.` : 'When normal training resumes, set your phase and week in <a href="#/settings">Settings</a>.'}
            Before the first session back, read <a href="#/rule/${esc(phase.returnRule || 'breaks')}">${esc((DB.idx.rules.get(phase.returnRule || 'breaks') || {}).title || 'Returning after missed training')}</a>.</p>
            ${back ? `<button class="btn primary" data-go="${r.phase}:${r.week}">Return to ${esc(back.short || back.name)} · week ${r.week}</button>` : ''}</div>`;
        }
        else if (gAny) html = `<div class="callout danger"><div class="callout-title">Step back</div><p>${esc((phase.regressAction || 'Return to an earlier part of this phase (or the previous phase) and rebuild.'))}</p>
          <div class="row">${prevP ? `<button class="btn" data-go="${prevP.id}:${Math.max(1, weekCount(prevP) - 3)}">Go to ${esc(prevP.short || prevP.name)} · week ${Math.max(1, weekCount(prevP) - 3)}</button>` : ''}<button class="btn" data-go="${phase.id}:1">Restart ${esc(phase.short || phase.name)} · week 1</button></div></div>`;
        else if (rAny || !aAll) html = `<div class="callout warn"><div class="callout-title">Repeat before advancing</div><p>${esc(phase.repeatAction || 'Repeat the final block of this phase, then re-check.')}</p>
          <div class="row"><button class="btn" data-go="${phase.id}:${Math.max(1, weekCount(phase) - (phase.repeatWeeks || 4) + 1)}">Repeat from week ${Math.max(1, weekCount(phase) - (phase.repeatWeeks || 4) + 1)}</button></div></div>`;
        else html = `<div class="callout ok"><div class="callout-title">Ready to advance</div><p>All advance criteria are met.</p>
          ${nextP ? `<button class="btn primary" data-go="${nextP.id}:1">Start ${esc(nextP.name)}</button>` : '<p>This is the final phase: continue its cycle structure.</p>'}</div>`;
        root.querySelector('#verdict').innerHTML = html;
      };
      root.addEventListener('change', e => {
        const k = e.target.dataset && e.target.dataset.k;
        if (!k) return;
        store.update(key, {}, st => ({ ...st, [k]: e.target.checked }));
        verdict();
      });
      root.addEventListener('click', e => {
        const b = e.target.closest('[data-go]');
        if (!b) return;
        const [p, w] = b.dataset.go.split(':');
        // Leaving an optional phase keeps earlier ticks; repeating, restarting or starting a phase begins fresh.
        setPosition(p, +w, { fresh: !phase.optional });
        toast('Position updated');
        location.hash = '#/today';
      });
      verdict();
    },
  };
}

// ---------------------------------------------------------------- breaks

function toolBreaks() {
  const ctx = makeCtx();
  const table = P().breaks || [];
  const away = P().breaksAway || null;   // advice when the gap was spent training without the gym
  const s = saved('breaks');
  return {
    title: 'After a break',
    html: `<div class="page reading">
      ${head('Tool', 'Returning after a break', 'Short breaks cost little; this tells you how much to reduce load and volume when you come back.')}
      <form class="tool-form card"><div class="form-grid">${field('days', 'Days since your last full session', s.days ?? 10, { step: 1, min: 0 })}
        ${away ? select('during', 'During the gap', [{ value: 'none', label: 'No training' }, { value: 'away', label: 'Away mode, 2 or more sessions a week' }], s.during ?? 'none', 'Fewer than 2 sessions a week counts as no training.') : ''}</div></form>
      <div id="out" aria-live="polite"></div>
      ${table.length ? `<details><summary>Full table</summary><div class="details-body"><div class="table-wrap"><table><thead><tr><th>Days off</th><th>Loads</th><th>Sets</th><th>Advice</th></tr></thead><tbody>
        ${table.map((r, i) => `<tr><td>${i === 0 ? '0' : table[i - 1].maxDays + 1}–${r.maxDays >= 9999 ? '∞' : r.maxDays}</td><td>${esc(r.loadLabel || (r.loadPct === 100 ? 'unchanged' : r.loadPct + '%'))}</td><td>${esc(r.setsLabel || '')}</td><td class="small">${ctx.md(r.advice || '').replace(/^<p>|<\/p>$/g, '')}</td></tr>`).join('')}
      </tbody></table></div></div></details>` : ''}
      <p><a href="#/rule/breaks">Rule and evidence</a> · <a href="#/plan/safety">Illness and when not to train</a></p>
      ${ctx.refsHtml()}
    </div>`,
    after(root) {
      bindForm(root, 'breaks', d => {
        const r = d.during === 'away' && away ? away : breakAdjustment(num(d.days), table);
        root.querySelector('#out').innerHTML = r
          ? `<div class="callout"><div class="callout-title">${esc(r.title || '')}</div><p><strong>Loads:</strong> ${esc(r.loadLabel || r.loadPct + '%')} · <strong>Sets:</strong> ${esc(r.setsLabel || '')}</p>${makeCtx().md(r.advice || '')}</div>`
          : '<div class="result muted">Enter the number of days.</div>';
      });
    },
  };
}

// ---------------------------------------------------------------- intensity

function toolIntensity() {
  const pr = profile();
  const zones = P().intensityZones || [];
  const s = saved('intensity');
  const ctx = makeCtx();
  return {
    title: 'Cardio intensity',
    html: `<div class="page reading">
      ${head('Tool', 'Cardio intensity guide', 'No heart-rate monitor is needed: effort (RPE) and the talk test are the primary guides. Heart-rate numbers are shown only if you enter a resting heart rate or buy a monitor later.')}
      <form class="tool-form card"><div class="form-grid">
        ${field('age', 'Age', s.age ?? pr.age ?? 31, { step: 1 })}
        ${field('rhr', 'Resting heart rate (optional)', s.rhr ?? '', { step: 1, hint: 'Count your pulse for 60 s after waking' })}
      </div></form>
      <div id="out" aria-live="polite"></div>
      ${ctx.refsHtml()}
    </div>`,
    after(root) {
      bindForm(root, 'intensity', d => {
        const age = num(d.age);
        const rhr = num(d.rhr);
        const max = hrMax(age);
        const rows = zones.map(z => {
          const useHrr = rhr > 30 && rhr < 120;
          const [lo, hi] = useHrr ? (z.hrr || [z.lo, z.hi]) : (z.hrmax || [z.lo, z.hi]);
          const hr = Number.isFinite(age) ? hrZone(age, useHrr ? rhr : NaN, lo, hi) : null;
          return `<tr><td><strong>${esc(z.name)}</strong></td><td>${esc(z.rpe)}</td><td class="small">${esc(z.talk)}</td><td class="num">${hr ? `${fmt(hr.lo)}–${fmt(hr.hi)}` : '–'}</td><td class="small">${esc(z.use || '')}</td></tr>`;
        }).join('');
        root.querySelector('#out').innerHTML = `<div class="result small">Predicted maximum heart rate ≈ ${fmt(max.tanaka)} bpm (Tanaka equation); individual values commonly differ by ±10 bpm or more, so heart-rate zones are approximate. ${Number.isFinite(rhr) ? 'Zones use heart-rate reserve (Karvonen).' : 'Zones use % of predicted maximum.'}</div>
          <div class="table-wrap"><table><thead><tr><th>Zone</th><th>RPE (0–10)</th><th>Talk test</th><th class="num">HR (bpm)</th><th>Used for</th></tr></thead><tbody>${rows}</tbody></table></div>`;
      });
    },
  };
}

// ---------------------------------------------------------------- running

function toolRunning() {
  const R = P().running || {};
  const s = saved('running');
  return {
    title: 'Run check',
    html: `<div class="page reading">
      ${head('Tool', 'Run progression check', 'Keep any single run within a modest step above your longest recent run. Large single-session jumps are a stronger warning sign than weekly totals.')}
      <form class="tool-form card"><div class="form-grid">
        ${field('longest', 'Longest run in the last 30 days', s.longest ?? '', { hint: 'Minutes of running (or km)' })}
        ${field('planned', 'Planned run today', s.planned ?? '')}
      </div></form>
      <div id="out" aria-live="polite"></div>
      <p><a href="#/rule/running">Full running rule</a></p>
    </div>`,
    after(root) {
      bindForm(root, 'running', d => {
        const lim = runSpikeLimit(num(d.longest), R.spikeMax ?? 0.1);
        const planned = num(d.planned);
        const out = root.querySelector('#out');
        if (!lim) { out.innerHTML = '<div class="result muted">Enter your longest run in the last 30 days.</div>'; return; }
        const over = planned > lim;
        out.innerHTML = `<div class="callout ${over ? 'warn' : 'ok'}"><div class="callout-title">Limit today: ${fmt(lim, 1)}</div>
          <p>${Number.isFinite(planned) ? (over ? `Your plan (${fmt(planned, 1)}) exceeds the limit; shorten it or split it with walking.` : `Your plan (${fmt(planned, 1)}) is within the limit.`) : 'Enter a planned run to check it.'}</p></div>`;
      });
    },
  };
}

// ---------------------------------------------------------------- settings

export function viewSettings() {
  const st = getSettings();
  const pos = getPosition();
  const toggles = [
    ['sound', 'Beep when a timer ends'], ['countdownBeeps', 'Short beeps in the last 3 seconds'], ['vibrate', 'Vibrate when a timer ends (Android)'],
    ['autoRest', 'Start the rest timer automatically after "Set done"'], ['wakeLock', 'Keep the screen on in the guided player'],
  ];
  const phaseOpts = phases().map(p => `<option value="${p.id}" ${pos && pos.phase === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  return {
    title: 'Settings',
    html: `<div class="page reading">
      ${head('', 'Settings and data')}
      <div class="card"><h2 style="margin-top:0">Where you are</h2>
        <div class="form-grid wide-first"><div class="field"><label for="posPhase">Phase</label><select id="posPhase">${phaseOpts}</select></div>
        ${field('posWeek', 'Week', pos ? pos.week : 1, { step: 1, min: 1 })}</div>
        <button class="btn primary" id="savePos">Save position</button>
      </div>
      <div class="card"><h2 style="margin-top:0">Appearance</h2>
        <div class="chips segmented" role="group" aria-label="Theme">${['system', 'light', 'dark'].map(t => `<button class="chip" data-theme-btn="${t}" aria-pressed="${st.theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="card"><h2 style="margin-top:0">Guided player</h2>
        ${toggles.map(([k, label]) => `<label class="check"><input type="checkbox" data-setting="${k}" ${st[k] ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
      </div>
      <div class="card"><h2 style="margin-top:0">Backup and restore</h2>
        <p class="small">Your position, "done" ticks, check-in data, checklists and tool inputs are stored only in this browser. Browsers can clear site data, so export a backup now and then (and before reinstalling or switching devices).</p>
        <div class="row"><button class="btn primary" id="exportBtn">Export backup (.json)</button>
          <label class="btn" for="importFile">Import backup…</label><input type="file" id="importFile" accept="application/json,.json" hidden></div>
        <p class="small muted" id="storageInfo"></p>
      </div>
      <div class="card"><h2 style="margin-top:0">Install and offline</h2>
        <p class="small">Android (Chrome): menu ⋮ → <em>Add to Home screen</em> / <em>Install app</em>. Windows (Edge): the app icon in the address bar, or ⋯ → <em>Apps</em> → <em>Install this site as an app</em>. After the first visit everything works offline.</p>
        <p class="small muted" id="cacheInfo">Checking offline cache…</p>
        <button class="btn small" id="installBtn" hidden>Install now</button>
      </div>
      <div class="card"><h2 style="margin-top:0">Content diagnostics</h2>
        <p class="small muted">Checks every citation and cross-link resolves. Useful after editing content files.</p>
        <button class="btn small" id="diagBtn">Run check</button><div id="diagOut"></div>
      </div>
      <div class="card"><h2 style="margin-top:0">About</h2>
        <p class="small">App ${esc(DB.meta.appVersion || '')} · content ${esc(DB.meta.contentVersion || '')} · evidence searched up to ${esc(DB.meta.evidenceCutoff || '–')}.</p>
        ${DB.meta.disclaimer ? `<div class="small">${makeCtx().md(DB.meta.disclaimer)}</div>` : ''}
      </div>
      <div class="card"><h2 style="margin-top:0">Reset</h2>
        <p class="small">Deletes everything stored on this device by this app.</p>
        <button class="btn danger" id="resetBtn">Delete all local data…</button>
      </div>
    </div>`,
    async after(root) {
      root.querySelector('#savePos').addEventListener('click', () => {
        const p = root.querySelector('#posPhase').value;
        const max = weekCount(getPhase(p));
        const w = Math.min(max, Math.max(1, Math.round(num(root.querySelector('#posWeek').value) || 1)));
        setPosition(p, w);
        setTemper(getPhase(p).color || 'p0');
        toast(`Position set: ${getPhase(p).short || p}, week ${w}`);
      });
      root.querySelectorAll('[data-theme-btn]').forEach(b => b.addEventListener('click', () => {
        const t = b.dataset.themeBtn;
        setSetting('theme', t);
        if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
        syncThemeColor();
        root.querySelectorAll('[data-theme-btn]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      }));
      root.querySelectorAll('[data-setting]').forEach(c => c.addEventListener('change', () => setSetting(c.dataset.setting, c.checked)));
      root.querySelector('#exportBtn').addEventListener('click', () => {
        const data = store.exportAll(DB.meta.appVersion);
        downloadFile(`forge-backup-${todayISO()}.json`, JSON.stringify(data, null, 2));
        store.set('lastBackup', new Date().toISOString());
        toast('Backup downloaded');
      });
      root.querySelector('#importFile').addEventListener('change', async e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const obj = JSON.parse(await readFileAsText(file));
          const problems = store.validateBackup(obj);
          if (problems.length) { toast(problems[0], 4000); return; }
          if (!confirm(`Restore backup from ${obj.exportedAt || 'unknown date'}? This replaces the data currently stored in this browser.`)) return;
          const n = store.importAll(obj, 'replace');
          toast(`Restored ${n} items`);
          setTimeout(() => location.reload(), 600);
        } catch (err) {
          toast(`Could not read that file: ${err.message}`, 4000);
        } finally { e.target.value = ''; }
      });
      root.querySelector('#resetBtn').addEventListener('click', () => {
        if (!confirm('Delete all locally stored data for this app? Export a backup first if you might want it.')) return;
        store.clearAll();
        toast('Local data deleted');
        setTimeout(() => location.reload(), 600);
      });
      root.querySelector('#diagBtn').addEventListener('click', () => {
        const probs = integrityReport();
        root.querySelector('#diagOut').innerHTML = probs.length
          ? `<div class="callout warn"><div class="callout-title">${probs.length} problem${probs.length === 1 ? '' : 's'}</div><ul>${probs.slice(0, 200).map(p => `<li class="small">${esc(p)}</li>`).join('')}</ul></div>`
          : '<div class="callout ok">All citations and links resolve.</div>';
      });
      const persisted = await store.persistenceState();
      const last = store.get('lastBackup', null);
      root.querySelector('#storageInfo').textContent =
        `${store.usable ? 'Local storage available' : 'Local storage is blocked: data will be lost when you close the app'}` +
        `${persisted === true ? ' · persistent (protected from automatic clearing)' : persisted === false ? ' · not persistent (installing the app usually makes it persistent)' : ''}` +
        `${last ? ` · last backup ${new Date(last).toLocaleDateString()}` : ' · no backup exported yet'}.`;
      try {
        const names = 'caches' in window ? await caches.keys() : [];
        let count = 0;
        for (const n of names.filter(n => n.startsWith('forge-'))) count += (await (await caches.open(n)).keys()).length;
        const ctl = navigator.serviceWorker && navigator.serviceWorker.controller;
        root.querySelector('#cacheInfo').textContent = count
          ? `Offline ready: ${count} files cached (${names.filter(n => n.startsWith('forge-')).join(', ')})${ctl ? '' : ' · reload once to let the offline worker take control'}.`
          : 'Not cached yet. Open the app online once over HTTPS (or localhost) to enable offline use.';
      } catch (e) {
        root.querySelector('#cacheInfo').textContent = 'Cache status unavailable in this browser.';
      }
      const ib = root.querySelector('#installBtn');
      if (window.__forgeInstallPrompt) {
        ib.hidden = false;
        ib.addEventListener('click', async () => {
          const p = window.__forgeInstallPrompt;
          window.__forgeInstallPrompt = null;
          ib.hidden = true;
          p.prompt();
          try { await p.userChoice; } catch (e) { /* ignore */ }
        });
      }
    },
  };
}

export { nextPosition };
