import assert from 'node:assert/strict';
import { createSpeaker, BEATS, bundledBeats, PROVIDERS, trimSilence, voiceProblemText } from '../speaker.mjs';
import { FISH_MODELS } from '../fish.mjs';
import { readFileSync } from 'node:fs';

// A FishVoice stand-in the test drives by hand.
const made = [];
class FakeVoice {
  constructor(o) { Object.assign(this, o); this.said = []; this.ended = false; this.aborted = false; made.push(this); }
  open() { return this; }
  say(s) { this.said.push(s); }
  end() { this.ended = true; }
  abort() { this.aborted = true; }
  rebind(cbs) { Object.assign(this, cbs); return true; }
}
const setup = (acct = { ok: true, credit: 4.5 }, beatPhrases = [], bundled = () => null) => {
  made.length = 0;
  const out = [], problems = [];
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), FishVoiceImpl: FakeVoice, account: async () => acct, beatPhrases, bundled });
  return { sp, out, problems };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

{ // No key: no voice.
  const { sp } = setup();
  assert.equal(sp.start(), null);
}
{ // Credit → Drama 3; audio goes out as base64 with the reply's id; end marks the end.
  const { sp, out } = setup();
  sp.setKey('k'); await tick();
  assert.equal(sp.model, 'drama-3');
  const r = sp.start();
  assert.deepEqual(out.at(-1), { kind: 'speech', stop: true }, 'a new reply stops whatever was playing');
  r.say('Hi.'); r.end();
  const v = made[0];
  assert.equal(v.model, 'drama-3'); assert.deepEqual(v.said, ['Hi.']); assert.ok(v.ended);
  v.onAudio(new Uint8Array([1, 0, 2, 0]));
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 44100, pcm: Buffer.from([1, 0, 2, 0]).toString('base64') });
  v.onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 3 }, 'a whole reply says how much it said');
}
{ // No credit → the free model.
  const { sp } = setup({ ok: true, credit: 0 });
  sp.setKey('k'); await tick();
  assert.equal(sp.model, 's2.1-pro-free');
}
{ // Fails before any audio → retried once on the free model with everything said so far, and ended again.
  const { sp, out, problems } = setup({ ok: true, credit: 0 });
  sp.setKey('k');
  const r = sp.start(); // started before the account check finished: still on production
  r.say('One.'); r.say('Two.'); r.end();
  await made[0].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false }));
  assert.equal(made.length, 2); assert.equal(made[1].model, 's2.1-pro-free');
  assert.deepEqual(made[1].said, ['One.', 'Two.']); assert.ok(made[1].ended);
  made[1].onAudio(new Uint8Array([0, 0])); made[1].onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 9 }); assert.deepEqual(problems, []);
}
{ // A bad key: no retry, one problem report, the reply ends (text stays).
  const { sp, out, problems } = setup({ ok: false, reason: 'key' });
  sp.setKey('bad');
  const r = sp.start(); r.say('Hi.');
  await made[0].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false }));
  assert.equal(made.length, 1); assert.deepEqual(problems, ['key']);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true });
}
{ // Fails after audio started: no retry (it would repeat itself), no problem shown, just ends.
  const { sp, problems, out } = setup();
  sp.setKey('k');
  const r = sp.start(); r.say('Hi.');
  made[0].onAudio(new Uint8Array([0, 0]));
  await made[0].onError(Object.assign(new Error('dropped'), { heard: true }));
  assert.equal(made.length, 1); assert.deepEqual(problems, []);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true });
}
{ // A new reply aborts the old one; the old one's late audio and end are ignored.
  const { sp, out } = setup();
  sp.setKey('k');
  const a = sp.start(); a.say('Old.');
  const b = sp.start();
  assert.ok(made[0].aborted);
  const n = out.length;
  made[0].onAudio(new Uint8Array([0, 0])); made[0].onEnd();
  assert.equal(out.length, n, 'nothing from the stopped reply');
  b.say('New.'); assert.deepEqual(made[1].said, ['New.']);
}
{ // stop() (Stop, barge-in): aborts and tells the overlay to go quiet.
  const { sp, out } = setup();
  sp.setKey('k');
  sp.start().say('Hi.');
  sp.stop();
  assert.ok(made[0].aborted); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
}
{ // Beats are made once in the voice; a slow tool with nothing said plays one instantly, only once per reply.
  const { sp, out } = setup(undefined, BEATS);
  sp.setKey('k'); await tick();
  for (let i = 0; i < BEATS.length; i++) { const w = made.at(-1); assert.deepEqual(w.said, [BEATS[i]]); w.onAudio(new Uint8Array([i, 0])); w.onEnd(); await tick(); await tick(); }
  assert.equal(sp.ready, BEATS.length);
  const r = sp.start(), n = made.length;
  assert.equal(r.beat(), true);
  const played = out.at(-1);
  assert.deepEqual({ ...played, pcm: undefined }, { kind: 'speech', id: r.id, rate: 44100, pcm: undefined });
  assert.ok(BEATS.some((_, i) => played.pcm === Buffer.from([i, 0]).toString('base64')), 'one of the made beats');
  assert.equal(made.length, n, 'no extra socket for the beat');
  assert.deepEqual(made.at(-1).said, [], 'the beat came from the cache, not the live socket');
  assert.equal(r.beat(), false, 'once per reply');
  const r2 = sp.start(); r2.say('Already talking.');
  assert.equal(r2.beat(), false, 'not when it already said something');
}
{ // No beats made yet (or making them failed): the beat is spoken live instead.
  const { sp } = setup(undefined, BEATS);
  sp.setKey('k');
  const r = sp.start(); const live = made.at(-1);
  assert.equal(r.beat(), true);
  assert.ok(BEATS.includes(live.said[0]));
}
{ // Drama 3 fails before any audio with credit left → S2.1 Pro, and the one that worked is kept for the next reply.
  const { sp, problems } = setup();
  sp.setKey('k'); await tick();
  const r = sp.start(); r.say('Hi.'); r.end();
  const v = made.slice(made.length - 1); // this reply's sockets (an earlier test's beat warm-up can add to made)
  await v[0].onError(Object.assign(new Error('Fish Audio closed the connection'), { heard: false }));
  v.push(made.at(-1));
  assert.equal(v[0].model, 'drama-3'); assert.equal(v[1].model, 's2.1-pro'); assert.deepEqual(v[1].said, ['Hi.']);
  v[1].onAudio(new Uint8Array([0, 0])); v[1].onEnd();
  assert.equal(sp.model, 's2.1-pro'); assert.deepEqual(problems, []);
  sp.start(); assert.equal(made.at(-1).model, 's2.1-pro');
}
{ // Every model fails before audio → tried once on each, then one problem report.
  const { sp, problems } = setup();
  sp.setKey('k'); await tick();
  sp.start().say('Hi.');
  const v = [made.at(-1)];
  for (let i = 0; i < 3; i++) { await v[i].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false })); if (i < 2) v.push(made.at(-1)); }
  assert.deepEqual(v.map((x) => x.model), ['drama-3', 's2.1-pro', 's2.1-pro-free']);
  assert.equal(made.at(-1), v[2], 'no fourth try');
  assert.deepEqual(problems, ['Could not reach Fish Audio']);
}
{ // Picking S2.1 Pro: replies use it, and a failure falls back to the free tier, never up to the pricier Drama 3.
  const { sp, problems } = setup();
  sp.setModel('s2.1-pro');
  sp.setKey('k'); await tick();
  assert.equal(sp.pick, 's2.1-pro');
  sp.start().say('Hi.');
  const v = [made.at(-1)];
  assert.equal(v[0].model, 's2.1-pro');
  for (let i = 0; i < 2; i++) { await v[i].onError(Object.assign(new Error('Could not reach Fish Audio'), { heard: false })); if (i < 1) v.push(made.at(-1)); }
  assert.deepEqual(v.map((x) => x.model), ['s2.1-pro', 's2.1-pro-free']);
  assert.equal(made.at(-1), v[1], 'no third try, and never Drama 3');
  assert.deepEqual(problems, ['Could not reach Fish Audio']);
}
{ // Switching the pick: the next reply uses it; no credit keeps it on the free tier; only real choices count.
  const { sp } = setup({ ok: true, credit: 0 });
  sp.setKey('k'); await tick();
  sp.setModel('s2.1-pro');
  assert.equal(sp.pick, 's2.1-pro');
  assert.equal(sp.model, 's2.1-pro-free', 'no credit stays free');
  sp.setModel('s2.1-pro-free'); sp.setModel('nope');
  assert.equal(sp.pick, 's2.1-pro', 'the free tier and unknown names are not picks');
  const { sp: sp2 } = setup();
  sp2.setKey('k'); await tick();
  sp2.setModel('s2.1-pro');
  sp2.start(); assert.equal(made.at(-1).model, 's2.1-pro');
  sp2.setModel('drama-3');
  sp2.start(); assert.equal(made.at(-1).model, 'drama-3');
}
{ // Gemini: its own voice class, 24 kHz audio, the cheaper model unless the other is picked, beats not made straight away.
  made.length = 0;
  const out = [], problems = [];
  let acct = { ok: true, credit: null };
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 4.5 }),
    providers: { gemini: { ...PROVIDERS.gemini, Voice: FakeVoice, account: async () => acct } }, beatPhrases: ['One sec.'], bundled: () => null });
  assert.equal(sp.provider, 'fish');
  sp.setKey('fish-key'); await tick(); await tick();
  made.length = 0; // the Fish beat made on its key
  sp.setProvider('gemini');
  assert.equal(sp.provider, 'gemini'); assert.equal(sp.on, false, "the other service's key isn't carried over");
  assert.equal(sp.start(), null);
  sp.setKey('g-key'); sp.setVoice('Puck'); await tick(); await tick();
  assert.equal(made.length, 0, 'beats wait a while, in case the voice is still being picked');
  assert.equal(sp.model, 'gemini-3.8-flash-lite-tts'); assert.equal(sp.pick, 'gemini-3.8-flash-lite-tts');
  const r = sp.start();
  assert.equal(r.beat(), true);
  const v = made[0];
  assert.deepEqual(v.said, ['One sec.'], 'the beat is said live');
  assert.equal(v.key, 'g-key'); assert.equal(v.voice, 'Puck'); assert.equal(v.model, 'gemini-3.8-flash-lite-tts');
  v.onAudio(new Uint8Array([1, 0]));
  assert.equal(out.at(-1).rate, 25440, 'played a semitone up');
  // A failure that isn't the key: said as it is, and not tried again (there's no cheaper model than this one).
  const r2 = sp.start(); r2.say('Hi.');
  made.at(-1).onError(Object.assign(new Error('Gemini: No matching speaker voice'), { heard: false, status: 400 })); await tick(); await tick();
  assert.deepEqual(problems, ['Gemini: No matching speaker voice']);
  assert.equal(made.length, 2);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r2.id, end: true });
  // The key stopped working: said as a key problem, though there was no model left to retry on.
  acct = { ok: false, reason: 'key' };
  const r3 = sp.start(); r3.say('Hi.');
  made.at(-1).onError(Object.assign(new Error('Gemini: API key not valid'), { heard: false, status: 400 })); await tick(); await tick();
  assert.deepEqual(problems.at(-1), 'key');
  // Flash picked: a reply that fails before any audio is tried again on Flash Lite, with what was said so far.
  acct = { ok: true, credit: null };
  sp.setModel('gemini-3.8-flash-tts'); sp.setModel('not-a-model');
  assert.equal(sp.pick, 'gemini-3.8-flash-tts');
  const r5 = sp.start(); r5.say('Hi.');
  assert.equal(made.at(-1).model, 'gemini-3.8-flash-tts');
  made.at(-1).onError(Object.assign(new Error('Gemini: overloaded'), { heard: false, status: 503 })); await tick(); await tick();
  assert.equal(made.at(-1).model, 'gemini-3.8-flash-lite-tts'); assert.deepEqual(made.at(-1).said, ['Hi.']);
  // Back to Fish: its own voice class and rate again.
  sp.setProvider('fish'); sp.setKey('fish-key'); await tick(); await tick();
  const r4 = sp.start(); r4.say('Hi.');
  assert.equal(made.at(-1).model, 'drama-3');
  made.at(-1).onAudio(new Uint8Array([1, 0]));
  assert.equal(out.at(-1).rate, 44100);
}
{ // A Fish account check still out when the service changes says nothing about Gemini's model.
  let answer;
  const sp = createSpeaker({ emit: () => {}, FishVoiceImpl: FakeVoice, account: () => new Promise((r) => { answer = r; }),
    providers: { gemini: { ...PROVIDERS.gemini, Voice: FakeVoice, account: async () => ({ ok: true, credit: null }) } }, beatPhrases: [], bundled: () => null });
  sp.setKey('fish-key');
  sp.setProvider('gemini'); sp.setKey('g-key'); await tick();
  answer({ ok: true, credit: 0 }); await tick(); await tick();
  assert.equal(sp.model, PROVIDERS.gemini.pick, 'not the Fish free tier');
  assert.deepEqual(await sp.check(), { ok: true, credit: null }, 'and the next check asks Gemini');
}
// Silence at both ends of a beat is cut (a little is kept), so it starts the moment it plays.
{
  const pcm = Buffer.from(new Int16Array([...Array(2000).fill(0), 9000, -9000, 9000, ...Array(3000).fill(3)]).buffer);
  const cut = trimSilence(pcm, 1000); // 40 samples kept each side
  assert.equal(cut.length / 2, 40 + 3 + 40);
  assert.equal(cut.readInt16LE(40 * 2), 9000);
  assert.equal(trimSilence(Buffer.from([1, 0, 2, 0]), 24000).length, 4, 'nothing loud: left alone');
  assert.equal(trimSilence(Buffer.from([1, 0, 2]), 24000).length, 2, 'a stray byte is dropped');
}
{ // Beats made here are kept (beatStore) and read back next time, so they're only ever made once per voice and model.
  const kept = new Map(), writes = [];
  const beatStore = { read: (name) => kept.get(name) ?? null, write: (name, data) => { writes.push(name); kept.set(name, data); } };
  const gem = { gemini: { ...PROVIDERS.gemini, Voice: FakeVoice, warmDelay: 0, account: async () => ({ ok: true, credit: null }) } };
  const mk = (out = []) => ({ out, sp: createSpeaker({ emit: (m) => out.push(m), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 1 }), providers: gem, beatPhrases: ['One sec.', 'On it.'], bundled: () => null, beatStore }) });
  const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
  made.length = 0;
  const { sp } = mk();
  sp.setProvider('gemini'); sp.setVoice('Puck'); sp.setKey('g-key'); await settle();
  assert.equal(made.length, 1, 'one at a time');
  assert.deepEqual(made[0].said, ['One sec.']); assert.equal(made[0].voice, 'Puck'); assert.equal(made[0].model, 'gemini-3.8-flash-lite-tts');
  made[0].onAudio(new Uint8Array([1, 0])); made[0].onAudio(new Uint8Array([2, 0])); made[0].onEnd(); await settle();
  made[1].onAudio(new Uint8Array([3, 0])); made[1].onEnd(); await settle();
  assert.equal(sp.ready, 2);
  assert.deepEqual(writes, ['gemini.Puck.gemini-3.8-flash-lite-tts']);
  assert.deepEqual(kept.get(writes[0]), { rate: 24000, beats: { 'One sec.': Buffer.from([1, 0, 2, 0]).toString('base64'), 'On it.': Buffer.from([3, 0]).toString('base64') } });
  // The next run: read back, nothing asked of Gemini, and played at once at its rate.
  made.length = 0;
  const { sp: sp2, out } = mk();
  sp2.setProvider('gemini'); sp2.setVoice('Puck'); sp2.setKey('g-key'); await settle();
  assert.equal(made.length, 0); assert.equal(sp2.ready, 2); assert.equal(writes.length, 1, 'nothing new to keep');
  const r = sp2.start(); assert.equal(r.beat(), true);
  assert.equal(out.at(-1).rate, 25440); assert.ok([...Object.values(kept.get(writes[0]).beats)].includes(out.at(-1).pcm));
  assert.deepEqual(made.at(-1).said, [], 'not said live');
  // Another voice: its own beats, made once the first lot is out of the way.
  made.length = 0;
  sp2.setVoice('Kore'); await settle();
  assert.equal(made.at(-1).voice, 'Kore'); assert.deepEqual(made.at(-1).said, ['One sec.']);
  // It gives up after three failures in a row (no allowance left), rather than asking for all of them.
  made.length = 0;
  const many = createSpeaker({ emit: () => {}, FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 1 }), providers: gem, beatPhrases: ['a', 'b', 'c', 'd', 'e'], bundled: () => null, beatStore });
  many.setProvider('gemini'); many.setKey('g-key'); await settle();
  for (let i = 0; i < 3; i++) { made.at(-1).onError(new Error('Gemini is rate limiting')); await settle(); }
  assert.equal(made.length, 3, 'stopped after three'); assert.equal(many.ready, 0);
}
console.log('speaker tests: passed');
{ // Voice cues aren't counted as spoken text.
  const { sp, out } = setup();
  sp.setKey('k');
  const r = sp.start(); r.say('[warm] Hello there.'); r.end();
  made.at(-1).onAudio(new Uint8Array([0, 0])); made.at(-1).onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 12 });
  console.log('speech pacing tests: passed');
}

