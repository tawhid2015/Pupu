// Speaks replies with Fish Audio, Gemini or VoiceStudio (the user's pick) and hands the audio to the overlay
// ({ kind: 'speech' } messages).
// - VoiceStudio is the VoiceStudio app on this computer (voicestudio.mjs): no key, its selected engine, the user's saved
//   VoiceStudio voice. A reply that fails there is reported and stays text; it never falls back to a paid service.
//   Beats aren't made in it (each one would hold up the GPU for seconds), so its replies have none.
// - Fish Audio: the model is the one the user picked (Drama 3 or S2.1 Pro) while the account has credit, the free tier
//   otherwise (checked when the key is set, at start and after a failure). If a reply's voice fails before any
//   audio, it's retried on the next model down from the pick, never a pricier one (Drama 3 → S2.1 Pro → free;
//   S2.1 Pro → free) with everything said so far, and one that works is kept from then on; if it fails after
//   audio, the rest stays text only.
// - Each reply has its own id, so audio from one that was stopped can never play over the next.
// - Beats: when something slow starts (a web search, a page, the screen) and the model hasn't said anything,
//   a short line ("One sec.", "On it." and 32 more, picked at random) plays so it's never silent. They're made once
//   in the voice and kept, so they play instantly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VOICE, FISH_MODELS, FREE_MODEL, FishVoice, RATE, fishAccount } from './fish.mjs';
import { StudioVoice, hasBuiltinVoice, studioStatus, warmBuiltin } from './voicestudio.mjs';
import { setEngineLanguage, setEngineLog } from './chatterbox.mjs';
import { cueFeel } from './speech.mjs';
import { GEMINI_DEFAULT_VOICE, GEMINI_MODEL, GEMINI_MODELS, GEMINI_PITCH, GEMINI_RATE, GeminiVoice, geminiAccount } from './gemini.mjs';

// The services that can speak. models: priciest first, the pick and the ones after it are tried in turn; pick:
// the one used until the user picks (else the first); freeModel: the one for an account with no credit; rate:
// the PCM's sample rate; warmDelay: how long a key, voice or model must stay put before its beats are made
// (Gemini has 30 voices to try out, and making 34 beats for each one passed over would waste the allowance).
export const PROVIDERS = {
  fish: { id: 'fish', name: 'Fish Audio', Voice: FishVoice, account: fishAccount, models: FISH_MODELS, freeModel: FREE_MODEL, rate: RATE, defaultVoice: DEFAULT_VOICE },
  gemini: { id: 'gemini', name: 'Gemini', Voice: GeminiVoice, account: geminiAccount, models: GEMINI_MODELS, pick: GEMINI_MODEL, freeModel: null, rate: GEMINI_RATE, play: Math.round(GEMINI_RATE * GEMINI_PITCH), defaultVoice: GEMINI_DEFAULT_VOICE, warmDelay: 15_000 },
};

// Silence trimmed from both ends (a little kept), so a beat starts the moment it plays.
export function trimSilence(pcm, rate) {
  const s = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.byteLength & ~1))), loud = 500, pad = Math.round(rate * 0.04);
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < loud) a++;
  if (a === s.length) return Buffer.from(s.buffer); // nothing loud in it: left as it is
  while (b > a && Math.abs(s[b]) < loud) b--;
  return Buffer.from(s.slice(Math.max(0, a - pad), Math.min(s.length, b + 1 + pad)).buffer);
}

// One or two words each, so a beat never sounds canned; any of them must fit before a search, a page, the screen or a drawing.
export const BEATS = [
  'One sec.', 'On it.', 'Hang on.', 'Hold on.', 'Got it.', 'Okay.', 'Sure.', 'Right.', 'Alright.', 'Gotcha.',
  'Checking.', "Let's see.", 'Sure thing.', 'Coming up.', 'Sec.', 'One moment.', 'Bear with.', 'Hmm, okay.', 'Got you.', 'Right, sec.',
  'Sure, sec.', 'Okay, sec.', 'Roger.', 'Yep.', 'Yep, sec.', 'Two secs.', 'Hold tight.', 'Mm-hmm.', 'Will do.', 'Righto.',
  'Moment.', 'Okay, checking.', 'Sure, checking.', 'Okie-dokie.',
];
const RECENT = 8; // a beat isn't picked again until this many others have played
const PREWARM_MS = 20_000; // a socket opened ahead of a reply that nothing takes is closed after this
// VoiceStudio: how much of a reply is spoken, in characters (its text is always all shown). 0: no cap.
export const STUDIO_CAPS = { short: 160, medium: 320, full: 0 };
// VoiceStudio reaps its engine after ~5 minutes idle, so after a real reply a throwaway word goes out every 4 minutes,
// until 30 minutes pass with no real reply. Prewarm (talking or typing) pings only when the last request is older than 60 s.
const KEEP_WARM_MS = 4 * 60_000, KEEP_WARM_IDLE_MS = 30 * 60_000, STUDIO_QUIET_MS = 60_000;
const STUDIO_PING = 'Hm.';

