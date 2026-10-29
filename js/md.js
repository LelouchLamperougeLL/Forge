// Markdown-lite renderer used for all programme content.
//
// Supported syntax (documented for content editors in README.md):
//   # / ## / ### headings          paragraphs separated by blank lines
//   - or * bullet lists, 1. ordered lists (nest by indenting 2+ spaces)
//   | pipe | tables | with a |---| separator row
//   > note callout   !> warning callout   +> tip callout   !!> danger callout
//   **bold**  *italic*  `code`  ^superscript^  [text](https://external.link)
//   [@refId] or [@refA; @refB]     -> numbered citations linked to the reference list
//   [[type:id]] or [[type:id|label]] -> internal links; types: ex, sci, dec, term, tool, phase,
//                                      plan, rule, ref, page
// Everything is HTML-escaped before formatting, so content cannot inject markup.

import { esc } from './util.js';

const LIST_RE = /^(\s*)([-*]|\d+\.)\s+/;
const CALLOUT_RE = /^(!!>|!>|\+>|>)\s?/;
const CALLOUT_CLASS = { '>': '', '!>': 'warn', '+>': 'ok', '!!>': 'danger' };

function indentOf(line) {
  const m = /^(\s*)/.exec(line);
  return m ? m[1].replace(/\t/g, '    ').length : 0;
}
const isListItem = line => LIST_RE.test(line);
const isTableStart = (lines, i) =>
  /^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]);

/** Render inline markup within a single block of text. */
export function inline(text, ctx = {}) {
  let s = esc(text);
  const stash = [];
  const keep = html => { stash.push(html); return `\u0000${stash.length - 1}\u0000`; };

  s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/\[(@[^\]]+)\]/g, (_, inner) => {
    const ids = inner.split(/[;,]/).map(x => x.trim().replace(/^@/, '')).filter(Boolean);
    return keep(ctx.cite ? ctx.cite(ids) : '');
  });
  s = s.replace(/\[\[(\w+):([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, type, id, label) =>
    keep(ctx.link ? ctx.link(type, id.trim(), label) : (label || id)));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
    keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/\^([^\s^]{1,12})\^/g, '<sup>$1</sup>');
  // Restore stashed fragments (they may themselves contain stashed fragments).
  for (let k = 0; k < 3 && s.includes('\u0000'); k++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  }
  return s;
}

function parseList(lines, start, ctx) {
  const base = indentOf(lines[start]);
  const ordered = /^\s*\d+\./.test(lines[start]);
  let html = ordered ? '<ol>' : '<ul>';
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && isListItem(lines[j]) && indentOf(lines[j]) >= base) { i = j; continue; }
      break;
    }
    const ind = indentOf(line);
    if (ind < base || !isListItem(line)) break;
    if (ind > base) {
      const nested = parseList(lines, i, ctx);
      html = html.replace(/<\/li>$/, '') + nested.html + '</li>';
      i = nested.next;
      continue;
    }
    let text = line.replace(LIST_RE, '');
    let inner = '';
    i++;
    while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base) {
      if (isListItem(lines[i])) {
        const nested = parseList(lines, i, ctx);
        inner += nested.html;
        i = nested.next;
      } else {
        text += ' ' + lines[i].trim();
        i++;
      }
    }
    html += `<li>${inline(text, ctx)}${inner}</li>`;
  }
  html += ordered ? '</ol>' : '</ul>';
  return { html, next: i };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(c => c.trim());
}

function parseTable(lines, start, ctx) {
  const head = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map(c => (/^:?-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : ''));
  let i = start + 2;
  const rows = [];
  while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
  const cell = (tag, txt, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(txt, ctx)}</${tag}>`;
  let html = '<div class="table-wrap"><table><thead><tr>' + head.map((h, k) => cell('th', h, k)).join('') + '</tr></thead><tbody>';
  for (const r of rows) html += '<tr>' + head.map((_, k) => cell('td', r[k] ?? '', k)).join('') + '</tr>';
  html += '</tbody></table></div>';
  return { html, next: i };
}

/** Render a markdown-lite string (or an array of paragraphs) to HTML. */
export function renderMarkdown(src, ctx = {}) {
  if (src == null || src === '') return '';
  if (Array.isArray(src)) src = src.join('\n\n');
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const hOffset = ctx.hOffset ?? 1;
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(6, h[1].length + hOffset);
      html += `<h${lvl}>${inline(h[2], ctx)}</h${lvl}>`;
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      const t = parseTable(lines, i, ctx);
      html += t.html;
      i = t.next;
      continue;
    }
    if (isListItem(line)) {
      const l = parseList(lines, i, ctx);
      html += l.html;
      i = l.next;
      continue;
    }
    const c = CALLOUT_RE.exec(line);
    if (c) {
      const marker = c[1];
      const body = [];
      while (i < lines.length) {
        const m = CALLOUT_RE.exec(lines[i]);
        if (!m || m[1] !== marker) break;
        body.push(lines[i].slice(m[0].length));
        i++;
      }
      html += `<div class="callout ${CALLOUT_CLASS[marker]}">${renderMarkdown(body.join('\n'), ctx)}</div>`;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,4}\s/.test(lines[i]) && !isListItem(lines[i]) &&
           !CALLOUT_RE.test(lines[i]) && !isTableStart(lines, i)) {
      para.push(lines[i].trim());
      i++;
    }
    html += `<p>${inline(para.join(' '), ctx)}</p>`;
  }
  return html;
}

/** Collect every [@ref] and [[type:id]] token in a string (used by integrity checks). */
export function scanTokens(src) {
  const out = { refs: [], links: [] };
  if (src == null) return out;
  const s = Array.isArray(src) ? src.join('\n') : String(src);
  for (const m of s.matchAll(/\[(@[^\]]+)\]/g)) {
    for (const id of m[1].split(/[;,]/).map(x => x.trim().replace(/^@/, '')).filter(Boolean)) out.refs.push(id);
  }
  for (const m of s.matchAll(/\[\[(\w+):([^\]|]+)(?:\|[^\]]+)?\]\]/g)) out.links.push({ type: m[1], id: m[2].trim() });
  return out;
}
