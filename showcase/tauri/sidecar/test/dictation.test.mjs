// Clipboard dictation: a recorded key or shortcut, with its own en/bn toggle, goes straight to the clipboard and the
// active field with no chat turn or spoken reply. Run: npm test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DICTATION_KEYS, dictationConflict, dictationKeyCode, dictationKeyId, dictationLang, dictationMods, dictationSettings, dictationShortcut, dictationShortcutLabel, needDictationModel } from '../dictation.mjs';
import { copyText, readText } from '../tools.mjs';

const root = new URL('../../../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const side = src('showcase/tauri/sidecar/sidekick.mjs');
const swift = src('showcase/tauri/src-tauri/voice/main.swift');
const rust = src('showcase/tauri/src-tauri/src/voice.rs');
const main = src('showcase/tauri/src-tauri/src/main.rs');
const tauri = src('showcase/tauri/src-tauri/tauri.conf.json');
const entitlements = src('showcase/tauri/src-tauri/Roamies.entitlements');
const panel = src('showcase/panel/panel.js');

assert.equal(dictationLang('bn-BD'), 'bn');
assert.equal(dictationLang('en-US'), 'en');
assert.equal(dictationLang('auto'), 'auto');
assert.equal(dictationLang(), 'auto');
assert.equal(dictationKeyCode('0x3A'), 0x3A);
assert.equal(dictationKeyCode('nonsense'), 0x3D, 'an unparsable value still falls back to right Option');
assert.equal(dictationKeyCode('0x7A'), 0x7A, 'any real virtual key code can be recorded');
assert.equal(dictationKeyId(0x3a), '0x3A');
assert.equal(DICTATION_KEYS[0][0], '0x3D', 'right Option is the default preset');
assert.deepEqual(dictationMods(['Command', 'shift', 'nonsense']), ['shift', 'command']);
assert.equal(dictationShortcut({ sttKey: '0x3A', sttMods: ['shift'], sttName: 'Left Option' }).code, 0x3A);
assert.equal(dictationShortcutLabel({ code: 0x3A, mods: [], name: 'Left Option' }), 'Left Option');
assert.equal(dictationShortcutLabel({ code: 0x31, mods: ['option'], name: 'Space' }), '⌥Space');
assert.equal(needDictationModel({ stt: true, sttLang: 'bn' }), true);
assert.equal(needDictationModel({ stt: true, sttLang: 'auto' }), true);
assert.equal(needDictationModel({ stt: true, sttLang: 'en' }), false);
assert.equal(needDictationModel({ stt: false, sttLang: 'bn' }), false);

// The key, its modifiers and its name are saved and restored as one object, so a restart can never half-restore it.
const optionM = dictationSettings({ sttKey: '0x2E', sttMods: ['option'], sttName: 'M' });
assert.deepEqual(optionM, { sttKey: '0x2E', sttMods: ['option'], sttName: 'M', sttShortcut: { code: 0x2E, mods: ['option'], name: 'M' } });
assert.deepEqual(dictationSettings({ ...optionM }), optionM, 'reopening the app restores the same shortcut');
assert.deepEqual(dictationSettings({ sttKey: '0x3A', sttMods: [], sttName: 'Left Option' }).sttShortcut, { code: 0x3A, mods: [], name: 'Left Option' });
const canonicalWins = dictationSettings({ sttShortcut: { code: 0x31, mods: ['command'], name: 'Space' }, sttKey: '0x3A', sttMods: ['option'], sttName: 'Left Option' });
assert.equal(canonicalWins.sttKey, '0x31', 'the canonical shortcut wins over stale legacy fields');
assert.deepEqual(canonicalWins.sttMods, ['command']);

// Conflicts: known system combos, this app's talk/type chords, and the registered shortcuts are refused.
assert.match(dictationConflict({ code: 0x35, mods: [] }), /Escape/);
assert.match(dictationConflict({ code: 0x31, mods: ['command'] }), /Spotlight/);
assert.match(dictationConflict({ code: 0x3A, mods: ['control'] }, { talk: ['control', 'option'] }), /talk shortcut/);
assert.equal(dictationConflict({ code: 0x31, mods: ['option'] }, { talk: ['control', 'option'], keybinds: ['Control+Option+S'] }), null);

assert.match(side, /m\.mode === 'stt'/, 'dictation finals are separated from chat turns');
assert.match(side, /copyText\(text, shellCall\)/, 'the transcript goes to the clipboard');
assert.match(side, /hands\(\{ quiet: true \}, 'act'/, 'the transcript is pasted quietly through the hands helper');
assert.match(side, /config\.sttLang/, 'the en/bn toggle chooses the local recognizer language');
assert.match(side, /sttMods/, 'modifiers of a recorded shortcut are saved');
assert.match(side, /voice_key_capture/, 'the native capture result reaches the sidecar');
assert.match(side, /sttdetect/, 'the Settings button starts recording');
assert.match(side, /sttsave/, 'a captured shortcut can be saved');
assert.match(side, /sttreset/, 'the default can be restored');
assert.match(side, /dictationConflict/, 'recorded keys are checked against existing shortcuts');
assert.match(side, /dictationSettings/, 'the saved shortcut is normalized as one object');
assert.match(side, /m\.type === 'voice_ready'[^\n]*voiceConfig\(\)/, 'a restarted helper gets the saved shortcut again');
assert.match(side, /m\.error && !dictationCapture\.active/, 'a key capture error is shown even when the recorder is closed');
const dictationPath = side.slice(side.indexOf('async function onDictation'), side.indexOf('async function onVoice'));
assert.match(dictationPath, /pasteProblem\(placed\.error\)/, 'a paste that cannot land is explained');
assert.doesNotMatch(dictationPath, /\bsay\([^)]*\b(text|appleText|got\.text)\b/, 'a successful dictation has no spoken reply');

assert.match(swift, /DictationShortcut\(code: 0x3D/, 'the helper has a typed default shortcut');
assert.match(swift, /case "record_start"/, 'the helper starts a native key recording');
assert.match(swift, /addLocalMonitorForEvents/, 'the recorder also sees keys while its own panel has focus');
assert.match(swift, /swallowLocal: recordingKeys/, 'recorded keys do not press panel buttons');
assert.match(swift, /"type": "key_capture"/, 'the helper reports the physical key that was pressed');
assert.doesNotMatch(swift, /AXIsProcessTrusted/, 'dictation never asks for an Accessibility grant it does not need');
assert.match(swift, /Self\.matches\(shortcut:/, 'matching uses the key code, not merged flags');
assert.match(swift, /modifierTapFires/, 'a bare modifier fires on a clean release');
assert.match(swift, /deviceModifiers/, 'raw device bits identify each physical modifier side');
assert.match(swift, /CGEventSource\.flagsState\(\.combinedSessionState\)/, 'key state is read without any Accessibility grant');
assert.match(swift, /NativeKeys\.shared\.poll\(\)/, 'key state is polled every frame, including modifier-only keys');
assert.doesNotMatch(swift, /case "native_key"/, 'no extra helper event path is needed');
assert.match(swift, /takeMode == \.dictate \{ break \}/, 'dictation ignores pause and maximum-length auto-stops');
assert.match(swift, /msg\["mode"\] = "stt"/, 'the helper tags dictation finals');
assert.match(swift, /case "stt_shortcut"/, 'the helper receives the saved shortcut');
assert.match(rust, /"mode": msg\.get\("mode"\)/, 'Rust forwards the dictation mode');
assert.match(main, /"cmd": "stt_shortcut"/, 'Rust sends the shortcut to the helper');
assert.match(main, /"cmd": "record_start"/, 'Rust forwards the recording command');
assert.match(rust, /format!\("voice_\{kind\}"\)/, 'Rust turns a helper key_capture event into voice_key_capture for the sidecar');
assert.match(panel, /v\.stt/, 'Settings shows the dictation controls');
assert.match(panel, /sttdetect/, 'Settings can detect and change the key');
assert.match(tauri, /"entitlements": "Roamies\.entitlements"/, 'the app signs itself with the entitlements file');
assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/, 'bundled Node can load the native Bangla recognizer');

// Clipboard preserves multibyte Unicode characters (Bangla + English code-switching) without mojikake
const sampleText = 'হ্যাঁ, WhatsApp ওপেন করে আমাকে message করুন।';
const copied = await copyText(sampleText);
if (copied && process.platform !== 'linux') {
  const readBack = await readText();
  assert.equal(readBack.trim(), sampleText.trim(), 'copied text preserves UTF-8 Bangla without mojikake');
}

console.log('dictation tests: passed');
