// The typing caret in the ask bubble (showcase/roamies/agent.js). Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const R = { clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t };
vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/agent.js', import.meta.url), 'utf8'), { window: { Roamie: R }, Math });
const lines = [{ start: 0, s: 'hello there' }, { start: 12, s: 'friend' }]; // "hello there friend", wrapped at the space
const at = (c) => ({ ...R.caretAt(lines, c) });

// Regression: the caret was always drawn at the end, so after moving back to fix a word, typing landed mid-text unseen.
assert.deepEqual(at(18), { li: 1, col: 6 }, 'at the end');
assert.deepEqual(at(3), { li: 0, col: 3 }, 'moved back into the first line');
assert.deepEqual(at(11), { li: 0, col: 11 }, 'on the space a wrap dropped: end of the first line');
assert.deepEqual(at(12), { li: 1, col: 0 }, 'start of the wrapped line');
assert.deepEqual(at(0), { li: 0, col: 0 });
assert.deepEqual({ ...R.caretAt([{ start: 0, s: '' }], 0) }, { li: 0, col: 0 }, 'empty text');
console.log('caret tests passed');
