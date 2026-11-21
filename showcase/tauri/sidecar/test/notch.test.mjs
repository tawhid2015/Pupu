// The notch capsule (#86): off unless picked, only on a Mac with a notched screen (notch.mjs), and in the overlay
// (showcase/roamies/notch.js) it takes clicks only with something to act on and tells screen readers the whole reply
// once, not every streamed word. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pickNotch } from '../notch.mjs';

assert.equal(pickNotch({ notchScreen: true, pick: undefined }), 'off', 'off until picked');
assert.equal(pickNotch({ notchScreen: true, pick: 'drop' }), 'drop');
assert.equal(pickNotch({ notchScreen: true, pick: 'spread' }), 'spread');
// The capsule comes to Windows, Linux and Macs without a notch; the notch style needs a notch, else it's the capsule.
assert.equal(pickNotch({ notchScreen: false, pick: 'drop' }), 'drop', 'no notched screen: the capsule still');
assert.equal(pickNotch({ notchScreen: false, pick: 'spread' }), 'drop', 'no notch to widen out of');
assert.equal(pickNotch({ notchScreen: false, pick: undefined }), 'off');
assert.equal(pickNotch({ notchScreen: true, pick: 'nonsense' }), 'off');

// A stand-in DOM: every element answers anything, and covers the box 0..500 x 0..60.
const noop = () => {};
const els = [];
function node(tag) {
  const attrs = {}, kids = [], found = {};
  const base = {
    tag, attrs, style: { set: [], setProperty(k, v) { this.set.push([k, v]); } }, dataset: {}, textContent: '', hidden: false, isConnected: true, width: 0, height: 0,
    classList: { set: new Set(), add(...c) { c.forEach((x) => this.set.add(x)); }, remove(...c) { c.forEach((x) => this.set.delete(x)); }, contains(c) { return this.set.has(c); }, toggle(c, on) { if (on ?? !this.set.has(c)) this.set.add(c); else this.set.delete(c); return this.set.has(c); } },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 500, bottom: 60, width: 500, height: 60 }),
    querySelector: (q) => (found[q] ??= node('div')), querySelectorAll: () => [], appendChild: (c) => kids.push(c), append: (...c) => kids.push(...c),
    replaceChildren(...c) { kids.length = 0; kids.push(...c); }, get children() { return kids; },
    on: {}, addEventListener(t, f) { (this.on[t] ??= []).push(f); }, fire(t) { (this.on[t] ?? []).forEach((f) => f({})); }, animate: () => ({ cancel: noop }), getAnimations: () => [], getContext: () => new Proxy({}, { get: () => noop }),
    scrollHeight: 0, offsetHeight: 0, offsetWidth: 0, scrollTop: 0, clientHeight: 0,
  };
  els.push(base);
  return base;
}
const document = { head: node('head'), body: node('body'), createElement: node, addEventListener: noop, fonts: null };
const timers = [], rafs = [];
const frames = (n = 3) => { for (let i = 0; i < n; i++) rafs.splice(0).forEach((f) => f(0)); };
const ctx = {
  window: {}, document, Math, performance, innerWidth: 1512, innerHeight: 982, devicePixelRatio: 2,
  matchMedia: () => ({ matches: true, addEventListener: noop }), addEventListener: noop,
  requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame: noop, setTimeout: (f) => { timers.push(f); return 0; }, clearTimeout: noop,
  getComputedStyle: () => ({}),
};
ctx.window.Roamie = { safe: { top: 38, notch: { x: 666, w: 180, h: 38 } }, wake: noop };
vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/notch.js', import.meta.url), 'utf8'), ctx);
const R = ctx.window.Roamie;
const sr = els.find((e) => e.className === 'nc-sr');
const flush = () => { while (timers.length) timers.shift()(); };
const capsule = els.find((e) => e.className?.startsWith?.('nc '));
assert.ok(sr && capsule, 'capsule and its screen-reader line are made');
assert.equal(capsule.attrs['aria-live'], undefined, 'the capsule itself is not a live region');

