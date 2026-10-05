// Billowing puff: a cloud of smoke traveling through each progress bar as if it were a glass chamber,
// seen side-on, with a separate billowing head layer at the front. The smoke stays neutral silver; outcomes are shown
// by the engraved scale beneath the glass. It animates only while a run is active; finished bars keep
// a faint still veil. Without JavaScript (exported reports), the CSS steam treatment remains.


function hash(x, y) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, n = 4) { let s = 0, a = .5, m = 0; for (let i = 0; i < n; i++) { s += a * noise(x, y); m += a; x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; a *= .5; } return s / m; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = x => Math.min(1, Math.max(0, x));

// Straight-alpha RGBA for one bar, rows top to bottom. U runs along the bar in units of bar height (V is 0 at the
// top, 1 at the floor); the smoke spans start..front. tintAt(u) returns the result color under that point or null.
export function smokePixels({start = 0, front, aspect, time: t, active = true, tintAt = () => null, rows = 10}) {
  const bh = rows, bw = Math.max(8, Math.min(240, Math.round(aspect * bh))), data = new Uint8ClampedArray(bw * bh * 4);
  const span = front - start;
  if (!(span > .02)) return {width: bw, height: bh, data};
  const f = .28 * 2.2 * t, fade = Math.min(1, span / .3), strength = active ? .84 : .42;
  for (let j = 0; j < bh; j++) {
    const V = (j + .5) / bh, edge = front + .28 * Math.sqrt(Math.max(0, 1 - (2 * V - 1) ** 2)) - .28 + .05 * Math.sin(t * .9 + V * 3);
    for (let i = 0; i < bw; i++) {
      const U = (i + .5) / bw * aspect, o = (j * bw + i) * 4;
      if (U < start - .2) continue;
      let r = 0, g = 0, b = 0, a = 0;
      // Base cloud, lit from above: a billow is lit where it is denser than the smoke just over it.
      const q = fbm(U * 1.3 - f * .6, V * 1.6 + t * .18, 3), n = fbm(U * .95 - f + q * 1.2, V * 1.3 + q * .8 - t * .12);
      const dd = U - edge + (n - .5) * 1.1;
      const dens = (1 - smooth(-.32, .19, dd)) * smooth(start - .2, start + .4, U) * (.85 + .15 * Math.sin(V * Math.PI)) * Math.pow(.2 + .8 * n, 1.6) * 1.35;
      if (dens * fade >= .01) {
        const above = fbm(U * .95 - f + .4, (V - .18) * 1.3 - t * .12, 3);
        const m = Math.min(1, clamp(.5 + (n - above) * 1.5 + (1 - V) * .2) + Math.exp(-Math.abs(dd) * 5) * .2);
        r = 122 + 118 * m; g = 132 + 112 * m; b = 148 + 102 * m; a = Math.min(1, dens) * fade * strength;
      }
      // Head layer: a bright billow at the front, churning faster than the cloud behind it. Active runs only.
      const x = U - (front + (edge - front) * .5);
      if (active && x > -2.2 && x < .6) {
        const w = fbm(U * 1.8 - f * 1.2, V * 2 + t * .3, 3), c = fbm(U * 2.6 - f * 1.8 + w * 1.3, V * 2.8 + w - t * .45);
        const head = Math.exp(-(((x + .55) / .8) ** 2)) * (1 - smooth(-.1, .35, x - (c - .5) * .9)) * Math.pow(.15 + .95 * c, 1.8) * 1.6;
        if (head * fade >= .02) {
          const above = fbm(U * 2.6 - f * 1.8 + w * 1.3, (V - .16) * 2.8 + w - t * .45, 3), m = clamp(.55 + (c - above) * 1.8 + (1 - V) * .2);
          const ha = Math.min(1, head) * fade * .84, out = ha + a * (1 - ha);
          r = ((132 + 100 * m) * ha + r * a * (1 - ha)) / out; g = ((142 + 96 * m) * ha + g * a * (1 - ha)) / out; b = ((158 + 88 * m) * ha + b * a * (1 - ha)) / out; a = out;
        }
      }
      if (a <= 0) continue;
      const tint = tintAt(U);
      if (tint) { r += (tint[0] - r) * .38; g += (tint[1] - g) * .38; b += (tint[2] - b) * .38; }
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a * 255;
    }
  }
  return {width: bw, height: bh, data};
}

let started = false;
// Attach smoke to every .run-progress bar on the page, now and after re-renders. One shared clock keeps the
// smoke continuous when a bar's markup is replaced.
export function startSmokeProgress(root = document) {
  if (started || typeof window === 'undefined') return;
  started = true;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)'), clock = performance.now();
  let last = 0;
  function draw(bar, now) {
    const channel = bar.querySelector('.steam-channel'), fill = bar.querySelector('.progress-fill');
    if (!channel || !fill) return;
    let canvas = channel.querySelector(':scope > canvas.smoke-canvas');
    if (!canvas) { canvas = document.createElement('canvas'); canvas.className = 'smoke-canvas'; canvas.setAttribute('aria-hidden', 'true'); channel.append(canvas); }
    const box = channel.getBoundingClientRect(), fillBox = fill.getBoundingClientRect();
    if (box.width < 4 || box.height < 2 || box.bottom < 0 || box.top > innerHeight) return;
    const active = bar.dataset.active === 'true' && !reduce.matches, h = box.height;
    const start = Math.max(0, (fillBox.left - box.left) / h), front = Math.min(box.width, fillBox.right - box.left) / h;
    const key = [Math.round(box.width), Math.round(h), front.toFixed(3), start.toFixed(3), active].join('|');
    if (!active && canvas.dataset.still === key) return;
    const image = smokePixels({start, front, aspect: box.width / h, time: active ? (now - clock) / 1000 : 4, active});
    const dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(box.width * dpr), ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const buffer = canvas._buffer && canvas._buffer.width === image.width && canvas._buffer.height === image.height ? canvas._buffer : Object.assign(document.createElement('canvas'), {width: image.width, height: image.height});
    canvas._buffer = buffer;
    buffer.getContext('2d').putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(buffer, 0, 0, cw, ch);
    canvas.dataset.still = active ? '' : key;
    bar.classList.add('has-smoke');
  }
  const drawAll = now => { for (const bar of root.querySelectorAll('.run-progress')) draw(bar, now); };
  // Progress polling can replace an entire bar between animation frames. Mutation delivery
  // runs before paint, so fill new canvases now rather than exposing an empty chamber.
  const observer = new MutationObserver(records => {
    if (document.hidden) return;
    const changed = records.some(record => {
      const nodes = [...record.addedNodes, ...record.removedNodes].filter(node => node.nodeType === 1 && !node.classList?.contains('smoke-canvas'));
      return nodes.length && (record.target.closest?.('.run-progress') || nodes.some(node => node.matches?.('.run-progress') || node.querySelector?.('.run-progress')));
    });
    if (changed) drawAll(performance.now());
  });
  observer.observe(root, {childList:true, subtree:true});
  function frame(now) {
    if (!document.hidden && now - last >= 33) { last = now; drawAll(now); }
    requestAnimationFrame(frame);
  }
  drawAll(performance.now());
  requestAnimationFrame(frame);
}
