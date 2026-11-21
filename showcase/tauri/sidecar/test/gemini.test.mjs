import assert from 'node:assert/strict';
import { GeminiVoice, geminiAccount, plain, speechRequest, GEMINI_API, GEMINI_DEFAULT_VOICE, GEMINI_LOOK_VOICES, GEMINI_MODEL, GEMINI_TAGS, GEMINI_VOICES } from '../gemini.mjs';
import { VOICE_CUES } from '../speech.mjs';

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
// One audio event, as Gemini sends it (checked against the live API).
const audio = (bytes) => `event: step.delta\ndata: ${JSON.stringify({ index: 0, delta: { mime_type: 'audio/l16', data: b64(bytes), channels: 1, sample_rate: 24000, type: 'audio' }, event_type: 'step.delta' })}\n\n`;
const DONE = 'event: done\ndata: [DONE]\n\n';

// A streamed response body the test feeds by hand.
class Body {
  constructor() { this.parts = []; this.over = false; this.wake = null; }
  push(s) { this.parts.push(Buffer.from(s)); this.wake?.(); }
  close() { this.over = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      while (this.parts.length) yield this.parts.shift();
      if (this.over) return;
      await new Promise((r) => { this.wake = r; });
    }
  }
}
// A fake fetch: every call gets its own Body (or the response `answer` gives), and is kept for the test to read.
const run = (opts = {}, answer = null) => {
  const got = { audio: [], ended: 0, errors: [] }, calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, sent: JSON.parse(init.body), body: new Body() };
    calls.push(call);
    return answer?.(call) ?? { ok: true, status: 200, body: call.body };
  };
  const v = new GeminiVoice({ key: 'AIza-test', voice: 'Puck', fetchImpl, onAudio: (a) => got.audio.push([...a]), onEnd: () => got.ended++, onError: (e) => got.errors.push(e), ...opts });
  return { v, got, calls };
};

// The voices: 30 of them, no doubles, the default among them.
assert.equal(GEMINI_VOICES.length, 30);
assert.equal(new Set(GEMINI_VOICES.map((x) => x.id)).size, 30);
assert.ok(GEMINI_VOICES.some((x) => x.id === GEMINI_DEFAULT_VOICE));
assert.ok(GEMINI_VOICES.every((x) => x.id && x.style));

// Fish voice cues never reach Gemini (it would read them out); the first mood becomes the style.
assert.deepEqual(plain('[warm] Hello there.'), { text: 'Hello there.', style: 'warm' });
assert.deepEqual(plain('[quietly proud] Done.'), { text: 'Done.', style: 'quietly proud' });
assert.deepEqual(plain('[chuckling] Ha, [emphasis] yes.'), { text: '<giggle> Ha, yes.', style: null }, 'a sound is a Gemini tag, not a style');
assert.deepEqual(plain('[break] [excited] It worked!'), { text: '<short pause> It worked!', style: 'excited' });
assert.deepEqual(plain('[warm] Long day. [sighing] Right.'), { text: 'Long day. <sigh> Right.', style: 'warm' }, 'a sound mid-reply keeps its place');
assert.deepEqual(plain('[audience laughing] Ta-da.'), { text: 'Ta-da.', style: null }, 'a sound Gemini has no tag for is dropped');
for (const c of Object.keys(GEMINI_TAGS)) assert.ok([...VOICE_CUES.sounds, ...VOICE_CUES.effects].includes(c), `${c} is a Fish cue`);
assert.deepEqual(plain('Dear [Landlord Name], hello.'), { text: 'Dear [Landlord Name], hello.', style: null }, "a draft's brackets stay");
assert.deepEqual(plain('[warm]'), { text: '', style: 'warm' });

