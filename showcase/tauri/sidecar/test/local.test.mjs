// Models served by Ollama, LM Studio and the user's own servers. Run: npm test
import assert from 'node:assert/strict';
import { LOCAL_API_KEY_PLACEHOLDER, getAuthStorageKeys, getModel, getModelsForProvider } from '@kenkaiiii/gg-core';
import {
  LMSTUDIO, MAX_SERVERS, MIN_CONTEXT, OLLAMA, OLLAMA_KEY, connectLocal, contextNote, downNote, forgetLocal, localModels, newServer, noModelsNote,
  serverFor, serverList, serverUrl, syncLocal,
} from '../local.mjs';

const model = (rawId, o = {}) => ({ rawId, endpointId: 'ollama', contextWindow: 4096, contextWindowKnown: false, supportsTools: true, supportsImages: true, supportsThinking: true, ...o });
const probe = { endpoint: OLLAMA, reachable: true, models: [
  model('qwen3.5:4b'),
  model('llama3:8b', { supportsImages: false }), // can't see screenshots
  model('moondream:2b', { supportsTools: false }), // can't use tools
  model('gemma4:12b', { contextWindow: 32768, contextWindowKnown: true }),
] };

const found = localModels([probe, { endpoint: { ...OLLAMA, id: 'other' }, reachable: false, models: [model('x')] }]);
assert.deepEqual(found.map((m) => m.id), ['local/ollama/qwen3.5:4b', 'local/ollama/gemma4:12b'], 'only models that see images and use tools, from servers that answered');
for (const m of found) {
  assert.equal(m.provider, 'local');
  assert.deepEqual(m.authStorageKeys, ['local:ollama']);
  assert.equal(m.supportsImages, true);
}
assert.equal(OLLAMA_KEY, 'local:ollama');
assert.equal(OLLAMA.baseUrl, 'http://127.0.0.1:11434/v1');

// A measured window replaces gg-core's 4k guess, but not a window the server reported.
const measured = new Map([['local/ollama/qwen3.5:4b', 32768], ['local/ollama/gemma4:12b', 8192]]);
const fitted = Object.fromEntries(localModels([probe], measured).map((m) => [m.id, m]));
assert.equal(fitted['local/ollama/qwen3.5:4b'].contextWindow, 32768);
assert.equal(fitted['local/ollama/qwen3.5:4b'].maxOutputTokens, 4096);
assert.equal(fitted['local/ollama/gemma4:12b'].contextWindow, 32768);

// Connecting registers the models; the credential is saved only when Ollama answered.
const saved = [];
const auth = { setLocalEndpoint: async (id, baseUrl) => saved.push([id, baseUrl]), getCredentials: async () => undefined };
const down = await connectLocal(auth, OLLAMA, { save: true, probe: async (e) => ({ endpoint: e, reachable: false, reason: 'Not running', models: [] }) });
assert.equal(down.ok, false);
assert.deepEqual(saved, [], "nothing saved when Ollama isn't running");
const up = await connectLocal(auth, OLLAMA, { save: true, windows: measured, probe: async () => probe });
assert.equal(up.ok, true);
assert.equal(up.all, 4);
assert.deepEqual(saved, [['ollama', 'http://127.0.0.1:11434/v1']]);
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), ['local/ollama/qwen3.5:4b', 'local/ollama/gemma4:12b']);
assert.equal(getModel('local/ollama/qwen3.5:4b').contextWindow, 32768);
assert.deepEqual(getAuthStorageKeys('local', 'local/ollama/qwen3.5:4b'), ['local:ollama'], 'the model runs on the saved Ollama credential');
await connectLocal(auth, OLLAMA, { probe: async () => ({ ...probe, models: probe.models.slice(1) }) });
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), ['local/ollama/gemma4:12b'], 'a removed model leaves the menu');
assert.equal(saved.length, 1, 'a rescan saves nothing');

// Too small a window gets a plain warning with the fix.
assert.match(contextNote(4096), /only 4k tokens.*Context length.*OLLAMA_CONTEXT_LENGTH/s);
assert.equal(contextNote(MIN_CONTEXT), '');
assert.match(contextNote(16384), /only 16k/, 'half of 16k is less than the system prompt and tools');
assert.equal(contextNote(65536), '');
assert.equal(contextNote(undefined), '');

