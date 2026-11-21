// Effort: how hard a model thinks before answering, set per model slot (the default model, each heavy job's model,
// each backup). Each model supports its own levels (getSupportedThinkingLevels); a slider offers Off plus those.
export const SLOTS = ['default', 'computer', 'code', 'agents', 'draw', 'web', 'backup1', 'backup2', 'sub_scout', 'sub_builder', 'sub_writer', 'sub_reviewer', 'sub_tidier'];
export const LADDER = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
/** A setting: '' (automatic), 'off' or a level. */
export const isSetting = (v) => v === '' || v === 'off' || LADDER.includes(v);

/**
 * The level to send for a slot's setting, given what the model supports: null for off (or a model that can't think),
 * the level itself when the model takes it, else the nearest one above it (or the highest it has). `fallback` is what
 * "automatic" means ('low', or null where the app default is off).
 */
export function resolveEffort(setting, supported, fallback = 'low') {
  if (setting === 'off' || !supported?.length) return null;
  const want = setting || fallback;
  if (!want) return null;
  if (supported.includes(want)) return want;
  const at = LADDER.indexOf(want);
  return supported.find((l) => LADDER.indexOf(l) >= at) ?? supported[supported.length - 1];
}