// The beats shipped with the app (beats/make.mjs), next to this file or the bundle: (voice, model) → Map of phrase →
// { rate, pcm } (base64), or null for a voice or model not recorded. The free tier uses the S2.1 Pro takes.
export function bundledBeats(dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'beats')) {
  let index = null;
  try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch { return () => null; }
  const sets = new Map();
  return (voice, model) => {
    const k = `${voice}:${model === FREE_MODEL ? 's2.1-pro' : model}`, set = index.sets?.[k];
    if (!set) return null;
    if (!sets.has(k)) {
      let all = null;
      try { all = fs.readFileSync(path.join(dir, set.file)); } catch {}
      sets.set(k, all && new Map(Object.entries(set.beats).map(([phrase, [at, n]]) => [phrase, { rate: index.rate, pcm: all.subarray(at, at + n).toString('base64') }])));
    }
    return sets.get(k);
  };
}

// What the overlay says when a reply's voice fails (onProblem's argument): the service's own reason when there is one.
export const voiceWhy = (message) => String(message ?? '').replace(/^(Gemini|Fish Audio):\s*/, '').replace(/[.\s]+$/, '');
export function voiceProblemText(what, name) {
  if (what === 'key') return `My ${name} key isn't working, so replies are text for now.`;
  const why = typeof what === 'string' ? voiceWhy(what) : '';
  return why ? `My voice isn't working right now: ${why}. Replies are text for now.` : "My voice isn't working right now, so replies are text for now.";
}