R.notch.enabled = true;
R.notch.think();
assert.equal(R.notchHit(100, 20), false, 'thinking: clicks go to the app below');
assert.equal(R.notchHit(100, 20, false), false);
R.notch.text('Hello ');
R.notch.text('there.');
flush();
assert.equal(sr.textContent, '', 'streaming words are not read out');
assert.equal(R.notchHit(100, 20), true, 'a reply can be clicked (fold it, open it)');
R.notch.done();
flush();
assert.equal(sr.textContent, 'Hello there.', 'the whole reply is read once');
// Each line is its own block with its own direction, so an Arabic line runs right to left and an English one doesn't.
{
  const textBlock = capsule.querySelector('.nc-text');
  assert.deepEqual(textBlock.children.map((c) => c.dir), ['auto'], 'a reply is a block with an automatic direction');
  assert.ok(textBlock.children.every((c) => c.className === 'nc-line'));
}
R.notch.close(); flush();
R.notch.text('English line\nمرحباً بك\n'); flush();
{
  const lines = capsule.querySelector('.nc-text').children;
  assert.equal(lines.length, 3, 'one block per line');
  assert.deepEqual(lines.map((c) => c.dir), ['auto', 'auto', 'auto']);
  assert.deepEqual(lines.map((c) => c.textContent), ['English line', 'مرحباً بك', '\u200b'], 'an empty line keeps its height');
}
R.notch.close(); flush();
R.notch.prompt('Run npm test?', ['Allow', "Don't allow"], noop);
flush();
assert.equal(sr.textContent, 'Run npm test?');
assert.equal(R.notchHit(100, 20), true, 'Allow buttons take clicks');
assert.equal(R.notchHit(900, 20), false, 'outside it, never');
assert.equal(R.notchTakes(), true, 'Linux gets its box as a click area while it has buttons');
// A line said while it's closed ("I heard you…") is measured once it's open, so its card fits it (it kept the last
// reply's height, and lost its bottom padding).
R.notch.close(); flush(); frames();
const card = capsule.querySelector('.nc-body');
card.style.set.length = 0;
R.notch.say("I heard you, but didn't catch any words.");
frames();
assert.ok(card.style.set.some(([k]) => k === '--bh'), 'the card is sized for the line');
// Talking again while the last turn is still finishing: that turn's end (or error) arrives once the mic is on, and the
// capsule keeps listening instead of closing.
R.notch.close(); flush(); frames();
R.notch.listen();
R.notch.done();
assert.equal(R.notch.active, true, 'the cut-short turn ending leaves it listening');
R.notch.fail('stopped');
assert.equal(capsule.dataset.mode, 'listen', 'an error from it does too');
// A long reply scrolls: new words keep the newest line in view, unless they scrolled up to read, and only their own
// scrolling (not the text being replaced as words stream in) counts as scrolling up.
R.notch.close(); flush(); frames();
{
  const t = capsule.querySelector('.nc-text');
  t.scrollHeight = 1000; t.clientHeight = 140;
  R.notch.text('a long reply'); frames();
  assert.equal(t.scrollTop, 1000, 'it follows the newest line');
  t.scrollTop = 0; t.fire('scroll'); // the text was replaced, not scrolled by them
  R.notch.text(' and more'); frames();
  assert.equal(t.scrollTop, 1000, 'a scroll they didn\'t make leaves it following');
  t.fire('wheel'); t.scrollTop = 300; t.fire('scroll');
  R.notch.text(' and more'); frames();
  assert.equal(t.scrollTop, 300, 'scrolled up to read: new words leave it where it is');
  t.fire('wheel'); t.scrollTop = 860; t.fire('scroll');
  R.notch.text(' and more'); frames();
  assert.equal(t.scrollTop, 1000, 'back at the bottom: it follows again');
  t.fire('wheel'); t.scrollTop = 300; t.fire('scroll');
  R.notch.close(); flush(); frames(); R.notch.text('a new reply'); frames();
  assert.equal(t.scrollTop, 1000, 'a new reply starts at its newest line');
}
console.log('notch tests: passed');