{ // At least 30 short beats, one or two words each, picked at random with no repeat among the last few.
  assert.ok(BEATS.length >= 30, 'plenty of beats');
  assert.equal(new Set(BEATS).size, BEATS.length, 'no duplicates');
  for (const b of BEATS) assert.ok(b.replace(/[.,!]/g, '').trim().split(/\s+/).length <= 2, `${b} is one or two words`);
  const { sp, out } = setup(undefined, BEATS);
  sp.setKey('k'); await tick();
  for (let i = 0; i < BEATS.length; i++) { const w = made.at(-1); w.onAudio(new Uint8Array([i, 1])); w.onEnd(); await tick(); await tick(); }
  const seen = [];
  for (let i = 0; i < 40; i++) { const r = sp.start(); r.beat(); seen.push(out.at(-1).pcm); r.abort(); }
  for (let i = 0; i < seen.length; i++) assert.ok(!seen.slice(Math.max(0, i - 8), i).includes(seen[i]), 'no repeat within 8');
  assert.ok(new Set(seen).size > 12, 'they vary');
}
console.log('speaker beat variety: passed');

{ // Beats shipped with the app play at their own rate, and none are made over Fish for them.
  const clip = { rate: 24000, pcm: Buffer.from([7, 7]).toString('base64') };
  const { sp, out } = setup(undefined, BEATS, () => new Map(BEATS.map((b) => [b, clip])));
  sp.setKey('k'); await tick(); await tick();
  assert.equal(made.filter((v) => v.said.length).length, 0, 'no beat is recorded at run time');
  const r = sp.start();
  assert.equal(r.beat(), true);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 24000, pcm: clip.pcm });
}
{ // Every look's voice has every beat recorded, in both paid models (re-run beats/make.mjs after changing BEATS).
  const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  const { DEFAULT_VOICE } = await import('../fish.mjs');
  const voices = [DEFAULT_VOICE, ...[...side.matchAll(/\['\w+', '[^']+', '([0-9a-f]{32})'\]/g)].map((m) => m[1])];
  const get = bundledBeats();
  for (const v of voices) for (const m of FISH_MODELS) {
    const set = get(v, m);
    assert.ok(set, `beats for ${v} on ${m}`);
    for (const b of BEATS) assert.ok(set.get(b)?.pcm.length > 1000, `"${b}" in ${v} on ${m}`);
  }
}
console.log('bundled beats: passed');

{ // VoiceStudio (local) as the provider: no Fish key needed, its PCM goes out at its own rate, cues aren't counted.
  made.length = 0;
  const local = [], out = [], problems = [];
  class FakeLocal { constructor(o) { Object.assign(this, o); this.said = []; this.ended = false; this.aborted = false; local.push(this); } open() { this.opened = true; return this; } say(s) { this.said.push(s); } end() { this.ended = true; } abort() { this.aborted = true; } }
  const sp = createSpeaker({ emit: (m) => out.push(m), onProblem: (p) => problems.push(p), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 5 }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: FakeLocal, localStatus: async () => ({ ok: true, engine: 'omnivoice', voices: [{ id: 'en-Alice_woman', name: 'Alice' }] }) });
  assert.equal(sp.provider, 'fish'); assert.equal(sp.on, false, 'Fish without a key is off');
  sp.setProvider('voicestudio'); await tick();
  assert.equal(sp.provider, 'voicestudio'); assert.equal(sp.on, true, 'VoiceStudio needs no key');
  assert.equal(sp.local.ok, true);
  sp.setLocalVoice('en-Alice_woman');
  const r = sp.start();
  assert.equal(local.at(-1).voice, 'en-Alice_woman'); assert.ok(local.at(-1).opened, 'its socket opens as the reply starts');
  assert.equal(r.beat(), false, 'no beats made in VoiceStudio');
  r.say('[warm] Hello there.'); r.end();
  assert.deepEqual(local.at(-1).said, ['[warm] Hello there.']); assert.ok(local.at(-1).ended);
  local.at(-1).onAudio(new Uint8Array([4, 0]), 24000);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, rate: 24000, pcm: Buffer.from([4, 0]).toString('base64') });
  local.at(-1).onEnd();
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r.id, end: true, chars: 12 });
  assert.equal(made.length, 0, 'Fish was never used');

  // Unavailable before any audio: reported with its reason and message, the reply ends as text, and Fish is NOT tried,
  // even when a Fish key is handed over meanwhile (it's ignored while VoiceStudio is the pick).
  sp.setKey('fish-key'); await tick();
  assert.equal(sp.provider, 'voicestudio');
  const n = made.length;
  const r2 = sp.start(); r2.say('Hi.'); r2.end();
  local.at(-1).onError(Object.assign(new Error("Run VoiceStudio first."), { reason: 'offline', heard: false }));
  assert.deepEqual(problems, [{ provider: 'voicestudio', reason: 'offline', message: "Run VoiceStudio first." }]);
  assert.deepEqual(out.at(-1), { kind: 'speech', id: r2.id, end: true });
  assert.equal(made.length, n, 'no Fish socket opened as a fallback');
  assert.equal(sp.local.reason, 'offline', 'the panel shows the latest reason');

  // Failing after audio started: no problem report (it was heard), just ends.
  const r3 = sp.start(); r3.say('Hi.');
  local.at(-1).onAudio(new Uint8Array([0, 0]), 24000);
  local.at(-1).onError(Object.assign(new Error('dropped'), { reason: 'error', heard: true }));
  assert.equal(problems.length, 1);

  // Stop (and barge-in) aborts the local voice and quiets the overlay; a new reply aborts the old one.
  const r4 = sp.start(); r4.say('Long one.');
  sp.stop();
  assert.ok(local.at(-1).aborted); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
  const a = sp.start(); a.say('Old.'); const old = local.at(-1);
  sp.start(); assert.ok(old.aborted);
  const before = out.length; old.onAudio(new Uint8Array([1, 0]), 24000); old.onEnd();
  assert.equal(out.length, before, 'nothing from the stopped reply');

  // Switching providers stops what's playing; back on Fish, replies use Fish again with the same model pick.
  const r5 = sp.start(); r5.say('Local.'); const playing = local.at(-1);
  sp.setProvider('fish');
  assert.ok(playing.aborted, 'switching stops the old provider'); assert.deepEqual(out.at(-1), { kind: 'speech', stop: true });
  assert.equal(sp.on, false, 'back on Fish, it waits for its key'); sp.setKey('fish-key'); await tick();
  const f = sp.start(); f.say('Fish again.');
  assert.equal(made.at(-1).model, 'drama-3'); assert.deepEqual(made.at(-1).said, ['Fish again.']);
  sp.setProvider('nope'); assert.equal(sp.provider, 'fish', 'unknown providers are ignored');
  console.log('speaker provider tests: passed');
}
{ // A key check doesn't prove the service will speak (#72): probe says one line, and a refusal comes back with its reason.
  const { sp } = setup();
  sp.setKey('k'); await tick();
  const good = sp.probe(); made.at(-1).onAudio(new Uint8Array([0, 0]));
  assert.deepEqual(await good, { ok: true }); assert.ok(made.at(-1).aborted, 'the audio is thrown away');
  const bad = sp.probe();
  assert.deepEqual(made.at(-1).said, ['Hi.']);
  made.at(-1).onError(Object.assign(new Error('Gemini: User location is not supported for the API use.'), { status: 400, heard: false }));
  assert.deepEqual(await bad, { ok: false, status: 400, message: 'Gemini: User location is not supported for the API use.' });
  const { sp: none } = setup();
  assert.equal((await none.probe()).ok, false, 'no key, nothing to try');
}
{ // A failed voice is said with the service's own reason, not a bare "isn't working" (#72).
  assert.equal(voiceProblemText('Gemini: User location is not supported for the API use.', 'Gemini'), "My voice isn't working right now: User location is not supported for the API use. Replies are text for now.");
  assert.equal(voiceProblemText('Gemini is rate limiting (the free allowance may be used up for now)', 'Gemini'), "My voice isn't working right now: Gemini is rate limiting (the free allowance may be used up for now). Replies are text for now.");
  assert.equal(voiceProblemText('key', 'Gemini'), "My Gemini key isn't working, so replies are text for now.");
  assert.equal(voiceProblemText(undefined, 'Gemini'), "My voice isn't working right now, so replies are text for now.");
  console.log('speaker probe tests: passed');
}

