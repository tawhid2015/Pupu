// Offline Bangla listening: pinned model files, local-only downloads, one guarded take path, and the two local engines.
// The unit tests never download a model. Set ROAMIES_BN_ASR_TEST=1 and ROAMIES_BN_ASR_DIR=<downloaded model dir> to
// also decode the Bengali-script fixture through the model this Mac actually uses. Run: npm test
import assert from 'node:assert/strict';
import { existsSync, readFileSync, copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAFE, checkFetch } from '../safety.mjs';

const root = new URL('../', import.meta.url);
const source = (p) => readFileSync(new URL(p, root), 'utf8');
const facadeSrc = source('bangla-asr.mjs');
const mlxSrc = source('bangla-mlx.mjs');
const zipSrc = source('bangla-zipformer.mjs');
const pySrc = source('voice/bangla-asr/server.py');
const swiftSrc = source('../src-tauri/voice/main.swift');
const sideSrc = source('sidekick.mjs');

assert.match(mlxSrc, /checkFetch\(url\)/, 'every model request goes through the app URL safety rule');
assert.match(zipSrc, /checkFetch\(url\)/, 'the Intel fallback uses the same URL rule');

// A staged model for the real-audio test is exposed to the module as its data root before any import resolves paths.
const staged = process.env.ROAMIES_BN_ASR_DIR;
if (process.env.ROAMIES_BN_ASR_TEST === '1' && staged) {
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), 'roamies-bn-asr-test-'));
  process.env.ROAMIES_DATA_DIR = dataRoot;
  globalThis.__bnAsrDataRoot = dataRoot;
}
const { MODEL, ENGINE, MLX_MODEL, ZIPFORMER_MODEL, ready, size, transcribeTake, TAKE_DIR, safeTakeFile, removeTake } = await import('../bangla-asr.mjs');
const { HELPER_SCRIPT } = await import('../bangla-mlx.mjs');
const { recognizerConfig } = await import('../bangla-zipformer.mjs');

for (const model of [MLX_MODEL, ZIPFORMER_MODEL]) {
  for (const f of model.files) {
    const verdict = await checkFetch(model.base + f.name, { lookup: async () => [{ address: '104.16.0.1' }] });
    assert.equal(verdict.level, SAFE, `${model.id}/${f.name} is an allowed model download`);
  }
}

// Apple Silicon gets the accurate model; Intel keeps the small one. Both ship with their licence.
assert.equal(MLX_MODEL.id, 'bangla-whisper-medium-mlx-8bit');
assert.match(MLX_MODEL.base, /^https:\/\/huggingface\.co\/tuxboy\/bengali-whisper-medium-mlx-8bit\/resolve\/[0-9a-f]{40}\/$/);
assert.deepEqual(MLX_MODEL.files.map((f) => f.name), [
  'model.safetensors', 'config.json', 'preprocessor_config.json', 'generation_config.json', 'tokenizer.json',
  'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json', 'merges.txt',
  'normalizer.json', 'LICENSE', 'SOURCE_MODEL_CARD.md', 'export-provenance.json',
]);
assert.equal(MLX_MODEL.files[0].size, 814432484);
assert.equal(MLX_MODEL.files[0].sha256, '31abeff0dda2877027b315a5d6b7b50e10692821dbb61f44714996208f1f2c00');
assert.ok(MLX_MODEL.files.some((f) => f.name === 'LICENSE'));
assert.equal(ZIPFORMER_MODEL.id, 'bangla-zipformer-onnx-int8');
assert.equal(MODEL, ENGINE === 'mlx-whisper' ? MLX_MODEL : ZIPFORMER_MODEL);
assert.match(size(), /^\d+ MB$/);
assert.equal(typeof ready(), 'boolean');

// The old recognizer is still available as a fallback: its config and the take guard stay pinned.
const cfg = recognizerConfig('/models/bn', null);
assert.equal(cfg.modelConfig.transducer.encoder, path.join('/models/bn', 'int8', 'encoder.onnx'));
assert.equal(cfg.modelConfig.transducer.decoder, path.join('/models/bn', 'int8', 'decoder.onnx'));
assert.equal(cfg.modelConfig.transducer.joiner, path.join('/models/bn', 'int8', 'joiner.onnx'));
assert.equal(cfg.modelConfig.tokens, path.join('/models/bn', 'tokens.txt'));
assert.equal(cfg.modelConfig.whisper, undefined);
assert.equal(cfg.decodingMethod, 'modified_beam_search');
assert.match(facadeSrc, /fallback\?\.ready\(\)/, 'a ready small model rescues a failed accurate decode');
assert.match(facadeSrc, /removeTake\(p\)/, 'the take is deleted once, after any fallback');
assert.match(facadeSrc, /cleanupOldModel\(\)/, 'the old weights go away after the accurate model is ready');
assert.match(facadeSrc, /sherpa-whisper-small-bn-int8/, 'the earlier broken Whisper download is removed too');

