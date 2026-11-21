// Fallback Bangla recognizer for Macs without MLX (Intel). This is a Bangla-only Zipformer transducer exported for
// sherpa-onnx (SayedShaun/bangla-zipformer-onnx, CC BY-SA 4.0; its LICENSE is downloaded with the model). It writes
// Bengali script directly, but its small model is less accurate than the Whisper Medium used on Apple Silicon.
import os from 'node:os';
import path from 'node:path';
import { SAFE, checkFetch } from './safety.mjs';
import { downloadModel, isReady, modelDir, sizeLabel } from './voicemodel.mjs';
import { fail } from './bangla-take.mjs';

// Pinned commit. The SHA-256s are the LFS object IDs from the repo (tokens.txt and LICENSE were hashed from the raw
// files). The int8 transducer is about 74 MB and is the recommended CPU build in the model card.
export const MODEL = {
  id: 'bangla-zipformer-onnx-int8',
  base: 'https://huggingface.co/SayedShaun/bangla-zipformer-onnx/resolve/d3698b7410692c27d99592235fca2bfa824d0940/',
  files: [
    { name: 'int8/encoder.onnx', size: 72828389, sha256: '43d5bdfc8e956c8137b8652fca347a4deb8ae6742cc0a2840db47c02a5c4cd4a' },
    { name: 'int8/decoder.onnx', size: 540689, sha256: 'a183a765346a050c8577dc947cb96e69beecb8a83a73ebef48ad0cdd387e18df' },
    { name: 'int8/joiner.onnx', size: 259417, sha256: 'bd9d5b3a02b0550fc09e55f222dce6ac72d38396b5c5087c462d67d0cb840fb4' },
    { name: 'tokens.txt', size: 6578, sha256: '8edb5b3ef2587207c86cc3966f3f729ec3845250d3b040e5ba916ce935fcae2b' },
    { name: 'LICENSE', size: 20138, sha256: '28a9529c7d0bb4dc51f4bf5c116a3d16ef247a052f7591466768ddf563fd1cf5' },
  ],
};

export const DIR = modelDir(MODEL);
export const size = () => sizeLabel(MODEL);
export const ready = () => isReady(DIR, MODEL);

/** The app's URL rule, applied to every model request instead of raw fetch. */
async function safeFetch(url, opts) {
  const verdict = await checkFetch(url);
  if (verdict.level !== SAFE) throw fail('network', String(verdict.reason ?? 'Model URL blocked.'));
  return fetch(url, opts);
}

let sherpaPromise;
function sherpaLib() {
  if (!sherpaPromise) sherpaPromise = import('sherpa-onnx-node').then((m) => m.default ?? m);
  return sherpaPromise;
}

/**
 * Recognizer config. The language argument is kept for callers that route by language, but this model only knows
 * Bengali; there is no Whisper language token and no `bpeVocab` (tokens.txt already carries the BPE scores).
 */
export function recognizerConfig(dir = DIR, _language = 'bn') {
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(dir, 'int8', 'encoder.onnx'),
        decoder: path.join(dir, 'int8', 'decoder.onnx'),
        joiner: path.join(dir, 'int8', 'joiner.onnx'),
      },
      tokens: path.join(dir, 'tokens.txt'),
      numThreads: Math.max(1, Math.min(4, (os.cpus()?.length || 2) - 1)),
    },
    decodingMethod: 'modified_beam_search',
    maxActivePaths: 4,
  };
}

let recognizerPromise;
async function recognizer(lib) {
  if (!recognizerPromise) {
    recognizerPromise = lib.OfflineRecognizer.createAsync(recognizerConfig(DIR)).catch((e) => {
      recognizerPromise = null;
      throw e;
    });
  }
  return recognizerPromise;
}

// The Zipformer was trained on 1-20 s utterances. Longer takes are decoded in order, in 15 s pieces, so the whole
// recording is still processed instead of being truncated by a single decoder call.
const CHUNK_SECONDS = 15;
async function decode(lib, rec, samples, sampleRate) {
  const chunk = Math.max(1, Math.floor(sampleRate * CHUNK_SECONDS));
  const parts = [];
  for (let start = 0; start < samples.length; start += chunk) {
    const wave = samples.subarray(start, Math.min(start + chunk, samples.length));
    if (!wave.length) continue;
    const stream = rec.createStream();
    stream.acceptWaveform({ samples: wave, sampleRate });
    const result = await rec.decodeAsync(stream);
    const text = String(result?.text ?? '').trim();
    if (text) parts.push(text);
  }
  return { text: parts.join(' ').trim(), lang: 'bn' };
}

/** Download and verify the model, then load it so the next take does not pay startup cost. */
export async function prepare({ onProgress = () => {}, signal } = {}) {
  if (!ready()) await downloadModel(DIR, { model: MODEL, onProgress, signal, fetchImpl: safeFetch });
  const lib = await sherpaLib();
  await recognizer(lib);
}

/** Decode one take. The caller deletes the WAV once, after any fallback has had its chance. */
export async function decodeTake(file) {
  if (!ready()) throw fail('model_missing', 'Bangla listening model is not ready.');
  const lib = await sherpaLib();
  const rec = await recognizer(lib);
  const wave = lib.readWave(file);
  if (!wave?.samples?.length) throw fail('audio', 'Take audio was empty.');
  return decode(lib, rec, wave.samples, wave.sampleRate || 16000);
}
