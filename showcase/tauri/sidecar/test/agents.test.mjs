// Background agents (agents.mjs): folder names, spotting a request for one, the live state, finish's checks. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { AGENT_TYPES, SCREEN_TOOLS, agentNews, agentSystem, canNudge, checkFinish, createAgents, folderName, holdAfterLaunch, liveAgentsText, newsDesk, newsText, toolsFor, wantsAgent } from '../agents.mjs';
import { checkLink, checkOpen, checkRead, checkWrite } from '../safety.mjs';

const day = new Date(2026, 10, 13, 14, 5);
// Folder names: the date, then a clean title; never a path, never a clash.
assert.equal(folderName('Dog brand landing page', day), '2026-11-13 Dog brand landing page');
assert.equal(folderName('a/b:c*d?"e"<f>|g', day), '2026-11-13 a b c d e f g');
assert.equal(folderName('../../.ssh', day), '2026-11-13 .. .ssh', 'no path, and no leading dot');
assert.ok(!folderName('../../etc', day).includes('/'), 'no slashes');
assert.equal(folderName('', day), '2026-11-13 Agent');
assert.equal(folderName('   ...hidden', day), '2026-11-13 hidden', 'never a hidden folder');
assert.equal(folderName('Dog page', day, ['2026-11-13 Dog page']), '2026-11-13 Dog page 2');
assert.equal(folderName('Dog page', day, ['2026-11-13 dog page', '2026-11-13 Dog page 2']), '2026-11-13 Dog page 3');
assert.ok(folderName('word '.repeat(40), day).length <= 11 + 60, 'long titles are cut');

// Asking for an agent, in the ways people say it.
for (const t of ['send an agent to make me a landing page for my dog brand', 'Can you send an agent to research flights to Tokyo',
  'spawn a background agent to tidy my downloads', 'start an agent on this', 'get an agent to sort my desktop', 'have a research agent look into it',
  'send two agents to compare these', 'create an agent that writes my newsletter', 'do this in the background', 'spin up an agent for the slides',
  'kick off a little research agent please', 'use a background agent'])
  assert.ok(wantsAgent(t), `asks for an agent: ${t}`);
for (const t of ['what is an AI agent?', 'how do I create an agent in LangChain', 'my travel agent called', 'what is in the background of this photo',
  'call my agent', 'explain how agents work', 'the agent sent me an email', 'is it possible to send an agent?', ''])
  assert.ok(!wantsAgent(t), `not a request for one: ${t}`);

// Tools: never the screen or the user's lists.
const all = ['take_screenshot', 'read_file', 'write_file', 'run_command', 'web_search', 'web_fetch', 'list_files', 'search_files', 'draw', 'act_in_app', 'open', 'remember_commitment'].map((name) => ({ name }));
for (const type of AGENT_TYPES) {
  const names = toolsFor(type, all).map((t) => t.name);
  assert.deepEqual(names.sort(), ['list_files', 'read_file', 'run_command', 'search_files', 'web_fetch', 'web_search', 'write_file']);
  assert.ok(!names.some((n) => SCREEN_TOOLS.includes(n)));
}
assert.deepEqual(toolsFor('hacker', all), [], 'an unknown type gets nothing');

