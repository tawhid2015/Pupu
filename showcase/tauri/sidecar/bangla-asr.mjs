// One Bangla dictation entry point for the sidecar. Apple Silicon uses the Bengali-tuned Whisper Medium through the
// bundled MLX runtime; other Macs keep the small Zipformer. Both write Bengali script straight to the clipboard, and
// Apple's transcript is only the fallback if neither model has words. The old model stays usable while a new one is
// downloading, then is removed so a machine doesn't carry two sets of weights.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as mlx from './bangla-mlx.mjs';
import * as zipformer from './bangla-zipformer.mjs';
import { TAKE_DIR, fail, removeTake, safeTakeFile } from './bangla-take.mjs';

export { TAKE_DIR, safeTakeFile, removeTake, fail };
export { recognizerConfig } from './bangla-zipformer.mjs';
export const MLX_MODEL = mlx.MODEL;
export const ZIPFORMER_MODEL = zipformer.MODEL;

// Intel has no MLX. If the bundled runtime is missing from an Apple-silicon build, the small model still works.
const useMlx = mlx.available();
const active = useMlx ? mlx : zipformer;
const fallback = useMlx && zipformer.ready() ? zipformer : null;

export const ENGINE = useMlx ? 'mlx-whisper' : 'zipformer';
export const MODEL = active.MODEL;
export const DIR = active.DIR;
export const size = active.size;
export const ready = active.ready;
export const wantsBanglaAsr = (speechLang) => speechLang === 'auto' || String(speechLang ?? '').startsWith('bn');

const oldModelDirs = () => [
  path.join(path.dirname(mlx.DIR), 'bangla-zipformer-onnx-int8'),
  path.join(path.dirname(mlx.DIR), 'sherpa-whisper-small-bn-int8'),
];

/** Once the accurate model is in place, the earlier experiments are only dead weight. */
async function cleanupOldModel() {
  if (!useMlx || !mlx.ready()) return;
  await Promise.all(oldModelDirs().map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => {})));
}

/** Download and verify the model, then load it so the next take isn't slow. */
export async function prepareBanglaAsr(options = {}) {
  await active.prepare(options);
  await cleanupOldModel();
}

/** Decode one held-key take. Any fallback runs before the caller's single cleanup deletes the WAV. */
export async function transcribeTake(file, options = {}) {
  const p = safeTakeFile(file);
  try {
    if (active.ready()) {
      try {
        const got = await active.decodeTake(p, options);
        await cleanupOldModel();
        return got;
      } catch (e) {
        if (!fallback?.ready()) throw e;
        // The accurate model was present but failed: the small one can still rescue this take.
      }
    }
    if (fallback?.ready()) return await fallback.decodeTake(p, options);
    throw fail('model_missing', 'Bangla listening model is not ready.');
  } finally {
    await removeTake(p).catch(() => {});
  }
}
