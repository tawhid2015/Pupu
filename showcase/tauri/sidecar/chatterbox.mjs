// Roamies' own voice, in the app bundle: Chatterbox (4-bit, MLX) run by a small Python helper (engine.py), with the
// voice clips it speaks in. No other app, no login, no network: the weights ship with Roamies.
// The helper listens on a loopback port it picks itself and prints; one sentence in, PCM out.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const ENGINE_DIR = process.env.ROAMIES_VOICE_DIR || path.join(DIR, 'voice', 'chatterbox');
export const RATE = 24000;
let language = 'en'; // the reply language picked in Speaking: 'en' (default) or 'bn' (Bangla)
export const setEngineLanguage = (lang) => { language = lang === 'bn' ? 'bn' : 'en'; };
export const getEngineLanguage = () => language;
const START_TIMEOUT = 45_000; // loading the weights, on a cold disk
const SAY_TIMEOUT = 120_000; // one sentence, generously (a cold GPU compile can take seconds)
const IDLE_MS = 10 * 60_000; // the helper is ended after this long with nothing to say

/** The helper's Python: the one shipped in the app, else this machine's dev venv. */
export function enginePython(dir = ENGINE_DIR) {
  if (process.env.ROAMIES_VOICE_PYTHON) return process.env.ROAMIES_VOICE_PYTHON;
  const shipped = path.join(dir, 'runtime', 'bin', 'python3');
  if (fs.existsSync(shipped)) return shipped;
  const shipped311 = path.join(dir, 'runtime', 'bin', 'python3.11');
  if (fs.existsSync(shipped311)) return shipped311;
  const dev = path.join(os.homedir(), 'Library', 'Application Support', 'RoamiesVoice', '.venv', 'bin', 'python');
  return fs.existsSync(dev) ? dev : null;
}

/** The weights: in the app, else the dev copy. */
export function engineModels(dir = ENGINE_DIR) {
  if (process.env.ROAMIES_VOICE_MODELS) return process.env.ROAMIES_VOICE_MODELS;
  for (const models of [path.join(dir, 'models'), path.join(os.homedir(), 'Library', 'Application Support', 'RoamiesVoice', 'models')]) {
    if (fs.existsSync(path.join(models, 'chatterbox-4bit'))) return models;
  }
  return null;
}

/** Which reply languages this build actually has weights for: English, plus Bangla when its fine-tune ships. */
export function builtinLanguages(dir = ENGINE_DIR) {
  const models = engineModels(dir);
  if (!models) return [];
  return ['en', ...(fs.existsSync(path.join(models, 'chatterbox-bangla')) ? ['bn'] : [])];
}

export function hasEngine(dir = ENGINE_DIR) {
  return fs.existsSync(path.join(dir, 'engine.py')) && !!enginePython(dir) && !!engineModels(dir);
}

/** The voice clips that ship next to the helper: [{ id, name }]. */
export function builtinVoices(dir = ENGINE_DIR) {
  const refs = path.join(dir, 'voices');
  let names = {};
  try { names = JSON.parse(fs.readFileSync(path.join(refs, 'voices.json'), 'utf8')); } catch { /* no names */ }
  try {
    return fs.readdirSync(refs).filter((f) => f.endsWith('.wav')).sort()
      .map((f) => ({ id: f.slice(0, -4), name: names[f.slice(0, -4)] ?? f.slice(0, -4) }));
  } catch { return []; }
}

/** What the panel shows for the built-in voice, without starting anything. */
export function builtinStatus(dir = ENGINE_DIR) {
  const voices = builtinVoices(dir);
  if (!hasEngine(dir)) return { ok: false, reason: 'offline', message: 'The built-in voice is missing from this build of Roamies.' };
  return { ok: true, reason: null, message: null, engine: 'builtin', engineName: 'Chatterbox (built in)', version: null, voices, languages: builtinLanguages(dir), builtin: true };
}

let child = null; // the helper process
let port = null;
let starting = null; // Promise<port>
let idleTimer = null;
let logFn = () => {};

function say(...a) { try { logFn('builtin_voice', ...a); } catch { /* logging never breaks speech */ } }
export const setEngineLog = (fn) => { logFn = typeof fn === 'function' ? fn : () => {}; };

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => stopEngine(), IDLE_MS);
  idleTimer?.unref?.();
}

// Never leave a 1.5 GB helper behind if the sidecar exits or is killed.
process.on('exit', () => stopEngine());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopEngine(); process.exit(0); });

export function stopEngine() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const c = child;
  child = null;
  port = null;
  starting = null;
  if (!c) return;
  try { c.kill(); } catch { /* already gone */ }
}

