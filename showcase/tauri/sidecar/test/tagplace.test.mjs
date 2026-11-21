// Where the task tag goes while a bubble is open (showcase/roamies/agent.js: Roamie.tagPlace), and that the open bubble is
// drawn over it. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../../../roamies/agent.js', import.meta.url), 'utf8');
const R = { clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t };
vm.runInNewContext(src, { window: { Roamie: R }, Math });

// A 1440 x 900 screen under a 25 px menu bar, with an 80 px Dock. The overlay's unit is 400, so the body's radius is 60
// (30 at the small size) and an LED cell is 4 px.
const S = { l: 0, t: 25, r: 1440, b: 820 };
const P = 4, EDGE = P * 2 + 4, TAG_H = 30, SMALL = 30, DEFAULT = 60;
const place = (body, w, bubble, had) => ({ ...R.tagPlace({ w, h: TAG_H }, body, S, bubble ?? null, had) });
// The tag as tagBox placed it before: under the body, centred, or above it when the bubble is below; 8 px inside the screen.
const before = ({ x, y, r }, w, side) => ({
  x: R.clamp(x - w / 2, S.l + 8, Math.max(S.l + 8, S.r - w - 8)),
  y: R.clamp(side === 'below' ? y - r * 1.5 - TAG_H : y + r * 1.32, S.t + 8, Math.max(S.t + 8, S.b - TAG_H - 8)),
  w, h: TAG_H,
});
// A bubble where step() puts it: above or below the head, or beside it with its top level with the head, inside the screen.
const bubble = (side, { x, y, r }, w, h) => {
  const gap = r * 0.5 + P * 2;
  const [bx, by] = { above: [x - w / 2, y - r * 1.1 - gap - h], below: [x - w / 2, y + r * 1.1 + gap], right: [x + r * 1.2 + gap, y - r * 0.95], left: [x - r * 1.2 - gap - w, y - r * 0.95] }[side];
  return { side, x: R.clamp(bx, S.l + EDGE, Math.max(S.l + EDGE, S.r - EDGE - w)), y: R.clamp(by, S.t + EDGE, Math.max(S.t + EDGE, S.b - EDGE - h)), w, h };
};
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 1e-6 && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 1e-6;
const inside = (g) => g.x >= S.l + 8 - 1e-9 && g.x + g.w <= S.r - 8 + 1e-9 && g.y >= S.t + 8 - 1e-9 && g.y + g.h <= S.b - 8 + 1e-9;
const box = (g) => ({ x: g.x, y: g.y, w: g.w, h: g.h });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// No bubble, or one that doesn't reach the tag: exactly where it always was, edges included.
for (const r of [SMALL, DEFAULT]) for (const x of [0, 20, 700, 1430, 1440]) for (const y of [30, 400, 810]) {
  const body = { x, y, r };
  assert.deepEqual(box(place(body, 300)), before(body, 300), `no bubble: unchanged (r ${r}, body ${x},${y})`);
}
{
  const body = { x: 700, y: 400, r: SMALL };
  assert.deepEqual(box(place(body, 300, bubble('above', body, 340, 120))), before(body, 300, 'above'), 'a bubble above: unchanged');
  assert.deepEqual(box(place(body, 300, bubble('below', body, 340, 120))), before(body, 300, 'below'), 'a bubble below: above the body, as before');
  assert.deepEqual(box(place(body, 300, { ...bubble('right', body, 200, 60), x: 1200 })), before(body, 300), 'a bubble beside but far off: unchanged');
}

// Regression: a permission prompt opens beside the body at the small size, level with its head and growing down, and the tag
// (up to 340 px wide, centred under the body) covered its bottom-left: the Allow button.
for (const side of ['right', 'left']) {
  const body = { x: 700, y: 400, r: SMALL }, prompt = bubble(side, body, 340, 170);
  assert.ok(overlaps(before(body, 340), prompt), `precondition: the old place covers a prompt on the ${side}`);
  const g = place(body, 340, prompt);
  assert.ok(!overlaps(g, prompt) && inside(g), `clear of a prompt on the ${side}, and on screen`);
  near(g.y, before(body, 340).y, 'still under the body, only moved sideways');
  if (side === 'right') near(g.x + g.w, prompt.x - 8, 'away from the prompt, 8 px clear'); else near(g.x, prompt.x + prompt.w + 8, 'away from the prompt, 8 px clear');
}
// At a wall there's no room beside it: above the body. In the top corner not even that: just under the bubble.
{
  const body = { x: 60, y: 400, r: SMALL }, prompt = bubble('right', body, 340, 170), g = place(body, 340, prompt);
  assert.ok(!overlaps(g, prompt) && inside(g));
  near(g.y, 400 - SMALL * 1.5 - TAG_H, 'above the body'); near(g.x, S.l + 8, 'held in from the left wall');
  const mirror = { x: 1380, y: 400, r: SMALL }, p2 = bubble('left', mirror, 340, 170), g2 = place(mirror, 340, p2);
  assert.ok(!overlaps(g2, p2) && inside(g2)); near(g2.x + g2.w, S.r - 8, 'held in from the right wall');
  const corner = { x: 60, y: 60, r: SMALL }, p3 = bubble('right', corner, 340, 170), g3 = place(corner, 340, p3);
  assert.ok(overlaps(before(corner, 340), p3), 'precondition');
  assert.ok(!overlaps(g3, p3) && inside(g3)); near(g3.y, p3.y + p3.h + 8, 'just under the bubble, 8 px clear');
}
// Nowhere clear (a bubble as tall as the screen): on screen, and covering no more of it than before.
{
  const body = { x: 60, y: 600, r: SMALL }, tall = bubble('right', body, 340, 700), g = place(body, 340, tall);
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  assert.ok(inside(g) && area(g, tall) <= area(before(body, 340), tall));
}
// Every bubble beside the body that step() would open there: the tag is clear of it and on screen.
{
  let n = 0, moved = 0;
  for (const r of [14, SMALL, DEFAULT, 135]) for (const side of ['right', 'left']) for (const x of [140, 400, 720, 1040, 1300]) for (const y of [200, 420, 600])
    for (const bw of [160, 340, 420]) for (const bh of [40, 100, 170, 320]) for (const tw of [90, 180, 340]) {
      const body = { x, y, r }, bb = bubble(side, body, bw, bh), gap = r * 0.5 + P * 2;
      const bx = side === 'right' ? x + r * 1.2 + gap : x - r * 1.2 - gap - bw;
      // A side that doesn't fit isn't chosen; a bubble the bottom edge pushed up past the head is the "nowhere clear" case above.
      if (bx < S.l + EDGE || bx + bw > S.r - EDGE || bb.y < y - r * 0.95 - 0.5) continue;
      const g = place(body, tw, bb);
      assert.ok(inside(g) && !overlaps(g, bb), `clear (r ${r}, ${side}, body ${x},${y}, bubble ${bw}x${bh}, tag ${tw}): ${JSON.stringify(box(g))} vs ${JSON.stringify(bb)}`);
      n++; if (overlaps(before(body, tw), bb)) moved++;
    }
  assert.ok(n > 1000 && moved > 100, `not vacuous: ${n} cases, ${moved} that had to move`);
}

