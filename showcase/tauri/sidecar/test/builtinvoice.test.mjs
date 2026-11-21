// The built-in voice's scheduling: synthesis is pipelined (the next sentence is requested while the current one
// plays), but audio is still emitted in sentence order and at the rate the helper reports. Nothing here changes the
// samples. Run: npm test
import assert from 'node:assert/strict';
import { BuiltinVoice } from '../chatterbox.mjs';

const tick = () => new Promise((r) => setImmediate(r));
const answer = (text, rate = 24000) => ({
  arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  headers: { get: (k) => (k === 'x-sample-rate' ? String(rate) : null) },
});
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

{ // Two requests go out at once; a later answer never overtakes an earlier one, and a freed slot starts the next.
  const calls = [], replies = [deferred(), deferred(), deferred()];
  const out = [], errors = [];
  let ended = 0;
  const v = new BuiltinVoice({
    voice: 'bengali', lang: 'bn', maxInflight: 2,
    startImpl: async () => 1,
    postImpl: (_path, body) => { calls.push(body.text); return replies[calls.length - 1].p; },
    onAudio: (pcm, rate) => out.push([new TextDecoder().decode(pcm), rate]),
    onEnd: () => ended++,
    onError: (e) => errors.push(e),
  });
  v.open(); v.say('one'); v.say('two'); v.say('three'); v.end();
  await tick();
  assert.deepEqual(calls, ['one', 'two'], 'the second sentence is requested before the first is even ready');

  replies[1].resolve(answer('TWO', 24000));
  await tick();
  assert.deepEqual(out, [], 'an early second answer waits for the first');
  replies[0].resolve(answer('ONE', 24000));
  await tick();
  assert.deepEqual(out, [['ONE', 24000], ['TWO', 24000]], 'in order, with the helper\'s rate');
  assert.deepEqual(calls, ['one', 'two', 'three'], 'the third sentence starts as soon as a slot frees');
  assert.equal(ended, 0, 'not until every sentence has played');

  replies[2].resolve(answer('THREE', 24000));
  await tick();
  assert.deepEqual(out, [['ONE', 24000], ['TWO', 24000], ['THREE', 24000]]);
  assert.equal(ended, 1); assert.deepEqual(errors, []);
}
{ // No text: end() is still an immediate end, with no request.
  let ended = 0, calls = 0;
  const v = new BuiltinVoice({ startImpl: async () => 1, postImpl: () => { calls++; }, onEnd: () => ended++ });
  v.open(); v.end(); await tick();
  assert.equal(calls, 0); assert.equal(ended, 1);
}
{ // A failure before any audio is reported once, and later answers are dropped.
  const errors = [];
  const v = new BuiltinVoice({
    startImpl: async () => 1,
    postImpl: () => Promise.reject(new Error('engine stopped')),
    onError: (e) => errors.push(e),
  });
  v.open(); v.say('hello'); v.end(); await tick();
  assert.equal(errors.length, 1); assert.match(errors[0].message, /engine stopped/); assert.equal(errors[0].heard, false);
}
{ // Script routing: Bengali text routes to 'bn' and 'bengali' voice even when caller passed 'en'
  const calls = [];
  const v = new BuiltinVoice({
    voice: 'jarvis', lang: 'en',
    startImpl: async () => 1,
    postImpl: async (_path, body) => {
      calls.push(body);
      return answer('ok');
    },
  });
  v.open();
  v.say('হ্যালো তৌহিদ! আপনি কেমন আছেন?');
  v.say('হ্যাঁ, WhatsApp ওপেন করে আমাকে message করুন।');
  v.say('Hello from Jarvis, everything is ready.');
  v.end();
  await tick();
  assert.equal(calls.length, 3);
  assert.equal(calls[0].lang, 'bn');
  assert.equal(calls[0].voice, 'bengali');
  assert.equal(calls[1].lang, 'bn');
  assert.equal(calls[1].voice, 'bengali');
  assert.equal(calls[2].lang, 'en');
  assert.equal(calls[2].voice, 'jarvis');
}
{ // Default maxInflight is 3: three requests go out concurrently so pipeline stays buffered
  const calls = [], replies = [deferred(), deferred(), deferred(), deferred()];
  const out = [];
  const v = new BuiltinVoice({
    voice: 'bengali', lang: 'bn',
    startImpl: async () => 1,
    postImpl: (_path, body) => { calls.push(body.text); return replies[calls.length - 1].p; },
    onAudio: (pcm, rate) => out.push([new TextDecoder().decode(pcm), rate]),
  });
  v.open(); v.say('one'); v.say('two'); v.say('three'); v.say('four'); v.end();
  await tick();
  assert.deepEqual(calls, ['one', 'two', 'three'], 'three sentences are pipelined concurrently');
  replies[0].resolve(answer('ONE', 24000));
  await tick();
  assert.deepEqual(calls, ['one', 'two', 'three', 'four'], 'sentence four starts as soon as sentence one resolves');
}
console.log('built-in voice pipeline tests: passed');
