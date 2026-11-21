// The one place that guards the temporary WAV a held-key take leaves behind. Both Bangla recognizers use it, so a
// failed or fallback decode still deletes the file exactly once, and no path outside the helper's take folder is read.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export const fail = (code, message) => Object.assign(new Error(message), { code });

export const TAKE_DIR = path.join(os.tmpdir(), 'RoamiesVoice');

export function safeTakeFile(file) {
  const p = path.resolve(String(file ?? ''));
  const root = path.resolve(TAKE_DIR) + path.sep;
  if (!p.startsWith(root) || !/\.wav$/i.test(p)) throw fail('audio', 'Take audio path refused.');
  return p;
}

/** Delete one take through the same path check used for decoding (a refused path is never touched). */
export async function removeTake(file) {
  const p = safeTakeFile(file);
  try { await fs.unlink(p); }
  catch (e) { if (e?.code !== 'ENOENT') throw e; }
}
