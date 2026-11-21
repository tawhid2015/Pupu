// The built-in voice's shipped assets: the five voice clips the user supplied and the Bangla fine-tune.
// A 4-bit Bangla T3 spoke gibberish (confirmed against the model author's own sample); 8-bit is the smallest
// quantisation that still says Bengali words. Keep this test so a future "shrink the model" change cannot regress it.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const voice = (p) => new URL(`../voice/chatterbox/${p}`, import.meta.url);

const bnConfig = JSON.parse(fs.readFileSync(voice('models/chatterbox-bangla/config.json'), 'utf8'));
assert.equal(bnConfig.quantization?.bits, 8, 'the Bangla T3 must be 8-bit: 4-bit made it unintelligible');
assert.equal(bnConfig.t3_config?.text_tokens_dict_size, 2530, 'the fine-tune keeps its extended Bengali vocabulary');
assert.equal(bnConfig.multilingual, false, 'the Bangla fine-tune extends the English tokenizer; it has no language token');
const bnTokenizer = fs.readFileSync(voice('models/chatterbox-bangla/tokenizer.json'), 'utf8');
assert.match(bnTokenizer, /[অ-হ]/, 'the Bangla tokenizer really contains Bengali letters');

// 16-bit mono 24 kHz PCM. The references are 11 s slices (6.5 s for the short anime take) of the supplied clips.
const names = JSON.parse(fs.readFileSync(voice('voices/voices.json'), 'utf8'));
for (const id of ['anime', 'anime-clip', 'jarvis', 'madara', 'ultron', 'bengali']) {
  assert.ok(names[id], `${id} is named for the Speaking page`);
  const wav = fs.readFileSync(voice(`voices/${id}.wav`));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF', `${id}: a WAV file`);
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE', `${id}: a WAV file`);
  const secs = (wav.length - 44) / 2 / 24000;
  assert.ok(secs > 5 && secs < 20, `${id}: a short, clean reference clip (${secs.toFixed(1)} s)`);
  // A silent or all-zero clip would still have a valid header but no voice for Chatterbox to clone.
  let loud = 0;
  for (let i = 44; i < wav.length - 1; i += 200) if (Math.abs(wav.readInt16LE(i)) > 500) loud++;
  assert.ok(loud > 20, `${id}: the clip contains speech, not silence`);
}

console.log('built-in voice assets: passed');
