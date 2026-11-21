// Accurate Bangla dictation on Apple Silicon. The Bengali-tuned Whisper Medium runs through the Python/MLX runtime the
// app already ships for its built-in voice (tuxboy/bengali-whisper-medium-mlx-8bit, Apache-2.0; LICENSE and the source
// model card are downloaded with the weights). It writes Bengali script directly and is far more accurate than the
// small transducer kept for Intel Macs. The WAV still comes from the voice helper and is deleted after decoding.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SAFE, checkFetch } from './safety.mjs';
import { downloadModel, isReady, modelDir, sizeLabel } from './voicemodel.mjs';
import { fail } from './bangla-take.mjs';
import { ENGINE_DIR, enginePython } from './chatterbox.mjs';

// Pinned commit. Hashes are the LFS object IDs published in the repo's SHA256SUMS.json; the small text files were
// hashed from the raw copies. About 818 MB once, downloaded and verified by voicemodel.mjs.
export const MODEL = {
  id: 'bangla-whisper-medium-mlx-8bit',
  base: 'https://huggingface.co/tuxboy/bengali-whisper-medium-mlx-8bit/resolve/a9714dfdadd342cb13cd8b0802546ea3a14501c2/',
  files: [
    { name: 'model.safetensors', size: 814432484, sha256: '31abeff0dda2877027b315a5d6b7b50e10692821dbb61f44714996208f1f2c00' },
    { name: 'config.json', size: 330, sha256: '362df5f5171df3bedbaf96e39a15f9c9b05549cc6779307a46bc57e2dfa98ffd' },
    { name: 'preprocessor_config.json', size: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
    { name: 'generation_config.json', size: 223, sha256: 'c6d95fc6d350280e9e5e40b6410dbb81ea46094f601a34f4a318300ea2e00a59' },
    { name: 'tokenizer.json', size: 1763578, sha256: '54accbae1f0b1f80cbd0added8742cbb702f4f52e718176e463ecec6b754b102' },
    { name: 'tokenizer_config.json', size: 20433, sha256: 'b40d57e80983087b1695095c93f680d8826a0982335434d4946d1eb4d106a425' },
    { name: 'special_tokens_map.json', size: 2190, sha256: '4679897a50cc1aea98b7d63b8c928b407f252683d3248add11d091e66cf0d5f1' },
    { name: 'added_tokens.json', size: 2082, sha256: 'ce949fe720c14311cb6c446e69cfe340dc669d7b006077a6feed6ae571dd7e88' },
    { name: 'vocab.json', size: 978016, sha256: '2372434fea54a0a493ea4e83a926161a50cba4538b4d60e32bba68cf773236cc' },
    { name: 'merges.txt', size: 255290, sha256: '610288a047d8f33dd7da34767ac649c54b7171986480723a95f35f200c7acdfd' },
    { name: 'normalizer.json', size: 52666, sha256: 'bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd' },
    { name: 'LICENSE', size: 11358, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
    { name: 'SOURCE_MODEL_CARD.md', size: 2117, sha256: 'a5479c2e890dea42a9fd1fa52b3137428256c869fb0b7e8c977a47e4c6e8c36b' },
    { name: 'export-provenance.json', size: 399, sha256: '87a3e8e817a3ca0f9bec8d1f4f877f42feaa71321ee57a6cd52b54694d568717' },
  ],
};

export const DIR = modelDir(MODEL);
export const size = () => sizeLabel(MODEL);
export const ready = () => isReady(DIR, MODEL);
export const HELPER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'voice', 'bangla-asr');
export const HELPER_SCRIPT = path.join(HELPER_DIR, 'server.py');
const run = promisify(execFile);

/** Can this build actually run the MLX model? The Python runtime and packages ship with the built-in voice. */
export function available() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return false;
  try { return !!enginePython() && !!HELPER_SCRIPT; }
  catch { return false; }
}

/** The app's URL rule, applied to every model request instead of raw fetch. */
async function safeFetch(url, opts) {
  const verdict = await checkFetch(url);
  if (verdict.level !== SAFE) throw fail('network', String(verdict.reason ?? 'Model URL blocked.'));
  return fetch(url, opts);
}

function pythonEnv() {
  const py = enginePython();
  if (!py) throw fail('asr_runtime', 'The bundled speech runtime is missing.');
  const packages = path.join(ENGINE_DIR, 'site-packages');
  return {
    py,
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'UTF-8',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONPATH: [HELPER_DIR, packages, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      HF_HUB_OFFLINE: '1',
      PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    },
  };
}

function parse(out) {
  const lines = String(out ?? '').trim().split(/\r?\n/).filter(Boolean);
  const last = lines.at(-1);
  if (!last) throw fail('asr_runtime', 'The Bangla recognizer returned no result.');
  let msg;
  try { msg = JSON.parse(last); }
  catch { throw fail('asr_runtime', `The Bangla recognizer returned an unreadable result: ${last.slice(0, 160)}`); }
  if (!msg?.ok) throw fail('asr_runtime', String(msg?.error ?? 'Bangla transcription failed.').slice(0, 300));
  return msg;
}

async function invoke(args, timeout = 180_000) {
  const { py, env } = pythonEnv();
  try {
    const { stdout } = await run(py, [HELPER_SCRIPT, '--model', DIR, ...args], { env, timeout, maxBuffer: 2 * 1024 * 1024 });
    return parse(stdout);
  } catch (e) {
    if (e?.code === 'asr_runtime') throw e;
    // A killed or crashed helper must not leave a half-written transcript behind.
    throw fail('asr_runtime', String(e?.stderr || e?.message || e).slice(-300));
  }
}

/** Download and verify the model, then load it once so the first dictation doesn't pay startup cost. */
export async function prepare({ onProgress = () => {}, signal } = {}) {
  if (!available()) throw fail('asr_runtime', 'This Mac cannot run the Bangla Whisper model.');
  if (!ready()) await downloadModel(DIR, { model: MODEL, onProgress, signal, fetchImpl: safeFetch });
  await invoke(['--check']);
}

/** Decode one take. The caller deletes the WAV once, after any fallback has had its chance. */
export async function decodeTake(file) {
  if (!ready()) throw fail('model_missing', 'Bangla listening model is not ready.');
  const msg = await invoke(['--wav', file]);
  const text = String(msg.text ?? '').trim();
  if (!text) throw fail('audio', 'The Bangla recognizer heard no words.');
  return { text, lang: msg.lang || 'bn' };
}
