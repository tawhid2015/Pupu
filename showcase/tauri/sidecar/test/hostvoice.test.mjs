// Held-key replies must keep their spoken text on screen until the audio has actually played. Typed turns keep the
// old immediate close. Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const host = readFileSync(new URL('../../../roamies/host.js', import.meta.url), 'utf8');

assert.match(host, /let pendingTalkEnd = null;/, 'a deferred bubble close is tracked');
assert.match(host, /const byVoice = waveTurn && !!e\.speech;/, 'only a macOS voice-bar turn defers');
assert.match(host, /if \(byVoice && Roamie\.voiceOut && !Roamie\.voiceOut\.finished\(e\.speech\)\) endTalkWhenSaid\(e\.speech\);/,
  'the bubble waits for that reply\'s audio');
assert.match(host, /else \{ dropTalkEnd\(\); endTalk\(\); \}/, 'typed turns still close at once');
assert.match(host, /if \(!Roamie\.voiceOut\?\.finished\(rid\) && Date\.now\(\) - t0 < 30_000\) return;/,
  'a stalled reply cannot hold the bubble forever');

console.log('held-key bubble sync tests: passed');
