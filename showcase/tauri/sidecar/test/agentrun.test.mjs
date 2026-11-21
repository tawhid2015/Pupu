// A background agent end to end: the real worker (agentrun.mjs) in its own process, driven by a scripted model
// (test/fakeagent.mjs), managed by agents.mjs in a temp ROAMIES_DATA_DIR. Run: npm test
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-agentrun-')));
// The worker's home is the temp folder too, so nothing it does can reach the real one.
process.env.HOME = process.env.USERPROFILE = tmp;
process.env.ROAMIES_DATA_DIR = path.join(tmp, 'data');
process.env.ROAMIES_FAKE_AGENT = fileURLToPath(new URL('./fakeagent.mjs', import.meta.url));
process.env.FAKE_LOG = path.join(tmp, 'fake.log');
const { agentsRoot, createAgents } = await import('../agents.mjs');
const { checkOpen, checkRead, checkWrite } = await import('../safety.mjs');

const events = [];
let onEnd = null;
const mgr = createAgents({
  fork, root: agentsRoot(), userName: 'Ken', home: tmp, runner: fileURLToPath(new URL('../agentrun.mjs', import.meta.url)), safety: { checkRead, checkWrite, checkOpen },
  config: { model: async () => ({ provider: 'anthropic', model: 'fake', route: 'api' }), creds: async () => ({}), allowActions: () => true, image: () => null, open: async () => {}, reveal: async () => {} },
  ui: ({ e }) => {
    events.push(e);
    // The yes from the row's Allow button.
    if (e.type === 'ask') setTimeout(() => mgr.answer(e.agent.id, true), 50);
    if (e.type === 'done' || e.type === 'fail' || e.type === 'gone') onEnd?.(e);
  },
});
// The next agent's end (done, failed or stopped), within 20 s.
const ended = () => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no result in 20 s: ${JSON.stringify(events.map((e) => e.type))}`)), 20_000);
  onEnd = (e) => { clearTimeout(t); onEnd = null; resolve(e); };
});
const done = ended();
const a = await mgr.start({ type: 'maker', title: 'Dog brand landing page', brief: 'Make a landing page for Woof Co.' });
const end = await done;
const log = fs.readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

assert.equal(end.type, 'done', `${end.agent.reason}\n${JSON.stringify(log, null, 1)}`);
assert.deepEqual(log.filter((l) => l.isError), [], 'every tool call worked');
assert.equal(a.dir, path.join(tmp, 'data', 'Roamies', 'Agents', a.folder), 'its folder is under ROAMIES_DATA_DIR');
// What the model was given: its brief, only its tools, a prompt about its folder.
assert.match(log[0].prompt, /Brief from Ken:\nMake a landing page for Woof Co\./);
assert.deepEqual([...log[0].tools].sort(), ['finish', 'list_files', 'plan', 'read_file', 'run_command', 'search_files', 'web_fetch', 'web_search', 'write_file']);
assert.ok(log[0].system.includes(`Your folder is ${a.dir}.`));
// It asked once (the command), not for overwriting its own file.
const asks = events.filter((e) => e.type === 'ask');
assert.equal(asks.length, 1);
assert.match(asks[0].agent.ask.question, /^Run `node -e "require\('fs'\)\.writeFileSync\('work\/scratch/);
assert.ok(events.some((e) => e.type === 'update' && e.agent.step === 'Writing the page'), 'its progress line reached the row');
// The folder: what it made, its scratch, its record.
assert.equal(fs.readFileSync(path.join(a.dir, 'files', 'index.html'), 'utf8'), '<h1>Woof Co</h1>');
assert.ok(fs.existsSync(path.join(a.dir, 'work', 'scratch.txt')), 'run_command ran in its folder');
assert.ok(fs.statSync(path.join(a.dir, 'inputs')).isDirectory());
assert.deepEqual(end.agent.result.files, [{ name: 'index.html', rel: 'files/index.html', what: 'the page', dir: false }]);
assert.equal(end.agent.result.outcome, 'Made a one-page site for Woof Co.');
assert.match(fs.readFileSync(path.join(a.dir, 'history.md'), 'utf8'), /^## Run 1 · \d{4}-\d\d-\d\d \d\d:\d\d · done\nAsked: Make a landing page for Woof Co\.\nOutcome: Made a one-page site for Woof Co\.\nFiles: files\/index\.html \(the page\)\n/);
const state = JSON.parse(fs.readFileSync(path.join(a.dir, '.agent.json'), 'utf8'));
assert.equal(state.state, 'done');
assert.deepEqual(state.tokens, { in: 500, out: 50 });
assert.equal(state.turns, 5);
assert.match(fs.readFileSync(path.join(agentsRoot(), 'Agents', 'index.md'), 'utf8'), / · Dog brand landing page · .+ · asked: Make a landing page for Woof Co\. · done: Made a one-page site for Woof Co\.\n$/);
assert.ok(!fs.existsSync(path.join(tmp, 'work')), 'nothing landed in the home folder');
assert.deepEqual(mgr.news().map((n) => [n.id, n.kind]), [[a.id, 'done']], 'its result is news for the chat');

// Asked to find something out: a report back to the chat, where it looked, and no files.
process.env.FAKE_LOG = path.join(tmp, 'fake-answer.log');
const doneB = ended();
const b = await mgr.start({ type: 'researcher', title: 'Latest LLM releases', brief: 'Find out the latest LLM releases.' });
const endB = await doneB;
const logB = fs.readFileSync(process.env.FAKE_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
assert.equal(endB.type, 'done', `${endB.agent.reason}\n${JSON.stringify(logB, null, 1)}`);
assert.match(logB[0].system, /Ken wants an answer, not a file/);
assert.deepEqual(logB.filter((l) => l.isError).map((l) => l.result), ['report is missing: they asked for an answer, so write what you found or did (answer first, plain text, under 1,200 characters).'], 'told what it got wrong, once');
assert.deepEqual(endB.agent.result.files, []);
assert.deepEqual(endB.agent.result.place, { kind: 'url', name: 'example.com' });
assert.deepEqual(fs.readdirSync(path.join(b.dir, 'files')), [], 'no file made just to have one');
assert.ok(fs.existsSync(path.join(b.dir, 'work', 'notes.md')), 'its notes stay in work/');
assert.match(fs.readFileSync(path.join(b.dir, 'history.md'), 'utf8'), /Outcome: GPT-6 and Claude 6 came out this week\.\nReport: GPT-6 and Claude 6 both came out this week\.\nSources: https:\/\/example\.com\/news\nPlace: https:\/\/example\.com\/news\n/);
assert.match(await mgr.report(b.id), /Report: GPT-6 and Claude 6/, 'agent_report has the report');
assert.equal(mgr.news().find((n) => n.id === b.id).report, 'GPT-6 and Claude 6 both came out this week.\nSources: https://example.com/news');
mgr.stopAll();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('agentrun tests: passed');
