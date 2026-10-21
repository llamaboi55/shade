import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approach, onScreen, spotlightStops, bandEdges } from '../src/js/shapes.js';

test('the window cutout eases toward its target and starts there', () => {
  const to = { x: 100, y: 100, w: 400, h: 300 };
  assert.deepEqual(approach(null, to, 0.3), to);
  const mid = approach({ x: 0, y: 0, w: 0, h: 0 }, to, 0.5);
  assert.deepEqual(mid, { x: 50, y: 50, w: 200, h: 150 });
});

test('a window on another screen does not cut a hole in this one', () => {
  assert.equal(onScreen({ x: 2000, y: 0, w: 500, h: 500 }, 1920, 1080), false);
  assert.equal(onScreen({ x: 1800, y: 100, w: 500, h: 500 }, 1920, 1080), true);
  assert.equal(onScreen(null, 1920, 1080), false);
});

test('spotlight stops stay ordered for every softness', () => {
  for (const s of [-1, 0, 0.5, 1, 2]) {
    const stops = spotlightStops(s);
    for (let i = 1; i < stops.length; i++) assert.ok(stops[i][0] >= stops[i - 1][0]);
    assert.equal(stops.at(-1)[1], 0);
  }
});

test('the reading band stays on screen', () => {
  assert.deepEqual(bandEdges(10, 200, 1000), { top: 0, bottom: 200 });
  assert.deepEqual(bandEdges(990, 200, 1000), { top: 800, bottom: 1000 });
  assert.deepEqual(bandEdges(500, 200, 1000), { top: 400, bottom: 600 });
});
