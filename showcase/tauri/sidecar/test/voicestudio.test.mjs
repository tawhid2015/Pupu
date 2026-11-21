import assert from 'node:assert/strict';
import http from 'node:http';
import { StudioVoice, studioStatus, studioUrl, plain, STUDIO_DEFAULT_URL, SENTENCE_TIMEOUT, FIRST_SENTENCE_TIMEOUT } from '../voicestudio.mjs';

// Status: a stand-in for VoiceStudio's HTTP API on a random loopback port; `mode` changes how it answers.
const api = { mode: 'ready' };
const server = http.createServer((req, res) => {
  const json = (status, o, vs = true) => { res.writeHead(status, { 'Content-Type': 'application/json', ...(vs ? { 'x-omnivoice-backend': '0.5.7' } : {}) }); res.end(JSON.stringify(o)); };
  if (req.url === '/health') {
    if (api.mode === 'other') return json(200, { status: 'ok' }, false);
    if (api.mode === 'starting') return json(503, { status: 'starting', step: 'models' });
    return json(200, { status: 'ok', device: 'mps', version: '0.5.7' });
  }
  if (req.url === '/engines/tts') {
    return json(200, { active: 'omnivoice', active_model: 'k2-fsa/OmniVoice', backends: [{ id: 'omnivoice', display_name: 'VoiceStudio (k2-fsa/OmniVoice, 600+ languages)', available: api.mode !== 'engine', reason: api.mode === 'engine' ? 'not installed' : null }, { id: 'kittentts', available: true }] });
  }
  if (req.url === '/v1/audio/voices') {
    return json(200, { voices: [{ voice_id: 'alloy', name: 'Alloy', type: 'openai_alias' }, { voice_id: 'a642d572', name: 'Ben', type: 'profile' }, { voice_id: 'fa08aff1', name: 'British · Female', type: 'profile' }] });
  }
  json(404, {});
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

{ // The address: loopback only, the default otherwise.
  assert.equal(studioUrl({}), STUDIO_DEFAULT_URL);
  assert.equal(studioUrl({ ROAMIES_VOICESTUDIO_URL: 'http://localhost:4900/x' }), 'http://localhost:4900');
  assert.equal(studioUrl({ ROAMIES_VOICESTUDIO_URL: 'http://example.com:3900' }), STUDIO_DEFAULT_URL, 'never a remote host');
}
{ // Fish voice cues are taken out: VoiceStudio's engines would read them aloud.
  assert.equal(plain('[warm] Hi there. [chuckling] Heh.'), 'Hi there. Heh.');
}
{ // Ready: its engine (short name) and only the saved voices, not the OpenAI-style aliases.
  api.mode = 'ready';
  const s = await studioStatus({ base });
  assert.equal(s.ok, true); assert.equal(s.engine, 'omnivoice'); assert.equal(s.engineName, 'OmniVoice', 'the model, not the app name again');
  assert.deepEqual(s.voices, [{ id: 'a642d572', name: 'Ben' }, { id: 'fa08aff1', name: 'British · Female' }]);
}
{ // Each way it can't be used has its own reason and a message that says what to do.
  api.mode = 'starting'; assert.equal((await studioStatus({ base })).reason, 'starting');
  api.mode = 'engine'; const e = await studioStatus({ base }); assert.equal(e.reason, 'engine'); assert.match(e.message, /not installed/);
  api.mode = 'other'; assert.equal((await studioStatus({ base })).reason, 'other', 'something else on the port is not VoiceStudio');
  const off = await studioStatus({ base: 'http://127.0.0.1:1' });
  assert.equal(off.reason, 'offline'); assert.match(off.message, /Run VoiceStudio first/);
  api.mode = 'ready';
}
server.close();

// The voice: a fake socket the test plays VoiceStudio's side of.
class FakeWS {
  static last;
  constructor(url) { this.url = url; this.sent = []; FakeWS.last = this; }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  json(m) { this.onmessage?.({ data: JSON.stringify(m) }); }
  bin(bytes) { this.onmessage?.({ data: new Uint8Array(bytes).buffer }); }
}
const run = (opts = {}) => {
  const got = { audio: [], rates: [], ended: 0, errors: [] };
  const v = new StudioVoice({ base: 'http://127.0.0.1:3900', voice: 'fa08aff1', WebSocketImpl: FakeWS, onAudio: (a, r) => { got.audio.push([...a]); got.rates.push(r); }, onEnd: () => got.ended++, onError: (e) => got.errors.push(e), ...opts });
  return { v, got };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

{ // Opened early; sentences are sent one at a time on the one socket, each after the last is done; whole samples out.
  const { v, got } = run();
  v.open();
  const ws = FakeWS.last;
  assert.equal(ws.url, 'ws://127.0.0.1:3900/ws/tts');
  v.say('[warm] One.'); v.say('Two.'); v.end();
  assert.equal(ws.sent.length, 0, 'nothing sent before it opens');
  ws.open();
  assert.deepEqual(ws.sent, [{ text: 'One.', voice: 'fa08aff1' }], 'only the first sentence until it is done');
  ws.json({ type: 'start', sample_rate: 24000, channels: 1, format: 'pcm16' });
  ws.bin([1, 0, 2]); ws.bin([0, 3, 0]); // a sample split across chunks is put back together
  ws.json({ type: 'done' });
  assert.deepEqual(ws.sent[1], { text: 'Two.', voice: 'fa08aff1' });
  ws.json({ type: 'start', sample_rate: 22050 });
  ws.bin([4, 0]);
  ws.json({ type: 'done' });
  assert.deepEqual(got.audio, [[1, 0], [2, 0, 3, 0], [4, 0]]);
  assert.deepEqual(got.rates, [24000, 24000, 22050], 'the rate VoiceStudio says, per sentence');
  assert.equal(got.ended, 1); assert.ok(ws.closed); assert.equal(got.errors.length, 0);
}
{ // No voice picked: the engine's default (no voice field).
  const { v } = run({ voice: null });
  v.open(); FakeWS.last.open(); v.say('Hi.');
  assert.deepEqual(FakeWS.last.sent, [{ text: 'Hi.' }]);
  v.abort(); // its sentence timer would hold the process open
}
{ // Not running: an "offline" error before any audio.
  const { v, got } = run();
  v.open(); v.say('Hi.');
  FakeWS.last.onerror?.(); 
  assert.equal(got.errors[0].reason, 'offline'); assert.equal(got.errors[0].heard, false); assert.match(got.errors[0].message, /Run VoiceStudio first/);
}
{ // Refused while starting up (close code 1008): "starting".
  const { v, got } = run();
  v.open(); FakeWS.last.onclose?.({ code: 1008 });
  assert.equal(got.errors[0].reason, 'starting');
}
{ // VoiceStudio reports an error for a sentence: the reply's voice ends with it, detail included.
  const { v, got } = run();
  v.open(); FakeWS.last.open(); v.say('Hi.');
  FakeWS.last.json({ type: 'error', detail: 'GPU out of memory' });
  assert.equal(got.errors[0].reason, 'error'); assert.match(got.errors[0].message, /GPU out of memory/);
}
{ // Stop: the socket closes, nothing more plays, it isn't an error, and the next sentence is never sent.
  const { v, got } = run();
  v.open(); const ws = FakeWS.last; ws.open();
  v.say('Long.'); v.say('Never sent.'); v.end();
  ws.json({ type: 'start', sample_rate: 24000 }); ws.bin([1, 0]);
  v.abort();
  assert.ok(ws.closed);
  ws.bin([9, 0]); ws.json({ type: 'done' }); ws.onclose?.({ code: 1000 });
  assert.deepEqual(got.audio, [[1, 0]]); assert.equal(ws.sent.length, 1); assert.equal(got.ended, 0); assert.equal(got.errors.length, 0);
}
{ // Silence for too long mid-sentence: a timeout, not a hang.
  const { v, got } = run({ sentenceTimeout: 20, firstSentenceTimeout: 20 });
  v.open(); FakeWS.last.open(); v.say('Hi.');
  await sleep(40);
  assert.equal(got.errors[0]?.reason, 'timeout');
}
{ // end() with nothing said: ends at once, no socket needed.
  const { v, got } = run(); v.end(); assert.equal(got.ended, 1);
}
{ // The first sentence of a socket may be a cold start: it gets the longer limit, later sentences the normal one.
  assert.equal(SENTENCE_TIMEOUT, 90_000); assert.equal(FIRST_SENTENCE_TIMEOUT, 150_000);
  const { v, got } = run({ sentenceTimeout: 20, firstSentenceTimeout: 60 });
  v.open(); const ws = FakeWS.last; ws.open(); v.say('One.'); v.say('Two.'); v.end();
  await sleep(40);
  assert.equal(got.errors.length, 0, 'the first sentence waits longer than the later ones');
  ws.json({ type: 'done' });
  assert.deepEqual(ws.sent[1], { text: 'Two.', voice: 'fa08aff1' });
  await sleep(40);
  assert.equal(got.errors[0]?.reason, 'timeout', 'a later sentence keeps the shorter limit');
}
{ // Defaults: 150 s for a socket's first sentence, 90 s after it.
  const { v } = run();
  v.open(); FakeWS.last.open(); v.say('Hi.');
  assert.equal(v.limit, 150_000);
  FakeWS.last.json({ type: 'done' }); v.say('Again.');
  assert.equal(v.limit, 90_000);
  v.abort();
}
console.log('voicestudio tests: passed');
