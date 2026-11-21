// What's new: the data file the commit command keeps up to date, and when the page opens by itself. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkWhatsNew, newer, whatsNewOnStart } from '../whatsnew.mjs';

assert.ok(newer('0.1.10', '0.1.9') && newer('1.0.0', '0.9.9') && !newer('0.1.36', '0.1.36') && !newer('0.1.35', '0.1.36'));

// Opens after an update only: not on a fresh install, not on the same version, not on a downgrade.
assert.deepEqual(whatsNewOnStart({ seen: '0.1.35', version: '0.1.36', onboarded: true }), { open: true, from: '0.1.35', seen: '0.1.36' });
assert.deepEqual(whatsNewOnStart({ seen: undefined, version: '0.1.36', onboarded: true }), { open: true, from: null, seen: '0.1.36' }, 'set up before What\'s new existed');
assert.equal(whatsNewOnStart({ seen: undefined, version: '0.1.36', onboarded: false }).open, false, 'a fresh install');
assert.equal(whatsNewOnStart({ seen: '0.1.36', version: '0.1.36', onboarded: true }).open, false);
assert.equal(whatsNewOnStart({ seen: '0.1.37', version: '0.1.36', onboarded: true }).open, false, 'a downgrade');
assert.equal(whatsNewOnStart({ seen: '0.1.35', version: '0.0.0', onboarded: true }).open, false, 'no version (a dev run without one)');

// The shipped file follows its rules (the commit command adds to it).
const data = JSON.parse(fs.readFileSync(new URL('../../../panel/whatsnew.json', import.meta.url), 'utf8'));
assert.deepEqual(checkWhatsNew(data), []);
// And the rules catch what they should.
const one = (it, u = {}) => checkWhatsNew({ updates: [{ version: '0.1.0', date: '2026-01-01', items: [{ kind: 'new', title: 'Hi', text: 'Hello.', ...it }], ...u }] });
assert.match(one({ kind: 'feature' })[0], /kind/);
assert.match(one({ title: 'x'.repeat(33) })[0], /keep it to 32/);
assert.match(one({ text: 'x'.repeat(89) })[0], /keep it to 88/);
assert.match(one({ text: 'Fast — really' })[0], /dash/);
assert.match(one({}, { version: 'v1' })[0], /x\.y\.z/);
assert.match(checkWhatsNew({ updates: [{ version: '0.1.0', date: '2026-01-01', items: [{ kind: 'new', title: 'a', text: 'b' }] }, { version: null, date: '2026-01-01', items: [{ kind: 'new', title: 'a', text: 'b' }] }] })[0], /unreleased/);
assert.match(checkWhatsNew({ updates: Array.from({ length: 51 }, () => ({ version: '0.1.0', date: '2026-01-01', items: [{ kind: 'new', title: 'a', text: 'b' }] })) })[0], /newest 50/);
console.log('whatsnew tests: passed');