// The bundled helper only reads the local take: forced Bengali transcription, no translation, no online fetch.
assert.ok(existsSync(HELPER_SCRIPT), 'the MLX helper ships with the app');
assert.match(pySrc, /language="bn"/);
assert.match(pySrc, /task="transcribe"/);
assert.match(pySrc, /condition_on_previous_text=False/);
assert.match(pySrc, /no_speech_threshold=None/);
assert.match(pySrc, /apply_tokenizer_fix\(model\)/, 'the tokenizer workaround for <|nocaptions|> stays applied');
assert.match(pySrc, /plan_chunks\(audio\)/, 'long takes are decoded in chunks instead of being truncated');
assert.match(pySrc, /rate != 16000 or channels != 1 or width != 2/, 'only the helper’s 16 kHz mono PCM takes are read');
assert.ok(!/requests\.|urllib\.request|huggingface_hub/.test(pySrc), 'the helper never reaches the network');

// An empty dictation toggle is not an error worth saying out loud.
assert.match(swiftSrc, /if empty, self\.takeMode != \.dictate/, 'dictation never emits a nothing-heard error');
assert.match(sideSrc, /m\.code === 'nothing_heard'.*logLine\('dictation_error'/, 'an empty dictation take is logged, not spoken');
assert.match(sideSrc, /hands\(\{ quiet: true \}, 'act'/, 'a dictation paste is a quiet helper act');
assert.match(sideSrc, /logLine\('dictation_paste'/, 'a failed paste is logged');
assert.match(sideSrc, /pasteProblem\(placed\.error\)/, 'a failed paste is explained instead of silently lost');

const good = path.join(TAKE_DIR, 'take-abc.wav');
assert.equal(safeTakeFile(good), good);
assert.throws(() => safeTakeFile('/tmp/other/take.wav'), /refused/);
assert.throws(() => safeTakeFile(path.join(TAKE_DIR, 'take.mp3')), /refused/);
assert.throws(() => safeTakeFile(path.join(TAKE_DIR, '..', 'take.wav')), /refused/);
await fs.mkdir(TAKE_DIR, { recursive: true });
const temp = path.join(TAKE_DIR, `take-test-${process.pid}.wav`);
await fs.writeFile(temp, 'test');
await removeTake(temp);
await assert.rejects(fs.access(temp), /ENOENT/);
await assert.rejects(removeTake('/tmp/elsewhere.wav'), /refused/);

// Real-audio regression: the model this Mac uses must write the spoken Bengali words, not empty or wrong text.
if (process.env.ROAMIES_BN_ASR_TEST === '1' && staged) {
  const mlxDir = existsSync(path.join(staged, 'model.safetensors'));
  const zipDir = existsSync(path.join(staged, 'int8', 'encoder.onnx'));
  const wanted = mlxDir ? MLX_MODEL : zipDir ? ZIPFORMER_MODEL : null;
  if (!wanted || wanted !== MODEL || !wanted.files.every((f) => existsSync(path.join(staged, f.name)))) {
    console.log(`Bangla ASR real-audio test skipped (stage a ${MODEL.id} model dir).`);
  } else if (ENGINE === 'mlx-whisper' && process.arch !== 'arm64') {
    console.log('Bangla ASR real-audio test skipped (MLX needs Apple Silicon).');
  } else {
    const dataRoot = globalThis.__bnAsrDataRoot;
    const target = path.join(dataRoot, 'Roamies', 'Data', 'models', wanted.id);
    await fs.mkdir(target, { recursive: true });
    for (const f of wanted.files) {
      const to = path.join(target, f.name);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.symlink(path.resolve(staged, f.name), to);
    }
    writeFileSync(path.join(target, 'ready.json'), JSON.stringify({ id: wanted.id, at: new Date().toISOString() }));
    const take = path.join(TAKE_DIR, `take-real-${process.pid}.wav`);
    copyFileSync(fileURLToPath(new URL('./fixtures/bn-sample.wav', import.meta.url)), take);
    const got = await transcribeTake(take);
    assert.match(got.text, /[\u0980-\u09FF]/, 'the transcript is in Bengali script');
    assert.match(got.text, /আমি/, 'the transcript contains the spoken word "আমি"');
    assert.match(got.text, /ভালো/, 'the transcript contains the spoken word "ভালো"');
    assert.match(got.text, /খবর/, 'the transcript contains the spoken word "খবর"');
    await assert.rejects(fs.access(take), /ENOENT/, 'the take is deleted after decoding');
    console.log(`Bangla ASR real-audio test (${ENGINE}): ${got.text}`);
  }
} else {
  console.log('Bangla ASR real-audio test skipped (set ROAMIES_BN_ASR_TEST=1 and ROAMIES_BN_ASR_DIR).');
}

console.log('Bangla ASR tests: passed');
