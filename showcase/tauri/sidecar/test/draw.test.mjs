// The draw tool's schema, places, parts, SMILES and picture fetching. Run: npm test
import assert from 'node:assert/strict';
import { DrawArgs, LIMITS, checkDraw, createParts, describeParts, faviconFor, fitWindow, parseSmiles, photoFor, resolveTargets, shapeRadius, windowSized } from '../draw.mjs';

// ---- schema and limits
const ok = (a) => DrawArgs.safeParse(a).success;
assert.ok(ok({ beats: [{ say: 'Click Export.', marks: [{ kind: 'target', at: { text: 'Export' }, label: 'Export' }], wait: 'click' }] }), 'a walkthrough step');
assert.ok(ok({ edit: [{ do: 'recolor', part: 'p2', tone: 'red' }] }), 'edits alone');
assert.ok(!ok({ beats: [{ say: '', marks: [] }] }), 'a beat needs a line');
assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'explode' }] }] }), 'unknown mark');
assert.ok(!ok({ beats: Array.from({ length: LIMITS.beats + 1 }, () => ({ say: 'x', marks: [] })) }), 'too many beats');
assert.ok(!ok({ beats: [{ say: 'x', marks: Array.from({ length: LIMITS.marks + 1 }, () => ({ kind: 'point', at: { x: 1, y: 1 } })) }] }), 'too many marks');
assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'note', text: 'hi', tone: 'neon' }] }] }), 'unknown tone');
assert.ok(ok({ beats: [{ say: 'Sources.', marks: [{ kind: 'sources', sources: [{ name: 'BBC', url: 'https://www.bbc.com/news/x' }], pinned: true }] }] }), 'Everything-mode source cards can arrive pinned');
assert.equal(DrawArgs.parse({ beats: [{ say: 'Sources.', marks: [{ kind: 'sources', sources: [{ name: 'BBC', url: 'https://www.bbc.com/news/x' }], pinned: true }] }] }).beats[0].marks[0].pinned, true, 'the overlay receives pinned');
assert.ok(!ok({ beats: [{ say: 'x', marks: [], wait: 'forever' }] }), 'unknown wait');
assert.deepEqual(checkDraw({}), ['Give beats to draw, or edit to change what is drawn.']);
assert.deepEqual(checkDraw({ beats: [{ say: 'Here.', marks: [{ kind: 'ring', at: { text: 'Share' } }] }] }), []);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'ring' }] }] })[0], /beat 1 mark 1 \(ring\): needs at/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'connect', at: { text: 'a' } }] }] })[0], /needs to/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'trace', points: [[1, 1]] }] }] })[0], /needs points/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'note', text: 'n' }], wait: 'click' }] })[0], /wait needs a mark/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'button', text: 'Next' }] }] })[0], /needs action/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'emote', name: 'dance' }] }] })[0], /needs name/);
assert.match(checkDraw({ beats: [{ say: 'x', marks: [{ kind: 'molecule', smiles: 'C[C@H]O' }] }] })[0], /not a supported bracket atom/);
assert.match(checkDraw({ edit: [{ do: 'recolor', part: 'p1' }] })[0], /recolor needs tone/);
assert.match(checkDraw({ edit: [{ do: 'erase' }] })[0], /needs part/);
assert.deepEqual(checkDraw({ edit: [{ do: 'clear' }] }), [], 'start over needs no part');
console.log('draw schema tests: passed');

// ---- the shape rule: round for small square things, a pill for thin ones, a rounded box for big ones and fields
assert.equal(shapeRadius(24, 24, 'checkbox'), 12, 'checkbox is round');
assert.equal(shapeRadius(90, 28, 'button'), 14, 'thin button is a pill');
assert.equal(shapeRadius(64, 60, 'button'), 30, 'small square button is round');
assert.equal(shapeRadius(300, 200, ''), 18, 'big area: gently rounded');
assert.equal(shapeRadius(300, 28, 'text field'), 4, 'a field stays a box even when thin');
assert.equal(shapeRadius(300, 28, 'button', 6), 6, 'r overrides');
console.log('shape radius tests: passed');

