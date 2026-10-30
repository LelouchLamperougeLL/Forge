// Small visual feedback for finished work: a burst of sparks, like struck hot steel.
// Purely decorative (aria-hidden, no pointer events) and skipped when reduced motion is preferred.

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Burst of sparks at viewport point (x, y). `count` sets the size; sparks fly mostly upwards. */
export function sparks(x, y, { count = 14, spread = 150, reach = 70 } = {}) {
  if (reduced() || !document.body) return;
  const layer = document.createElement('div');
  layer.className = 'sparks';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  layer.appendChild(document.createElement('b'));
  for (let i = 0; i < count; i++) {
    const a = (-90 + (Math.random() - 0.5) * spread) * Math.PI / 180;
    const d = reach * (0.45 + Math.random() * 0.75);
    const s = document.createElement('i');
    s.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
    // A little gravity: sparks drop back at the end of their flight.
    s.style.setProperty('--dy', `${(Math.sin(a) * d + d * 0.35).toFixed(1)}px`);
    s.style.setProperty('--rot', `${(a + Math.PI / 2).toFixed(3)}rad`);
    s.style.setProperty('--dur', `${Math.round(480 + Math.random() * 320)}ms`);
    s.style.setProperty('--delay', `${Math.round(Math.random() * 70)}ms`);
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1000);
}

/** Sparks from the centre of an element (e.g. the checkbox or button that was pressed). */
export function sparksFrom(el, opts) {
  if (!el || !el.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  sparks(r.left + r.width / 2, r.top + r.height / 2, opts);
}
