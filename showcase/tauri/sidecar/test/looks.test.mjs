import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE } from '../fish.mjs';

// Every look the app offers has a drawing and its voice; the setup guide offers the same looks.
const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const side = src('../sidekick.mjs'), guide = src('../../../onboarding/onboarding.js');
const looks = [...side.slice(side.indexOf('const LOOKS = ['), side.indexOf('];', side.indexOf('const LOOKS = ['))).matchAll(/\['(\w+)', '([^']+)', (DEFAULT_VOICE|'(\w+)')\]/g)];
assert.deepEqual(looks.map((m) => m[1]), ['classic', 'jarvis', 'glayos', 'ultren', 'anime', 'sarah', 'adrian', 'rita']);
const voices = Object.fromEntries(looks.map((m) => [m[1], m[4] ?? null]));
assert.equal(voices.classic, null, 'Roamie uses DEFAULT_VOICE');
assert.equal(DEFAULT_VOICE, '2680da81de8348a68e1f4dbaa79272f1');
assert.equal(voices.jarvis, 'e13fa398a7f445a685316a3de6089ce7');
// Regression: Roamie spoke with JARVIS's voice (the default was JARVIS's ID).
assert.equal(new Set([DEFAULT_VOICE, ...Object.values(voices).filter(Boolean)]).size, 8, 'every look has its own voice');
assert.ok(!/config\.fishVoice/.test(side), 'a saved fishVoice (the old JARVIS default) is never used');
assert.equal(voices.anime, 'd8f3b4c1199f4568a767ec54112d2b17');
assert.equal(voices.sarah, '933563129e564b19a115bedd57b7406a');
assert.equal(voices.adrian, 'bf322df2096a46f18c579d0baa36f41d');
assert.equal(voices.rita, '84aadb575ed74e9aa44ba7ab8619d1a1');
assert.equal(voices.ultren, '06cfdb3653a4496983d6ad77f98cc184');
assert.equal(voices.glayos, 'ee885900b0874d12b1c3439d1e56cc95');
for (const [, id, label] of looks) assert.ok(guide.includes(`['${id}', '${label}']`), `the setup guide offers ${label}`);
// Each look greets you in its voice when picked, with the words Settings and the setup guide show.
{
  const obj = (text, name) => new Function(`return ${text.match(new RegExp(`const ${name} = (\\{[^}]*\\})`))[1]}`)();
  const said = obj(side, 'LOOK_GREETINGS');
  assert.deepEqual(Object.keys(said), looks.map((m) => m[1]), 'a greeting for every look');
  assert.deepEqual(obj(src('../../../panel/panel.js'), 'QUIPS'), said, 'Settings shows the spoken greeting');
  assert.deepEqual(obj(guide, 'LOOK_QUIPS'), said, 'the setup guide shows the spoken greeting');
  const set = side.slice(side.indexOf('function setLook('), side.indexOf('\n}\n', side.indexOf('function setLook(')));
  assert.match(set, /if \(changed && VOICE_ON\(\) && !busy\)/, 'only for a new look, with voice on, and not over a reply');
  assert.match(set, /v\.say\(LOOK_GREETINGS\[l\]\)/);
  // Each talks its own way, in the full prompt and in Lite mode, and the prompt names every look.
  assert.deepEqual(Object.keys(obj(side, 'LOOK_STYLE')), looks.map((m) => m[1]), 'a talking style for every look');
  assert.match(side, /Personality: \$\{LOOK_STYLE\[config\.look\] \?\? LOOK_STYLE\.classic\}/);
  assert.match(side, /style: LOOK_STYLE\[config\.look\]/);
  assert.match(side, /your name and your voice: \$\{LOOKS\.slice\(0, -1\)/);
}

// The characters draw at every size without throwing, inside their area, and the sprites are well formed.
const warns = [];
globalThis.window = { Roamie: {} };
const warn = console.warn; console.warn = (m) => warns.push(m);
new Function(src('../../../roamies/people.js'))();
console.warn = warn;
assert.deepEqual(warns, [], 'every sprite row is half or whole width');
const P = window.Roamie.people;
const th = () => 0.5;
// ken: Ken Kai, on the About page (drawn the same way, though not a look you can pick).
for (const who of ['anime', 'sarah', 'adrian', 'rita', 'ultren', 'glayos', 'ken']) for (const size of ['default', 'small', 'cursor']) for (const state of [{}, { mode: 'talk', voice: 0.9 }, { happy: 1 }, { open: 0 }, { dizzy: 1 }, { sleepy: 1 }, { act: 'hype', actA: 0.2 }, { act: 'upset', actA: 0.1 }]) {
  const cells = [];
  const k = { put: (x, y, l) => { assert.ok(Number.isInteger(x) && Number.isInteger(y) && l >= 0 && l <= 4, `${who} ${size} cell`); cells.push([x, y]); }, L: 4, th };
  const st = { t: 1, mode: null, voice: null, act: null, actA: 0, open: 1, look: [0.5, -0.3], vx: 0, sq: 0, wide: 0, dizzy: 0, happy: 0, sleepy: 0, mouth: null, brow: null, ...state };
  if (size === 'cursor') P[who].cursor(k, 50, 50, 46, 43, st); else P[who].body(k, 50, 50, size === 'small' ? 6.4 : 12.75, st);
  assert.ok(cells.length > 40, `${who} ${size} draws`);
  const span = Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x));
  assert.ok(span < (size === 'default' ? 40 : 24), `${who} ${size} stays its size (${span})`);
}
assert.ok(!looks.some((m) => m[1] === 'ken'), 'Ken is not a pickable look');
console.log('looks tests: passed');

