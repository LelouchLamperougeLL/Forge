// Demonstration videos on exercise pages and in the guided player's Demo sheet (content/videos.json). Nothing
// contacts YouTube until you press play: the page shows a poster drawn by the app, and only then loads the player
// from youtube-nocookie.com (YouTube's privacy-enhanced mode). If the video cannot play, the page says why and
// links to it on YouTube.

import { esc, ICONS, youtubeId } from './util.js';
import { DB } from './content.js';

const HOST = 'https://www.youtube-nocookie.com';

// Error codes the embedded player reports (YouTube IFrame Player API). YouTube also uses 101/150 for
// videos that are no longer available, so those messages cover both cases.
const NOT_HERE = 'YouTube won’t play it inside other apps: its owner may have turned that off, or it may no longer be available.';
const ERRORS = {
  2: 'YouTube did not recognise the video id.',
  5: 'The video player ran into a problem.',
  100: 'The video has been removed or made private.',
  101: NOT_HERE,
  150: NOT_HERE,
  153: 'YouTube would not play it inside the app.',
};

/** The video entry for a library item (id normalised), or null when it has none or the id is unusable. */
export function videoFor(itemId) {
  const v = DB.videos && DB.videos[itemId];
  const id = v && youtubeId(v.id);
  return id ? { ...v, id, start: Math.max(0, Math.floor(+v.start || 0)) } : null;
}

