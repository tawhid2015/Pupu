// Arabic and Bengali replies: the fonts that draw them are bundled and declared in every page that shows text
// (desktop.html for the overlay, onboarding.css for the panel and setup guide), with their licences and credit.
// Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const WOFF = 'onboarding/fonts/readex-pro-arabic.woff2';
assert.ok(fs.statSync(new URL(WOFF, root)).size > 10_000, 'the Arabic font file is bundled');
assert.ok(fs.statSync(new URL('onboarding/fonts/OFL-ReadexPro.txt', root)).size > 1000, 'with its licence text');
const BN = 'onboarding/fonts/NotoSansBengali-Regular.ttf';
assert.ok(fs.statSync(new URL(BN, root)).size > 100_000, 'the Bengali font file is bundled');
assert.ok(fs.statSync(new URL('onboarding/fonts/OFL-NotoSansBengali.txt', root)).size > 1000, 'with its licence text');
assert.match(fs.readFileSync(new URL('../THIRD_PARTY_NOTICES.md', root), 'utf8'), /Readex Pro/, 'Arabic font credited');
assert.match(fs.readFileSync(new URL('../THIRD_PARTY_NOTICES.md', root), 'utf8'), /Noto Sans Bengali/, 'Bengali font credited');

for (const [file, ar, bn] of [
  ['desktop.html', 'onboarding/fonts/readex-pro-arabic.woff2', 'onboarding/fonts/NotoSansBengali-Regular.ttf'],
  ['onboarding/onboarding.css', 'fonts/readex-pro-arabic.woff2', 'fonts/NotoSansBengali-Regular.ttf'],
]) {
  const css = read(file);
  const face = (name) => new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${name}";[^}]*\\}`).exec(css)?.[0] ?? '';
  const letters = face('Roamies Arabic'), rtl = face('Roamies Arabic RTL'), bengali = face('Roamies Bengali');
  assert.ok(letters && rtl, `${file} declares both Arabic faces`);
  assert.ok(letters.includes(ar) && rtl.includes(ar), `${file}: both load the bundled Arabic file`);
  assert.ok(!/U\+0020/.test(letters), `${file}: the letters face leaves the space to Martian Mono`);
  assert.ok(/U\+0020/.test(rtl) && /U\+0600-06FF/.test(rtl), `${file}: the right-to-left face also takes the space`);
  assert.ok(bengali.includes(bn) && /U\+0980-09FF/.test(bengali), `${file}: declares the bundled Bengali face for Bangla letters`);
}
assert.match(read('onboarding/onboarding.css'), /--mono:\s*"Martian Mono",\s*"Roamies Bengali",\s*"Roamies Arabic"/, 'the panel stack has a real Bengali font after Martian Mono');

// Where the overlay draws or lays out text, Arabic and Bengali get fonts the mono face doesn't have:
// canvas stacks and the card / capsule / ask bar rules.
const js = (f) => read(`roamies/${f}`);
for (const f of ['glass.js', 'ink.js', 'agent.js', 'agent-panel.js', 'agent-home.js', 'ask-bar.js', 'notch.js']) {
  assert.match(js(f), /"Martian Mono", "Roamies Bengali", "Roamies Arabic"/, `${f}: Bengali and Arabic letters after Martian Mono`);
}
assert.match(js('core.js'), /R\.rtlFont = \(s, font\) => \(R\.rtl\(s\) \? String\(font\)\.replace\('"Martian Mono"', '"Roamies Arabic RTL", "Martian Mono"'\)/, 'right-to-left canvas text puts the Arabic face first');
// Bengali joins letters into conjuncts and moves vowel signs around, so it must be drawn as one shaped run in a
// proportional Bengali face, never letter-by-letter on the monospace grid (that broke the glyphs).
assert.match(js('core.js'), /R\.indic = \(s\) => INDIC\.test/, 'Indic script is detected');
assert.match(js('core.js'), /R\.indicFont = \(s, font\) => \(R\.indic\(s\) \? String\(font\)\.replace\('"Martian Mono"', '"Roamies Bengali", "Martian Mono"'\)/, 'Indic canvas text puts the Bengali face first');
assert.match(js('agent.js'), /if \(R\.indic\(line\.s\)\) \{[\s\S]*?fillText\(line\.s\.slice\(0, n\)\.trimEnd\(\), 0, cy, iw\)/, 'the bubble draws Bengali lines whole, left aligned');
assert.match(js('glass.js'), /R\.indicFont\(str, R\.rtlFont \? R\.rtlFont\(str, font\) : font\)/, 'cards and capsules shape Bengali as a run too');
assert.match(js('ink.js'), /R\.indicFont\(str, R\.rtlFont\(str, font\)\)/, 'drawn card text shapes Bengali as a run too');
assert.match(js('agent.js'), /const rf = R\.rtlFont\(line\.s, fontFor\(0\)\)/, 'the bubble draws Arabic lines with it');
assert.match(js('agent-panel.js'), /\.rp-body :dir\(rtl\) \{ font-family: "Roamies Arabic RTL"/, 'the card too, per paragraph');
assert.match(js('notch.js'), /\.nc-line:dir\(rtl\) \{ font-family: "Roamies Arabic RTL"/, 'and the capsule, per line');
assert.match(js('ask-bar.js'), /ta\.dir = 'auto'/, 'typing Arabic runs right to left');

console.log('arabic tests: passed');
