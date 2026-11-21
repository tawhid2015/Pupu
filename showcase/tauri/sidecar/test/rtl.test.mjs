// Right-to-left text (showcase/roamies/core.js: Roamie.rtl): Arabic and Hebrew lines are drawn whole and right-aligned
// in the speech bubble so letters join (#69). Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
const window = {};
vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/core.js', import.meta.url), 'utf8'), {
  window, Math, Map, performance, matchMedia: () => ({ matches: false, addEventListener: noop }), addEventListener: noop, document: { addEventListener: noop },
});
const { rtl } = window.Roamie;
for (const s of ['مرحبا بك', 'שלום', 'Roamies يعمل الآن', 'ﻻ', 'ܫܠܡܐ']) assert.equal(rtl(s), true, s);
for (const s of ['Hello there', 'Привет', '你好', 'café 42', '', null, undefined]) assert.equal(rtl(s), false, String(s));
console.log('rtl tests: passed');
