// MCP connections with a fake client: the saved list, secrets kept out of the file, connecting, sign-in, tools,
// switching off, removing, and importing from GG Coder or Claude Desktop. Runs against a throwaway HOME. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-mcp-test-'));
process.env.HOME = TMP; process.env.USERPROFILE = TMP; delete process.env.ROAMIES_DATA_DIR;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const { SECRET_MARK, createMcp, importPaths, toConfig, whereOf } = await import('../mcp.mjs');
const { DIR, flushWrites } = await import('../store.mjs');

// A fake gg client: "notes" has two tools, "linear" needs sign-in until login, "broken" never connects.
const calls = [];
let signedIn = false;
const tool = (server, name, annotations) => ({ name: `mcp__${server}__${name}`, description: `${name} things`, rawInputSchema: { type: 'object' }, annotations, execute: async (args) => `ran ${name} ${JSON.stringify(args)}` });
const fake = {
  async connectAllDetailed(cfgs) {
    return cfgs.map((c) => {
      calls.push(['connect', c.name, c.env ?? null, c.headers ?? null]);
      if (c.name.startsWith('linear') && !signedIn) return { name: c.name, ok: false, toolCount: 0, tools: [], error: 'Requires login.', requiresAuth: true };
      if (c.name === 'broken') return { name: c.name, ok: false, toolCount: 0, tools: [], error: 'spawn ENOENT' };
      const tools = c.name === 'notes' ? [tool('notes', 'search_notes', { readOnlyHint: true }), tool('notes', 'delete_note', { destructiveHint: true })] : [tool(c.name, 'ping')];
      return { name: c.name, ok: true, toolCount: tools.length, tools };
    });
  },
  async probe(c) { calls.push(['probe', c.name]); return c.name === 'broken' ? { ok: false, toolCount: 0, error: 'spawn ENOENT' } : { ok: true, toolCount: 2 }; },
  async login(c, onUrl) { onUrl('https://linear.app/oauth?x=1'); signedIn = true; return { ok: true, toolCount: 1 }; },
  async disconnect(name) { calls.push(['disconnect', name]); },
};
const kept = new Map();
const secrets = { get: async (k) => kept.get(k) ?? null, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } };
const ggFile = path.join(TMP, '.gg', 'mcp.json'), claudeFile = path.join(TMP, 'claude.json');
const mcp = createMcp({ secrets, manager: fake, paths: { gg: ggFile, 'claude-desktop': claudeFile } });

assert.deepEqual(mcp.status(), [], 'nothing saved yet');
assert.equal(mcp.liveText(), '');

// Adding: the key goes to the secret store, the file only says where it is.
await mcp.add({ name: 'notes', command: 'npx', args: ['-y', '@acme/notes-mcp'], secretEnv: { NOTES_TOKEN: 'tok-123456' } });
await flushWrites();
const saved = JSON.parse(fs.readFileSync(path.join(DIR, 'mcp.json'), 'utf8'));
assert.deepEqual(saved.mcpServers.notes, { command: 'npx', args: ['-y', '@acme/notes-mcp'], enabled: true, env: { NOTES_TOKEN: SECRET_MARK } });
assert.ok(!fs.readFileSync(path.join(DIR, 'mcp.json'), 'utf8').includes('tok-123456'), 'no secret in the file');
assert.deepEqual(calls.find((c) => c[0] === 'connect' && c[1] === 'notes')[2], { NOTES_TOKEN: 'tok-123456' }, 'the client gets the real key');
assert.deepEqual(mcp.status()[0], { name: 'notes', remote: false, where: 'npx -y @acme/notes-mcp', enabled: true, state: 'connected', toolCount: 2, error: null });
assert.equal(mcp.liveText(), '- notes: connected, 2 tools');

// Tools: names without the mcp__server__ prefix, with schema and hints; a query narrows them; calls reach the server.
const list = await mcp.tools('notes');
assert.deepEqual(list.map((t) => t.name), ['search_notes', 'delete_note']);
assert.deepEqual(list[0].annotations, { readOnlyHint: true });
assert.deepEqual((await mcp.tools('notes', 'search')).map((t) => t.name), ['search_notes']);
assert.equal(await (await mcp.tool('notes', 'search_notes')).execute({ q: 'x' }), 'ran search_notes {"q":"x"}');
await assert.rejects(mcp.tool('notes', 'nope'), /no tool called nope[^]*connection_tools/);
await assert.rejects(mcp.tools('ghost'), /No connection called ghost/);