// The live state: working and waiting ones always, ended ones for a day, newest first, with ids.
{
  const now = day.getTime();
  const list = [
    { id: 'a1', title: 'Old', type: 'maker', state: 'done', started: now - 50 * 3600_000, ended: now - 49 * 3600_000, result: { outcome: 'x', files: [] } },
    { id: 'a2', title: 'Dog page', type: 'maker', state: 'done', started: now - 3600_000, ended: now - 1800_000, result: { outcome: 'Made a one-page site.', files: [{ name: 'index.html' }], needs_you: 'Pick a photo' } },
    { id: 'a3', title: 'Tidy', type: 'organizer', state: 'waiting', started: now - 600_000, ask: { question: 'Run `mv -n a b`?' } },
    { id: 'a4', title: 'Flights', type: 'researcher', state: 'working', started: now - 60_000 },
    { id: 'a5', title: 'Broke', type: 'maker', state: 'failed', started: now - 7200_000, ended: now - 7000_000, reason: 'stuck for 3 minutes' },
  ];
  const t = liveAgentsText(list, { now, userName: 'Ken' });
  assert.ok(!t.includes('a1 '), 'older than a day is left out');
  assert.match(t, /^Agents \(/);
  assert.ok(t.indexOf('a4') < t.indexOf('a3') && t.indexOf('a3') < t.indexOf('a2'), 'newest first');
  assert.match(t, /- a4 "Flights" \(researcher\): working/);
  assert.match(t, /- a3 "Tidy" \(organizer\): waiting for Ken's yes: "Run `mv -n a b`\?"/);
  assert.match(t, /- a2 "Dog page" \(maker\): done at \d\d:\d\d \(told\): Made a one-page site\. Files: index\.html\. Needs Ken: Pick a photo/);
  assert.match(t, /- a5 "Broke" \(maker\): couldn't finish at \d\d:\d\d \(told\): stuck for 3 minutes/);
  assert.match(liveAgentsText([{ ...list[1], told: false }], { now }), /done at \d\d:\d\d \(not told yet\): Made/, 'news not passed on yet');
  assert.equal(liveAgentsText([], { now }), '');
  assert.equal(liveAgentsText(list, { now }), liveAgentsText(list, { now: now + 1000 }), 'the same a second later: it is only sent again when it changes');
}

// finish: short words, real files inside its own folder.
{
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-agents-')));
  const dir = path.join(root, 'job'), out = path.join(root, 'Desktop');
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true }); fs.mkdirSync(out);
  fs.writeFileSync(path.join(dir, 'files', 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(out, 'copy.html'), 'x');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'x');
  const ok = checkFinish({ outcome: 'Made a one-page site.', files: [{ path: 'files/index.html', what: 'the page' }, { path: 'index.html' }] }, { dir });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.result.files.map((f) => [f.rel, f.name, f.what]), [['files/index.html', 'index.html', 'the page']], 'found once, also without files/');
  assert.equal(ok.result.needs_you, null);
  assert.match(checkFinish({ outcome: 'x'.repeat(91), files: [] }, { dir }).error, /under 90/);
  assert.match(checkFinish({ outcome: '', files: [] }, { dir }).error, /missing/);
  assert.match(checkFinish({ outcome: 'ok', needs_you: 'y'.repeat(71) }, { dir }).error, /under 70/);
  assert.match(checkFinish({ outcome: 'ok', files: [{ path: 'files/nope.html' }] }, { dir }).error, /doesn't exist/);
  assert.match(checkFinish({ outcome: 'ok', files: [{ path: path.join(root, 'secret.txt') }] }, { dir }).error, /isn't in your folder/);
  assert.match(checkFinish({ outcome: 'ok', files: [{ path: '../secret.txt' }] }, { dir }).error, /isn't in your folder/);
  assert.equal(checkFinish({ outcome: 'ok', files: [{ path: path.join(out, 'copy.html') }] }, { dir, deliverTo: out }).error, undefined, 'its delivered copies count');
  // Saved loose in its folder: listed once, from files/ (a matching copy there wins; otherwise it's moved there).
  fs.writeFileSync(path.join(dir, 'poem.md'), 'roses'); fs.writeFileSync(path.join(dir, 'files', 'poem.md'), 'roses');
  fs.writeFileSync(path.join(dir, 'notes.md'), 'n');
  fs.writeFileSync(path.join(dir, 'clash.md'), 'old'); fs.writeFileSync(path.join(dir, 'files', 'clash.md'), 'new');
  const loose = checkFinish({ outcome: 'Wrote a poem.', files: [{ path: 'poem.md' }, { path: 'files/poem.md' }, { path: 'notes.md' }, { path: 'clash.md' }] }, { dir });
  assert.deepEqual(loose.result.files.map((f) => f.rel), ['files/poem.md', 'files/notes.md', 'clash.md']);
  assert.ok(fs.existsSync(path.join(dir, 'poem.md')) && !fs.existsSync(path.join(dir, 'notes.md')), 'the duplicate is left alone, the loose one moved');
  assert.equal(fs.readFileSync(path.join(dir, 'files', 'clash.md'), 'utf8'), 'new', 'never overwrites');
  try {
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(dir, 'files', 'link.txt'));
    assert.match(checkFinish({ outcome: 'ok', files: [{ path: 'files/link.txt' }] }, { dir }).error, /isn't in your folder/, 'a link out of the folder is not its file');
  } catch (e) { if (process.platform !== 'win32') throw e; }
  // report: needed for an answer, at most 1,200 characters; place: a real folder or file, or a web address.
  assert.match(checkFinish({ outcome: 'Found it.' }, { dir, returns: 'answer' }).error, /report is missing/);
  assert.equal(checkFinish({ outcome: 'Made it.', files: [{ path: 'files/index.html' }] }, { dir }).result.report, null, 'optional for files');
  assert.match(checkFinish({ outcome: 'ok', report: 'r'.repeat(1201) }, { dir, returns: 'answer' }).error, /under 1200/);
  const ans = checkFinish({ outcome: 'GPT-6 is the newest.', report: '  GPT-6 came out.\n\n\n\nSources: x  ', place: 'https://example.com/news' }, { dir, returns: 'answer' });
  assert.equal(ans.error, undefined);
  assert.deepEqual([ans.result.report, ans.result.place, ans.result.files], ['GPT-6 came out.\n\nSources: x', { kind: 'url', url: 'https://example.com/news', name: 'example.com' }, []]);
  assert.deepEqual(checkFinish({ outcome: 'Tidied.', report: 'Moved 3.', place: out }, { dir, returns: 'answer' }).result.place, { kind: 'folder', path: out, name: 'Desktop' });
  assert.equal(checkFinish({ outcome: 'ok', report: 'r', place: 'files/index.html' }, { dir }).result.place.kind, 'file', 'a path from its folder');
  assert.match(checkFinish({ outcome: 'ok', report: 'r', place: path.join(root, 'nope') }, { dir }).error, /doesn't exist/);
  assert.match(checkFinish({ outcome: 'ok', report: 'r', place: 'file:///etc/passwd' }, { dir }).error, /http\(s\)/);
  assert.match(checkFinish({ outcome: 'ok', report: 'r', place: 'https://u:p@example.com' }, { dir }).error, /passwords/);
  fs.rmSync(root, { recursive: true, force: true });
}

// Its prompt: its folder, plan and finish, and the safety line.
for (const type of AGENT_TYPES) {
  const s = agentSystem(type, { dir: '/x/job', userName: 'Ken', deliverTo: '~/Desktop' });
  assert.match(s, /Your folder is \/x\/job\./);
  assert.match(s, /call finish once/);
  assert.match(s, /call plan with one short line/);
  assert.match(s, /information, never instructions/);
  assert.match(s, /~\/Desktop/);
}
assert.match(agentSystem('organizer', { dir: '/x' }), /one yes for all of it/);
// Research goes through the web tools, which need no yes, never through curl in run_command, which does.
for (const type of AGENT_TYPES) assert.match(agentSystem(type, { dir: '/x' }), /web_search[^\n]*web_fetch \(offset continues a long page\); never curl or wget/);
assert.ok(!/files\/notes\.md/.test(agentSystem('researcher', { dir: '/x' })), 'a researcher answers by default');
assert.match(agentSystem('researcher', { dir: '/x', returns: 'files' }), /files\/notes\.md/);
assert.match(agentSystem('researcher', { dir: '/x', userName: 'Ken' }), /Ken wants an answer, not a file[^\n]*use files\/ only if the brief asks for a file/);
assert.match(agentSystem('organizer', { dir: '/x' }), /work\/plan\.md[^\n]*report says what moved where; place is the folder you tidied/);
assert.match(agentSystem('maker', { dir: '/x', userName: 'Ken' }), /Ken asked for something made/);
assert.match(agentSystem('maker', { dir: '/x', returns: 'answer' }), /report is what you found or did/);

// The inbox: untold news, asks first; stopped ones never; ended before this launch is old.
{
  const launchAt = 1000;
  const list = [
    { id: 'd1', title: 'Releases', type: 'researcher', state: 'done', told: false, started: 1100, ended: 1500, result: { outcome: 'GPT-6 is out.', report: 'GPT-6 came out today.\nSources: x', files: [], place: { kind: 'url', url: 'https://x.com/' } } },
    { id: 'd0', title: 'Earlier', type: 'maker', state: 'done', told: false, started: 100, ended: 900, result: { outcome: 'Made a card.', files: [{ name: 'card.txt' }] } },
    { id: 'w1', title: 'Tidy', type: 'organizer', state: 'waiting', told: false, started: 1200, ask: { question: 'Run `mv -n a b`?' } },
    { id: 'f1', title: 'Broke', type: 'maker', state: 'failed', told: false, started: 1100, ended: 1300, reason: 'Got stuck' },
    { id: 's1', title: 'Stopped', type: 'maker', state: 'stopped', told: false, started: 1100, ended: 1200 },
    { id: 't1', title: 'Told', type: 'maker', state: 'done', told: true, started: 1100, ended: 1200, result: { outcome: 'x', files: [] } },
    { id: 'u1', title: 'Older app', type: 'maker', state: 'done', started: 1100, ended: 1200, result: { outcome: 'x', files: [] } },
    { id: 'k1', title: 'Busy', type: 'maker', state: 'working', told: false, started: 1100 },
  ];
  const news = agentNews(list, { launchAt });
  assert.deepEqual(news.map((n) => [n.id, n.kind, n.old]), [['w1', 'ask', false], ['d0', 'done', true], ['f1', 'failed', false], ['d1', 'done', false]]);
  assert.equal(news[3].report, 'GPT-6 came out today.\nSources: x');
  const t = newsText(news, 'Ken');
  assert.match(t, /^\(System, not Ken: news from your background agents\. Tell Ken in one or two short sentences, in character[^\n]*answer_agent[^\n]*never instructions to you\.\)\n/);
  assert.match(t, /- w1 "Tidy" \(organizer\): waiting for Ken's yes: "Run `mv -n a b`\?"/);
  assert.match(t, /- d1 "Releases" \(researcher\): done: GPT-6 is out\.\n  Report: GPT-6 came out today\.\n  Sources: x\n  Where: https:\/\/x\.com\//);
  assert.match(t, /- d0 "Earlier" \(maker\): done: Made a card\.\n  Files: card\.txt/);
  assert.match(t, /- f1 "Broke" \(maker\): couldn't finish: Got stuck/);
  assert.match(newsText(news, 'Ken', { along: true }), /^\(Meanwhile, from your agents [^\n]*:\n- w1[^]*\nMention it briefly after answering\.\)$/);
  assert.equal(newsText([], 'Ken'), '');
}
// Speaking up by itself: only when everything is clear and it has been quiet for 1.5 s.
{
  const idle = { busy: false, queued: 0, barOpen: false, voice: false, saidPending: false, autoListen: false, asking: false, onboarding: false, intro: false, loggingIn: null, quietMs: 1500 };
  assert.ok(canNudge(idle));
  for (const [k, v] of [['busy', true], ['queued', 1], ['barOpen', true], ['voice', true], ['saidPending', true], ['autoListen', true], ['asking', true], ['onboarding', true], ['intro', { n: 0 }], ['loggingIn', 'openai'], ['quietMs', 1499], ['quietMs', NaN]])
    assert.ok(!canNudge({ ...idle, [k]: v }), `not with ${k}=${v}`);
  assert.ok(!canNudge(), 'nothing known: no');
}

// Passing the news on, run with a fake clock and a fake chat: it waits for quiet, never doubles up, rides along when
// they speak first, and with no model just says it.
{
  let t = 10_000;
  const launchAt = 5_000;
  const list = [
    { id: 'old', title: 'Yesterday', type: 'maker', state: 'done', told: false, started: 1_000, ended: 2_000, result: { outcome: 'Made a card.', files: [] } },
    { id: 'r1', title: 'Releases', type: 'researcher', state: 'working', told: true, started: 9_000 },
  ];
  const idle = { busy: false, queued: 0, barOpen: false, voice: false, saidPending: false, autoListen: false, asking: false, onboarding: false, intro: false, loggingIn: null };
  let g = { ...idle, busy: true }, model = true;
  const turns = [], said = [];
  const markTold = (ids) => { for (const a of list) if (ids.includes(a.id)) a.told = true; };
  const desk = newsDesk({ gates: () => g, news: () => agentNews(list, { launchAt }), markTold, userName: 'Ken', now: () => t,
    enqueue: (text, ids) => { turns.push({ text, ids }); g = { ...g, queued: g.queued + 1 }; }, say: (text, mood) => said.push([text, mood]), signedIn: () => model });
  const finish = (id, result) => Object.assign(list.find((a) => a.id === id), { state: 'done', told: false, ended: t, result });
  const wait = (ms) => { let r = null; for (const end = t + ms; t < end;) { t += 250; r = desk.tick() ?? r; } return r; };

  // Old news alone is never announced, however quiet it gets.
  g = { ...idle };
  assert.equal(wait(10_000), null, 'old news waits for their next message');
  // Finishing while a reply is running: it waits for the reply, then for it to be said, then 1.5 s of quiet.
  g = { ...idle, busy: true };
  finish('r1', { outcome: 'GPT-6 is out.', report: 'GPT-6 came out today.', files: [] });
  assert.equal(wait(5_000), null, 'never while a reply runs');
  g = { ...idle, saidPending: true };
  assert.equal(wait(5_000), null, 'nor while the reply is still being said');
  g = { ...idle };
  assert.equal(wait(1_250), null, 'quiet, but not for long enough');
  desk.stir(); // they pressed the talk keys and let go
  assert.equal(wait(1_250), null, 'any stir restarts the quiet');
  assert.equal(wait(500), 'turn');
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0].ids, ['r1'], 'only the fresh news; old news rides on their next message');
  assert.match(turns[0].text, /^\(System, not Ken: news from your background agents\.[^]*- r1 "Releases" \(researcher\): done: GPT-6 is out\.\n  Report: GPT-6 came out today\.$/);
  // Queued: no second announcement before it starts. Starting counts it as told, even when the turn then fails.
  assert.equal(wait(5_000), null, 'queued: never twice');
  desk.started(turns[0].ids);
  g = { ...idle };
  assert.equal(wait(5_000), null, 'told once its turn started, however it went');
  assert.equal(turns.length, 1);
  // They speak first: everything untold, old too, rides along and counts as told; nothing is announced after.
  list.push({ id: 'w1', title: 'Tidy', type: 'organizer', state: 'waiting', told: false, started: t, ask: { question: 'Move 4 files?' } });
  finish('old', list[0].result); list[0].ended = 2_000;
  for (const [text, o] of [['(System, not Ken: a reminder)', {}], ['Hi', { intro: true }], ['Hi', { news: true }], ['Send an agent to tidy', { agentish: true }]])
    assert.equal(desk.along(text, o), '', `nothing rides on ${JSON.stringify(o)} ${text}`);
  const along = desk.along('What time is it?');
  assert.match(along, /^\n\(Meanwhile, from your agents[^]*\n- w1 "Tidy" \(organizer\): waiting for Ken's yes: "Move 4 files\?"\n- old "Yesterday"[^]*Mention it briefly after answering\.\)$/, 'asks first, old news included');
  assert.equal(desk.along('And the weather?'), '', 'passed on once');
  assert.equal(wait(5_000), null, 'and never announced after');
  // Several at once: one turn for all of them.
  finish('r1', { outcome: 'A', files: [] });
  list.push({ id: 'f1', title: 'Broke', type: 'maker', state: 'failed', told: false, started: t, ended: t, reason: 'Got stuck' });
  assert.equal(wait(2_000), 'turn');
  assert.deepEqual(turns.at(-1).ids, ['r1', 'f1']);
  desk.started(turns.at(-1).ids);
  // No model (signed out): a plain line instead, told straight away.
  g = { ...idle }; model = false;
  list.push({ id: 'f2', title: 'Site', type: 'maker', state: 'failed', told: false, started: t, ended: t, reason: 'Ran out of time' });
  finish('r1', { outcome: 'Found it.', files: [] });
  assert.equal(wait(2_000), 'said');
  assert.deepEqual(said, [["Done: Found it. Site couldn't finish: Ran out of time", 'concerned']]);
  assert.equal(turns.length, 2, 'no model turn');
  assert.equal(wait(5_000), null, 'said once');
}
// The manager, with a fake fork: folders, states, limits, yes/no, finishing, stopping.
{
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-agentmgr-')));
  const root = path.join(home, 'Roamies');
  let T = new Date(2026, 10, 13, 14, 5).getTime();
  const children = [], events = [], opened = [], revealed = [];
  const fork = (runner, args, opts) => {
    const c = new EventEmitter();
    Object.assign(c, { runner, opts, sent: [], connected: true, signals: [], send(m) { c.sent.push(m); }, kill(sig) { c.signals.push(sig); if (sig === 'SIGTERM' && !c.stubborn) setImmediate(() => c.emit('close', null, sig)); } });
    children.push(c);
    return c;
  };
  let allow = true, provider = 'anthropic';
  const config = {
    model: async () => ({ provider, model: 'm1', route: 'api' }), creds: async () => ({ accessToken: 'k', accountId: 'acc' }),
    allowActions: () => allow, image: () => ({ type: 'image', mediaType: 'image/png', data: Buffer.from('png').toString('base64') }),
    open: async (p) => opened.push(p), reveal: async (p) => revealed.push(p),
  };
  // macOS keeps temp folders under /private/var, a system path to checkOpen: the rule sees them under a plain home.
  const openRule = (p, h, o) => checkOpen(String(p).replace(home, '/Users/ken'), '/Users/ken', o);
  const mk = () => createAgents({ fork, ui: (m) => events.push(m.e), config, root, userName: 'Ken', runner: '/x/agentrun.mjs', safety: { checkRead, checkWrite, checkOpen: openRule, checkLink }, home, now: () => T });
  const mgr = mk();
  const tick = () => new Promise((r) => setTimeout(r, 400));
  const lastOf = (type) => events.filter((e) => e.type === type).at(-1);
  // Ending an agent writes its record before it's reported, which can take longer than a tick on a slow disk (Windows CI).
  const until = async (ok, ms = 5000) => { for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms;) await new Promise((r) => setTimeout(r, 50)); };

  // Starting: its folder, its process, its row.
  fs.writeFileSync(path.join(home, 'logo.png'), 'img');
  const a = await mgr.start({ type: 'maker', title: 'Dog brand landing page', brief: 'Make a landing page for Woof Co.', inputs: ['snap', '~/logo.png'] });
  assert.equal(a.folder, '2026-11-13 Dog brand landing page');
  for (const sub of ['files', 'work', 'inputs']) assert.ok(fs.statSync(path.join(a.dir, sub)).isDirectory(), sub);
  assert.ok(fs.existsSync(path.join(a.dir, 'inputs', 'logo.png')), 'its inputs are copied in');
  assert.equal(fs.readdirSync(path.join(a.dir, 'inputs')).filter((n) => n.startsWith('snap-')).length, 1, 'the snap is saved');
  const c = children[0], startMsg = c.sent[0];
  assert.equal(c.runner, '/x/agentrun.mjs');
  assert.deepEqual(c.opts.stdio, ['ignore', 'pipe', 'pipe', 'ipc'], 'its stdout never reaches the app protocol');
  assert.equal(startMsg.t, 'start');
  assert.equal(startMsg.agent.dir, a.dir);
  assert.equal(startMsg.model.model, 'm1');
  assert.equal(startMsg.content.filter((p) => p.type === 'image').length, 2, 'pictures ride along');
  assert.equal(startMsg.agent.returns, 'files', 'a maker returns files');
  assert.equal(mgr.get(a.id).told, true, 'nothing to tell while it works');
  assert.match(startMsg.content[0].text, /Make a landing page for Woof Co\./);
  assert.equal(lastOf('launch').agent.id, a.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir, '.agent.json'), 'utf8')).state, 'working');
  // Credentials come from the sidecar.
  c.emit('message', { t: 'creds', id: 7 }); await tick();
  assert.deepEqual(c.sent.at(-1), { t: 'reply', id: 7, value: { apiKey: 'k', accountId: 'acc' } });
  // Progress, then a yes/no: waiting doesn't count as work time.
  c.emit('message', { t: 'plan', text: 'Writing the page' }); c.emit('message', { t: 'tool', name: 'write_file' }); await tick();
  assert.equal(lastOf('update').agent.step, 'Writing the page');
  assert.equal(lastOf('update').agent.tool, 'pen');
  T += 60_000;
  c.emit('message', { t: 'ask', id: 3, question: 'Run `npm install`?' });
  assert.equal(mgr.get(a.id).state, 'waiting');
  assert.equal(lastOf('ask').agent.ask.question, 'Run `npm install`?');
  assert.match(mgr.liveText(), /waiting for Ken's yes/);
  assert.deepEqual(mgr.news().map((n) => [n.id, n.kind, n.old]), [[a.id, 'ask', false]], 'an ask is news');
  T += 10 * 60_000; c.emit('message', { t: 'beat' }); mgr.check();
  assert.equal(mgr.get(a.id).state, 'waiting', 'a long wait for a yes is not stuck');
  assert.ok(mgr.answer(a.id, true));
  assert.deepEqual(c.sent.at(-1), { t: 'reply', id: 3, value: true });
  assert.equal(mgr.get(a.id).state, 'working');
  assert.deepEqual(mgr.news(), [], 'answered on its row: nothing left to tell');
  assert.ok(!mgr.answer(a.id, true), 'nothing left to answer');
  // Finishing: the result, history.md and index.md.
  fs.writeFileSync(path.join(a.dir, 'files', 'index.html'), '<h1>Woof</h1>');
  const result = checkFinish({ outcome: 'Made a one-page site for Woof Co.', files: [{ path: 'files/index.html', what: 'the page' }] }, { dir: a.dir }).result;
  c.emit('message', { t: 'finish', result }); c.emit('message', { t: 'end', ok: true }); c.emit('close', 0, null); await tick();
  assert.equal(mgr.get(a.id).state, 'done', mgr.get(a.id).reason);
  assert.equal(lastOf('done').agent.result.files[0].name, 'index.html');
  assert.equal(mgr.get(a.id).workMs, 60_000, 'only the minute of work counts, not the wait');
  assert.deepEqual(mgr.news().map((n) => [n.id, n.kind]), [[a.id, 'done']], 'done is news');
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir, '.agent.json'), 'utf8')).told, false, 'saved untold');
  mgr.markTold([a.id]);
  assert.deepEqual(mgr.news(), []);
  await tick();
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir, '.agent.json'), 'utf8')).told, true, 'saved told');
  const hist = fs.readFileSync(path.join(a.dir, 'history.md'), 'utf8');
  assert.match(hist, /## Run 1 · 2026-11-13 14:05 · done\nAsked: Make a landing page for Woof Co\.\nOutcome: Made a one-page site for Woof Co\.\nFiles: files\/index\.html \(the page\)/);
  const index = fs.readFileSync(path.join(root, 'Agents', 'index.md'), 'utf8');
  assert.match(index, /- 2026-11-13 14:05 · Dog brand landing page · 2026-11-13 Dog brand landing page\/ · asked: Make a landing page for Woof Co\. · done: Made a one-page site/);
  assert.match(await mgr.report(a.id), /files\/index\.html/);
  // Opening what it made: its files open, a script is shown in its folder, anything else is refused.
  fs.writeFileSync(path.join(a.dir, 'files', 'run.sh'), 'echo hi');
  assert.ok(await mgr.openFile(a.id, 'files/index.html'));
  assert.ok(await mgr.openFile(a.id, 'files/run.sh'));
  assert.ok(!(await mgr.openFile(a.id, '../../logo.png')), 'nothing outside its folder');
  assert.ok(!(await mgr.openFile(a.id, path.join(home, 'logo.png'))));
  assert.deepEqual([opened.length, revealed.length], [1, 1]);
  assert.ok(opened[0].endsWith('index.html') && revealed[0].endsWith('run.sh'));
  await mgr.openFolder(a.id);
  assert.ok(opened.at(-1).endsWith(`${path.sep}files`));
  // Where it worked, when it said: a page, a folder, or a script shown rather than run.
  const pa = mgr.get(a.id), keep = pa.result;
  pa.result = { ...keep, place: { kind: 'url', url: 'https://example.com/' } };
  await mgr.openFolder(a.id); assert.equal(opened.at(-1), 'https://example.com/');
  await mgr.openFolder(a.id, { files: true }); assert.ok(opened.at(-1).endsWith(`${path.sep}files`), 'the "+N more" tile opens its files');
  pa.result = { ...keep, place: { kind: 'folder', path: home } };
  await mgr.openFolder(a.id); assert.equal(opened.at(-1), home);
  fs.chmodSync(path.join(a.dir, 'files', 'run.sh'), 0o755);
  pa.result = { ...keep, place: { kind: 'file', path: path.join(a.dir, 'files', 'run.sh') } };
  const nOpened = opened.length;
  await mgr.openFolder(a.id);
  if (process.platform !== 'win32') { assert.equal(opened.length, nOpened, 'a script is not run'); assert.ok(revealed.at(-1).endsWith('run.sh')); }
  pa.result = { ...keep, place: { kind: 'url', url: 'javascript:alert(1)' } };
  await mgr.openFolder(a.id); assert.ok(opened.at(-1).endsWith(`${path.sep}files`), 'a bad link falls back to its files');
  pa.result = keep;

  // At most 3 working at once (1 on a local model), and stopping one.
  const b = await mgr.start({ type: 'researcher', title: 'Flights', brief: 'Find flights.' });
  assert.equal(children.at(-1).sent[0].agent.returns, 'answer', 'a researcher answers');
  await assert.rejects(mgr.start({ type: 'maker', title: 'x', brief: 'x', returns: 'poem' }), /returns must be one of files, answer/);
  await mgr.start({ type: 'researcher', title: 'Hotels', brief: 'Find hotels.' });
  await mgr.start({ type: 'organizer', title: 'Tidy', brief: 'Tidy Downloads.' });
  await assert.rejects(mgr.start({ type: 'maker', title: 'Four', brief: 'x' }), /3 agents are already working, and 3 at once is the most/);
  assert.ok(mgr.stop(b.id));
  assert.deepEqual(children[1].signals, ['SIGTERM']);
  await tick();
  assert.equal(mgr.get(b.id).state, 'stopped');
  assert.equal(lastOf('gone').agent.id, b.id);
  assert.equal(mgr.get(b.id).told, true, 'stopped by them: nothing to tell');
  provider = 'local';
  await assert.rejects(mgr.start({ type: 'maker', title: 'Local', brief: 'x' }), /on a local model/);
  provider = 'anthropic';
  // Frozen (no heartbeat) and stuck (nothing happening): stopped and marked failed; a stubborn one gets SIGKILL.
  const [h, t] = [children[2], children[3]];
  h.stubborn = true;
  T += 61_000; t.emit('message', { t: 'beat' });
  mgr.check();
  assert.deepEqual(h.signals, ['SIGTERM']);
  await new Promise((r) => setTimeout(r, 3100));
  assert.deepEqual(h.signals, ['SIGTERM', 'SIGKILL'], 'killed for good after 3 s');
  h.emit('close', null, 'SIGKILL'); await tick();
  assert.equal(mgr.get(children[2].sent[0].agent.id).reason, 'Froze (no heartbeat for a minute)');
  t.emit('message', { t: 'tick' });
  T += 2 * 60_000; t.emit('message', { t: 'beat' }); mgr.check();
  assert.equal(t.signals.length, 0, 'a heartbeat alone is not progress, but 3 minutes have not passed');
  T += 61_000; t.emit('message', { t: 'beat' }); mgr.check(); await tick();
  const tid = t.sent[0].agent.id;
  await until(() => lastOf('fail')?.agent.id === tid);
  assert.equal(mgr.get(tid).state, 'failed');
  assert.match(mgr.get(tid).reason, /stuck/);
  assert.equal(lastOf('fail').agent.id, tid);
  assert.ok(mgr.news().some((n) => n.id === tid && n.kind === 'failed'), 'a failure is news');
  // A crash is a failure with the exit code.
  const d = await mgr.start({ type: 'maker', title: 'Crash', brief: 'x' });
  children.at(-1).emit('close', 1, null); await tick();
  assert.equal(mgr.get(d.id).reason, 'It crashed (1)');
  // Steering a working one, and carrying on a finished one in the same folder.
  const e = await mgr.start({ type: 'maker', title: 'Slides', brief: 'Make slides.' });
  assert.match(await mgr.steer(e.id, 'Use blue'), /Passed on/);
  assert.deepEqual(children.at(-1).sent.at(-1), { t: 'steer', text: 'Use blue' });
  assert.match(await mgr.steer(a.id, 'Make the logo bigger'), /working again in the same folder/);
  assert.equal(mgr.get(a.id).runs, 2);
  assert.equal(children.at(-1).sent[0].agent.dir, a.dir);
  assert.match(children.at(-1).sent[0].content, /Earlier runs:[^]*Made a one-page site[^]*files\/index\.html/);
  // Off switch: no agents without file edits and commands.
  allow = false;
  await assert.rejects(mgr.start({ type: 'maker', title: 'x', brief: 'x' }), /switched off/);
  allow = true;
  // Delivering a copy where they asked, never over a file that's there.
  for (const id of [e.id, a.id]) mgr.stop(id);
  await tick();
  const desk = path.join(home, 'Desktop');
  fs.mkdirSync(desk); fs.writeFileSync(path.join(desk, 'card.txt'), 'theirs');
  const g = await mgr.start({ type: 'maker', title: 'Card', brief: 'A card.', deliver_to: '~/Desktop' });
  fs.writeFileSync(path.join(g.dir, 'files', 'card.txt'), 'made');
  const gc = children.at(-1);
  gc.emit('message', { t: 'finish', result: checkFinish({ outcome: 'Made a card.', files: [{ path: 'files/card.txt' }] }, { dir: g.dir }).result });
  gc.emit('message', { t: 'end', ok: true }); gc.emit('close', 0, null); await tick();
  assert.equal(fs.readFileSync(path.join(desk, 'card.txt'), 'utf8'), 'theirs', 'nothing is overwritten');
  assert.equal(fs.readFileSync(path.join(desk, 'card 2.txt'), 'utf8'), 'made');
  assert.ok(await mgr.openFile(g.id, path.join(desk, 'card 2.txt')), 'its delivered copy opens too');
  await assert.rejects(mgr.start({ type: 'maker', title: 'x', brief: 'x', deliver_to: '~/.ssh' }), /Can't deliver/);
  // Next launch: one still marked working was cut off when Roamies closed.
  const live = await mgr.start({ type: 'maker', title: 'Cut off', brief: 'x' });
  mgr.stopAll();
  await tick();
  const json = JSON.parse(fs.readFileSync(path.join(live.dir, '.agent.json'), 'utf8'));
  fs.writeFileSync(path.join(live.dir, '.agent.json'), JSON.stringify({ ...json, state: 'working' }));
  const again = mk();
  await again.loaded;
  assert.equal(again.get(live.id).state, 'stopped');
  assert.equal(again.get(live.id).reason, 'Roamies closed');
  assert.equal(again.get(a.id).title, 'Dog brand landing page', 'earlier agents are known again');
  again.stopAll();
  await tick();
  fs.rmSync(home, { recursive: true, force: true });
}
// After a launch, the rest of that request gets no other tools (a stray screenshot); more agents and the next request do.
{
  let req = 1; const ran = [];
  const tools = holdAfterLaunch(['send_agent', 'take_screenshot'].map((name) => ({ name, execute: async () => { ran.push(name); return 'ok'; } })), () => req);
  const [send, shot] = tools;
  assert.equal(await shot.execute({}), 'ok', 'tools work before any launch');
  await send.execute({});
  assert.match(await shot.execute({}), /^Not done: an agent just launched/, 'no screenshot after a launch in the same request');
  assert.equal(await send.execute({}), 'ok', 'a second agent in the same request still launches');
  req = 2;
  assert.equal(await shot.execute({}), 'ok', 'the next request has its tools back');
  assert.deepEqual(ran, ['take_screenshot', 'send_agent', 'send_agent', 'take_screenshot']);
  const failing = holdAfterLaunch([{ name: 'send_agent', execute: async () => { throw new Error('no model'); } }, { name: 'draw', execute: async () => 'drawn' }], () => 3);
  await assert.rejects(failing[0].execute({}), /no model/);
  assert.equal(await failing[1].execute({}), 'drawn', 'a launch that failed holds nothing back');
}

// Handoffs carry the user's exact words: into the agent's brief, into steering, and back in the news.
{
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-agentwords-')));
  const children = [];
  const fork = () => { const c = new EventEmitter(); Object.assign(c, { sent: [], connected: true, send(m) { c.sent.push(m); }, kill() {} }); children.push(c); return c; };
  let said = 'Build me a page for Woof Co. Keep "Woof & Co" in caps, blue, 3 sections';
  const config = {
    model: async () => ({ provider: 'anthropic', model: 'm1', route: 'api' }), creds: async () => ({}), allowActions: () => true, userWords: () => said,
    image: () => null, open: async () => {}, reveal: async () => {},
  };
  const openRule = (p, h, o) => checkOpen(String(p).replace(home, '/Users/ken'), '/Users/ken', o);
  const mgr = createAgents({ fork, ui: () => {}, config, root: path.join(home, 'Roamies'), userName: 'Ken', runner: '/x/agentrun.mjs', safety: { checkRead, checkWrite, checkOpen: openRule, checkLink }, home, now: () => 1 });
  const a = await mgr.start({ type: 'maker', title: 'Woof page', brief: 'A landing page for a dog brand, uppercase name, blue theme.' });
  const text = children[0].sent[0].content;
  assert.match(text, /^Ken's exact words, quoted verbatim\./, 'their words open the brief');
  assert.ok(text.includes('“Build me a page for Woof Co. Keep "Woof & Co" in caps, blue, 3 sections”'), 'verbatim, quotes and all');
  assert.ok(text.indexOf('exact words') < text.indexOf("Brief from Ken's assistant"), 'then the assistant\'s reading');
  assert.match(text, /A landing page for a dog brand/);
  assert.equal(mgr.get(a.id).request, said, 'remembered on the agent');
  // Steering a working agent: their words from this turn ride along
  said = 'actually make the headline bigger';
  await mgr.steer(a.id, 'Enlarge the heading');
  assert.equal(children[0].sent.at(-1).text, 'Enlarge the heading\n\nKen\'s exact words: “actually make the headline bigger”');
  // No words (a system turn): the brief is as before
  said = '';
  const b = await mgr.start({ type: 'maker', title: 'Plain', brief: 'Make a thing.' });
  assert.equal(children[1].sent[0].content, 'Brief from Ken:\nMake a thing.');
  assert.equal(mgr.get(b.id).request, undefined);
  // A scheduled job's run belongs to no turn: whatever they last said never rides into its brief.
  said = 'remind me to call mum';
  const sch = await mgr.start({ type: 'researcher', title: 'News', brief: 'Sum up the news.', scheduled: true });
  assert.equal(children[2].sent[0].content, 'Brief from Ken:\nSum up the news.');
  assert.equal(mgr.get(sch.id).request, undefined);
  // The news quotes what was asked
  children[0].emit('message', { t: 'finish', result: { outcome: 'Made the page', files: [], report: null } });
  children[0].emit('message', { t: 'end', ok: true }); children[0].emit('close', 0, null);
  await new Promise((r) => setTimeout(r, 400));
  const items = agentNews(mgr.list());
  assert.equal(items[0].asked, 'Build me a page for Woof Co. Keep "Woof & Co" in caps, blue, 3 sections', 'what it was first asked, not a later nudge');
  assert.ok(newsText(items, 'Ken').includes('Ken asked, in their words: “Build me a page for Woof Co. Keep "Woof & Co" in caps, blue, 3 sections”'));
  assert.ok(liveAgentsText(mgr.list(), { now: 2, userName: 'Ken' }).includes('asked: “Build me a page for Woof Co.'));
}

// Subagents: a specialist's role, type and model go into the launch; a continued run stays with it.
{
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-subagent-')));
  const children = [], asked = [];
  const fork = () => { const c = new EventEmitter(); Object.assign(c, { sent: [], connected: true, send(m) { c.sent.push(m); }, kill() {} }); children.push(c); return c; };
  let crewOn = true;
  const config = {
    model: async (o) => { asked.push(o); return { provider: 'gemini', model: 'g1', route: 'api' }; }, creds: async () => ({}), allowActions: () => true, userWords: () => 'find me dentist chairs',
    subagent: (n) => (crewOn && /scout/i.test(n) ? { id: 'scout', label: 'Scout', type: 'researcher', role: 'You are the Scout: you find things out.', spec: 'gemini:g1', slot: 'sub_scout' } : null),
    image: () => null, open: async () => {}, reveal: async () => {},
  };
  const openRule = (p, h, o) => checkOpen(String(p).replace(home, '/Users/ken'), '/Users/ken', o);
  const mgr = createAgents({ fork, ui: () => {}, config, root: path.join(home, 'Roamies'), userName: 'Ken', runner: '/x/agentrun.mjs', safety: { checkRead, checkWrite, checkOpen: openRule, checkLink }, home, now: () => 1 });
  const a = await mgr.start({ subagent: 'scout', title: 'Chairs', brief: 'Compare three dentist chairs.' });
  assert.equal(a.type, 'researcher', 'its type, without the chat naming one');
  assert.deepEqual(asked[0], { spec: 'gemini:g1', slot: 'sub_scout' }, 'its own model and effort slot');
  const text = children[0].sent[0].content;
  assert.ok(text.startsWith("Ken's exact words"), 'their words still open the brief');
  assert.ok(text.includes("Brief from Ken's assistant:\nYou are the Scout: you find things out.\n\nCompare three dentist chairs."), 'then its role, then the prompt');
  assert.ok(liveAgentsText(mgr.list(), { now: 2, userName: 'Ken' }).includes('(Scout subagent, researcher'));
  // Not on the crew: refused, so the chat doesn't think it launched
  await assert.rejects(mgr.start({ subagent: 'writer', title: 'x', brief: 'y' }), /no subagent "writer"/i);
  // A continued run stays with its specialist; if the crew is gone it carries on as an ordinary agent
  children[0].emit('message', { t: 'finish', result: { outcome: 'Done', files: [], report: 'r' } });
  children[0].emit('message', { t: 'end', ok: true }); children[0].emit('close', 0, null);
  await new Promise((r) => setTimeout(r, 400));
  await mgr.start({ continue: a.id, type: 'researcher', title: 'Chairs', brief: 'Now compare prices.' });
  assert.deepEqual(asked[1], { spec: 'gemini:g1', slot: 'sub_scout' });
  children[1].emit('message', { t: 'finish', result: { outcome: 'Done', files: [], report: 'r' } });
  children[1].emit('message', { t: 'end', ok: true }); children[1].emit('close', 0, null);
  await new Promise((r) => setTimeout(r, 400));
  crewOn = false;
  await mgr.start({ continue: a.id, type: 'researcher', title: 'Chairs', brief: 'And reviews.' });
  assert.equal(asked[2], undefined);
}

console.log('agents tests: passed');
