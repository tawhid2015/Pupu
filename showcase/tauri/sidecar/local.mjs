// Models served on this computer or the user's own servers: Ollama, LM Studio, and any OpenAI-compatible server they
// add (llama.cpp, vLLM, oMLX…). gg-core finds the models and talks to them; this picks the ones Roamies can use and
// keeps their context window honest.
import {
  DEFAULT_LOCAL_ENDPOINTS, LOCAL_API_KEY_PLACEHOLDER, clearRuntimeModels, localAuthStorageKey, parseLocalModelId, probeEndpoint,
  registerRuntimeModels, toModelInfo,
} from '@kenkaiiii/gg-core';

export const OLLAMA = DEFAULT_LOCAL_ENDPOINTS.find((e) => e.id === 'ollama');
export const OLLAMA_KEY = localAuthStorageKey(OLLAMA.id);
export const LMSTUDIO = { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', kind: 'lmstudio' };
export const BUILT_IN = [OLLAMA, LMSTUDIO];
export const MAX_SERVERS = 8;
// Requests are fitted to half the window, and the system prompt and tools alone are about 12.6k tokens.
export const MIN_CONTEXT = 32_768;

// The window gg-core gives a model of this size (room for the prompt on small windows).
export const withWindow = (info, contextWindow) => ({ ...info, contextWindow, maxOutputTokens: Math.max(512, Math.min(4096, Math.floor(contextWindow / 4))) });

/**
 * Chat models Roamies can use. A model that only reads text is still useful as the main model when a separate vision
 * model is picked (screenshots are summarized before the main model sees them). A model that only sees images is
 * offered for the vision slot, never as the main model. `windows`: measured contexts by id.
 */
export const localModels = (probes, windows = new Map()) => probes.filter((p) => p.reachable).flatMap((p) => p.models
  .filter((m) => m.supportsImages || m.supportsTools)
  .map((m) => {
    const info = toModelInfo(m, p.endpoint);
    const withCap = { ...info, supportsTools: m.supportsTools };
    return !m.contextWindowKnown && windows.has(info.id) ? withWindow(withCap, windows.get(info.id)) : withCap;
  }));

const okServer = (s) => s && typeof s === 'object' && typeof s.id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s.id)
  && !BUILT_IN.some((b) => b.id === s.id) && typeof s.label === 'string' && typeof s.baseUrl === 'string';

/** Ollama, LM Studio, then the servers the user added (`config.localServers`: { id, label, baseUrl, images }). */
export const serverList = (saved) => [...BUILT_IN, ...(Array.isArray(saved) ? saved : []).filter(okServer).slice(0, MAX_SERVERS).map((s) => ({
  id: s.id, label: s.label, baseUrl: s.baseUrl, kind: 'custom', custom: true,
  // Off means "let the server say" (llama.cpp reports it), not "never".
  ...(s.images === true ? { supportsImages: true } : {}),
}))];

/** The server a local model id runs on, from the list. */
export const serverFor = (servers, modelId) => servers.find((s) => s.id === parseLocalModelId(modelId ?? '')?.endpointId);