// A remote one that needs sign-in: shown as such until login, which opens the browser and connects it.
await mcp.add({ name: 'linear', url: 'https://mcp.linear.app/mcp' });
assert.equal(mcp.status().find((s) => s.name === 'linear').state, 'needs-login');
assert.match(mcp.liveText(), /linear: needs sign-in/);
let opened = '';
await mcp.login('linear', (u) => { opened = u; });
assert.equal(opened, 'https://linear.app/oauth?x=1');
assert.equal(mcp.status().find((s) => s.name === 'linear').state, 'connected');
await assert.rejects(mcp.login('notes', () => {}), /runs on this computer/);

// Probing reports a failure without saving anything; unsafe servers are refused before anything runs.
assert.deepEqual(await mcp.probe({ name: 'broken', command: 'broken-mcp' }), { ok: false, toolCount: 0, error: 'spawn ENOENT', requiresAuth: false });
assert.equal(mcp.has('broken'), false);
await assert.rejects(mcp.probe({ name: 'evil', command: 'bash', args: ['-c', 'echo hi'] }), /can run anything/);
await assert.rejects(mcp.add({ name: 'bad name!', command: 'npx' }), /The name must be/);
assert.ok(!calls.some((c) => c[1] === 'evil'), 'never started');

// A key that's gone from the store: the server says what it needs instead of starting without it.
kept.clear();
const again = createMcp({ secrets, manager: fake, paths: { gg: ggFile, 'claude-desktop': claudeFile } });
await again.ready();
assert.equal(again.status().find((s) => s.name === 'notes').state, 'needs-key');
assert.match(again.liveText(), /notes: needs a key \(needs NOTES_TOKEN\)/);

// Off and on again; removing deletes its secrets and its entry.
await mcp.setEnabled('notes', false);
assert.equal(mcp.status().find((s) => s.name === 'notes').state, 'off');
assert.ok(calls.some((c) => c[0] === 'disconnect' && c[1] === 'notes'));
await mcp.add({ name: 'gh', url: 'https://api.example.com/mcp', secretHeaders: { Authorization: 'Bearer abc' } });
assert.equal(kept.size, 1);
assert.ok(await mcp.remove('gh'));
assert.equal(kept.size, 0, 'its secrets went too');
assert.equal(mcp.has('gh'), false);
assert.equal(await mcp.remove('gh'), false);

// Importing: what's in GG Coder's and Claude Desktop's lists (only files that exist).
assert.deepEqual(mcp.importable(), {});
fs.mkdirSync(path.dirname(ggFile), { recursive: true });
fs.writeFileSync(ggFile, JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer x' } } } }));
fs.writeFileSync(claudeFile, JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '~/Desktop'] }, 'bad name': { command: 'x' } } }));
const imp = mcp.importable();
assert.deepEqual(imp.gg.map((s) => [s.name, s.where, s.headers]), [['github', 'https://api.githubcopilot.com/mcp/', ['Authorization']]]);
assert.deepEqual(imp['claude-desktop'].map((s) => s.name), ['files'], 'names that would break tool names are left out');

// Helpers.
assert.deepEqual(toConfig('x', { type: 'sse', url: 'https://a.test/sse', enabled: false }), { name: 'x', url: 'https://a.test/sse', transport: 'sse', enabled: false });
assert.equal(whereOf({ command: 'uvx', args: ['mcp-server-time'] }), 'uvx mcp-server-time');
assert.match(importPaths({ home: '/Users/ken', platform: 'darwin' })['claude-desktop'].replaceAll('\\', '/'), /Library\/Application Support\/Claude\/claude_desktop_config\.json$/);
assert.equal(importPaths({ home: 'C:\\Users\\ken', platform: 'win32', env: { APPDATA: 'C:\\Users\\ken\\AppData\\Roaming' } })['claude-desktop'], path.join('C:\\Users\\ken\\AppData\\Roaming', 'Claude', 'claude_desktop_config.json'));
console.log('mcp ok');

