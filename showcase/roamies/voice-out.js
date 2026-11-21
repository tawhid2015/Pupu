// Plays spoken replies: 16-bit mono PCM chunks from the brain (Fish Audio), scheduled back to back so a
// reply plays without gaps or clicks. A new reply's id replaces the old one at once; "stop" fades out fast.
// level() is the live loudness, for the body to move with the voice.
(() => {
  const R = window.Roamie;
  const LEAD = 0.12; // cushion for a chunk that arrived just after the previous one finished
  // Linux (WebKitGTK, #80): a chunk that comes just after the audio ran out (a stream in bursts, or an audio clock
  // running ahead over Bluetooth) restarts it behind a cushion that doubles each time, so the rest join up. Longer
  // pauses (a tool running) don't count; it eases back after a reply with none late. Elsewhere it stays LEAD.
  const ADAPT = !!window.ROAMIE_LINUX, MAX_LEAD = 1, JITTER = 0.5;
  let lead = LEAD, late = false;
  let ac = null, out = null, meter = null, buf = null, id = null, endAt = 0, live = [], lv = 0;
  // How fast the voice talks (characters a second), learned from each whole reply: its audio length against how much
  // text it said. Drawings pace their marks to it (ink.js).
  let rate = 15, secs = 0;
  // Replies that are over: their end arrived, or they were stopped or replaced (auto-listen waits for this).
  const over = new Set();
  // The feelings in a reply (speech.mjs cueFeel): [where it starts in characters, feeling], from the brain ahead of the
  // audio. Placed in time by how much of the reply has played (pauses for tools don't count) and how fast it talks.
  const feels = new Map();
  let sched = []; // the reply's chunks: [start, duration]
  const isOver = (x) => { over.add(x); if (over.size > 20) over.delete(over.values().next().value); };

  const ctx = () => {
    if (!ac) {
      // Fish sends 44.1 kHz; a context at the same rate avoids resampling every chunk (older WebKit can't set it).
      // Gemini's 24 kHz chunks say their own rate and are resampled as they play.
      try { ac = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' }); } catch { ac = new AudioContext({ latencyHint: 'interactive' }); }
      out = ac.createGain();
      meter = ac.createAnalyser(); meter.fftSize = 512; buf = new Float32Array(meter.fftSize);
      out.connect(meter); meter.connect(ac.destination);
    }
    if (ac.state !== 'running') ac.resume().catch(() => {});
    return ac;
  };

  const pcm = (b64, rate) => {
    const raw = atob(b64), n = raw.length >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; f[i] = v / 32768; }
    const b = ac.createBuffer(1, Math.max(1, n), rate);
    b.getChannelData(0).set(f);
    return b;
  };

  const stop = () => {
    if (id) isOver(id);
    id = null; endAt = 0;
    if (!ac || !live.length) return;
    const t = ac.currentTime, old = live; live = [];
    out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 0.04);
    for (const s of old) { try { s.stop(t + 0.05); } catch { /* not started */ } }
  };

  const play = (m) => {
    const a = ctx();
    if (m.id !== id) { stop(); id = m.id; secs = 0; sched = []; if (!late) lead = Math.max(LEAD, lead * 0.75); late = false; }
    const b = pcm(m.pcm, m.rate || 44100), s = a.createBufferSource();
    s.buffer = b; s.connect(out);
    const now = a.currentTime;
    // A new reply fades in over 30 ms (a replaced reply's tail never plays at full level).
    if (!live.length) { out.gain.cancelScheduledValues(now); out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(1, now + 0.03); }
    const gap = endAt ? now - endAt : 0; // > 0: what was queued has already played out
    // The first chunk starts now. Later ones join the end of what's playing when they arrive in time; only a chunk
    // that's actually late gets a cushion (grown on Linux for bursty streams). An early chunk is never pushed back:
    // doing that used to put a gap between chunks that were ready before the previous one had finished.
    let at;
    if (!endAt || gap >= JITTER) at = now; // a new reply, or a long pause: nothing is queued to join up with
    else if (gap <= 1e-6) at = endAt; // a hair of clock jitter still counts as on time
    else {
      let cushion = LEAD;
      if (ADAPT) { late = true; lead = Math.min(MAX_LEAD, lead * 2); cushion = lead; }
      at = now + cushion;
    }
    s.start(at); endAt = at + b.duration; secs += b.duration; sched.push([at, b.duration]);
    live.push(s);
    s.onended = () => { live = live.filter((x) => x !== s); };
  };

  R.voiceOut = {
    handle(m) {
      if (m.stop) return stop();
      if ('feel' in m) {
        if (!feels.has(m.id)) { feels.set(m.id, []); if (feels.size > 8) feels.delete(feels.keys().next().value); }
        feels.get(m.id).push([m.at ?? 0, m.feel]);
        return;
      }
      if (m.end) { // the last chunk is already scheduled
        isOver(m.id);
        if (m.id === id && m.chars > 20 && secs > 1) rate = Math.min(30, Math.max(8, rate * 0.6 + (m.chars / secs) * 0.4));
        return;
      }
      if (m.pcm) play(m);
    },
    playing: () => !!ac && ac.state === 'running' && live.length > 0 && ac.currentTime < endAt + 0.05,
    cps: () => rate,
    // The feeling in what's being said right now (null: none, or nothing playing).
    feel() {
      const list = feels.get(id);
      if (!list || !this.playing()) return null;
      const t = ac.currentTime;
      let played = 0;
      for (const [s, d] of sched) { if (t <= s) break; played += Math.min(d, t - s); }
      const at = played * rate;
      let f = null;
      for (const [c, x] of list) { if (c > at) break; f = x; }
      return f;
    },
    lead: () => lead,
    // That reply has nothing left to play: its end arrived (or it was stopped), and nothing is still sounding.
    finished(rid) { return !this.playing() && (!rid || over.has(rid)); },
    // Smoothed RMS, roughly 0 (quiet) to 1 (loud speech).
    level() {
      if (!this.playing()) return (lv = 0);
      meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const v = Math.min(1, Math.sqrt(sum / buf.length) * 4);
      return (lv += (v - lv) * (v > lv ? 0.5 : 0.15));
    },
    // The voice itself as it plays: the analyser's latest window of samples (-1..1), or null when silent. Shared
    // buffer, read it before the next call. For drawing a true waveform of what's being said (notch.js).
    samples() {
      if (!this.playing()) return null;
      meter.getFloatTimeDomainData(buf);
      return buf;
    },
    stop,
    // Make the audio context ahead of the first reply (host.js calls it when a request starts), so the first
    // chunk doesn't pay for creating it.
    warm() { try { ctx(); } catch { /* no audio */ } },
  };
})();
