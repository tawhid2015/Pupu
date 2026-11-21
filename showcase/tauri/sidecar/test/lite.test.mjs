// Lite mode (#73): a short prompt and a few flat tools for small and local models. Run: npm test
import assert from 'node:assert/strict';
import { resolveToolSchema } from '@kenkaiiii/gg-ai';
import { createTools } from '../tools.mjs';
import { LITE_BUDGET, LITE_TOOLS, LITE_TURNS, liteSystem } from '../lite.mjs';
import { LITE_MIN_CONTEXT, MIN_CONTEXT, OLLAMA, contextNote, isSmallModel, modelBillions } from '../local.mjs';

const noop = async () => {};
const { tools } = createTools({ allowActions: false, ui: () => {}, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test', focus: { start: () => 'ok', stop: () => 'ok' } });
const size = (list) => list.reduce((n, t) => n + JSON.stringify({ name: t.name, description: t.description, parameters: resolveToolSchema(t) }).length, 0);

// Every Lite tool is a real one (about_roamies is added by sidekick.mjs), and none of them sees, acts in apps or draws.
const lite = tools.filter((t) => LITE_TOOLS.has(t.name));
assert.deepEqual(lite.map((t) => t.name).sort(), [...LITE_TOOLS].filter((n) => n !== 'about_roamies').sort());
for (const n of ['draw', 'take_screenshot', 'act_in_app', 'read_window', 'run_command', 'write_file', 'read_file', 'start_focus']) assert.ok(!LITE_TOOLS.has(n), n);
// A fraction of what the full tool list costs on every request.
assert.ok(size(lite) < size(tools) / 4, `lite tools ${size(lite)} chars vs ${size(tools)}`);
assert.ok(LITE_BUDGET <= 16_000 && LITE_TURNS <= 8);

// The prompt: short, says what Lite mode can't do and to say so (with where to switch it off) instead of trying.
const o = { name: 'JARVIS', body: 'a sleek assistant', user: 'Sam', version: '0.1.41', panel: 'the panel (click my icon)', voice: false };
const text = liteSystem(o), voice = liteSystem({ ...o, voice: true });
assert.ok(text.length < 3000, `${text.length} chars`);
assert.match(text, /Lite mode is on/);
assert.match(text, /can't see or read the screen, click or type in apps, draw/);
assert.match(text, /don't try it and don't pretend: say .*Lite mode is on.*switching Lite mode off on the Model page in the panel \(click my icon\)/s);
assert.match(text, /"- " lines: they show on a card/);
assert.match(voice, /talk out loud.*no markdown/s); assert.doesNotMatch(voice, /\*\*bold\*\*/);
// The look's own way of talking, else the default.
assert.match(liteSystem({ ...o, style: 'deadpan and clinical.' }), /Personality: deadpan and clinical\. In your own way/);
assert.match(text, /Personality: warm, funny, a little cheeky\./);

// Local models: Lite needs half the memory; small models are told about Lite mode.
assert.equal(LITE_MIN_CONTEXT * 2, MIN_CONTEXT);
assert.equal(contextNote(16_384, OLLAMA, true), '');
assert.match(contextNote(8_192, OLLAMA, true), /only 8k.*16k or more.*OLLAMA_CONTEXT_LENGTH=16384/s);
assert.match(contextNote(16_384, OLLAMA), /32k or more/, 'the full agent still needs 32k');
for (const [id, b] of [['local:ollama:qwen3.5:9b', 9], ['local:lmstudio:gemma-4-e4b-it', 4], ['llama-3.2-3B-instruct', 3], ['phi-5-mini-3.8b', 3.8], ['gpt-oss-20b', 20], ['qwen3-30b-a3b', 30], ['mistral-small', null], ['deepseek-v4', null]]) assert.equal(modelBillions(id), b, id);
assert.ok(isSmallModel('local:ollama:qwen3.5:4b')); assert.ok(!isSmallModel('local:ollama:qwen3.5:32b')); assert.ok(!isSmallModel('mistral-small'));
console.log('lite tests: passed');
