// OpenRouter's and OpenCode's live model lists. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getModel, getModelsForProvider, setProviderCatalog } from '@kenkaiiii/gg-core';
import { CATALOG_PROVIDERS, REFRESH_MS, RETRY_MS, createCatalogs } from '../catalogs.mjs';
import { flushWrites } from '../store.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roamies-catalogs-'));
const row = (id, o = {}) => ({ id, name: id, description: 'x'.repeat(500), context_length: 200_000, supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] }, ...o });
const routerBody = { data: [row('anthropic/claude-x'), row('google/gemini-y'), row('meta/no-tools', { supported_parameters: [] })] };
const codeBody = (ids) => ({ object: 'list', data: ids.map((id) => ({ id, name: id, type: 'chat', api: { 'chat-completions': {} }, capabilities: { tools: { supported: true } }, limit: { context: 200_000 }, cost: { text: { input: { price: 1 } } } })) });

let t = 1_000_000;
const calls = [];
let answers = {};
const fakeFetch = async (url, init) => {
  calls.push({ url, auth: init.headers.Authorization ?? null });
  const a = answers[url];
  if (!a) throw new Error('offline');
  return { ok: a.ok ?? true, status: a.status ?? 200, json: async () => a.body };
};
let creds = { accessToken: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1' };
const auth = { getCredentials: async (p) => (p === 'openrouter' ? creds : null) };
const make = () => createCatalogs({ auth, dir, fetch: fakeFetch, now: () => t });

assert.deepEqual(CATALOG_PROVIDERS, ['openrouter', 'opencode', 'opencode-go']);
const builtIn = getModelsForProvider('openrouter').map((m) => m.id);
assert.ok(builtIn.length >= 1, 'gg-core ships at least one OpenRouter model');

// Nothing cached and offline: the built-in list stays.
let c = make();
await c.load();
assert.equal(await c.refreshStale(['openrouter']), false);
assert.deepEqual(getModelsForProvider('openrouter').map((m) => m.id), builtIn);

// Online: OpenRouter's whole tool-capable list replaces the built-in one, read with the key from its endpoint.
answers = { 'https://openrouter.ai/api/v1/models': { body: routerBody } };
calls.length = 0;
assert.equal(await c.refreshStale(['openrouter']), false, 'a failed read waits before trying again');
assert.equal(calls.length, 0);
t += RETRY_MS;
assert.equal(await c.refreshStale(['openrouter']), true);
assert.deepEqual(calls, [{ url: 'https://openrouter.ai/api/v1/models', auth: 'Bearer sk-or-test' }]);
assert.deepEqual(getModelsForProvider('openrouter').map((m) => m.id), ['anthropic/claude-x', 'google/gemini-y'], 'models that cannot call tools are left out');
assert.equal(getModel('anthropic/claude-x').provider, 'openrouter');
await flushWrites();
const saved = JSON.parse(await fs.readFile(path.join(dir, 'openrouter-models.json'), 'utf8'));
assert.equal(saved.url, 'https://openrouter.ai/api/v1/models');
assert.deepEqual(saved.body.data.map((r) => r.id), ['anthropic/claude-x', 'google/gemini-y'], 'the cache keeps only usable rows');
assert.ok(saved.body.data.every((r) => !('description' in r)), 'without descriptions');

// Fresh: not read again until it's stale; providers that aren't connected are never read.
calls.length = 0;
assert.equal(await c.refreshStale(['openrouter']), false);
assert.equal(calls.length, 0);

// An empty or failed answer never wipes a working list.
answers['https://openrouter.ai/api/v1/models'] = { body: { data: [] } };
assert.equal(await c.refresh('openrouter'), false);
answers['https://openrouter.ai/api/v1/models'] = { ok: false, status: 500 };
assert.equal(await c.refresh('openrouter'), false);
assert.equal(getModelsForProvider('openrouter').length, 2);

// A restart offline: the cached list comes back.
setProviderCatalog('openrouter', undefined);
answers = {};
c = make();
await c.load();
assert.deepEqual(getModelsForProvider('openrouter').map((m) => m.id), ['anthropic/claude-x', 'google/gemini-y']);

// A key on another endpoint: the cache describes another server, so it isn't used.
setProviderCatalog('openrouter', undefined);
creds = { accessToken: 'k', baseUrl: 'https://proxy.example/v1/' };
c = make();
await c.load();
assert.deepEqual(getModelsForProvider('openrouter').map((m) => m.id), builtIn);
creds = { accessToken: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1' };

// OpenCode: each plan's public list, no key sent; read again once it's six hours old.
const zen = 'https://opencode.ai/inference/v1/models';
answers = { [zen]: { body: codeBody(['kimi-k3', 'qwen3.8-max', 'mistral-large-4']) } };
c = make();
await c.load();
calls.length = 0;
assert.equal(await c.refreshStale(['opencode']), true);
assert.deepEqual(calls, [{ url: zen, auth: null }]);
assert.deepEqual(getModelsForProvider('opencode').map((m) => m.id), ['opencode/kimi-k3', 'opencode/qwen3.8-max', 'opencode/mistral-large-4']);
calls.length = 0;
t += REFRESH_MS;
await c.refreshStale(['opencode']);
assert.equal(calls.length, 1, 'stale after six hours');

await fs.rm(dir, { recursive: true, force: true });
console.log('catalogs ok');