// Regression: placed afresh every frame, a body drifting a few pixels across the edge of "clear" flipped the tag back and forth
// across the whole overlap. The spot it had for a bubble is kept while it stays clear; an earlier one comes back once clear by 16.
{
  const body = { x: 700, y: 400, r: SMALL }, home = before(body, 340);
  const edge = { ...bubble('right', body, 340, 100), h: home.y - 8 - (400 - SMALL * 0.95) }; // its bottom 8 px above the tag
  let had;
  const frame = (dy, bb = edge, dx = 0) => { const g = place({ ...body, x: 700 + dx, y: 400 + dy }, 340, bb, had); had = g.spot; return g.x; };
  near(frame(0), home.x, 'clear by exactly 8: where it always was');
  const aside = edge.x - 8 - 340;
  near(frame(-4), aside, '4 px closer: it steps aside, once');
  for (const dy of [0, 4, -4, 7, 0, -3]) near(frame(dy), aside, `and holds still through a bob of ${dy}`);
  for (const dx of [-4, 4, 0]) near(frame(0, edge, dx), aside, `and a sideways bob of ${dx}`);
  near(frame(8), home.x, 'back once its old spot is clear by 16');
  near(frame(0), home.x, 'which it keeps at 8');
  near(frame(-3), aside, 'and leaves again when it would touch');
  // A real change still moves it: the bubble grows into it, then shrinks away.
  had = undefined;
  near(frame(0, { ...edge, h: 40 }), home.x, 'a short bubble: under the body');
  near(frame(0, { ...edge, h: edge.h + 2 }), aside, 'grown into it: aside');
  near(frame(0, { ...edge, h: 40 }), home.x, 'shrunk away again: back');
  // Remembering never puts it on the bubble when a fresh choice wouldn't.
  for (const [dx, dy, dh] of [[0, 0, 0], [3, -3, 0], [-3, 3, 4], [0, 4, -4], [0, 0, 20], [0, 0, -20], [-4, -4, 0]]) {
    const bb = { ...edge, h: edge.h + dh }, at = { ...body, x: 700 + dx, y: 400 + dy };
    const g = place(at, 340, bb, had); had = g.spot;
    if (!overlaps(place(at, 340, bb), bb)) assert.ok(!overlaps(g, bb), `remembered spot on the bubble (drift ${dx},${dy},${dh})`);
  }
}

// The agent layer: the tag is placed from the open bubble's anchor and remembers its spot on that bubble, and every bubble is
// drawn after it (on top): the open one, and one fading out (the tag takes its usual spot back the moment a bubble closes).
{
  const tagBox = src.slice(src.indexOf('const tagBox = '), src.indexOf('const drawTag = '));
  assert.match(tagBox, /tagPlace\(\{ w, h: TAG_H \}, \{ x: b\?\.ax \?\? m\.x, y: b\?\.ay \?\? m\.y, r: k\.R \}/, 'tagBox places it from the bubble\'s anchor');
  assert.match(tagBox, /b\?\.tagSpot\);\s*if \(b\) b\.tagSpot = g\.spot;/, 'and remembers its spot on the bubble');
  const over = src.slice(src.indexOf('over: (ctx, env) => {'), src.indexOf('return self;'));
  const at = (s) => { const i = over.indexOf(s); assert.ok(i > 0, `over draws ${s}`); return i; };
  assert.ok(at('drawTag(ctx, tool)') < at('if (b) { drawBubble(ctx, b)'), 'the open bubble is drawn over the tag');
  assert.ok(at('drawTag(ctx, tool)') < at('for (const bb of dying) { drawBubble(ctx, bb)'), 'and so is a bubble fading out');
}
console.log('tag place tests: passed');