// Regression: a selected stage canvas showed as a grey box around the Roamie (WebKit tints selected canvases).
assert.match(src('../../../desktop.html'), /canvas \{[^}]*-webkit-user-select: none; user-select: none;[^}]*\}/);

// Regression: after a drawing the Sidekick stopped following the cursor and hopped away from it instead.
{
  const agent = src('../../../roamies/agent.js'), rel = agent.slice(agent.indexOf('async release()'), agent.indexOf('place: (x, y) =>'));
  assert.match(agent, /pen\.follow = !!station\.byCursor/, 'take() remembers whether it was following the cursor');
  assert.match(rel, /if \(pen\.follow && presence\.ptr\) station\.byCursor = presence\.ptr\.slice\(\)/, 'release() goes back to following');
}

// The bubbles, tags and step list draw with glass.js, so the overlay loads it before them.
{
  const page = src('../../../desktop.html'), at = (f) => page.indexOf(`roamies/${f}`);
  assert.ok(at('glass.js') > 0 && at('glass.js') < at('agent.js') && at('glass.js') < at('agent-cards.js'), 'desktop.html loads glass.js before agent.js and agent-cards.js');
}

// Regression: the hands trailed behind the body when it moved fast (they sprang after screen points, not body ones).
{
  const kit = src('../../../roamies/10-dither.js');
  assert.match(kit, /spring\(h\.o, tg\[0\] \* R, tg\[1\] \* R/, 'hands spring in the body\'s own space');
  assert.match(kit, /h\.y = m\.y \+ oy \+ h\.o\.y/, 'and ride its hop once');
  assert.match(kit, /lerp\(sx, bx \+ h\.o\.x, arms\)/, 'hands are drawn from where the body is drawn');
}

// Regression: the cheer (hype) stuttered on the characters: the kit's hop plus one of their own at another rate.
for (const who of ['anime', 'sarah', 'adrian', 'rita', 'ultren', 'glayos']) {
  const tops = new Set();
  for (const actA of [0, 0.1, 0.2, 0.3, 0.45]) {
    let top = Infinity;
    const st = { t: 1, mode: null, voice: null, act: 'hype', actA, open: 1, look: [0, 0], vx: 0, sq: 0, wide: 0, dizzy: 0, happy: 1, sleepy: 0, mouth: null, brow: null };
    P[who].body({ put: (x, y) => { top = Math.min(top, y); }, L: 4, th }, 50, 50, 12.75, st);
    tops.add(top);
  }
  assert.equal(tops.size, 1, `${who} doesn't hop on its own while cheering (the kit moves it)`);
}