// ---- places, with a fake screen
{
  const seen = [];
  const look = {
    text: async (t) => { seen.push(['text', t]); if (t === 'Missing') throw new Error('No button reads "Missing"'); return { bounds: [100, 200, 80, 24], role: 'button', text: t }; },
    id: async (n) => { seen.push(['id', n]); return { id: n + 1, bounds: [10, 10, 24, 24], role: 'checkbox', label: 'Agree' }; },
    pixel: async (x, y) => [x * 2, y * 2 + 40],
  };
  const beats = [{ say: 'Open Format, then tick Agree.', marks: [
    { kind: 'target', at: { text: 'Format' }, label: 'Format' },
    { kind: 'ring', at: { id: 7 } },
    { kind: 'point', at: { x: 10, y: 10 } },
    { kind: 'frame', at: { x: 10, y: 10, w: 50, h: 20 } },
    { kind: 'trace', points: [[0, 0], [10, 0], [10, 10]] },
    { kind: 'connect', at: { text: 'Format' }, to: { x: 5, y: 5 } },
    { kind: 'molecule', smiles: 'CCO' },
    { kind: 'note', text: 'remember' },
  ], wait: 'click' }];
  const [b] = await resolveTargets(beats, look);
  assert.equal(b.wait, 'click');
  assert.deepEqual(b.marks[0].at, { rect: [100, 200, 80, 24], r: 12, role: 'button', name: 'Format' }, 'text: exact bounds, pill');
  assert.deepEqual(b.marks[1].at, { rect: [10, 10, 24, 24], r: 12, role: 'checkbox', name: 'Agree', live: 8 }, 'id: the live control');
  assert.deepEqual(b.marks[2].at.rect, [6, 46, 28, 28], 'a pixel: a small spot round it');
  // Regression: x, y with w, h was read as the top-left corner while models gave the centre, so loops sat low and right.
  assert.deepEqual(b.marks[3].at.rect, [-30, 40, 100, 40], 'pixels with w, h: x, y is the centre, both corners mapped');
  assert.deepEqual(b.marks[4].points, [[0, 40], [20, 40], [20, 60]], 'paths map every point');
  assert.deepEqual(b.marks[5].to.rect, [-4, 36, 28, 28]);
  assert.equal(b.marks[6].mol.atoms.length, 3, 'molecules are parsed for the overlay');
  assert.equal(b.marks[7].at, undefined, 'cards need no place');
  await assert.rejects(resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { text: 'Missing' } }] }], look), /beat 1 mark 1 \(ring\): No button reads "Missing"/);
  // With the app's controls known, a pixel loop near one snaps to it; text and point marks don't ask.
  const asked = [];
  const [s2] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { x: 10, y: 10, w: 50, h: 20 } }, { kind: 'point', at: { x: 5, y: 5 } }] }], { ...look, snap: async (r) => { asked.push(r); return [-28, 42, 100, 40]; } });
  assert.deepEqual(s2.marks[0].at.rect, [-28, 42, 100, 40], 'snapped to the control');
  assert.equal(asked.length, 1, 'only the loop with w, h snaps');
  // A pixel guess is fitted to what's really drawn first (letters, icons, shapes); the control snap is only the fallback.
  const fitted = [], snapped = [];
  const fitLook = { ...look, refine: async (r) => { fitted.push(r); return r[2] === 28 ? [8, 48, 6, 6] : [-26, 43, 96, 34]; }, snap: async (r) => { snapped.push(r); return [0, 0, 1, 1]; } };
  const [s3] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { x: 10, y: 10, w: 50, h: 20 } }, { kind: 'point', at: { x: 5, y: 5 } }] }], fitLook);
  assert.deepEqual(s3.marks.map((m) => m.at.rect), [[-26, 43, 96, 34], [8, 48, 6, 6]], 'both fitted to the pixels');
  assert.equal(snapped.length, 0, 'no control snap once the pixels fit');
  const [s4] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { x: 10, y: 10, w: 50, h: 20 } }] }], { ...fitLook, refine: async () => null });
  assert.deepEqual(s4.marks[0].at.rect, [0, 0, 1, 1], 'nothing clear in the pixels: the control snap still helps');
  // every: one mark per place the text appears, in reading order; none at all is an error.
  const many = { ...look, textAll: async (t) => (t === 's' ? [{ bounds: [10, 20, 7, 9] }, { bounds: [30, 20, 7, 9] }, { bounds: [12, 50, 7, 9] }] : []) };
  const [s5] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { text: 's', every: true } }, { kind: 'label', text: 'hi', at: { x: 1, y: 1 } }] }], many);
  assert.deepEqual(s5.marks.map((m) => [m.kind, m.at.rect]), [['ring', [10, 20, 7, 9]], ['ring', [30, 20, 7, 9]], ['ring', [12, 50, 7, 9]], ['label', [-12, 28, 28, 28]]]);
  await assert.rejects(resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { text: 'zz', every: true } }] }], many), /"zz" isn't on screen/);
  // within: only the matches in that part of the screenshot (pixel maps x*2, y*2+40, so 0..15 px covers x 0..30, y 40..70).
  const [s6] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { text: 's', every: true, within: { x: 7.5, y: 7.5, w: 15, h: 15 } } }] }], many);
  assert.deepEqual(s6.marks.map((m) => m.at.rect), [[10, 20, 7, 9]].filter(() => false).concat([[12, 50, 7, 9]]), 'only the s inside the area');
  // Regression: text that appears more than once asks for within, but within without every was ignored, so the same
  // error came back every time. Now it picks the one in that area.
  const [s7] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { text: 's', within: { x: 7.5, y: 7.5, w: 15, h: 15 } } }] }], many);
  assert.deepEqual(s7.marks.map((m) => m.at.rect), [[12, 50, 7, 9]], 'within alone: the one in that area');
  assert.ok(DrawArgs.safeParse({ beats: [{ say: 'x', marks: [{ kind: 'ring', at: { text: 's', every: true } }] }] }).success, 'every is in the schema');
  console.log('draw target tests: passed');
}

