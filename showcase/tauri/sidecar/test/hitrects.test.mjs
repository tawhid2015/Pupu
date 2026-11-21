// The click shape of the overlay on Linux (showcase/roamies/core.js: Roamie.hitRects). Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/core.js', import.meta.url), 'utf8'), {
  window, Math, Map, performance, matchMedia: () => ({ matches: false, addEventListener: noop }), addEventListener: noop, document: { addEventListener: noop },
});
const { hitRects } = window.Roamie;
const plain = (a) => Array.from(a);
const inRect = (r) => (x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const covers = (rects, x, y) => { for (let i = 0; i < rects.length; i += 4) if (inRect(rects.slice(i, i + 4))(x, y)) return true; return false; };

// Nothing clickable: no rectangles, so every click passes through.
assert.deepEqual(plain(hitRects(() => false, [0, 0, 400, 300])), []);

// One block comes back as one rectangle (rows with the same run are joined), grown by the pad.
{
  const r = plain(hitRects(inRect([120, 60, 96, 48]), [0, 0, 400, 300], 12, 8));
  assert.deepEqual(r, [112, 52, 112, 64]);
  assert.deepEqual(plain(hitRects(inRect([120, 60, 96, 48]), [0, 0, 400, 300], 12, 0)), [120, 60, 96, 48], 'no pad: exactly the block');
}

// A circle (the Roamie) is covered everywhere, and nothing far from it is.
{
  const circle = (x, y) => Math.hypot(x - 200, y - 150) < 40;
  const r = plain(hitRects(circle, [100, 50, 200, 200]));
  assert.ok(r.length % 4 === 0 && r.length >= 4);
  for (let a = 0; a < Math.PI * 2; a += 0.1) for (const d of [0, 20, 39]) assert.ok(covers(r, 200 + Math.cos(a) * d, 150 + Math.sin(a) * d), `inside at ${a.toFixed(1)}, ${d}`);
  for (const [x, y] of [[200, 80], [200, 222], [130, 150], [272, 150], [110, 60]]) assert.ok(!covers(r, x, y), `${x},${y} stays click-through`);
}

// Two things side by side stay two rectangles: the gap between them passes clicks through.
{
  const two = (x, y) => inRect([24, 24, 48, 48])(x, y) || inRect([144, 24, 48, 48])(x, y);
  const r = plain(hitRects(two, [0, 0, 240, 120], 12, 0));
  assert.deepEqual(r, [24, 24, 48, 48, 144, 24, 48, 48]);
  assert.ok(!covers(r, 100, 40));
}

// An L shape: the wide part and the narrow part are separate runs.
{
  const L = (x, y) => inRect([0, 0, 120, 24])(x, y) || inRect([0, 24, 36, 48])(x, y);
  assert.deepEqual(plain(hitRects(L, [0, 0, 120, 72], 12, 0)), [0, 0, 120, 24, 0, 24, 36, 48]);
}

// The box is where it looks: a hit outside it is never sampled, and a box off the grid still lines up.
assert.deepEqual(plain(hitRects(inRect([500, 500, 50, 50]), [0, 0, 400, 300])), []);
assert.deepEqual(plain(hitRects(() => true, [10.6, 20.2, 24, 24], 12, 0)), [10, 20, 24, 24]);
console.log('hitrects tests: passed');