// The server list: Ollama and LM Studio always, then the user's own (bad entries in the config are skipped).
const mine = [
  { id: 'gpu-box', label: 'GPU box', baseUrl: 'http://10.0.0.5:8000/v1', images: true },
  { id: 'llama', label: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', images: false },
  { id: 'ollama', label: 'Fake', baseUrl: 'http://x/v1' }, { id: 'Bad/Id', label: 'x', baseUrl: 'http://x/v1' }, null, 'junk',
];
const servers = serverList(mine);
assert.deepEqual(servers.map((s) => s.id), ['ollama', 'lmstudio', 'gpu-box', 'llama']);
assert.equal(LMSTUDIO.baseUrl, 'http://127.0.0.1:1234/v1');
assert.deepEqual(servers[2], { id: 'gpu-box', label: 'GPU box', baseUrl: 'http://10.0.0.5:8000/v1', kind: 'custom', custom: true, supportsImages: true });
assert.equal('supportsImages' in servers[3], false, "images off lets the server say (llama.cpp reports it), it doesn't force no");
assert.deepEqual(serverList(undefined).map((s) => s.id), ['ollama', 'lmstudio']);
assert.equal(serverFor(servers, 'local/gpu-box/Qwen/Qwen3-VL-32B').label, 'GPU box');
assert.equal(serverFor(servers, 'claude-opus-5-5'), undefined);

// Addresses: http(s) only, no key inside it, /v1 added when only the host is given.
assert.equal(serverUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/v1');
assert.equal(serverUrl(' http://127.0.0.1:8080/v1/ '), 'http://127.0.0.1:8080/v1');
assert.equal(serverUrl('https://llm.example.com/api/v1?x=1#y'), 'https://llm.example.com/api/v1');
assert.equal(serverUrl('ftp://host/v1'), null);
assert.equal(serverUrl('http://user:secret@host/v1'), null, 'a password in the address would be saved in plain text');
assert.equal(serverUrl('localhost:8080'), null);
assert.equal(serverUrl(''), null);

// Adding a server: a name, a good address, no duplicates, and an id that's safe in model ids.
assert.deepEqual(newServer([], { label: '  My  vLLM ', baseUrl: 'http://10.0.0.9:8000', images: true }), { server: { id: 'my-vllm', label: 'My vLLM', baseUrl: 'http://10.0.0.9:8000/v1', images: true } });
assert.equal(newServer([], { label: 'Ollama', baseUrl: 'http://10.0.0.9:11434' }).server.id, 'ollama-2', "a built-in's id isn't reused");
assert.equal(newServer(mine, { label: 'GPU box', baseUrl: 'http://10.0.0.6:8000' }).server.id, 'gpu-box-2');
assert.equal(newServer([], { label: '量子', baseUrl: 'http://h:1' }).server.id, 'server');
assert.equal(newServer([], { label: 'x', baseUrl: 'http://h:1' }).server.images, false);
assert.match(newServer([], { label: ' ', baseUrl: 'http://h:1' }).error, /name/);
assert.match(newServer([], { label: 'x', baseUrl: 'nope' }).error, /http:\/\//);
assert.match(newServer(mine, { label: 'again', baseUrl: 'http://10.0.0.5:8000/v1/' }).error, /already/);
const full = Array.from({ length: MAX_SERVERS }, (_, i) => ({ id: `s${i}`, label: `S${i}`, baseUrl: `http://h:${i + 1}/v1` }));
assert.match(newServer(full, { label: 'x', baseUrl: 'http://h:99' }).error, new RegExp(`up to ${MAX_SERVERS}`));

// A server's saved key is sent when probing, and saved again with its credential; the placeholder isn't a key.
const creds = new Map([['local:gpu-box', { accessToken: 'sk-box' }], ['local:ollama', { accessToken: LOCAL_API_KEY_PLACEHOLDER }]]);
const seen = [], stored = [];
const auth2 = {
  getCredentials: async (k) => creds.get(k),
  hasCredentials: async (k) => creds.has(k),
  setLocalEndpoint: async (...a) => stored.push(a),
};
const gpu = servers[2];
const fake = (models) => async (e) => { seen.push([e.id, e.apiKey]); return { endpoint: e, reachable: true, models: models(e) }; };
const vl = (id, o) => model(id, o);
await connectLocal(auth2, gpu, { save: true, probe: fake(() => [vl('Qwen/Qwen3-VL-32B', { endpointId: 'gpu-box' })]) });
assert.deepEqual(seen.at(-1), ['gpu-box', 'sk-box']);
assert.deepEqual(stored.at(-1), ['gpu-box', 'http://10.0.0.5:8000/v1', 'sk-box']);
await connectLocal(auth2, gpu, { save: true, apiKey: 'sk-new', probe: fake(() => []) });
assert.deepEqual(seen.at(-1), ['gpu-box', 'sk-new'], 'a key typed in the form wins');
assert.deepEqual(stored.at(-1), ['gpu-box', 'http://10.0.0.5:8000/v1', 'sk-new']);

// Syncing refreshes only connected servers, each replacing its own models; a server no longer connected loses its models.
creds.set('local:ollama', { accessToken: LOCAL_API_KEY_PLACEHOLDER });
const byServer = { ollama: [model('qwen3-vl:8b')], 'gpu-box': [vl('Qwen/Qwen3-VL-32B', { endpointId: 'gpu-box' })], lmstudio: [vl('qwen3-vl-8b', { endpointId: 'lmstudio' })] };
seen.length = 0;
const synced = await syncLocal(auth2, servers, { probe: fake((e) => byServer[e.id]) });
assert.deepEqual([...synced.keys()], ['ollama', 'gpu-box'], "LM Studio isn't connected, so it isn't asked");
assert.deepEqual(seen.find(([id]) => id === 'ollama'), ['ollama', undefined], 'no key is sent for the placeholder');
assert.deepEqual(getModelsForProvider('local').map((m) => m.id).sort(), ['local/gpu-box/Qwen/Qwen3-VL-32B', 'local/ollama/qwen3-vl:8b']);
assert.deepEqual(getAuthStorageKeys('local', 'local/gpu-box/Qwen/Qwen3-VL-32B'), ['local:gpu-box']);
creds.delete('local:gpu-box');
await syncLocal(auth2, servers, { probe: fake((e) => byServer[e.id]) });
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), ['local/ollama/qwen3-vl:8b'], 'a removed server leaves the menu');
const dead = await syncLocal(auth2, servers, { probe: async (e) => ({ endpoint: e, reachable: false, reason: 'Not running', models: [] }) });
assert.equal(dead.get('ollama').ok, false);
assert.deepEqual(getModelsForProvider('local').map((m) => m.id), ['local/ollama/qwen3-vl:8b'], 'a closed server keeps its models, so asking says to open it');
forgetLocal('ollama');
assert.deepEqual(getModelsForProvider('local'), []);

// What each server's row says.
assert.match(noModelsNote(OLLAMA, 3), /ollama pull qwen3-vl:8b/);
assert.match(noModelsNote(LMSTUDIO, 2), /None of the models in LM Studio can see images/);
assert.match(noModelsNote(LMSTUDIO, 0), /no models yet/);
assert.match(noModelsNote(gpu, 2), /GPU box.*Its models can see images/);
for (const x of [OLLAMA, LMSTUDIO, gpu]) for (const n of [0, 2]) assert.ok(noModelsNote(x, n, true).length <= 50, "a row's note fits on one line");
assert.match(downNote(gpu, 'Not running at http://10.0.0.5:8000/v1'), /GPU box isn't running at http:\/\/10\.0\.0\.5:8000\/v1/);
assert.equal(downNote(LMSTUDIO, 'Not running'), "LM Studio isn't running.");
assert.match(downNote(gpu, 'http://10.0.0.5:8000/v1 rejected the API key (HTTP 401)'), /rejected the key/);
assert.match(contextNote(4096, LMSTUDIO), /LM Studio gives this model only 4k.*Context Length/);
assert.match(contextNote(8192, gpu), /GPU box says this model has only 8k/);
assert.equal(contextNote(MIN_CONTEXT, gpu), '');

console.log('local: ok');