// ---- frames round whole windows
{
  // Regression: "point to each window" on a 3×2 grid of 600×533-point windows. The model's boxes (pixels of a
  // 1568×1018 screenshot of an 1800-point-wide screen) were right, but each was refitted to "what's drawn there",
  // which joined the neighbouring windows in: the helper gave back boxes 900 to 1300 points wide.
  const grid = [[600, 572, 600, 533], [1200, 572, 600, 533], [600, 39, 600, 533], [0, 572, 600, 533], [1200, 39, 600, 533], [0, 39, 600, 533]];
  const S = 1800 / 1568, refits = [];
  const look = {
    pixel: async (x, y) => [Math.round(x * S), Math.round(y * S)],
    refine: async (r) => { refits.push(r); return r[2] > 200 ? [0, 0, 923.8, 654.4] : [20, 50, 30, 30]; },
    windows: async () => grid,
  };
  const frame = (x, y, w, h) => ({ kind: 'frame', at: { x, y, w, h } });
  const logged = [frame(261, 265, 495, 460), frame(783, 265, 515, 460), frame(1303, 265, 500, 460), frame(261, 730, 495, 460), frame(783, 730, 515, 460), frame(1303, 730, 500, 460)];
  const [w1] = await resolveTargets([{ say: 'Six panes.', marks: logged }], look);
  assert.deepEqual(w1.marks.map((m) => m.at.rect), [[0, 39, 600, 533], [600, 39, 600, 533], [1200, 39, 600, 533], [0, 572, 600, 533], [600, 572, 600, 533], [1200, 572, 600, 533]], 'each frame sits on its window');
  assert.equal(refits.length, 0, 'window-sized boxes are not refitted to drawn content');
  // The looser boxes of the first try (up to 26 points off an edge) still land on their windows.
  const [w2] = await resolveTargets([{ say: 'x', marks: [frame(255, 730, 490, 440), frame(783, 270, 520, 450)] }], look);
  assert.deepEqual(w2.marks.map((m) => m.at.rect), [[0, 572, 600, 533], [600, 39, 600, 533]]);
  // A big box round no window (a pane, a picture) stays as the model gave it.
  const [w3] = await resolveTargets([{ say: 'x', marks: [frame(785, 455, 1110, 625)] }], look);
  assert.deepEqual(w3.marks[0].at.rect, [264, 164, 1274, 717], 'no window there: the box as given');
  const [w4] = await resolveTargets([{ say: 'x', marks: [frame(785, 455, 1110, 625)] }], { pixel: look.pixel, refine: look.refine });
  assert.deepEqual(w4.marks[0].at.rect, [264, 164, 1274, 717], 'no window list: the box as given');
  assert.equal(refits.length, 0);
  // Small things are still fitted to what's drawn, windows open or not.
  const [w5] = await resolveTargets([{ say: 'x', marks: [{ kind: 'ring', at: { x: 30, y: 60, w: 40, h: 40 } }] }], look);
  assert.deepEqual(w5.marks[0].at.rect, [20, 50, 30, 30], 'a small box is still refitted');
  assert.equal(refits.length, 1);
  assert.ok(windowSized([0, 0, 568, 528]) && !windowSized([0, 0, 300, 40]) && !windowSized([0, 0, 120, 400]), 'window-sized: big both ways');
  assert.deepEqual(fitWindow([15, 40, 568, 528], grid), [0, 39, 600, 533]);
  assert.equal(fitWindow([15, 40, 568, 528], []), null);
  assert.equal(fitWindow([60, 40, 540, 528], grid), null, 'an edge 60 points off: not that window');
  // Two windows fit (one stacked a few points off the other): the closer one; the frontmost when equally close.
  assert.deepEqual(fitWindow([10, 40, 600, 533], [[0, 39, 600, 533], [12, 41, 600, 533]]), [12, 41, 600, 533]);
  assert.deepEqual(fitWindow([5, 39, 600, 533], [[0, 39, 600, 533], [10, 39, 600, 533]]), [0, 39, 600, 533]);
  console.log('draw window frame tests: passed');
}

// ---- parts: ids in order, never reused; screen marks clear on their own, cards stay
{
  const p = createParts();
  const ids = p.assign([{ marks: [{ kind: 'ring', at: { name: 'Export' } }, { kind: 'emote', name: 'hype' }, { kind: 'card', heading: 'Interest' }] }]);
  assert.deepEqual(ids, ['p1', 'p2'], 'emotes get no id');
  assert.equal(p.describe(), 'p1 ring “Export”, p2 card “Interest”');
  assert.equal(p.screenCount, 1);
  p.clearScreen();
  assert.deepEqual(p.ids, ['p2'], 'the card stays');
  assert.deepEqual(p.assign([{ marks: [{ kind: 'label', text: 'here', at: {} }] }]), ['p3'], 'ids are never reused');
  p.remove('p2');
  assert.equal(p.has('p2'), false);
  assert.equal(describeParts([['p9', { desc: 'note “x”' }]]), 'p9 note “x”');
  p.assign([{ marks: [{ kind: 'note', text: 'a' }, { kind: 'note', text: 'b' }] }]);
  p.clear((id) => id === 'p4');
  assert.deepEqual(p.ids, ['p4'], 'clear keeps what keep() names (a pinned card)');
  // Regression: eight cards in one drawing filled the screen and the last was drawn on top of the first. Only a
  // few stay up: the oldest are forgotten (screen marks and cards that don't count are left alone).
  const q = createParts();
  q.assign([{ marks: [{ kind: 'ring', at: { name: 'Export' } }, ...['a', 'b', 'c', 'd', 'e', 'f'].map((text) => ({ kind: 'note', text }))] }]);
  assert.deepEqual(q.trimCards(LIMITS.cardsShown, (id) => id === 'p2'), ['p3'], 'the oldest card that counts goes');
  assert.deepEqual(q.ids, ['p1', 'p2', 'p4', 'p5', 'p6', 'p7']);
  assert.deepEqual(q.trimCards(LIMITS.cardsShown), ['p2'], 'now p2 counts too');
  assert.deepEqual(q.trimCards(LIMITS.cardsShown), [], 'four cards: nothing to close');
  // The overlay closes them by the same number.
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(new URL('../../../roamies/ink.js', import.meta.url), 'utf8').includes(`const MAX_CARDS = ${LIMITS.cardsShown};`), 'the overlay and the sidecar agree on how many cards stay up');
  console.log('draw parts tests: passed');
}

// ---- SMILES
{
  const hs = (s) => parseSmiles(s).atoms.map((a) => a.el + (a.h || '')).join(' ');
  assert.equal(hs('CCO'), 'C3 C2 O1', 'ethanol');
  assert.equal(hs('c1ccccc1'), 'C1 C1 C1 C1 C1 C1', 'benzene');
  assert.equal(hs('c1cc[nH]c1'), 'C1 C1 C1 N1 C1', 'pyrrole');
  assert.equal(hs('Cn1cnc2c1c(=O)n(C)c(=O)n2C'), 'C3 N C1 N C C C O N C3 C O N C3', 'caffeine');
  assert.equal(hs('O=C=O'), 'O C O', 'carbon dioxide');
  assert.equal(hs('C#N'), 'C1 N', 'hydrogen cyanide');
  const nh4 = parseSmiles('[NH4+]').atoms[0];
  assert.deepEqual(nh4, { el: 'N', arom: false, charge: 1, h: 4 }, 'bracket atom with charge');
  assert.equal(parseSmiles('[O-]C=O').atoms[0].charge, -1);
  assert.equal(parseSmiles('[Fe+2]').atoms[0].charge, 2);
  assert.equal(parseSmiles('C1CC%10CC1%10').bonds.length, 6, 'two-digit ring closures');
  assert.deepEqual(parseSmiles('C=C').bonds, [{ a: 0, b: 1, order: 2 }]);
  assert.equal(parseSmiles('c1ccccc1').bonds.filter((b) => b.order === 1.5).length, 6, 'aromatic bonds');
  assert.equal(parseSmiles('CC(C)(C)C').bonds.length, 4, 'branches');
  for (const bad of ['', 'C[C@H](O)C', 'CC.O', 'C/C=C/C', 'C1CC', 'C(C', 'C)C', '[13C]', 'C=', 'Xx', 'C==C'])
    assert.throws(() => parseSmiles(bad), /SMILES|empty/, `refuses ${JSON.stringify(bad)}`);
  assert.throws(() => parseSmiles('C'.repeat(LIMITS.atoms + 1)), /more than/);
  console.log('smiles tests: passed');
}