{ // Prewarm: Fish's socket opens while the user talks; the reply takes it (no second socket), and an unused one closes after prewarmMs.
  made.length = 0;
  const out = [];
  const sp = createSpeaker({ emit: (m) => out.push(m), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 4.5 }), beatPhrases: [], bundled: () => null, prewarmMs: 20 });
  sp.prewarm(); assert.equal(made.length, 0, 'no key: nothing to open');
  sp.setKey('sk-test'); await tick();
  sp.prewarm(); assert.equal(made.length, 1, 'opened ahead of the reply');
  const warm = made[0];
  sp.prewarm(); assert.equal(made.length, 1, 'already warm: not opened again');
  const r = sp.start();
  assert.equal(made.length, 1, 'the reply adopts the warm socket');
  r.say('Hi.');
  assert.deepEqual(warm.said, ['Hi.']);
  warm.onAudio(new Uint8Array([1, 2]));
  assert.ok(out.some((m) => m.kind === 'speech' && m.id === r.id && m.pcm), 'its audio is the reply\'s');
  // Unused: closed after prewarmMs.
  made.length = 0; out.length = 0;
  sp.prewarm(); const idle = made[0];
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(idle.aborted, true, 'an unused socket is closed');
  // A different voice or model doesn't adopt it: it's closed and the reply opens its own.
  sp.prewarm(); const other = made.at(-1);
  sp.setVoice('someone-else');
  const r2 = sp.start();
  assert.equal(other.aborted, true, 'a mismatched socket is closed');
  assert.equal(made.at(-1).voice, 'someone-else');
  r2.abort();
  console.log('speaker prewarm tests: passed');
}