// The chat's tools: adding always asks (even with Allow prompts skipped) and takes keys in masked asks; calls run
// read-only tools straight away and ask for the rest, destructive ones even with Allow prompts skipped.
{
  const { createMcpTools } = await import('../mcp.mjs');
  const { checkMcpCall, isYes } = await import('../safety.mjs');
  const asked = [];
  let answers = [];
  const ask = async (o) => { asked.push(o); return answers.shift() ?? null; };
  let skip = true;
  const m = createMcp({ secrets, manager: fake, paths: { gg: ggFile, 'claude-desktop': claudeFile } });
  const opened = [];
  const T = Object.fromEntries(createMcpTools({ mcp: m, ask, isYes, skipAllow: () => skip, openUrl: (u) => opened.push(u), userName: 'Ken', checkCall: checkMcpCall }).map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(T), ['add_connection', 'remove_connection', 'connection_tools', 'use_connection']);

  // Said no: nothing is asked for, nothing saved.
  answers = [null];
  await assert.rejects(T.add_connection.execute({ name: 'notes2', command: 'npx', args: ['-y', '@acme/notes-mcp'], env_keys: ['NOTES_TOKEN'] }), /Ken said no/);
  assert.equal(asked.length, 1, 'asked even with Allow prompts skipped');
  assert.match(asked[0].placeholder, /^Connect notes2\? Run npx -y @acme\/notes-mcp$/);
  assert.equal(m.has('notes2'), false);

  // Yes, then the key in a masked ask: saved to the store, never in the reply.
  asked.length = 0; answers = ['yes', 'tok-999'];
  const out = await T.add_connection.execute({ name: 'notes', command: 'npx', args: ['-y', '@acme/notes-mcp'], env_keys: ['NOTES_TOKEN'] }).catch((e) => e.message);
  assert.match(out, /already a connection called notes/, 'names are unique');
  answers = ['yes', 'tok-999'];
  const added = await T.add_connection.execute({ name: 'notes3', command: 'npx', args: ['-y', '@acme/notes-mcp'], env_keys: ['NOTES_TOKEN'] });
  assert.match(added, /^Connected notes3: 1 tool\./);
  assert.equal(asked.at(-1).mask, true, 'the key is asked for masked');
  assert.match(asked.at(-1).prompt, /Paste the NOTES_TOKEN for notes3/);
  assert.ok(!added.includes('tok-999') && [...kept.values()].includes('tok-999'), 'kept in the store, not in the reply');

  // No key given: not added.
  answers = ['yes', ''];
  await assert.rejects(T.add_connection.execute({ name: 'notes4', command: 'npx', args: ['x'], env_keys: ['K'] }), /didn't give the K/);
  assert.equal(m.has('notes4'), false);

  // A server run on this computer is a command: not with commands switched off (a remote one is fine).
  const off = Object.fromEntries(createMcpTools({ mcp: m, ask, isYes, allowActions: () => false, userName: 'Ken', checkCall: checkMcpCall }).map((t) => [t.name, t]));
  await assert.rejects(off.add_connection.execute({ name: 'local1', command: 'npx', args: ['x'] }), /commands are switched off/);

  // Blocked ones never ask.
  asked.length = 0;
  await assert.rejects(T.add_connection.execute({ name: 'sh', command: 'sh', args: ['-c', 'echo'] }), /Blocked for safety/);
  assert.equal(asked.length, 0);

  // A server that needs sign-in: the browser opens straight after it's added.
  signedIn = false; answers = ['yes'];
  assert.match(await T.add_connection.execute({ name: 'linear2', url: 'https://mcp.linear.app/mcp' }), /^Connected linear2/);
  assert.deepEqual(opened, ['https://linear.app/oauth?x=1'], 'sign-in opened in the browser');

  // Import: lists first, then copies one, its header kept as a secret.
  const listed = await T.add_connection.execute({ import_from: 'gg' });
  assert.match(listed, /- github: https:\/\/api\.githubcopilot\.com\/mcp\/ \(keys: Authorization\)/);
  answers = ['yes'];
  assert.match(await T.add_connection.execute({ import_from: 'gg', name: 'github' }), /Connected github/);
  assert.ok(!fs.readFileSync(path.join(DIR, 'mcp.json'), 'utf8').includes('Bearer x'), 'the imported header is a secret');

  // Tools and calls.
  await m.add({ name: 'notes', command: 'npx', args: ['-y', '@acme/notes-mcp'] });
  assert.match(await T.connection_tools.execute({ server: 'notes' }), /- search_notes \[read-only\]: search_notes things\n {2}args: \{"type":"object"\}/);
  asked.length = 0;
  assert.equal(await T.use_connection.execute({ server: 'notes', tool: 'search_notes', args: '{"q":"a"}' }), 'ran search_notes {"q":"a"}');
  assert.equal(asked.length, 0, 'read-only: no ask');
  answers = [null];
  await assert.rejects(T.use_connection.execute({ server: 'notes', tool: 'delete_note', args: '{}' }), /Ken said no/);
  assert.equal(asked.length, 1, 'destructive: asked even with Allow prompts skipped');
  await assert.rejects(T.use_connection.execute({ server: 'notes', tool: 'search_notes', args: '[1]' }), /JSON object/);
  await assert.rejects(T.use_connection.execute({ server: 'notes', tool: 'search_notes', args: 'nope' }), /JSON object/);

  // Removing asks (skippable), then deletes.
  skip = false; answers = ['yes'];
  assert.equal(await T.remove_connection.execute({ name: 'notes3' }), 'Removed notes3.');
  assert.equal(m.has('notes3'), false);
  console.log('mcp tools ok');
}
