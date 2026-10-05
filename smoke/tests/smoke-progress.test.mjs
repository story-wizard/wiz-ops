import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {smokePixels} from '../public/smoke-progress.js';

const coverage = image => {
  const {width, height, data} = image, columns = Array(width).fill(0);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) columns[i] += data[(j * width + i) * 4 + 3];
  return columns;
};

test('smoke stays within the occupied part of the bar and leads with a head', () => {
  assert.equal(coverage(smokePixels({front: 0, aspect: 30, time: 7})).reduce((a, b) => a + b), 0, 'no smoke at zero progress');
  const half = coverage(smokePixels({front: 15, aspect: 30, time: 7})), quarter = half.length / 4;
  assert.ok(half.slice(0, quarter).some(Boolean), 'smoke fills behind the front');
  assert.equal(half.slice(Math.ceil(half.length * .6)).reduce((a, b) => a + b), 0, 'smoke does not run ahead of the front');
  const still = coverage(smokePixels({front: 15, aspect: 30, time: 7, active: false}));
  const near = c => c.slice(Math.floor(half.length * .4), Math.floor(half.length * .5)).reduce((a, b) => a + b);
  assert.ok(near(half) > near(still) * 1.5, 'active bars carry a brighter head; finished bars a faint veil');
});

test('result colors tint the smoke', () => {
  const plain = smokePixels({front: 30, aspect: 30, time: 7}), tinted = smokePixels({front: 30, aspect: 30, time: 7, tintAt: () => [232, 145, 145]});
  let redder = 0;
  for (let o = 0; o < plain.data.length; o += 4) if (plain.data[o + 3] > 40 && tinted.data[o] - tinted.data[o + 2] > plain.data[o] - plain.data[o + 2]) redder++;
  assert.ok(redder > 0, 'a failed segment reads redder through the smoke');
});

test('replacement progress bars contain painted smoke before the next animation frame', () => {
  // Model the browser's mutation-before-paint boundary; keep the real pixel renderer.
  let notify, now = 100;
  const frames = [], root = {bars: [], querySelectorAll: () => root.bars};
  const canvas = () => {
    const c = {dataset: {}, setAttribute() {}};
    c.getContext = () => ({
      putImageData(image) {c.pixels = image.data;},
      clearRect() {c.pixels = null;},
      drawImage(buffer) {c.pixels = buffer.pixels;},
    });
    return c;
  };
  const bar = () => {
    const channel = {
      querySelector: () => channel.canvas,
      append(c) {channel.canvas = c;},
      getBoundingClientRect: () => ({left: 0, top: 0, bottom: 14, width: 280, height: 14}),
    };
    return {
      nodeType: 1, dataset: {active: 'true'}, channel,
      classList: {add() {}, contains: () => false},
      matches: selector => selector === '.run-progress',
      querySelector: selector => selector === '.steam-channel' ? channel : {
        getBoundingClientRect: () => ({left: 0, right: 140}),
      },
    };
  };
  root.bars = [bar()];
  const source = readFileSync(process.env.SMOKE_PROGRESS_SOURCE || new URL('../public/smoke-progress.js', import.meta.url), 'utf8');
  runInNewContext(source.replace(/export function /g, 'function ') + '\nstartSmokeProgress(root);', {
    root, window: {}, document: {hidden: false, createElement: canvas},
    performance: {now: () => now}, matchMedia: () => ({matches: false}),
    innerHeight: 900, devicePixelRatio: 1,
    ImageData: class {constructor(data) {this.data = data;}},
    MutationObserver: class {constructor(cb) {notify = cb;} observe() {}},
    requestAnimationFrame: cb => frames.push(cb),
  });
  // An ordinary frame establishes the previous bar, even in the buggy renderer.
  frames.shift()(now);
  const original = root.bars[0], replacement = bar();
  root.bars = [replacement];
  now += 1;
  notify?.([{target: root, addedNodes: [replacement], removedNodes: [original]}]);
  const pixels = replacement.channel.canvas?.pixels;
  assert.ok(pixels?.some((value, index) => index % 4 === 3 && value > 0),
    'the browser must not paint an empty chamber after a polling update');
});
