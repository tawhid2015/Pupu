// Spoken replies' playback (showcase/roamies/voice-out.js): on Linux, chunks that come just late grow the cushion
// (#80); elsewhere scheduling is unchanged. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
const src = fs.readFileSync(new URL('../../../roamies/voice-out.js', import.meta.url), 'utf8');
const chunk = Buffer.alloc(4410 * 2).toString('base64'); // 0.1 s at 44.1 kHz
// A player with its own clock; starts: when each chunk was scheduled to play.
function player(linux) {
  const clock = { t: 0 }, starts = [];
  class AudioContext {
    constructor() { this.state = 'running'; this.destination = {}; }
    get currentTime() { return clock.t; }
    resume() {}
    createGain() { return { gain: { value: 1, cancelScheduledValues: noop, setValueAtTime: noop, linearRampToValueAtTime: noop }, connect: noop }; }
    createAnalyser() { return { connect: noop, getFloatTimeDomainData: noop }; }
    createBuffer(_c, n, rate) { return { duration: n / rate, getChannelData: () => new Float32Array(n) }; }
    createBufferSource() { return { connect: noop, stop: noop, start(at) { starts.push({ at, d: this.buffer.duration }); } }; }
  }
  const window = { Roamie: {}, ...(linux ? { ROAMIE_LINUX: 'x11' } : {}) };
  vm.runInNewContext(src, { window, AudioContext, Float32Array, Math, Set, atob: (s) => Buffer.from(s, 'base64').toString('latin1') });
  const out = window.Roamie.voiceOut;
  const at = (t, id) => { clock.t = t; out.handle({ id, rate: 44100, pcm: chunk }); return starts.at(-1).at - t; };
  // Silence between chunks, from the nth one on.
  const gaps = (from) => { let g = 0; for (let i = from + 1; i < starts.length; i++) g += Math.max(0, starts[i].at - (starts[i - 1].at + starts[i - 1].d)); return g; };
  return { out, at, gaps, starts };
}
const bursty = (p, id, t0) => { for (let i = 0; i < 40; i++) p.at(t0 + i * 0.1 + (i % 2 ? 0.25 : 0), id); };

{ // On time, back to back: no gaps, and the cushion stays small.
  const p = player(true);
  for (let i = 0; i < 10; i++) p.at(i * 0.1, 'a');
  assert.ok(p.gaps(0) < 1e-9); assert.equal(p.out.lead(), 0.12);
}
{ // Linux, in bursts (real time on average, every other chunk 0.25 s late): the cushion grows, so most of it joins up.
  const p = player(true);
  bursty(p, 'b', 0);
  assert.ok(p.gaps(0) < 0.8, `bursty stream: ${p.gaps(0).toFixed(2)} s of gaps in 4 s`); // a fixed 0.12 s cushion leaves ~7 s
  assert.ok(p.out.lead() > 0.12 && p.out.lead() <= 1);
  // A new reply's first chunk starts at once; a long pause (a tool running) doesn't grow the lead.
  const grown = p.out.lead();
  assert.ok(Math.abs(p.at(20, 'c') - 0) < 1e-9, 'first chunk starts now');
  assert.ok(Math.abs(p.at(23, 'c') - 0) < 1e-9, 'after a long pause too');
  assert.equal(p.out.lead(), grown);
  // Replies with nothing late ease it back down.
  for (const [i, id] of ['d', 'e', 'f'].entries()) p.at(30 + i * 5, id);
  assert.ok(p.out.lead() < grown);
}
{ // Elsewhere: chunks that arrive early or on time join the previous one; a short late gap still gets the cushion.
  const p = player(false);
  const first = p.at(0, 'b');
  assert.ok(Math.abs(first) < 1e-9, 'first chunk starts now');
  const joined = p.at(0.1, 'b');
  assert.ok(Math.abs(joined) < 1e-9, 'an on-time chunk joins without a gap');
  const late = p.at(0.35, 'b'); // 0.15 s after the second chunk ended
  assert.ok(Math.abs(late - 0.12) < 1e-9, 'a late chunk keeps the small cushion');
  const early = p.at(0.4, 'b'); // arrives before the late one has finished
  assert.ok(Math.abs(early) > 0, 'an early chunk is scheduled at the end of playback');
  assert.equal(p.out.lead(), 0.12);
}
console.log('voiceout tests: passed');
