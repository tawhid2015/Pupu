// Where the type-to-ask field sits beside the cursor (showcase/roamies/ask-bar.js: Roamie.askBarPlace). Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Without a document only the placement rule loads, which is all that's tested here.
const window = { Roamie: {} };
vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/ask-bar.js', import.meta.url), 'utf8'), { window, Math });
const place = (cursor, size = [320, 38], bounds = B) => Array.from(window.Roamie.askBarPlace(cursor, size, bounds));
// A 1440 x 900 screen with a menu bar on top and a Dock below, less the 8 px kept clear of every edge.
const B = { l: 8, t: 41, r: 1432, b: 812 };
const inside = ([x, y], [w, h] = [320, 38], b = B) => x >= b.l && y >= b.t && x + w <= b.r && y + h <= b.b;
const covers = ([x, y], [w, h], [cx, cy]) => cx >= x && cx <= x + w && cy >= y && cy <= y + h;

// In the open: right of the arrow and just below its tip, so the arrow never covers what's typed.
assert.deepEqual(place([400, 300]), [418, 308]);
// Near the right edge it goes to the cursor's left; near the bottom, above it; in the corner, both.
assert.deepEqual(place([1300, 300]), [1300 - 8 - 320, 308], 'flips left');
assert.deepEqual(place([400, 800]), [418, 800 - 8 - 38], 'flips up');
assert.deepEqual(place([1420, 805]), [1420 - 8 - 320, 805 - 8 - 38], 'the bottom-right corner');
// The last spot it still fits on the right, and the first where it doesn't.
assert.deepEqual(place([1432 - 320 - 18, 300]), [1112, 308]);
assert.deepEqual(place([1432 - 320 - 17, 300]), [1432 - 320 - 17 - 8 - 320, 308]);
// Five lines tall (110 px): it flips up sooner.
assert.deepEqual(place([400, 700], [320, 110]), [418, 700 - 8 - 110]);
// Always inside the safe area and never under the cursor, wherever the cursor is (even over the menu bar or Dock).
for (const size of [[320, 38], [320, 110]]) {
  for (let cx = 0; cx <= 1440; cx += 36) {
    for (let cy = 0; cy <= 900; cy += 30) {
      const p = place([cx, cy], size);
      assert.ok(inside(p, size), `on screen for a cursor at ${cx},${cy}: ${p}`);
      assert.ok(!covers(p, size, [cx, cy]), `clear of a cursor at ${cx},${cy}: ${p}`);
      assert.ok(p.every(Number.isInteger), 'whole pixels, so the text stays crisp');
    }
  }
}
// A cursor on another screen (past this overlay's edge): held at the nearest edge.
assert.deepEqual(place([-500, 300]), [8, 308]);
assert.deepEqual(place([3000, -40]), [1432 - 320, 41]);
// Room smaller than the field: its left and top edges stay in view.
assert.deepEqual(place([100, 60], [320, 38], { l: 8, t: 8, r: 200, b: 30 }), [8, 8]);
console.log('askbar tests: passed');

// Clicking away closes it, even with something typed; what was typed comes back, selected, on the next open.
{
  const node = () => {
    const on = {}, cls = new Set();
    return { on, style: {}, classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), has: (c) => cls.has(c) },
      addEventListener: (t, f) => { on[t] = f; }, setAttribute() {}, append() {}, appendChild() {},
      focus() {}, blur() {}, select() { this.selected = true; }, offsetWidth: 320, offsetHeight: 38, scrollHeight: 18, value: '' };
  };
  const made = [];
  const document = { createElement: () => { const n = node(); made.push(n); return n; }, head: node(), body: node() };
  let now = 0;
  const w = { Roamie: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/ask-bar.js', import.meta.url), 'utf8'),
    { window: w, Math, document, performance: { now: () => now }, innerWidth: 1440, innerHeight: 900 });
  const bar = w.Roamie.askBar;
  let left = 0;
  const open = (o = {}) => bar.open({ ...o, onLeft: () => { left++; bar.close(); } });
  open();
  const ta = made.find((n) => 'rows' in n);
  const el = made.find((n) => n.className === 'ab');
  ta.value = 'draft of a long question';
  now = 1000; ta.on.blur();
  assert.equal(left, 1, 'clicking away leaves the ask');
  assert.equal(bar.isOpen, false, 'and the field closes');
  assert.ok(!el.classList.has('on'));
  open(); bar.focus();
  assert.equal(bar.value, 'draft of a long question', 'what was typed comes back');
  assert.ok(ta.selected, 'selected, so typing replaces it');
  bar.close(); ta.selected = false;
  open(); assert.equal(bar.value, '', 'closed on purpose (Esc or sent): the draft is gone');
  ta.value = 'kept'; now = 2000; ta.on.blur();
  open({ value: 'Connect my ' }); bar.focus();
  assert.equal(bar.value, 'Connect my ', 'a prefilled open wins over a draft');
  assert.ok(!ta.selected);
  bar.close();
  open(); ta.value = '   '; now = 3000; ta.on.blur();
  open(); assert.equal(bar.value, '', 'nothing but spaces is not kept');
  console.log('askbar click-away tests: passed');
}