const watchUrl = v => `https://www.youtube.com/watch?v=${v.id}${v.start ? `&t=${v.start}s` : ''}`;
const outLink = (v, text, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${esc(watchUrl(v))}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/** The demonstration block for an exercise page ('' when the item has no video). */
export function videoBlock(itemId) {
  if (DB.videosError) {
    return `<div class="callout warn"><div class="callout-title">Demonstration video unavailable</div><p>content/videos.json could not be read (${esc(DB.videosError)}).</p></div>`;
  }
  const v = videoFor(itemId);
  if (!v) return '';
  const len = /^\d{1,2}(:\d{2}){1,2}$/.test(v.length || '') ? v.length : '';
  // Source order is the spoken order ("Play video: title, channel, length"); the grid places each part.
  const caption = `<span class="demo-caption"><span class="demo-title">${esc(v.title || 'Demonstration video')}</span>${v.channel ? `<span class="demo-by"><span class="sr-only">, </span>${esc(v.channel)}</span>` : ''}</span>`;
  const badge = len ? `<span class="demo-len"><span class="sr-only">, length </span>${esc(len)}</span>` : '';
  const disc = `<span class="demo-disc">${ICONS.play}</span>`;
  if (v.embed === false) {
    return `<section class="demo" aria-label="Demonstration video">
      <div class="demo-frame steel">${outLink(v, `<span class="sr-only">Watch on YouTube: </span>${caption}${badge}${disc}`, 'demo-poster')}</div>
      <p class="demo-foot"><span class="demo-note">Opens on YouTube: its owner does not allow it to play inside other apps.</span></p>
    </section>`;
  }
  return `<section class="demo" aria-label="Demonstration video" data-video="${esc(v.id)}" data-start="${v.start}" data-title="${esc(v.title || 'Demonstration video')}">
    <div class="demo-frame steel">
      <button class="demo-poster" type="button" data-video-play><span class="sr-only">Play video: </span>${caption}${badge}${disc}</button>
    </div>
    <p class="demo-foot"><span class="demo-note">Plays from YouTube in privacy-enhanced mode. Nothing loads until you press play.</span> ${outLink(v, 'Open on YouTube')}</p>
  </section>`;
}

/** Wire up the demonstration block on a rendered page. Returns a cleanup function (or null). */
export function mountVideo(root) {
  const block = root.querySelector('.demo[data-video]');
  if (!block) return null;
  let stop = null;
  const onClick = e => {
    if (!e.target.closest('[data-video-play]')) return;
    if (stop) stop();
    stop = play(block);
  };
  block.addEventListener('click', onClick);
  return () => { if (stop) stop(); block.removeEventListener('click', onClick); };
}

/** The guided player's Demo sheet (opened by js/app.js): the exercise page's block and, during a rest, the time
 *  left above it, which the player keeps up to date ([data-player-clock]). '' when the item has no video. */
export function demoSheetHtml(itemId, { clock = '' } = {}) {
  const block = videoBlock(itemId);
  if (!block) return '';
  return `${clock ? `<p class="demo-clock" data-player-clock>Next exercise · rest left <span class="mono">${esc(clock)}</span></p>` : ''}${block}`;
}

/** mountVideo for a block in a sheet, which is hidden rather than replaced when it closes: the cleanup also
 *  removes the YouTube player, so a playing video stops at once. */
export function mountSheetVideo(root) {
  const stop = mountVideo(root);
  return () => {
    if (stop) stop();
    root.querySelectorAll('.demo-frame iframe').forEach(f => f.remove());
  };
}

function message(frame, title, text, actions) {
  frame.classList.remove('is-playing');
  frame.innerHTML = `<div class="demo-msg" role="status"><p class="demo-msg-title">${title}</p><p>${text}</p><div class="row">${actions}</div></div>`;
}

function play(block) {
  const frame = block.querySelector('.demo-frame');
  const v = { id: block.dataset.video, start: +block.dataset.start || 0, title: block.dataset.title };
  const watch = outLink(v, 'Watch on YouTube', 'btn primary small');
  if (navigator.onLine === false) {
    message(frame, 'You’re offline', 'The video streams from YouTube, so it needs a connection. Everything else on this page works offline.',
      `<button class="btn small" type="button" data-video-play>Try again</button>`);
    return null;
  }
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', enablejsapi: '1', origin: location.origin });
  if (v.start) params.set('start', String(v.start));
  const iframe = document.createElement('iframe');
  iframe.src = `${HOST}/embed/${encodeURIComponent(v.id)}?${params}`;
  iframe.title = `${v.title} (YouTube video)`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  iframe.allowFullscreen = true;
  // YouTube refuses to play embeds that do not say which site they are on, so keep the default referrer policy.
  // (No loading="lazy": the poster already defers everything until play, and the player is on screen by then.)
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.replaceChildren(iframe);
  frame.classList.add('is-playing');
  iframe.focus();

  // The player reports readiness and errors over postMessage once told someone is listening
  // (the channel YouTube's IFrame Player API uses). An error replaces the player with an explanation.
  let heard = false, loaded = false, poll = 0;
  const note = block.querySelector('.demo-note');
  const noteText = note ? note.textContent : '';
  const hello = () => {
    try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), HOST); } catch (e) { /* gone */ }
  };
  const onMessage = e => {
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    let data = e.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (err) { return; } }
    if (!data || typeof data.event !== 'string') return;
    heard = true;
    clearInterval(poll);
    if (data.event === 'onError') {
      stop();
      message(frame, 'This video can’t play here', ERRORS[data.info] || 'YouTube reported an error.', watch);
    }
  };
  const onLoad = () => {
    loaded = true;
    if (block.classList.contains('is-slow')) {
      block.classList.remove('is-slow');
      if (note) note.textContent = noteText;
    }
    hello();
    clearInterval(poll);
    poll = setInterval(hello, 500);
    setTimeout(() => clearInterval(poll), 10000);
  };
  iframe.addEventListener('load', onLoad);
  window.addEventListener('message', onMessage);
  // Nothing at all after 15 s (no page, no player): point to YouTube instead.
  const slow = setTimeout(() => {
    if (loaded || heard) return;
    block.classList.add('is-slow');
    if (note) note.textContent = 'Not loading? The connection may be slow or blocked.';
  }, 15000);
  function stop() {
    window.removeEventListener('message', onMessage);
    iframe.removeEventListener('load', onLoad);
    clearInterval(poll);
    clearTimeout(slow);
  }
  return stop;
}