// ---- photos and favicons go through the URL rules, with size caps
{
  const calls = [];
  const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => Buffer.from(body) });
  const png = Buffer.from([137, 80, 78, 71]);
  const fake = (routes) => async (url) => { calls.push(url); const r = routes[url]; if (!r) return res(404, ''); return r(); };
  const wiki = fake({
    'https://en.wikipedia.org/api/rest_v1/page/summary/Jet_engine': () => res(200, JSON.stringify({ title: 'Jet engine', thumbnail: { source: 'https://upload.wikimedia.org/jet.png' } }), { 'content-type': 'application/json' }),
    'https://upload.wikimedia.org/jet.png': () => res(200, png, { 'content-type': 'image/png' }),
  });
  const p = await photoFor({ query: 'jet engine' }, { fetchImpl: wiki });
  assert.equal(p.src, `data:image/png;base64,${png.toString('base64')}`, 'a data URL the overlay can dither');
  assert.equal(p.title, 'Jet engine');
  await assert.rejects(photoFor({ url: 'http://192.168.0.2/cam.png' }, { fetchImpl: wiki }), /Blocked for safety/, 'local network');
  const bounce = fake({ 'https://example.com/a.png': () => res(302, '', { location: 'http://localhost/secret.png' }) });
  await assert.rejects(photoFor({ url: 'https://example.com/a.png' }, { fetchImpl: bounce }), /Blocked for safety/, 'a redirect to this computer');
  const big = fake({ 'https://example.com/big.png': () => res(200, Buffer.alloc(LIMITS.photoBytes + 1), { 'content-type': 'image/png' }) });
  await assert.rejects(photoFor({ url: 'https://example.com/big.png' }, { fetchImpl: big }), /too big/);
  const html = fake({ 'https://example.com/page': () => res(200, '<html>', { 'content-type': 'text/html' }) });
  await assert.rejects(photoFor({ url: 'https://example.com/page' }, { fetchImpl: html }), /isn't a picture/);
  const ico = fake({ 'https://news.example.org/favicon.ico': () => res(200, png, { 'content-type': 'image/x-icon' }) });
  assert.match(await faviconFor('https://news.example.org/story?id=1', { fetchImpl: ico }), /^data:image\/x-icon;base64,/);
  const n = calls.length;
  await faviconFor('https://news.example.org/other', { fetchImpl: ico });
  assert.equal(calls.length, n, 'favicons are cached per site');
  assert.equal(await faviconFor('https://nothing.example.net/', { fetchImpl: fake({}) }), null, 'no favicon: a dot instead');
  assert.equal(await faviconFor('javascript:alert(1)'), null, 'not a web link');
  // Looked-at pictures: labels are refused until the picture has been seen, and the card then gets that same picture.
  const { createPhotos } = await import('../draw.mjs');
  const photos = createPhotos({ fetchImpl: wiki, max: 2 });
  const labelled = [{ say: 'x', marks: [{ kind: 'note', text: 'n' }, { kind: 'photo', query: 'Jet engine', labels: [{ text: 'fan', x: 0.2, y: 0.5 }] }] }];
  assert.match(photos.unseen(labelled), /^beat 1 mark 2 \(photo\): labels go on a picture you have looked at[^\n]*First call see_photo with \{"query":"Jet engine"\}/);
  assert.equal(photos.unseen([{ say: 'x', marks: [{ kind: 'photo', query: 'Jet engine' }] }]), null, 'a photo without labels needs no look');
  const before = calls.length, shown = await photos.see({ query: 'jet engine' });
  assert.deepEqual(shown, { title: 'Jet engine', mediaType: 'image/png', data: png.toString('base64') }, 'the picture comes back for the model to look at');
  assert.equal(photos.unseen(labelled), null, 'seen (whatever the capitals): labels are allowed');
  const fetched = calls.length;
  assert.equal((await photos.get({ kind: 'photo', query: 'Jet engine' })).title, 'Jet engine');
  assert.equal(calls.length, fetched, 'the card shows the picture that was looked at, not a second download');
  assert.ok(fetched > before);
  await assert.rejects(photos.see({}), /Give query/);
  await assert.rejects(photos.see({ url: 'http://192.168.0.2/cam.png' }), /Blocked for safety/, 'looking goes through the URL rules too');
  const svg = fake({ 'https://example.com/logo.svg': () => res(200, '<svg/>', { 'content-type': 'image/svg+xml' }) });
  await assert.rejects(createPhotos({ fetchImpl: svg }).see({ url: 'https://example.com/logo.svg' }), /can't be looked at here/, 'a drawing file can be shown on a card but not looked at');
  assert.match(photos.unseen([{ say: 'x', marks: [{ kind: 'photo', url: 'https://example.com/a.png', labels: [{ text: 'a', x: 0, y: 0 }] }] }]), /see_photo with \{"url":"https:\/\/example.com\/a.png"\}/);
  console.log('photo and favicon tests: passed');
}

// Regression: a timeline event of 41+ characters failed the whole draw call; event text wraps now, up to 60.
{
  const tl = (text) => ({ beats: [{ say: 'When.', marks: [{ kind: 'timeline', events: [{ when: 'c. 330 BC', text }] }] }] });
  assert.ok(ok(tl('Aristotle gives strong evidence for a round Earth')), 'a 49-character event');
  assert.ok(!ok(tl('x'.repeat(61))), 'past 60 still fails');
  console.log('timeline schema tests: passed');
}

// ---- the kinds with a structure of their own: flow, table, bars, map, math, geometry, quiz, photo labels, moving parts
{
  const { checkFlow, findCountry, flowLayers, parseTex, resolveRegion, CARDS } = await import('../draw.mjs');
  const one = (mark) => checkDraw({ beats: [{ say: 'x', marks: [mark] }] });
  const fine = (mark, why) => { assert.ok(ok({ beats: [{ say: 'x', marks: [mark] }] }), `${why}: fits the schema`); assert.deepEqual(one(mark), [], why); };
  for (const k of ['flow', 'table', 'bars', 'map', 'math', 'geometry', 'quiz']) assert.ok(CARDS.includes(k), `${k} is a card`);

  // moving parts
  fine({ kind: 'model', title: 'Piston', parts: [{ shape: 'cylinder', label: 'piston', motion: { do: 'slide', to: [0, 0.6, 0], secs: 2 } }, { shape: 'torus', motion: { do: 'spin', axis: 'z' } }, { shape: 'sphere', motion: { do: 'orbit', around: [0, 0, 0] } }, { shape: 'box', motion: { do: 'pulse' } }] }, 'a model whose parts move');
  assert.match(one({ kind: 'model', parts: [{ shape: 'box', label: 'rod', motion: { do: 'slide' } }] })[0], /part 1 \(rod\): slide needs to/);
  assert.match(one({ kind: 'model', parts: [{ shape: 'box', motion: { do: 'spin', secs: 0 } }] })[0], /secs \(one full cycle\) must be between/);
  assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'model', parts: [{ shape: 'box', motion: { do: 'explode' } }] }] }] }), 'unknown motion');
  assert.match(one({ kind: 'model' })[0], /needs parts/);
  // Regression: a live run gave size: 2 for a cylinder and the whole drawing was refused for it.
  assert.deepEqual(DrawArgs.parse({ beats: [{ say: 'x', marks: [{ kind: 'model', parts: [{ shape: 'sphere', size: 2 }] }] }] }).beats[0].marks[0].parts[0].size, [2, 2, 2], 'one number for a size is that size every way');
  assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'model', parts: [{ shape: 'sphere', size: [1, 2] }] }] }] }), 'a size of two numbers is still wrong');

  // flow
  const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, text: id.toUpperCase() }));
  fine({ kind: 'flow', dir: 'right', nodes, links: [{ from: 'a', to: 'b', label: 'then', flow: true }, { from: 'b', to: 'c' }] }, 'a flow');
  assert.match(checkFlow({ nodes: [nodes[0]] })[0], /needs nodes \(at least 2/);
  assert.match(checkFlow({ nodes, links: [{ from: 'a', to: 'zz' }] })[0], /link 1: no node has the id "zz" \(nodes: "a", "b", "c", "d"\)/, 'an unknown id is named, with the ones there are');
  assert.match(checkFlow({ nodes: [...nodes, nodes[0]], links: [{ from: 'a', to: 'b' }] })[0], /two nodes share the id "a"/);
  assert.match(checkFlow({ nodes, links: [{ from: 'a', to: 'a' }] })[0], /goes from "a" to itself/);
  assert.match(checkFlow({ nodes, links: [] }).join(' '), /needs links/);
  assert.match(one({ kind: 'flow', dir: 'up', nodes, links: [{ from: 'a', to: 'b' }] })[0], /dir for a flow is down or right/);
  assert.match(one({ kind: 'scroll', at: { text: 'x' }, dir: 'right' })[0], /dir for scroll is up or down/);
  // a chain: one node per layer, in order
  assert.deepEqual(flowLayers(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }]), { layers: [['a'], ['b'], ['c'], ['d']], via: {}, back: [] });
  // a tree: children share a layer, in the order of their parents
  assert.deepEqual(flowLayers(nodes, [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }]).layers, [['a'], ['b', 'c'], ['d']]);
  // a loop: the link that closes it is turned round (back) and gets a lane past the layer between
  const loop = flowLayers(nodes.slice(0, 3), [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]);
  assert.deepEqual(loop.back, [2], 'the closing link is the back one');
  assert.deepEqual(loop.layers.map((l) => l.filter((id) => !id.startsWith('~'))), [['a'], ['b'], ['c']]);
  assert.deepEqual(loop.via[2], ['~2.1'], 'and it passes beside b, not under it');
  // nothing but a loop still gets layers, and a late start sits just above what it feeds
  assert.equal(flowLayers(nodes.slice(0, 2), [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]).layers.length, 2);
  assert.deepEqual(flowLayers(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'd', to: 'c' }]).layers, [['a'], ['b', 'd'], ['c']]);
  // links cross as little as the order allows: a→d, b→c with c listed first puts d under a
  assert.deepEqual(flowLayers([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], [{ from: 'a', to: 'd' }, { from: 'b', to: 'c' }]).layers, [['a', 'b'], ['d', 'c']]);
  console.log('flow tests: passed');

  // table and bars
  fine({ kind: 'table', title: 'Languages', columns: ['', 'Python', 'Rust'], rows: [['Easy to start', 'yes', 'no'], ['Speed', 'slow', 'fast']] }, 'a table');
  assert.match(one({ kind: 'table', columns: ['a', 'b', 'c'], rows: [['1', '2', '3'], ['1', '2']] })[0], /row 2 has 2 cells but there are 3 columns/);
  assert.match(one({ kind: 'table', columns: ['a'], rows: [['1']] })[0], /needs columns/);
  assert.match(one({ kind: 'table', columns: ['a', 'b'] })[0], /needs rows/);
  assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'table', columns: Array(LIMITS.columns + 1).fill('c'), rows: [] }] }] }), 'too many columns');
  assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'table', columns: ['a', 'b'], rows: Array(LIMITS.rows + 1).fill(['1', '2']) }] }] }), 'too many rows');
  fine({ kind: 'bars', unit: 'm', bars: [{ label: 'Everest', value: 8849 }, { label: 'K2', value: 8611, tone: 'amber' }] }, 'bars');
  assert.match(one({ kind: 'bars', bars: [{ label: 'a', value: 1 }] })[0], /needs bars \(at least 2/);
  assert.match(one({ kind: 'bars', bars: [{ label: 'a', value: 1 }, { label: 'b', value: -2 }] })[0], /bar 2 \("b"\): value must be 0 or more/);
  assert.match(one({ kind: 'bars', bars: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] })[0], /every value is 0/);

  // labels on a photo: fractions of the picture
  fine({ kind: 'photo', query: 'Acoustic guitar', labels: [{ text: 'neck', x: 0.5, y: 0.3 }] }, 'a labelled photo');
  assert.match(one({ kind: 'photo', query: 'Acoustic guitar', labels: [{ text: 'neck', x: 220, y: 90 }] })[0], /label 1 \("neck"\): x and y are fractions of the picture/);
  console.log('table, bars and label tests: passed');

  // maps
  fine({ kind: 'map', region: 'Europe', shade: [{ name: 'Portugal', tone: 'teal' }], pins: [{ name: 'Lisbon', lat: 38.7, lon: -9.1 }, { name: 'Porto', lat: 41.1, lon: -8.6 }], routes: [{ from: 'Lisbon', to: 'Porto' }] }, 'a map');
  assert.equal(findCountry('usa'), findCountry('United States of America'), 'a country goes by its usual names');
  assert.equal(findCountry('Côte d’Ivoire'), findCountry('ivory coast'), 'accents and case don’t matter');
  assert.equal(findCountry('the Netherlands'), findCountry('Holland'));
  assert.throws(() => findCountry('Portugual'), /no country outline for "Portugual" \(nearest: Portugal\)/, 'a slip gets the nearest names');
  assert.throws(() => findCountry('Singapore'), /mark a city, a state or a small country with a pin/, 'no outline at this scale: use a pin');
  assert.throws(() => findCountry('England'), /part of United Kingdom/);
  assert.deepEqual(resolveRegion({ region: 'europe' }).view, [-25, 34, 45, 72], 'a continent by name');
  const pt = resolveRegion({ shade: [{ name: 'Portugal', tone: 'teal' }] });
  assert.equal(pt.shade[0].name, 'Portugal');
  assert.ok(pt.view[0] < -9.5 && pt.view[2] > -6.4 && pt.view[2] - pt.view[0] >= 7, 'with no region the view fits what is shaded, with its neighbours in view');
  const fr = resolveRegion({ region: 'France' }).view;
  assert.ok(fr[0] > -10 && fr[2] < 15, 'France fits France, not French Guiana too');
  const two = resolveRegion({ region: 'Portugal, Spain' }).view, es = resolveRegion({ region: 'Spain' }).view;
  assert.ok(two[0] < es[0] + 0.01 && two[2] >= es[2] - 2, 'several countries: all of them fit');
  assert.ok(resolveRegion({ region: 'Fiji' }).view[2] > 180, 'a country on the date line stays in one piece');
  assert.deepEqual(resolveRegion({ pins: [{ name: 'Lisbon', lat: 38.7, lon: -9.1 }] }).view, [-12.6, 35.2, -5.6, 42.2], 'a lone pin gets room round it');
  assert.match(one({ kind: 'map', region: 'Narnia' })[0], /region: no country outline for "narnia"[^\n]*Regions by name: world, africa, europe/);
  assert.match(one({ kind: 'map', shade: [{ name: 'Atlantis' }] })[0], /no country outline for "Atlantis"/);
  assert.match(one({ kind: 'map', region: 'world', pins: [{ name: 'X', lat: 120, lon: 0 }] })[0], /pin "X": lat must be between -90 and 90/);
  assert.match(one({ kind: 'map', region: 'world', pins: [{ name: 'A', lat: 0, lon: 0 }], routes: [{ from: 'A', to: 'B' }] })[0], /route 1: no pin is named "B" \(pins: "A"\)/);
  assert.match(one({ kind: 'map' })[0], /needs region, shade/);
  console.log('map tests: passed');

  // maths
  const flat = (n) => (n.t === 's' ? n.s : n.t === 'row' ? n.c.map(flat).join(' ') : n.t === 'frac' ? `(${flat(n.a)})/(${flat(n.b)})` : n.t === 'sqrt' ? `√${n.n ? `[${flat(n.n)}]` : ''}(${flat(n.a)})` : n.t === 'script' ? `${flat(n.a)}${n.sub ? `_(${flat(n.sub)})` : ''}${n.sup ? `^(${flat(n.sup)})` : ''}` : n.t === 'fence' ? `${n.l}${flat(n.a)}${n.r}` : n.t === 'text' ? `"${n.s}"` : n.t === 'over' ? `${n.m}(${flat(n.a)})` : n.t === 'box' ? `[${flat(n.a)}]` : '␣');
  const tex = (s) => flat(parseTex(s));
  assert.equal(tex('3x + 7 = 22'), '3 x + 7 = 22');
  assert.equal(tex('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'), 'x = (− b ± √(b^(2) − 4 a c))/(2 a)', 'the quadratic formula');
  assert.equal(tex('\\frac12 + x^2_i'), '(1)/(2) + x_(i)^(2)', 'one thing after a command needs no braces; a power and a subscript share a base');
  assert.equal(tex('x^10'), 'x^(1) 0', 'without braces a power is one digit, as in LaTeX');
  assert.equal(tex('\\sqrt[3]{27} = 3'), '√[3](27) = 3');
  assert.equal(tex('\\left(\\frac{a}{b}\\right)^{n}'), '((a)/(b))^(n)', 'sized brackets take a power');
  assert.equal(tex('\\alpha + \\beta \\le 90^\\circ'), 'α + β ≤ 90 °', 'Greek, symbols, and a raised ring as a degree sign');
  assert.equal(tex('$E = mc^2$'), 'E = m c^(2)', 'a wrapping $ is dropped');
  assert.equal(tex('\\(a \\times b\\)'), 'a × b', 'so is \\( \\)');
  assert.equal(tex('\\text{area} = \\pi r^2'), '"area" = π r^(2)');
  assert.equal(tex('\\vec{F} = m\\vec{a}'), 'vec(F) = m vec(a)');
  assert.equal(tex('\\boxed{x = 5}'), '[x = 5]');
  assert.equal(tex('\\sum_{i=1}^{n} i'), '∑_(i = 1)^(n) i');
  assert.equal(tex('\\sin\\theta \\, \\mathrm{d}x'), 'sin θ ␣ d x', 'functions, spaces, and styles read past');
  assert.equal(tex('\\displaystyle \\mathbb{R}'), 'ℝ');
  assert.equal(parseTex('12.5').k, 'num', 'a whole number is one thing');
  // Regression: the first live run wrote "3(5) + 7 = 22 \checkmark" and the whole drawing was refused.
  assert.equal(tex('3(5) + 7 = 22 \\checkmark'), '3 ( 5 ) + 7 = 22 ✓');
  assert.equal(tex('\\binom{n}{k} \\lt \\textcolor{red}{x} \\cancel{y}'), '((n)/(k)) < x cancel(y)', 'more of what models write: binomials, a colour read past, a struck term');
  assert.equal(parseTex('\\binom{n}{k}').a.bar, false, 'a binomial has no bar');
  for (const [bad, why] of [['\\begin{matrix}a\\end{matrix}', /\\begin\{…\} blocks[^\n]*one line per step/], ['a & b', /& \(tables and lined-up equations\) is not supported/], ['a \\\\ b', /a new line\) is not supported: put each line in its own step/],
    ['\\foo{x}', /\\foo is not supported \(supported: \\frac/], ['\\frac{1}{', /a \{ without its \}/], ['x}', /a \} without its \{/], ['\\left( x', /a \\left without its \\right/], ['x \\right)', /a \\right without its \\left/],
    ['\\frac', /something is missing at the end/], ['\\sqrt[3{x}', /a \[ without its \]/], ['', /The math is empty/], ['\\left< x \\right>', /need a bracket after them/], ['x'.repeat(0) + '{'.repeat(20) + 'x' + '}'.repeat(20), /nested too deep/]]) assert.throws(() => parseTex(bad), why, `refused: ${bad}`);
  assert.throws(() => parseTex(Array(LIMITS.tex + 5).fill('x').join('+')), /too long for one step/);
  fine({ kind: 'math', title: 'Solve', steps: [{ tex: '3x + 7 = 22' }, { tex: '3x = 15', note: 'take 7 from both sides' }, { tex: 'x = 5' }] }, 'worked steps');
  assert.match(one({ kind: 'math', steps: [{ tex: 'x = 1' }, { tex: '\\begin{cases} 1 \\end{cases}' }] })[0], /\(math\): step 2: Can't read math/, 'the step is named');
  assert.match(one({ kind: 'math' })[0], /needs steps/);
  console.log('math tests: passed');

  // geometry and quizzes
  const tri = [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 4, y: 0 }, { id: 'C', x: 1, y: 3 }];
  fine({ kind: 'geometry', vertices: tri, lines: [{ from: 'A', to: 'B', label: 'c' }, { from: 'B', to: 'C' }, { from: 'C', to: 'A', dash: true }], angles: [{ at: 'A', from: 'B', to: 'C', label: 'α' }], circles: [{ at: 'A', r: 1 }] }, 'a figure');
  assert.match(one({ kind: 'geometry', vertices: tri, lines: [{ from: 'A', to: 'D' }] })[0], /line 1: no vertex has the id "D" \(vertices: "A", "B", "C"\)/);
  assert.match(one({ kind: 'geometry', vertices: tri, lines: [{ from: 'A', to: 'B' }], angles: [{ at: 'A', from: 'A', to: 'B' }] })[0], /must be three different vertices/);
  assert.match(one({ kind: 'geometry', vertices: tri, circles: [{ at: 'A', r: 0 }] })[0], /r must be above 0/);
  assert.match(one({ kind: 'geometry', vertices: tri })[0], /needs lines/);
  assert.match(one({ kind: 'geometry', vertices: [tri[0]] })[0], /needs vertices \(at least 2/);
  assert.match(one({ kind: 'geometry', vertices: [tri[0], tri[0]], lines: [{ from: 'A', to: 'A' }] }).join(' '), /two vertices share the id "A"/);
  const q = { text: 'Which planet is closest to the Sun?', options: ['Venus', 'Mercury', 'Mars'], answer: 'Mercury', explain: 'It orbits at about 58 million km.' };
  fine({ kind: 'quiz', title: 'Planets', questions: [q] }, 'a quiz');
  assert.match(one({ kind: 'quiz', questions: [{ ...q, answer: 'Earth' }] })[0], /question 1: answer must be one of its options, word for word \(options: "Venus", "Mercury", "Mars"\)/);
  assert.match(one({ kind: 'quiz', questions: [{ ...q, options: ['Mars', 'mars '] , answer: 'Mars' }] })[0], /two options are the same/);
  assert.ok(!ok({ beats: [{ say: 'x', marks: [{ kind: 'quiz', questions: [{ ...q, options: ['only one'] }] }] }] }), 'a question needs two options');
  assert.match(one({ kind: 'quiz' })[0], /needs questions/);
  // A quiz answered on screen: the score and what was missed, in words for the model's next request.
  const { quizNote } = await import('../draw.mjs');
  const [qb] = await resolveTargets([{ say: 'x', marks: [{ kind: 'quiz', title: 'Planets', questions: [q, { text: 'Biggest planet?', options: ['Jupiter', 'Saturn'], answer: 'Jupiter' }, { text: 'Red planet?', options: ['Mars', 'Venus'], answer: 'Mars' }] }] }], {});
  assert.equal(quizNote(qb.marks[0], [1, 0, 0]), 'They answered the quiz “Planets” on screen by clicking: 3 of 3 right.');
  assert.equal(quizNote(qb.marks[0], [1, 1]), 'They answered the quiz “Planets” on screen by clicking: 1 of 3 right. Missed: “Biggest planet?” (they picked “Saturn”; the answer is “Jupiter”); “Red planet?” (they skipped it; the answer is “Mars”).');
  assert.match(quizNote(qb.marks[0], ['x', 99, -1]), /0 of 3 right/, 'anything that is not one of the options counts as skipped');
  assert.equal(quizNote(undefined, [0]), null, 'a quiz that is no longer on screen says nothing');
  console.log('geometry and quiz tests: passed');

  // what reaches the overlay is already worked out
  const [b] = await resolveTargets([{ say: 'x', marks: [
    { kind: 'flow', nodes: nodes.slice(0, 2), links: [{ from: 'a', to: 'b' }] },
    { kind: 'map', shade: [{ name: 'portugal' }] },
    { kind: 'math', steps: [{ tex: 'x^2' }] },
    { kind: 'quiz', questions: [{ ...q, answer: ' mercury' }] },
  ] }], {});
  assert.deepEqual(b.marks[0].lay.layers, [['a'], ['b']], 'a flow arrives with its layers');
  assert.equal(b.marks[1].shade[0].name, 'Portugal'); assert.equal(b.marks[1].view.length, 4, 'a map with its view and countries');
  assert.equal(b.marks[2].steps[0].tree.t, 'script', 'maths as a tree');
  assert.equal(b.marks[3].questions[0].right, 1, 'a quiz with which option is right');
  const parts = createParts();
  parts.assign([{ marks: [{ kind: 'table', columns: ['Name', 'Speed'], rows: [['a', 'b']] }, { kind: 'math', steps: [{ tex: 'x = 5' }] }, { kind: 'map', region: 'Europe' }] }]);
  assert.equal(parts.describe(), 'p1 table “Name, Speed”, p2 math “x = 5”, p3 map “Europe”', 'new cards are named in the result');
  console.log('worked-out card tests: passed');
}