{ // VoiceStudio keep-warm and prewarm, on a fake clock: no timer before the first real reply; a throwaway word every 4
  // minutes after one (audio dropped, nothing emitted); none while a reply runs; ends 30 minutes after the last reply;
  // and a provider change ends it. Prewarm pings when the last request is over a minute old, never during a reply.
  const M = 60_000;
  const clock = { t: 0, timers: [] };
  const setTimer = (f, ms) => { const h = { f, at: clock.t + ms, live: true, unref() {} }; clock.timers.push(h); return h; };
  const clearTimer = (h) => { if (h) h.live = false; };
  const advance = (ms) => {
    const end = clock.t + ms;
    for (;;) {
      const next = clock.timers.filter((h) => h.live && h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock.t = next.at; next.live = false; next.f();
    }
    clock.t = end;
  };
  const local = [], pingAt = [], out = [], logs = [];
  let failNext = false; // the next throwaway fails instead of ending
  class FakeLocal {
    constructor(o) { Object.assign(this, o); this.said = []; local.push(this); }
    open() { return this; }
    say(s) { this.said.push(s); }
    end() { // a throwaway ends at once; a reply waits for its test to end it
      if (this.said.join() !== 'Hm.') return;
      if (failNext) { failNext = false; this.onError(new Error('offline')); return; }
      pingAt.push(clock.t); this.onEnd();
    }
    abort() { this.aborted = true; }
  }
  const sp = createSpeaker({ emit: (m) => out.push(m), log: (k) => logs.push(k), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 5 }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: FakeLocal, localStatus: async () => ({ ok: true, engine: 'omnivoice', voices: [] }), keepWarmMs: 4 * M, keepWarmIdleMs: 30 * M, studioQuietMs: M, now: () => clock.t, setTimer, clearTimer });
  sp.setProvider('voicestudio'); await tick();
  const live = () => clock.timers.filter((h) => h.live).length;
  // Phase 1: nothing before the first real reply.
  advance(60 * M);
  assert.equal(local.length, 0, 'no throwaway before the first real use');
  assert.equal(live(), 0, 'no timer before the first real use');
  // Phase 2: a real reply at 60 min; pings at 64, 72, 76, ... (68 is skipped, a reply is running).
  const r1 = sp.start(); r1.say('Hi.'); r1.end(); local.at(-1).onEnd();
  assert.equal(live(), 1, 'the schedule starts with the first real reply');
  advance(4 * M);
  assert.deepEqual(pingAt, [64 * M], 'a throwaway word at 4 minutes');
  assert.equal(out.filter((m) => m.kind === 'speech' && m.pcm).length, 0, 'the throwaway is never emitted');
  advance(2 * M); // 66 min
  const r2 = sp.start(); r2.say('Long one.');
  advance(2 * M); // 68 min: the tick comes while r2 runs
  assert.deepEqual(pingAt, [64 * M], 'skipped while a reply is in flight');
  assert.equal(local.at(-1).said.join(), 'Long one.', 'the reply is still the live socket');
  local.at(-1).onEnd(); // r2 ends at 68
  advance(4 * M); // 72
  assert.deepEqual(pingAt, [64 * M, 72 * M]);
  advance(20 * M); // to 92: 76, 80, 84, 88, 92
  assert.equal(pingAt.length, 7);
  // Phase 3: 30 minutes after the last real reply (66 min) → at 96 the schedule ends, and it stays ended.
  advance(4 * M);
  assert.equal(pingAt.length, 7, 'no ping once 30 minutes have passed with no real reply');
  assert.equal(live(), 0, 'the schedule has ended');
  advance(120 * M);
  assert.equal(pingAt.length, 7);
  // Phase 4: a new real reply starts it again; a provider change stops it.
  const r3 = sp.start(); r3.say('Again.'); local.at(-1).onEnd();
  assert.equal(live(), 1, 'a new real reply restarts it');
  sp.setProvider('fish');
  assert.equal(live(), 0, 'a provider change stops it');
  advance(30 * M);
  assert.equal(pingAt.length, 7);
  // Errors in a throwaway are quiet: no log, and the next one can go.
  sp.setProvider('voicestudio'); await tick();
  const n = logs.length;
  failNext = true; sp.prewarm(); // the last request was long ago: a throwaway, which fails
  assert.equal(logs.length, n, 'a failed throwaway logs nothing');
  assert.equal(pingAt.length, 7, 'and is not counted as a ping');
  advance(2 * M); sp.prewarm();
  assert.equal(pingAt.length, 8, 'after a failure the next one goes');
  // Stopping a reply and the warm-up: the schedule keeps its own clock; stopWarm ends it.
  const r4 = sp.start(); r4.say('Hi.'); local.at(-1).onEnd();
  assert.equal(live(), 1);
  sp.stopWarm();
  assert.equal(live(), 0, 'stopWarm ends it');
  // Prewarm: pings when the last request is over a minute old; not during a reply; never throws.
  advance(2 * M); const p0 = pingAt.length; sp.start(); // a real reply: that's the last request
  sp.prewarm(); assert.equal(pingAt.length, p0, 'not during a reply, nor right after one');
  local.at(-1).onEnd();
  advance(30_000); sp.prewarm(); assert.equal(pingAt.length, p0, 'within a minute of the last request: nothing');
  advance(31_000); sp.prewarm(); assert.equal(pingAt.length, p0 + 1, 'over a minute since the last request: a throwaway');
  sp.stopWarm();
}
{ // Prewarm before anything was used: pings at once, and a constructor that throws is swallowed.
  const made = [], logged = [];
  const sp = createSpeaker({ emit: () => {}, log: (k) => logged.push(k), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: class { constructor() { made.push(this); } open() { return this; } say() {} end() {} abort() {} }, localStatus: async () => ({ ok: true, voices: [] }) });
  sp.setProvider('voicestudio'); await tick();
  sp.prewarm(); assert.equal(made.length, 1, 'the first talk or typing wakes VoiceStudio');
  sp.prewarm(); assert.equal(made.length, 1, 'not again within a minute');
  const bad = createSpeaker({ emit: () => {}, log: (k) => logged.push(k), FishVoiceImpl: FakeVoice, account: async () => ({ ok: true }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: class { constructor() { throw new Error('boom'); } }, localStatus: async () => ({ ok: true, voices: [] }) });
  bad.setProvider('voicestudio'); await tick();
  assert.doesNotThrow(() => bad.prewarm());
  assert.deepEqual([...new Set(logged)], ['voicestudio_status'], 'a failed throwaway is never logged');
  console.log('speaker keep-warm tests: passed');
}
{ // What SpeechText is given: VoiceStudio's early first chunk and its spoken cap (short by default); the rest as before.
  const sp = createSpeaker({ emit: () => {}, FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 1 }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: class { open() { return this; } say() {} end() {} abort() {} }, localStatus: async () => ({ ok: true, voices: [] }) });
  assert.deepEqual(sp.localOpts(), { early: false, cap: 0 }, 'Fish, no key: as before');
  sp.setProvider('voicestudio'); await tick();
  assert.equal(sp.studioSpeak, 'short');
  assert.deepEqual(sp.localOpts(), { early: true, cap: 160 }, 'short by default');
  sp.setStudioSpeak('medium'); assert.deepEqual(sp.localOpts(), { early: true, cap: 320 });
  sp.setStudioSpeak('full'); assert.deepEqual(sp.localOpts(), { early: true, cap: 0 });
  sp.setStudioSpeak('huge'); assert.equal(sp.studioSpeak, 'full', 'unknown modes are ignored');
  sp.setStudioSpeak('short');
  sp.setProvider('fish'); assert.deepEqual(sp.localOpts(), { early: false, cap: 0 }, 'back on Fish: as before');
  sp.setProvider('gemini'); assert.deepEqual(sp.localOpts(), { early: false, cap: 0 }, 'Gemini: as before');
  console.log('speaker localOpts tests: passed');
}