// The request: the documented shape, and no style note when there's no cue.
assert.deepEqual(speechRequest('Hi.', { voice: 'Kore', style: 'warm' }), {
  model: GEMINI_MODEL,
  input: [{ type: 'user_input', content: [{ type: 'text', text: 'Hi.', annotations: [{ type: 'speech_metadata', style: 'warm' }] }] }],
  response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: 'Kore' }] }, stream: true,
});
assert.equal('annotations' in speechRequest('Hi.').input[0].content[0], false);

{ // Each sentence is its own request, started at once; audio comes out in the order said, whatever arrives first.
  const { v, got, calls } = run();
  assert.equal(v.open(), v);
  v.say('[warm] One.'); v.say('Two.');
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${GEMINI_API}/interactions`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-test');
  assert.equal(calls[0].sent.input[0].content[0].text, 'One.');
  assert.equal(calls[0].sent.input[0].content[0].annotations[0].style, 'warm, speaking quickly');
  assert.equal(calls[0].sent.generation_config.speech_config[0].voice, 'Puck');
  assert.equal(calls[1].sent.input[0].content[0].text, 'Two.');
  assert.equal(calls[1].sent.input[0].content[0].annotations[0].style, 'speaking quickly', 'no mood: the pace alone');
  calls[1].body.push(audio([7, 8])); await tick();
  assert.deepEqual(got.audio, [], 'the second sentence waits for the first');
  calls[0].body.push('event: step.start\ndata: {"index":0,"step":{"type":"model_output"},"event_type":"step.start"}\n\n' + audio([1, 2])); await tick();
  assert.deepEqual(got.audio, [[1, 2]], 'the first one plays as it streams');
  calls[0].body.push(audio([3, 4]) + DONE); calls[0].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 2], [3, 4], [7, 8]]);
  v.end(); await tick();
  assert.equal(got.ended, 0, 'not over until the last sentence is');
  calls[1].body.push(audio([9, 10])); calls[1].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 2], [3, 4], [7, 8], [9, 10]]);
  assert.equal(got.ended, 1); assert.equal(got.errors.length, 0);
  v.say('Late.'); v.end(); await tick();
  assert.equal(calls.length, 2); assert.equal(got.ended, 1);
}
{ // An event split across network chunks, and samples split across events (odd lengths).
  const { v, got, calls } = run();
  v.say('Hi.'); await tick();
  const all = audio([1, 2, 3]) + audio([4, 5, 6]);
  calls[0].body.push(all.slice(0, 40)); await tick();
  assert.deepEqual(got.audio, []);
  calls[0].body.push(all.slice(40)); calls[0].body.close(); v.end(); await tick();
  assert.deepEqual(got.audio, [[1, 2], [3, 4, 5, 6]]);
  assert.equal(got.ended, 1);
}
{ // Only a few at once: the rest start as the earlier ones finish.
  const { v, got, calls } = run({ maxInFlight: 2 });
  for (const s of ['A.', 'B.', 'C.']) v.say(s);
  v.end(); await tick();
  assert.equal(calls.length, 2);
  calls[1].body.push(audio([3, 3])); calls[1].body.close(); await tick();
  assert.equal(calls.length, 3, 'a finished one frees a place, even out of turn');
  calls[0].body.push(audio([1, 1])); calls[0].body.close();
  calls[2].body.push(audio([5, 5])); calls[2].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 1], [3, 3], [5, 5]]);
  assert.equal(got.ended, 1);
}
{ // Nothing said (or only a cue, or only punctuation): end() reports done without asking Gemini for anything.
  const { v, got, calls } = run();
  v.say(''); v.say('[warm]'); v.say('…'); v.say('[sighing] ...'); v.end(); await tick();
  assert.equal(calls.length, 0); assert.equal(got.ended, 1);
}
{ // abort(): silent, and the requests are cancelled.
  const { v, got, calls } = run();
  v.say('Hi.'); await tick();
  calls[0].body.push(audio([1, 2])); await tick();
  v.abort();
  assert.equal(calls[0].init.signal.aborted, true);
  calls[0].body.push(audio([3, 4])); calls[0].body.close(); await tick();
  assert.deepEqual(got.audio, [[1, 2]]); assert.equal(got.ended, 0); assert.equal(got.errors.length, 0);
}
{ // Refused (an unknown voice is a 400 too, so the voice doesn't call it a key problem): the reason and the status.
  const { v, got } = run({}, () => ({ ok: false, status: 400, text: async () => 'event: error\ndata: {"error":{"message":"No matching speaker voice found for name: Nope","code":"invalid_request"},"event_type":"error"}\n\n' }));
  v.say('Hi.'); v.say('Again.'); await tick();
  assert.equal(got.errors.length, 1, 'one failure is reported once');
  assert.match(got.errors[0].message, /No matching speaker voice/);
  assert.equal(got.errors[0].status, 400); assert.equal(got.errors[0].heard, false); assert.equal(got.ended, 0);
}
{ // Too many requests.
  const { v, got } = run({}, () => ({ ok: false, status: 429, text: async () => '{}' }));
  v.say('Hi.'); await tick();
  assert.match(got.errors[0].message, /rate limiting/); assert.equal(got.errors[0].status, 429);
}
{ // An error in the middle of the stream, after some audio: heard says so.
  const { v, got, calls } = run();
  v.say('Hi.'); await tick();
  calls[0].body.push(audio([1, 2]) + 'event: error\ndata: {"error":{"message":"overloaded"},"event_type":"error"}\n\n'); await tick();
  assert.match(got.errors[0].message, /overloaded/); assert.equal(got.errors[0].heard, true);
}
{ // A reply that ends without any audio is a failure, not a silent success.
  const { v, got, calls } = run();
  v.say('Hi.'); v.end(); await tick();
  calls[0].body.push(DONE); calls[0].body.close(); await tick();
  assert.match(got.errors[0].message, /no audio/); assert.equal(got.ended, 0);
}
{ // Nothing arriving: gives up after the timeout.
  const { v, got } = run({ audioTimeout: 20 });
  v.say('Hi.'); await tick(60);
  assert.match(got.errors[0].message, /stopped sending audio/); assert.equal(got.errors[0].heard, false);
}
{ // The network failing.
  const { v, got } = run({}, () => { throw new Error('offline'); });
  v.say('Hi.'); await tick();
  assert.equal(got.errors[0].message, 'offline');
}

// The key check: a bad key is a 400 from Google, anything else that fails is the network. Never throws.
const fake = (status) => async (url, init) => { fake.last = { url, init }; return { status, ok: status >= 200 && status < 300 }; };
assert.deepEqual(await geminiAccount('k', { fetchImpl: fake(200) }), { ok: true, credit: null });
assert.equal(fake.last.url, `${GEMINI_API}/models?pageSize=1`);
assert.equal(fake.last.init.headers['x-goog-api-key'], 'k');
for (const s of [400, 401, 403]) assert.deepEqual(await geminiAccount('k', { fetchImpl: fake(s) }), { ok: false, reason: 'key' });
assert.deepEqual(await geminiAccount('k', { fetchImpl: fake(503) }), { ok: false, reason: 'network' });
assert.deepEqual(await geminiAccount('k', { fetchImpl: async () => { throw new Error('offline'); } }), { ok: false, reason: 'network' });

// Each look has its own Gemini voice, one of Gemini's, and no two looks share one.
assert.deepEqual(Object.keys(GEMINI_LOOK_VOICES), ['classic', 'jarvis', 'glayos', 'ultren', 'anime', 'sarah', 'adrian', 'rita'], 'the same looks as sidekick.mjs LOOKS');
for (const v of Object.values(GEMINI_LOOK_VOICES)) assert.ok(GEMINI_VOICES.some((x) => x.id === v), `${v} is a Gemini voice`);
assert.equal(new Set(Object.values(GEMINI_LOOK_VOICES)).size, 8);
console.log('gemini tests passed');
