// Effort per model slot (effort.mjs). Run: npm test
import assert from 'node:assert/strict';
import { LADDER, SLOTS, isSetting, resolveEffort } from '../effort.mjs';

const full = ['low', 'medium', 'high', 'xhigh', 'max'];
assert.equal(resolveEffort('high', full), 'high');
assert.equal(resolveEffort('off', full), null, 'off sends no thinking');
assert.equal(resolveEffort('', full), 'low', 'automatic is the app default');
assert.equal(resolveEffort('', full, null), null, 'unless the app default is off');
assert.equal(resolveEffort('', full, 'medium'), 'medium');
// A level the model doesn't have goes to the nearest one above it
assert.equal(resolveEffort('low', ['high']), 'high');
assert.equal(resolveEffort('medium', ['low', 'high', 'max']), 'high');
assert.equal(resolveEffort('xhigh', ['low', 'high']), 'high', 'above everything: the highest');
assert.equal(resolveEffort('ultra', ['medium', 'high', 'xhigh']), 'xhigh');
// A model that can't think, or reports nothing
assert.equal(resolveEffort('high', []), null);
assert.equal(resolveEffort('high', undefined), null);
// Settings and slots
for (const ok of ['', 'off', ...LADDER]) assert.ok(isSetting(ok), ok);
for (const bad of ['loud', 'LOW', null, undefined, 3]) assert.ok(!isSetting(bad), String(bad));
assert.deepEqual(SLOTS, ['default', 'computer', 'code', 'agents', 'draw', 'web', 'backup1', 'backup2', 'sub_scout', 'sub_builder', 'sub_writer', 'sub_reviewer', 'sub_tidier']);

console.log('effort tests: passed');