{ // The built-in reply language reaches every voice it makes; English is the default.
  const made = [];
  const sp = createSpeaker({ emit: () => {}, FishVoiceImpl: FakeVoice, account: async () => ({ ok: true, credit: 1 }), beatPhrases: [], bundled: () => null,
    LocalVoiceImpl: class { constructor(o) { Object.assign(this, o); this.said = []; made.push(this); } open() { return this; } say(s) { this.said.push(s); } end() {} abort() {} },
    localStatus: async () => ({ ok: true, voices: [] }) });
  sp.setProvider('voicestudio'); await tick();
  let r = sp.start(); r.say('Hello.'); r.end();
  assert.equal(made.at(-1).lang, 'en', 'English until changed');
  sp.setLocalLanguage('bn');
  r = sp.start(); r.say('নমস্কার।'); r.end();
  assert.equal(made.at(-1).lang, 'bn', 'Bangla reaches the voice');
  assert.deepEqual(made.at(-1).said, ['নমস্কার।']);
  sp.setLocalLanguage('fr');
  r = sp.start(); r.say('Hello again.'); r.end();
  assert.equal(made.at(-1).lang, 'en', 'unknown languages fall back to English');
  console.log('speaker language tests: passed');
}

{ // The face follows the voice: a sentence with a new feeling is marked with where it starts (cues and beats counted right).
  const { sp, out } = setup({ ok: true, credit: 4.5 }, ['On it.'], () => new Map([['On it.', { rate: 44100, pcm: 'AAA=' }]]));
  sp.setKey('k'); await tick();
  const r = sp.start();
  assert.equal(r.beat(), true);
  r.say('[excited] We did it!'); r.say('[happy] Really.'); r.say('Next up.'); r.say('[sad] Oh.'); r.end();
  const feels = out.filter((m) => 'feel' in m).map(({ feel, at }) => [feel, at]);
  assert.deepEqual(feels, [['joy', 7], [null, 26], ['sad', 35]], 'the beat and spoken text before each; no repeat; no cue is a plain face');
  assert.ok(out.filter((m) => 'feel' in m).every((m) => m.id === r.id && m.kind === 'speech'));
  console.log('speaker feeling tests: passed');
}