/** Start the helper (already running: reused) and resolve its port. */
export function startEngine(dir = ENGINE_DIR) {
  if (port) return Promise.resolve(port);
  if (starting) return starting;
  const py = enginePython(dir);
  const models = engineModels(dir);
  if (!py || !models) return Promise.reject(Object.assign(new Error('The built-in voice is not installed.'), { reason: 'offline' }));
  starting = new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ROAMIES_VOICE_PORT: '0',
      ROAMIES_VOICE_MODELS: models,
      ROAMIES_VOICE_REFS: path.join(dir, 'voices'),
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      HF_HUB_OFFLINE: '1',
    };
    // The app's copy of the packages travels next to the runtime, not in its site-packages.
    const packages = path.join(dir, 'site-packages');
    if (fs.existsSync(packages)) env.PYTHONPATH = [packages, env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    // A macOS app launched from the Dock has a thin PATH; the helper needs nothing from it.
    env.PATH = env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
    // stdin is a leash: if this sidecar goes away, the pipe closes and the helper exits instead of lingering with 1.5 GB.
    const proc = spawn(py, [path.join(dir, 'engine.py')], { env, stdio: ['pipe', 'ignore', 'pipe'] });
    proc.stdin?.on('error', () => {});
    child = proc;
    const timer = setTimeout(() => { stopEngine(); reject(Object.assign(new Error('The built-in voice took too long to start.'), { reason: 'timeout' })); }, START_TIMEOUT);
    let err = '';
    const settle = (fn, v) => { clearTimeout(timer); fn(v); };
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
      for (const line of d.split('\n')) {
        const m = /listening on 127\.0\.0\.1:(\d+)/.exec(line);
        if (m && !port) { port = Number(m[1]); starting = null; say('started on', port); settle(resolve, port); }
        // The helper says which language and text it actually synthesised: invaluable when a reply sounds wrong.
        if (line.includes('[voice]')) say('engine', line.trim().replace(/^\[voice\]\s*/, ''));
      }
    });
    proc.on('error', (e) => { stopEngine(); settle(reject, Object.assign(new Error(`The built-in voice didn't start: ${e.message}`), { reason: 'offline' })); });
    proc.on('exit', (code) => {
      const was = child === proc;
      if (port && was) { port = null; child = null; starting = null; say('exited', code); }
      else if (!port) { starting = null; settle(reject, Object.assign(new Error(`The built-in voice stopped (${code}). ${err.trim().split('\n').pop() ?? ''}`.trim()), { reason: 'error' })); }
    });
  });
  return starting;
}

async function post(p, body, timeout = SAY_TIMEOUT) {
  if (!port) await startEngine();
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  armIdle();
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `voice engine answered ${r.status}`);
  }
  return r;
}

/** Make the engine ready for a voice (conditionals computed, GPU warm). Never throws. */
export async function warmEngine(voice = null, lang = null) {
  try { await post('/warm', { voice, lang: lang ?? language }, START_TIMEOUT); return true; } catch { return false; }
}

/**
 * One reply's voice, the same shape as StudioVoice: say() as many times as needed, then end(); abort() stops at once.
 * onAudio(Uint8Array, rate), onEnd(), onError(err with reason and heard).
 */
export class BuiltinVoice {
  // Up to two sentences are synthesised ahead. The helper still does one at a time, but the next request is queued
  // while the current audio plays instead of waiting for its HTTP response to be read first. Audio is emitted in
  // sentence order; nothing about the model, its settings or the samples changes.
  constructor({ voice = null, lang = null, onAudio, onEnd, onError, dir = ENGINE_DIR, log: logger = null,
    postImpl = post, startImpl = startEngine, maxInflight = 2 } = {}) {
    if (logger) log = logger;
    Object.assign(this, { voice, lang, onAudio, onEnd, onError, dir, postImpl, startImpl, maxInflight });
    if (logger) setEngineLog(logger);
    this.queue = []; // { i, text }
    this.ready = new Map(); // i → { pcm, rate } (the helper answers in order; emit in order too)
    this.seq = 0;
    this.next = 0;
    this.inflight = 0;
    this.state = 'new'; // new → open → done
    this.ending = false;
    this.opening = false;
    this.heard = false;
  }

  open() {
    if (this.state !== 'new') return this;
    this.state = 'open';
    this.opening = true;
    this.startImpl(this.dir).then(() => { this.opening = false; armIdle(); this.pump(); })
      .catch((e) => this.fail(e.reason ?? 'error', e.message));
    return this;
  }

  say(text) {
    if (this.state === 'done' || this.ending) return;
    const t = String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (this.state === 'new') this.open();
    this.queue.push({ i: this.seq++, text: t });
    this.pump();
  }

  end() {
    if (this.state === 'done' || this.ending) return;
    this.ending = true;
    if (this.state === 'new') { this.state = 'done'; this.onEnd?.(); return; }
    this.pump();
    this.maybeFinish();
  }

  abort() { this.close(); }

  pump() {
    if (this.state !== 'open' || this.opening) return;
    while (this.queue.length && this.inflight < this.maxInflight) {
      const item = this.queue.shift();
      this.inflight++;
      this.generate(item);
    }
    this.maybeFinish();
  }

  async generate(item) {
    const t0 = Date.now();
    say('say start', { index: item.i, chars: item.text.length });
    try {
      const r = await this.postImpl('/say', { text: item.text, voice: this.voice, lang: this.lang || language });
      const pcm = new Uint8Array(await r.arrayBuffer());
      const rate = Number(r.headers.get('x-sample-rate')) || RATE;
      say('say done', { index: item.i, ms: Date.now() - t0, seconds: +(pcm.length / 2 / rate).toFixed(2) });
      if (this.state !== 'done') this.ready.set(item.i, { pcm, rate });
    } catch (e) {
      if (this.state !== 'done') this.fail(/timeout|aborted/i.test(e.message) ? 'timeout' : 'error', e.message);
      return;
    } finally {
      this.inflight--;
      this.flush();
      this.maybeFinish();
      this.pump();
    }
  }

  /** Emit whatever has finished, in the order it was asked for. */
  flush() {
    while (this.state === 'open' && this.ready.has(this.next)) {
      const { pcm, rate } = this.ready.get(this.next);
      this.ready.delete(this.next++);
      if (pcm.length) { this.heard = true; this.onAudio?.(pcm, rate); }
    }
  }

  maybeFinish() {
    if (this.state === 'open' && this.ending && !this.queue.length && !this.inflight && !this.ready.size) this.finish();
  }

  close() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.queue.length = 0;
    this.ready.clear();
  }

  finish() { if (this.state === 'done') return; this.close(); this.onEnd?.(); }

  fail(reason, detail) {
    if (this.state === 'done') return;
    const heard = this.heard;
    this.close();
    this.onError?.(Object.assign(new Error(detail || 'The built-in voice failed.'), { reason, heard }));
  }
}