/** The address as Roamies stores it: http(s), no key or query in it, and `/v1` when only the host was given. Else null. */
export function serverUrl(text) {
  let u;
  try { u = new URL(String(text ?? '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path || '/v1'}`;
}

/** A new server for `config.localServers`, from the Add a server form. → { server } or { error } in the user's words. */
export function newServer(saved, { label, baseUrl, images } = {}) {
  const list = Array.isArray(saved) ? saved.filter(okServer) : [];
  const name = String(label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return { error: 'Give the server a name.' };
  const url = serverUrl(baseUrl);
  if (!url) return { error: 'That address doesn\'t look right. It should start with http:// or https://, like http://127.0.0.1:8080/v1' };
  if (list.length >= MAX_SERVERS) return { error: `You can add up to ${MAX_SERVERS} servers. Remove one first.` };
  if (list.some((s) => s.baseUrl === url)) return { error: 'That server is already on the list.' };
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'server';
  const taken = new Set([...BUILT_IN, ...list].map((s) => s.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return { server: { id, label: name, baseUrl: url, images: images === true } };
}

/** The key saved for a server, if it has a real one. */
export async function storedKey(auth, id) {
  const token = (await auth.getCredentials(localAuthStorageKey(id)).catch(() => null))?.accessToken;
  return token && token !== LOCAL_API_KEY_PLACEHOLDER ? token : undefined;
}

const onServer = (id) => (m) => m.provider === 'local' && parseLocalModelId(m.id)?.endpointId === id;

/** Takes a server's models out of the Model menu (after it's removed). */
export const forgetLocal = (id) => clearRuntimeModels(onServer(id));

/**
 * Asks one server what it serves and registers its usable models, leaving other servers' alone. `save`: also store
 * its `local:<id>` credential, with `apiKey` (only when it answered). → { ok, reason, models, all } where `all`
 * counts every chat model, usable or not.
 */
export async function connectLocal(auth, server, { save = false, apiKey, windows, probe = probeEndpoint } = {}) {
  const key = apiKey || await storedKey(auth, server.id);
  const p = await probe(key ? { ...server, apiKey: key } : server, { timeoutMs: 1500 });
  if (!p.reachable) return { ok: false, reason: p.reason ?? 'not running', models: [], all: 0 };
  const models = localModels([p], windows);
  clearRuntimeModels(onServer(server.id));
  registerRuntimeModels(models);
  if (save) await auth.setLocalEndpoint(server.id, server.baseUrl, key);
  return { ok: true, models, all: p.models.length };
}

/** Refreshes every connected server at once; the models of servers not connected leave the menu. → Map id → result. */
export async function syncLocal(auth, servers, { windows, probe } = {}) {
  const on = [];
  for (const s of servers) if (await auth.hasCredentials(localAuthStorageKey(s.id)).catch(() => false)) on.push(s);
  clearRuntimeModels((m) => m.provider === 'local' && !on.some((s) => onServer(s.id)(m)));
  const results = await Promise.all(on.map((s) => connectLocal(auth, s, { windows, probe }).catch(() => ({ ok: false, models: [], all: 0 }))));
  return new Map(on.map((s, i) => [s.id, results[i]]));
}

/** What to say when a server is connected but none of its models can be used. `short`: one line, for its row. */
export function noModelsNote(server, all, short = false) {
  if (short) return server.id === 'ollama' ? 'No chat models. Try: ollama pull llama3.2'
    : server.id === 'lmstudio' ? 'No chat models in LM Studio.'
    : all ? 'No chat models served.' : 'No models served.';
  if (server.id === 'ollama') return "None of Ollama's models can chat. Get one with: ollama pull llama3.2, then connect it again.";
  if (server.id === 'lmstudio') return all ? 'None of the models in LM Studio can chat.' : 'LM Studio has no models yet.';
  return all ? `${server.label} isn't serving a chat model.` : `${server.label} isn't serving any models.`;
}

/** Why a server that's connected isn't answering, in plain words. */
export const downNote = (server, reason) => (/rejected the API key/.test(reason ?? '')
  ? `${server.label} rejected the key. Remove it and add it again with the right key.`
  : `${server.label} isn't running${server.custom ? ` at ${server.baseUrl}` : ''}.`);

/** What to tell the user when a server serves too small a context, else ''. */
// Lite mode (#73) sends far less each time, so half the memory is enough.
export const LITE_MIN_CONTEXT = 16_384;
export const contextNote = (window, server = OLLAMA, lite = false) => {
  const min = lite ? LITE_MIN_CONTEXT : MIN_CONTEXT, need = `${min / 1024}k`;
  if (!window || window >= min) return '';
  const k = Math.round(window / 1024);
  if (server.id === 'ollama') return `Ollama gives this model only ${k}k tokens of memory, too little for me to work well. In Ollama's settings, set Context length to ${need} or more (or start it with OLLAMA_CONTEXT_LENGTH=${min}), then pick the model again.`;
  if (server.id === 'lmstudio') return `LM Studio gives this model only ${k}k tokens of memory (or hasn't loaded it yet), too little for me to work well. In LM Studio, load it with Context Length set to ${need} or more, then pick the model again.`;
  return `${server.label} says this model has only ${k}k tokens of memory (or didn't say), too little for me to work well. Start it with a context of ${need} or more, then pick the model again.`;
};
// A model's size from its name ("qwen3.5:9b", "gemma-4-e4b-it", "llama-3.2-3B-instruct"), in billions; null when the
// name doesn't say. Small (9B or less) is when Lite mode is suggested.
export const modelBillions = (id) => {
  const m = /(?:^|[^a-z0-9.])e?(\d+(?:\.\d+)?)b(?![a-z0-9])/i.exec(String(id ?? ''));
  return m ? Number(m[1]) : null;
};
export const isSmallModel = (id) => { const b = modelBillions(id); return b != null && b <= 9; };