// beatStore: { read(name), write(name, data) }, where beats made here are kept between runs (none: made again each run).
export function createSpeaker({ emit, onProblem = () => {}, log = () => {}, FishVoiceImpl = FishVoice, account = fishAccount, providers = {}, beatPhrases = BEATS, bundled = bundledBeats(), beatStore = null, LocalVoiceImpl = StudioVoice, localStatus = studioStatus, prewarmMs = PREWARM_MS,
  keepWarmMs = KEEP_WARM_MS, keepWarmIdleMs = KEEP_WARM_IDLE_MS, studioQuietMs = STUDIO_QUIET_MS, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h) }) {
  const all = { ...PROVIDERS, fish: { ...PROVIDERS.fish, Voice: FishVoiceImpl, account }, ...providers };
  // The built-in helper's own timings go to the same activity log: they tell a synthesis stall from a text stall.
  setEngineLog((kind, ...parts) => log(kind, parts.map((p) => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join(' ')));
  let P = all.fish; // the service in use
  let key = null, voice = P.defaultVoice, pref = P.pick ?? P.models[0], model = pref, seq = 0, current = null, checking = null;
  let localLang = 'en'; // the built-in voice's reply language: 'en' or 'bn'
  // The pick and the cheaper ones after it (models run from priciest to free).
  const chain = () => P.models.slice(Math.max(0, P.models.indexOf(pref)));
  let beats = new Map(), recent = [], warming = null; // phrase → [base64 PCM], for the current key, voice and model
  let prewarmed = null; // Fish's socket opened ahead of a reply (prewarm), for the key, voice and model it was opened with
  // A random beat, not one of the last few: one that's already made if there is one, so it plays instantly.
  const shipped = () => bundled(voice, model);
  const ready = (p) => beats.has(p) || !!shipped()?.has(p);
  const pickBeat = () => {
    const fresh = beatPhrases.filter((p) => !recent.includes(p));
    const pool = [fresh.filter(ready), beatPhrases.filter(ready), fresh, beatPhrases].find((x) => x.length);
    const phrase = pool?.[Math.floor(Math.random() * pool.length)] ?? BEATS[0];
    recent = [...recent, phrase].slice(-Math.min(RECENT, Math.max(0, beatPhrases.length - 1)));
    return phrase;
  };

  // Make the beats once, one at a time (well under the services' concurrency limits), and keep them for next time.
  // Failures just leave a gap: that beat is then spoken live instead. Three in a row and it stops for now (no
  // credit, or too many requests): the next account check starts it again.
  function warm() {
    if (warming) return warming;
    const k = key, vo = voice, mo = model, p = P;
    const same = () => key === k && voice === vo && model === mo && P === p;
    const name = `${p.id}.${vo}.${mo}`.replace(/[^\w.-]/g, '_');
    const mine = warming = (async () => {
      if (p.warmDelay) await new Promise((r) => { setTimeout(r, p.warmDelay).unref?.(); });
      if (!same()) return;
      const kept = await Promise.resolve().then(() => beatStore?.read(name)).catch(() => null);
      if (!same()) return;
      for (const [phrase, pcm] of Object.entries(kept?.beats ?? {})) if (beatPhrases.includes(phrase) && typeof pcm === 'string' && !beats.has(phrase)) beats.set(phrase, [pcm]);
      let made = 0, failed = 0;
      for (const phrase of beatPhrases) {
        if (!same() || failed >= 3) break;
        if (beats.has(phrase) || bundled(vo, mo)?.has(phrase)) continue; // kept, or shipped with the app
        const chunks = await new Promise((done) => {
          const got = [];
          const v = new p.Voice({ key: k, voice: vo, model: mo, onAudio: (pcm) => got.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)), onEnd: () => done(got), onError: () => done(null) }).open();
          v.say(phrase); v.end();
        });
        if (!chunks?.length) { failed++; continue; }
        failed = 0;
        if (same()) { beats.set(phrase, [trimSilence(Buffer.concat(chunks), p.rate).toString('base64')]); made++; }
      }
      if (made && same()) await Promise.resolve().then(() => beatStore?.write(name, { rate: p.rate, beats: Object.fromEntries([...beats].map(([phrase, c]) => [phrase, c.join('')])) })).catch(() => {});
    })().finally(() => {
      if (warming !== mine) return; // the service was changed: its own key starts this again
      warming = null;
      if (key && !same()) warm(); // the key, voice or model changed meanwhile: make the new one's
    });
    return mine;
  }

  // Returns the account check: { ok, credit } or { ok: false, reason: 'key' | 'network' }.
  async function check() {
    if (!key) return { ok: false, reason: 'key' };
    if (checking) return checking;
    const p = P;
    const mine = checking = p.account(key).then((a) => {
      if (P !== p) return a; // the service was changed while this was out: its answer is about the old one
      // No credit: the free tier. Credit again: back to the best model, else keep the paid one that worked.
      if (a.ok) model = a.credit != null && a.credit <= 0.01 && p.freeModel ? p.freeModel : model === p.freeModel ? pref : model;
      log(`${p.id}_account`, { ok: a.ok, reason: a.reason, model });
      if (a.ok) warm();
      return a;
    }).finally(() => { if (checking === mine) checking = null; });
    return mine;
  }

  function stopAll() {
    if (current) { current.abort(); current = null; }
    emit({ kind: 'speech', stop: true });
  }

  // VoiceStudio: on while picked (it needs no key); local is its last check ({ ok, reason, message, engine, voices, … }).
  let localOn = false, localVoice = null, local = null, studioMode = 'short';
  let lastReq = -Infinity, lastReply = -Infinity; // VoiceStudio: when its last request went out, and its last real reply
  let warmTimer = null, pinging = null; // the keep-warm schedule (null: off); the throwaway request in flight
  // Is VoiceStudio up, with a usable engine selected? Never throws; the answer is kept for the panel.
  async function checkLocal() {
    const s = await localStatus().catch((e) => ({ ok: false, reason: 'offline', message: e.message }));
    local = s;
    log('voicestudio_status', { ok: s.ok, reason: s.reason, engine: s.engine });
    return s;
  }
  // One throwaway request: a short word whose audio is thrown away and nothing is emitted. Best effort: it never
  // throws or logs, and it's skipped while a reply runs or another throwaway is still out.
  function ping() {
    if (pinging || current) return false;
    lastReq = now();
    // Roamies' own voice: just make sure its engine is up and this voice is warm (no audio is made or thrown away).
    if (LocalVoiceImpl === StudioVoice && hasBuiltinVoice()) { warmBuiltin(localVoice); return true; }
    let v = null;
    const done = () => { if (pinging === v) pinging = null; };
    try {
      v = new LocalVoiceImpl({ voice: localVoice, lang: localLang, onAudio() {}, onEnd: done, onError: done });
      pinging = v;
      v.open?.(); v.say(STUDIO_PING); v.end();
    } catch { done(); }
    return true;
  }
  // Keep-warm: a real reply starts the schedule (never before the first one); each tick pings while there's no reply in
  // flight, and the schedule ends once 30 minutes have passed since the last real reply.
  function keepWarm() {
    if (!localOn) return;
    lastReply = now();
    if (warmTimer === null) armWarm();
  }
  function armWarm() {
    warmTimer = setTimer(warmTick, keepWarmMs);
    warmTimer?.unref?.();
  }
  function warmTick() {
    warmTimer = null;
    if (!localOn || now() - lastReply >= keepWarmIdleMs) return;
    if (!current) ping();
    armWarm();
  }
  // Ends the keep-warm schedule (the provider changed, or voice replies were turned off).
  function stopWarm() {
    if (warmTimer !== null) clearTimer(warmTimer);
    warmTimer = null;
  }
  // A reply in VoiceStudio: its socket opens now, one request per sentence, played as each streams in.
  function startLocal() {
    stopAll();
    lastReq = now(); keepWarm();
    const id = `s${++seq}`, said = [], t0 = Date.now();
    let heard = false, done = false, v = null, firstText = false;
    const finish = (whole = false) => {
      if (done) return;
      done = true;
      const chars = whole && heard ? said.join(' ').replace(/\[[^\]]*\]\s*/g, '').length : 0;
      emit({ kind: 'speech', id, end: true, ...(chars ? { chars } : {}) });
      if (current === me) current = null;
    };
    const me = {
      id,
      say(s) {
        if (done) return;
        said.push(s);
        if (!firstText) { firstText = true; log('speech_first_text', { id, ms: Date.now() - t0, chars: String(s).length }); }
        v.say(s);
      },
      beat() { return false; },
      end() { if (!done) v.end(); },
      abort() { if (done) return; done = true; v?.abort(); if (current === me) current = null; },
    };
    v = new LocalVoiceImpl({
      voice: localVoice,
      lang: localLang,
      onAudio: (pcm, rate) => {
        if (done) return;
        if (!heard) { heard = true; log('speech_first_audio', { id, provider: 'voicestudio', ms: Date.now() - t0 }); if (local && !local.ok) checkLocal(); } // working again: refresh the panel's status
        emit({ kind: 'speech', id, rate, pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64') });
      },
      onEnd: () => finish(true),
      onError: (err) => {
        if (done) return;
        log('speech_error', { id, provider: 'voicestudio', heard: !!err.heard, reason: err.reason, message: err.message });
        if (err.reason) local = { ...(local ?? {}), ok: false, reason: err.reason, message: err.message };
        if (!heard) onProblem({ provider: 'voicestudio', reason: err.reason ?? 'error', message: err.message });
        finish();
      },
    });
    log('speech_start', { id, provider: 'voicestudio', voice: localVoice });
    v.open?.(); // opening costs a moment: do it while the model thinks
    current = me;
    return me;
  }

  // Fish only: open the socket now, while the user is still talking, so the reply's first sentence doesn't wait for
  // the connection (0.4-1.4 s). The socket has placeholder callbacks until start() takes it; one nothing takes is
  // closed after prewarmMs.
  function prewarm() {
    // VoiceStudio: its engine is woken with a throwaway word when the last request is old enough (and no reply runs).
    if (localOn) { if (!current && now() - lastReq > studioQuietMs) ping(); return; }
    if (!key || P.id !== 'fish') return;
    const w = prewarmed;
    if (w && w.key === key && w.voice === voice && w.model === model && w.p === P && w.v.state !== 'done') return;
    dropPrewarm();
    try {
      const v = new P.Voice({ key, voice, model, onAudio() {}, onEnd() {}, onError() {} }).open();
      const timer = setTimeout(dropPrewarm, prewarmMs);
      timer.unref?.();
      prewarmed = { key, voice, model, p: P, v, timer };
    } catch (e) { log('speech_prewarm_error', { message: e.message }); }
  }
  function dropPrewarm() {
    const w = prewarmed;
    if (!w) return;
    prewarmed = null;
    clearTimeout(w.timer);
    w.v.abort?.();
  }
  // The warm socket for a reply on model m, if it still matches the key, voice and model; otherwise it's closed.
  function takePrewarm(m) {
    const w = prewarmed;
    if (!w) return null;
    prewarmed = null;
    clearTimeout(w.timer);
    if (w.key !== key || w.voice !== voice || w.model !== m || w.p !== P || w.v.state === 'done') { w.v.abort?.(); return null; }
    return w.v;
  }

  /** A new reply's voice, its socket opening now. say(sentence) as they come, then end(). */
  function start() {
    if (localOn) return startLocal();
    if (!key) return null;
    stopAll();
    const id = `s${++seq}`, said = [];
    let ended = false, tries = 0, v = null, heard = false, done = false, beat = false, t0 = Date.now();
    // The face follows the voice: a sentence whose feeling differs from the last one's (speech.mjs cueFeel) is marked
    // with where it starts, in characters spoken so far (cues left out); the overlay times it by the audio played.
    let spoken = 0, feel = null;
    const mark = (s) => {
      const f = cueFeel(s);
      if (f !== feel) { feel = f; emit({ kind: 'speech', id, feel: f, at: spoken }); }
      spoken += s.replace(/\[[^\]]*\]\s*/g, '').length + 1;
    };
    const me = {
      id,
      say(s) { if (done) return; mark(s); said.push(s); v.say(s); },
      /** Something slow is starting: a short beat, unless it's already said something. */
      beat() {
        if (done || beat || said.length || heard) return false;
        beat = true;
        const phrase = pickBeat(), shippedBeat = shipped()?.get(phrase), chunks = beats.get(phrase);
        if (!shippedBeat && !chunks) { me.say(phrase); return true; }
        log('speech_beat', { id, ms: Date.now() - t0 });
        spoken += phrase.length + 1; // played ahead of the reply, so the feelings after it start later
        if (shippedBeat) emit({ kind: 'speech', id, rate: shippedBeat.rate, pcm: shippedBeat.pcm });
        else for (const pcm of chunks) emit({ kind: 'speech', id, rate: P.play ?? P.rate, pcm });
        return true;
      },
      end() { if (done || ended) return; ended = true; v.end(); },
      abort() { if (done) return; done = true; v?.abort(); if (current === me) current = null; },
    };
    // A reply that played to its end also says how much it said (without the voice cues), so the overlay can learn
    // how fast the voice talks and pace drawings to it.
    const finish = (whole = false) => {
      if (done) return;
      done = true;
      const chars = whole && heard ? said.join(' ').replace(/\[[^\]]*\]\s*/g, '').length : 0;
      emit({ kind: 'speech', id, end: true, ...(chars ? { chars } : {}) });
      if (current === me) current = null;
    };
    const connect = (m) => {
      tries++;
      const cbs = {
        onAudio: (pcm) => {
          if (done) return;
          if (!heard) { heard = true; if (m !== model) model = m; log('speech_first_audio', { id, model: m, ms: Date.now() - t0 }); }
          emit({ kind: 'speech', id, rate: P.play ?? P.rate, pcm: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64') });
        },
        onEnd: () => finish(true),
        onError: async (err) => {
          if (done) return;
          log('speech_error', { id, model: m, heard: err.heard, message: err.message });
          if (!err.heard && !heard) {
            // Is it the key? Asked whether or not there's another model to try (Gemini has just the one).
            const a = await check();
            if (done) return;
            if (!a.ok && a.reason === 'key') { onProblem('key'); return finish(); }
            if (tries < chain().length) {
              // Retry: the free tier when there's no credit, else the next model down (the free one again once at the bottom).
              const c = chain();
              const next = a.ok && P.freeModel && model === P.freeModel ? P.freeModel : c[Math.min(c.indexOf(m) + 1, c.length - 1)];
              connect(next);
              for (const s of said) v.say(s);
              if (ended) v.end();
              return;
            }
            onProblem(err.message);
          }
          finish();
        },
      };
      // The first try takes the socket opened ahead of the reply, if it's still the one this reply needs.
      const warm = tries === 1 ? takePrewarm(m) : null;
      if (warm?.rebind(cbs)) v = warm;
      else { warm?.abort?.(); v = new P.Voice({ key, voice, model: m, ...cbs }).open(); }
    };
    log('speech_start', { id, model });
    connect(model);
    current = me;
    return me;
  }

  return {
    setKey(k) { if (localOn) return; if ((k || null) !== key) { beats = new Map(); dropPrewarm(); if (!k) stopAll(); } key = k || null; if (key) check(); },
    // The user's pick. Beats are remade in it; with no credit it stays on the free tier until there is some.
    setModel(m) {
      if (!P.models.includes(m) || m === P.freeModel || m === pref) return;
      pref = m; beats = new Map();
      if (model !== P.freeModel) model = m;
      if (key) warm();
    },
    get pick() { return pref; },
    // One short line spoken with the key, voice and model now set, its audio thrown away: the account check only says
    // the key is real, not that the service will speak with it (Gemini refuses some regions; free allowances run out).
    // { ok: true } or { ok: false, status, message }.
    probe(text = 'Hi.') {
      if (localOn || !key) return Promise.resolve(localOn ? { ok: true } : { ok: false, status: null, message: 'no key' });
      return new Promise((done) => {
        const v = new P.Voice({ key, voice, model, onAudio: () => { v.abort(); done({ ok: true }); }, onEnd: () => done({ ok: true }), onError: (e) => done({ ok: false, status: e.status ?? null, message: e.message }) }).open();
        v.say(text); v.end();
      });
    },
    setVoice(v) { if ((v || P.defaultVoice) !== voice) beats = new Map(); voice = v || P.defaultVoice; if (key) warm(); },
    // Fish Audio, Gemini or VoiceStudio. Starts clean: the key, voice and model are the old service's, so set them again after.
    setProvider(id) {
      const p = all[id];
      dropPrewarm(); // a socket opened for the old service is never used for the new one
      if (id === 'voicestudio') {
        if (localOn) return;
        if (key) stopAll();
        localOn = true; key = null; checking = null; warming = null; beats = new Map();
        // Start the built-in engine now, in the background: its first sentence pays for loading and the first compile.
        checkLocal().then((s) => { if (s.ok && LocalVoiceImpl === StudioVoice) warmBuiltin(localVoice); }).catch(() => {});
        return;
      }
      if (!p || (p === P && !localOn)) return;
      stopWarm();
      if (key || localOn) stopAll(); // nothing can be playing without a key or VoiceStudio (and nothing is sent when the app is just starting)
      localOn = false; P = p; key = null; checking = null; warming = null; beats = new Map();
      voice = p.defaultVoice; pref = p.pick ?? p.models[0]; model = pref;
    },
    get provider() { return localOn ? 'voicestudio' : P.id; },
    // How the reply is cut for the SpeechText: the built-in voice starts synthesizing on a short first clause so
    // speech begins sooner after the words appear; playback speed is untouched. The old VoiceStudio socket keeps
    // its longer cut (its engine is slower to start on a half-finished phrase).
    localOpts() { return localOn ? { early: true, cap: STUDIO_CAPS[studioMode] ?? 0, ...(LocalVoiceImpl === StudioVoice && hasBuiltinVoice() ? { earlyMin: 16, earlyWords: 28 } : {}) } : { early: false, cap: 0 }; },
    // How much VoiceStudio speaks of a reply: 'short', 'medium' or 'full' (anything else is ignored).
    setStudioSpeak(m) { if (Object.hasOwn(STUDIO_CAPS, m)) studioMode = m; },
    get studioSpeak() { return studioMode; },
    stopWarm,
    // The VoiceStudio voice (a saved profile id; null: the engine's default voice).
    setLocalVoice(v) { localVoice = typeof v === 'string' && v ? v : null; },
    // Reply language for the built-in voice. English is the default; Bangla uses the fine-tuned model in the app.
    setLocalLanguage(l) {
      const next = l === 'bn' ? 'bn' : 'en';
      if (next === localLang) return;
      localLang = next; setEngineLanguage(next);
      if (LocalVoiceImpl === StudioVoice && hasBuiltinVoice()) checkLocal().then((s) => { if (s.ok) warmBuiltin(localVoice, next); }).catch(() => {});
    },
    get localVoice() { return localVoice; },
    get local() { return local; },
    checkLocal,
    get ready() { return beats.size + beatPhrases.filter((p) => !beats.has(p) && shipped()?.has(p)).length; },
    get model() { return model; },
    get on() { return localOn || !!key; },
    check,
    start,
    prewarm,
    stop: stopAll,
  };
}