// ---- the outlines the overlay draws are the countries the sidecar checks names against, in the same order
{
  const { readFileSync } = await import('node:fs');
  const { COUNTRIES } = await import('../countries.mjs');
  const win = { Roamie: {} };
  new Function('window', readFileSync(new URL('../../../roamies/world.js', import.meta.url), 'utf8'))(win);
  const world = win.Roamie.world;
  assert.deepEqual(world.countries.map((c) => c[0]), COUNTRIES.map((c) => c.n), 'world.js and countries.mjs list the same countries in the same order');
  assert.ok(world.countries.every(([, rings]) => rings.length && rings.every((r) => r.length >= 6 && r.length % 2 === 0)), 'every country has an outline');
  // Portugal's outline starts inside the box a map of it fits.
  const pt = COUNTRIES.findIndex((c) => c.n === 'Portugal'), [x, y] = world.countries[pt][1][0], b = COUNTRIES[pt].b;
  assert.ok(x / world.q >= b[0] - 0.1 && x / world.q <= b[2] + 0.1 && y / world.q >= b[1] - 0.1 && y / world.q <= b[3] + 0.1, 'outlines are in degrees × q');
  console.log('world outline tests: passed');
}
{ // Gemini Flash-Lite's shapes (#81, from a user's log): a lone mark's fields on its beat or on the call, label for a
  // button's text. Each is moved into marks, so the card draws instead of failing or drawing nothing.
  const tidy = (a) => DrawArgs.parse(a);
  const onBeat = tidy({ beats: [{ say: 'Steps.', kind: 'card', heading: 'Change Your Wallpaper', items: ['Open Settings', 'Pick Background'] }] });
  assert.deepEqual(onBeat.beats[0].marks, [{ kind: 'card', heading: 'Change Your Wallpaper', items: ['Open Settings', 'Pick Background'] }]);
  assert.deepEqual(checkDraw(onBeat), []);
  const emptyMarks = tidy({ beats: [{ say: 'Ha.', kind: 'card', heading: 'Ben 23 vs Ben Prime', items: ['Drip'], marks: [] }] });
  assert.equal(emptyMarks.beats[0].marks[0].heading, 'Ben 23 vs Ben Prime', 'marks: [] with the card on the beat');
  const onCall = tidy({ card_size: 'small', items: ['Open Windows Settings'], heading: 'Change Your Wallpaper', beats: [{ say: 'Here.', marks: [{ kind: 'card' }] }] });
  assert.deepEqual(onCall.beats[0].marks, [{ kind: 'card', card_size: 'small', items: ['Open Windows Settings'], heading: 'Change Your Wallpaper' }]);
  const sayOnCall = tidy({ say: 'Groups.', beats: [{ kind: 'mindmap', title: 'Groups', branches: [{ text: 'Metals' }, { text: 'Gases' }] }] });
  assert.equal(sayOnCall.beats[0].say, 'Groups.'); assert.equal(sayOnCall.beats[0].marks[0].kind, 'mindmap'); assert.deepEqual(checkDraw(sayOnCall), []);
  const button = tidy({ beats: [{ say: 'Go.', marks: [{ kind: 'button', label: 'Open Settings', action: { do: 'open', value: 'ms-settings:' } }] }] });
  assert.equal(button.beats[0].marks[0].text, 'Open Settings'); assert.deepEqual(checkDraw(button), []);
  assert.equal(tidy({ beats: [{ say: 'Hi.', kind: 'card', title: 'Hello' }] }).beats[0].marks[0].heading, 'Hello', "a card's title as its heading");
  // Well-formed calls are left as they are; two marks and a stray field aren't guessed at.
  const fine = { beats: [{ say: 'x', marks: [{ kind: 'card', heading: 'A' }] }] };
  assert.deepEqual(tidy(fine), fine);
  assert.equal(tidy({ beats: [{ say: 'x', heading: 'H', marks: [{ kind: 'card', text: 'a' }, { kind: 'card', text: 'b' }] }] }).beats[0].marks.every((m) => !m.heading), true);
  console.log('draw tidy tests: passed');
}
