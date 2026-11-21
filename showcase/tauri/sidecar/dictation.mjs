// Clipboard-only dictation: a recorded key or shortcut starts a take, the next tap ends it, and the local
// recognizer's words go straight to the clipboard and the active text field. There is no chat turn and no TTS.
export const DICTATION_LANGS = ['auto', 'en', 'bn'];

export const dictationLang = (value) => {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'en' || s.startsWith('en-')) return 'en';
  if (s === 'bn' || s.startsWith('bn-')) return 'bn';
  return 'auto';
};

// The four one-click choices. Anything else can be recorded natively by the voice helper.
export const DICTATION_KEYS = [
  ['0x3D', 'Right Option (default)'],
  ['0x3A', 'Left Option'],
  ['0x36', 'Right Command'],
  ['0x37', 'Left Command'],
];
export const DICTATION_DEFAULT_CODE = 0x3D;
export const DICTATION_MODS = ['control', 'option', 'shift', 'command'];
const MOD_FLAG = { control: 1, option: 2, shift: 4, command: 8 };
const MOD_SYMBOL = { control: '⌃', option: '⌥', shift: '⇧', command: '⌘' };
const MOD_ORDER = ['control', 'option', 'shift', 'command'];

/** Any virtual key code is valid now; only out-of-range or unparsable values fall back to right Option. */
export const dictationKeyCode = (value) => {
  const raw = String(value ?? '').trim();
  const code = typeof value === 'number' ? value : /^0x/i.test(raw) ? parseInt(raw.slice(2), 16) : /^[0-9a-f]+$/i.test(raw) ? parseInt(raw, 16) : NaN;
  return Number.isInteger(code) && code >= 0 && code <= 0x7F ? code : DICTATION_DEFAULT_CODE;
};

export const dictationKeyId = (value) => `0x${dictationKeyCode(value).toString(16).toUpperCase().padStart(2, '0')}`;

export const dictationMods = (value) => {
  const names = Array.isArray(value) ? value : typeof value === 'string' ? value.split('+') : [];
  const lower = (s) => ({ ctrl: 'control', alt: 'option', cmd: 'command', super: 'command' })[String(s).toLowerCase()] ?? String(s).toLowerCase();
  return MOD_ORDER.filter((m) => names.some((n) => lower(n) === m));
};

/** A shortcut is { code, mods, name }, and may be saved as sttKey + sttMods + sttName for compatibility. */
export function dictationShortcut(config = {}) {
  const raw = config?.sttShortcut ?? config ?? {};
  const code = dictationKeyCode(raw.code ?? raw.sttKey ?? raw.key ?? config?.sttKey);
  const mods = dictationMods(raw.mods ?? raw.sttMods ?? config?.sttMods);
  const name = String(raw.name ?? raw.sttName ?? config?.sttName ?? '').slice(0, 80);
  return { code, mods, name, id: dictationShortcutId({ code, mods }) };
}

export function dictationShortcutId(s) {
  return [...dictationMods(s?.mods), `0x${dictationKeyCode(s?.code).toString(16).toUpperCase().padStart(2, '0')}`].join('+');
}

/** The four settings fields, always derived together from one shortcut: startup and saving use the same round trip. */
export function dictationSettings(config = {}) {
  const shortcut = dictationShortcut(config);
  return {
    sttKey: dictationKeyId(shortcut.code),
    sttMods: shortcut.mods,
    sttName: shortcut.name,
    sttShortcut: { code: shortcut.code, mods: shortcut.mods, name: shortcut.name },
  };
}

export function shortcutFlag(code) {
  const c = dictationKeyCode(code);
  if (c === 0x3B || c === 0x3E) return MOD_FLAG.control;
  if (c === 0x3A || c === 0x3D) return MOD_FLAG.option;
  if (c === 0x38 || c === 0x39) return MOD_FLAG.shift;
  if (c === 0x36 || c === 0x37) return MOD_FLAG.command;
  return 0;
}

export const isModifierKey = (code) => shortcutFlag(code) !== 0;

export function dictationKeyName(s) {
  const shortcut = dictationShortcut(s);
  if (shortcut.name) return shortcut.name;
  const preset = DICTATION_KEYS.find(([hex]) => dictationKeyCode(hex) === shortcut.code);
  return preset ? preset[1].replace(' (default)', '') : `Key ${dictationKeyId(shortcut.code)}`;
}

export function dictationShortcutLabel(s) {
  const shortcut = dictationShortcut(s);
  return shortcut.mods.map((m) => MOD_SYMBOL[m] ?? m).join('') + dictationKeyName(shortcut);
}

/** Known OS/app combos and this app's own shortcuts. System-wide conflicts we can't detect are left to the user. */
export function dictationConflict(shortcut, { talk = [], keybinds = [], write = [] } = {}) {
  const s = dictationShortcut(shortcut);
  const flags = new Set(dictationMods(s.mods).map((m) => MOD_FLAG[m]));
  const own = shortcutFlag(s.code);
  if (own) flags.add(own);
  const name = dictationKeyName(s).toLowerCase();

  if (s.code === 0x35 && !s.mods.length) return 'Escape closes the panel and cards, so it can’t start dictation.';
  if (s.code === 0x0C && flags.has(MOD_FLAG.command)) return '⌘Q quits Roamies, so it can’t start dictation.';
  if (s.code === 0x30 && flags.has(MOD_FLAG.command)) return '⌘Tab switches apps, so it can’t start dictation.';
  if (s.code === 0x31 && flags.has(MOD_FLAG.command)) return '⌘Space opens Spotlight, so it can’t start dictation.';

  for (const [label, pair] of [['talk', talk], ['type-to-ask', write]]) {
    const set = dictationMods(pair);
    if (set.length >= 2 && own && set.every((m) => flags.has(MOD_FLAG[m]))) return `That is the ${label} shortcut. Pick another key.`;
  }
  for (const words of keybinds) {
    const parts = String(words).trim().split(/\s*\+\s*/).filter(Boolean);
    const key = parts.at(-1)?.toLowerCase() ?? '';
    const mods = dictationMods(parts.slice(0, -1));
    if (!key || !name.includes(key) && !key.includes(name)) continue;
    if (mods.every((m) => flags.has(MOD_FLAG[m])) && flags.size === mods.length) return `That is already the shortcut for ${words}. Pick another.`;
  }
  return null;
}

export const needDictationModel = (config) => !!config?.stt && (dictationLang(config?.sttLang) === 'bn' || dictationLang(config?.sttLang) === 'auto');
