# Forge · evidence-based training programme (PWA)

A personal, multiphase training, nutrition and recovery programme delivered as an installable,
offline Progressive Web App. Plain HTML, CSS and JavaScript: no framework, no build step,
no external runtime resources, no accounts, no analytics.

## File structure

```
index.html              App shell (loads css/app.css and js/app.js)
manifest.webmanifest    Install metadata (relative start_url and scope, so it works under a sub-path)
sw.js                   Service worker: precaches every file, serves cache-first (offline)
css/app.css             All styles (light/dark, phone and laptop layouts)
js/                     Application code (ES modules)
  app.js                Bootstrap, router, navigation, service-worker registration
  content.js            Loads content/*.json, resolves citations and cross-links
  md.js                 Markdown-lite renderer used for all text
  engine.js             Expands phases/weeks/sessions; transcription text; progress tracking
  calc.js               Pure calculators (progression, e1RM, energy, body composition, trends)
  player.js             Guided session player with rest/hold/interval timers
  views.js, tools.js    Pages and tools
  store.js              Local storage, backup and restore
  util.js               Helpers
content/                ALL programme content, as JSON (edit these to update the programme)
  meta.json             Version, evidence cut-off, profile analysis, welcome text
  programme.json        Phases, week plans, schedules and session templates
  exercises.json        Resistance-exercise library (technique, errors, progressions, alternatives)
  drills.json           Warm-up drills, stretches, cardio protocols, balance/power drills, tests
  rules.json            Progression and adjustment rules + parameters used by the calculators
  plan.json             Nutrition, supplements, sleep, activity, monitoring and safety pages
  science.json          Layered science articles (summary → mechanisms → evidence)
  decisions.json        Decision records (question, options, evidence, choice, confidence)
  references.json       Bibliography (authors, year, journal, DOI/PMID, evidence grade)
  glossary.json         Definitions of technical terms
icons/                  App icons (SVG + PNG, including a maskable icon)
tests/index.html        In-browser unit tests (calculators, renderer, content integrity)
tools/serve.ps1         Local preview server for Windows (PowerShell 7)
EVIDENCE.md             Evidence appendix: sources consulted and how evidence was graded
```

## Deploy to GitHub Pages

1. Create a repository (public, or private with a plan that allows Pages) and add **all files
   in this folder** to it (keep the folder structure; `.claude/` can be left out).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose
   `main` and `/ (root)`, and save.
3. After a minute the app is live at `https://<user>.github.io/<repository>/`. Every path in the
   app is relative, so a repository sub-path works without changes.
4. Open that URL once while online. The service worker caches everything; from then on the app
   works fully offline.

No server-side code or build is needed. Any static host that serves over HTTPS works the same way.

## Install

- **Android (Chrome):** open the site, then menu **⋮ → Add to Home screen** (or the *Install app*
  prompt). It opens full-screen like a native app.
- **Windows (Microsoft Edge):** open the site, then click the **App available / install icon** in
  the address bar, or **⋯ → Apps → Install this site as an app**. It gets a Start-menu entry and
  its own window.
- Installing also makes Chromium treat the app's storage as persistent (less likely to be cleared).

## Your data

Position in the programme, "done" ticks, check-in weights and waist values, checklist states and
tool inputs are stored only in this browser (localStorage). Nothing is sent anywhere. Browsers can
clear site data, so use **Settings → Export backup** occasionally; **Import backup** restores it
(also how you move data between phone and laptop).

## Preview locally on Windows

```
pwsh -File tools/serve.ps1 -Base /forge/
```

Then open `http://localhost:8765/forge/` (the `-Base` option mimics a GitHub Pages sub-path).
`http://localhost` is a secure context, so installation and offline mode can be tested too.
Run the unit tests at `http://localhost:8765/forge/tests/`.

## Updating the programme

All content lives in `content/*.json`; the app code does not need to change.

1. Edit the JSON file(s). Text fields use a small Markdown dialect:
   - `**bold**`, `*italic*`, `` `code` ``, `^superscript^`, `[text](https://link)`
   - blank line = new paragraph; `- ` bullet lists; `1. ` numbered lists; `| a | b |` tables
   - `> note`, `!> warning`, `+> tip`, `!!> danger` callouts (one marker per line)
   - citations: `[@ReferenceId]` or `[@Id1; @Id2]` (the id must exist in `references.json`)
   - links: `[[ex:exercise-id]]`, `[[sci:article-id]]`, `[[dec:D01]]`, `[[term:rir|RIR]]`,
     `[[tool:progression]]`, `[[phase:p1]]`, `[[plan:nutrition]]`, `[[rule:double-progression]]`
2. Check the JSON is valid (any JSON validator, or PowerShell:
   `Get-Content -Raw content/programme.json | ConvertFrom-Json`).
3. Preview locally and open **Settings → Content diagnostics → Run check** (or `tests/`) to confirm
   every citation and link resolves.
4. **Bump the version** in `sw.js` (`const VERSION = 'forge-v1.0.1'`) so installed copies fetch
   the new files. If you add a new file, also add it to the `PRECACHE` list in `sw.js`.
5. Commit and push. Open copies show *"An updated version of the app is ready"*; tap **Reload**.

### How sessions are built

`programme.json` holds, per phase: `weeks`, `defaults` and `weekPlans` (sets and RIR per exercise
*role*, plus `params` such as cardio minutes), and `schedule` (7-day patterns, cycled week by
week). Session templates list `warmup`, `main` and `cooldown` items that reference ids in
`exercises.json` / `drills.json`. A main item's `sets` and `rir` default to the week plan for its
`role` unless set explicitly; `{{param}}` placeholders take values from the week's `params`.
Timers: a number (seconds), `{"type":"hold","seconds":30,"sets":2,"sides":true}`, or
`{"type":"intervals","warmup":300,"work":240,"recover":180,"reps":4,"cooldown":300}`.

## How the content was produced and checked

- **Evidence:** 12 research domains, searched up to 28 October 2026 (PubMed plus agency and guideline
  documents), 517 unique papers recorded with DOI/PMID, evidence grades and the reader's notes. Method,
  per-domain source tables, search logs and seed references that could not be found are in `EVIDENCE.md`.
- **Claim audit:** after writing, every sentence that cites a source or states a number was checked by an
  independent auditor against the cited source's recorded findings and against a single canonical-numbers
  sheet: 3,867 claims checked, 503 corrected in place (6 high-severity, e.g. a monthly 60,000 IU vitamin D
  option and two solo-lifting texts that allowed 1–2 RIR on barbell lifts; overstated or misattributed
  citations were softened, corrected or replaced).
- **Identifiers:** all 507 references cited in the app were re-checked against PubMed (PMID↔DOI); 506 verified,
  none needed correction. One citation has no DOI/PMID to verify: Google's *Get started with Google Fitbit Air*
  help page, used only for that device's specifications (shown as "unverified" on its reference page).
- **App tests:** `tests/index.html` (45 checks: calculators, renderer, phase sequencing, content integrity,
  every scheduled session resolving, session timings) all pass; a crawl of 709 pages found no errors or broken
  citations/links; offline use was verified by stopping the server and reloading.

## Development notes

- `?nosw` in the URL unregisters the service worker so edited files load directly.
- Browser features used: Service Worker + Cache Storage, Web App Manifest, localStorage, ES
  modules, Screen Wake Lock (optional), Web Audio (optional), Vibration (optional, Android),
  Clipboard API (with a fallback), Blob downloads and file input for backups. All are supported
  by current Chrome for Android and Microsoft Edge for Windows; the optional ones degrade silently.
