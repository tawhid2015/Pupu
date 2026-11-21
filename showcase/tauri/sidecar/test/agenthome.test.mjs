// The agents' corner in the overlay (showcase/roamies/minis.js, agent-home.js): which icon a file gets, the pixel
// icons themselves, and where the home sits. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Without a document only the pure parts load, which is all that's tested here.
const window = { Roamie: {} };
for (const f of ['minis.js', 'agent-home.js']) vm.runInNewContext(fs.readFileSync(new URL(`../../../roamies/${f}`, import.meta.url), 'utf8'), { window, Math, Map });
const { fileKind, icon, KINDS } = window.Roamie.minis;

const kinds = {
  'index.html': 'web', 'notes.md': 'doc', 'Report.PDF': 'pdf', 'logo.svg': 'image', 'photo.jpeg': 'image', 'budget.csv': 'sheet', 'plan.xlsx': 'sheet',
  'deck.pptx': 'slides', 'app.js': 'code', 'main.py': 'code', 'style.css': 'code', 'part.stl': 'model', 'scene.glb': 'model', 'theme.mp3': 'audio',
  'clip.mov': 'video', 'site.zip': 'archive', 'backup.tar.gz': 'archive', 'README': 'other', 'weird.xyz': 'other', '': 'other', 'site/': 'folder',
};
for (const [name, kind] of Object.entries(kinds)) assert.equal(fileKind(name), kind, name);
assert.equal(fileKind('build', true), 'folder', 'a folder by its flag');
assert.equal(KINDS.length, 13);
// Each icon: a 12 x 12 grid of crisp cells in the teal family only, different from every other icon.
const TEAL = new Set(['#051214', '#0e5c60', '#28c4b8', '#78ffe2', '#e6fffa']);
const seen = new Set();
for (const k of KINDS) {
  const svg = icon(k);
  assert.match(svg, /^<svg viewBox="0 0 12 12" width="36" height="36" shape-rendering="crispEdges" aria-hidden="true" focusable="false">/, k);
  const cells = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="(#[0-9a-f]{6})"\/>/g)];
  assert.ok(cells.length > 20, `${k} has a shape`);
  for (const [, x, y, fill] of cells) { assert.ok(+x < 12 && +y < 12, `${k} stays in its grid`); assert.ok(TEAL.has(fill), `${k}: ${fill} is a teal-family colour`); }
  assert.ok(!seen.has(svg), `${k} looks different from the others`);
  seen.add(svg);
}

// The home: the top-right corner, 12 px in from the safe area (menu bar, Dock, notch), whatever the screen.
const place = (size, safe, view) => Array.from(window.Roamie.agentHomePlace(size, safe, view));
const none = { top: 0, right: 0, bottom: 0, left: 0 };
assert.deepEqual(place([300, 200], none, [1440, 900]), [1440 - 12 - 300, 12]);
assert.deepEqual(place([300, 200], { top: 33, right: 0, bottom: 80, left: 0 }, [1440, 900]), [1128, 45], 'below the menu bar');
assert.deepEqual(place([300, 200], { top: 0, right: 64, bottom: 0, left: 0 }, [1280, 800]), [1280 - 64 - 12 - 300, 12], 'clear of a Dock on the right');
assert.deepEqual(place([300, 200], none, [280, 600]), [12, 12], 'a screen narrower than the home: its left edge stays in view');
assert.deepEqual(place([300, 200], undefined, [1280, 800]), [968, 12], 'no safe area yet');
for (const [w, h] of [[1440, 900], [1280, 800], [1920, 1080], [3008, 1692]]) {
  const [x, y] = place([300, 400], { top: 25, right: 0, bottom: 70, left: 0 }, [w, h]);
  assert.ok(x + 300 <= w - 12 && y >= 25 + 12 && Number.isInteger(x) && Number.isInteger(y), `${w}x${h}`);
}
// desktop.html pins every <canvas> (position: fixed); the minis must opt back into their row's layout.
const homeSrc = fs.readFileSync(new URL('../../../roamies/agent-home.js', import.meta.url), 'utf8');
assert.ok(/canvas\s*\{[^}]*position:\s*fixed/.test(fs.readFileSync(new URL('../../../desktop.html', import.meta.url), 'utf8')));
assert.ok(/\.ah-mini, \.ahs-mini \{[^}]*position: static/.test(homeSrc), 'minis stay in flow');
// The made panel's open button: where it worked when it said so, else its files, else none.
const label = window.Roamie.agentOpenLabel;
assert.equal(label({ outcome: 'x', files: [{ name: 'a.md' }], place: null }), 'Open folder');
assert.equal(label({ outcome: 'x', files: [], place: { kind: 'folder', name: 'Downloads' } }), 'Open folder');
assert.equal(label({ outcome: 'x', files: [], place: { kind: 'file', name: 'a.pdf' } }), 'Open file');
assert.equal(label({ outcome: 'x', files: [{ name: 'a.md' }], place: { kind: 'url', name: 'example.com' } }), 'Open page', 'the place wins');
assert.equal(label({ outcome: 'Found it.', files: [], place: null }), null, 'an answer with nowhere to go: no button');
assert.equal(label(null), null);
assert.ok(/\.ahs-out, \.ahs-need \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis/.test(homeSrc), 'the outcome stays on one line');
console.log('agenthome tests: passed');
