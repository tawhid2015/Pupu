// The assistant choosing a card's starting size (card_size): what the draw tool takes, and that it reaches the overlay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DrawArgs } from '../draw.mjs';
import { createTools } from '../tools.mjs';

const list = (card_size) => ({ beats: [{ say: 'A list.', marks: [{ kind: 'list', title: 'plan', items: ['one', 'two'], ...(card_size ? { card_size } : {}) }] }] });
for (const s of ['small', 'normal', 'large', 'full', undefined]) assert.equal(DrawArgs.safeParse(list(s)).success, true, `${s} is a size`);
assert.equal(DrawArgs.safeParse(list('huge')).success, false, 'only the four sizes');

const events = [];
const noop = async () => {};
const made = createTools({ allowActions: () => false, ui: (m) => { if (m.kind === 'agent' && m.e?.type === 'draw') { events.push(m.e); setTimeout(() => made.ink.started(m.e.id, m.e.seg), 5); } }, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' });
const draw = made.tools.find((t) => t.name === 'draw');
assert.match(draw.description, /card_size: small for an aside, large for something to read closely/, 'the model is told when to use each');
await draw.execute(list('large'), { toolCallId: 'size1' });
assert.equal(events[0].beats[0].marks[0].card_size, 'large', 'the size reaches the overlay');

// The overlay opens at that size and still lets the user resize it or make it full screen.
const ink = readFileSync(new URL('../../../roamies/ink.js', import.meta.url), 'utf8');
assert.match(ink, /m\.card_size === 'small' \? 0\.8 : m\.card_size === 'large' \? 1\.5 : 1/);
assert.match(ink, /if \(m\.card_size === 'full' && !c\.full\) await toggleFull\(c\);/);
assert.match(ink, /kind: 'resize'/, 'the resize corner is still there');
console.log('card size tests: passed');
process.exit(0);
