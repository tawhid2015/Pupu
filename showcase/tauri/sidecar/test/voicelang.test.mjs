// Held-key language handling: the Mac helper listens in English and Bangla when both are available, tells the sidecar
// which one it heard, and that choice lasts for one turn only. Typed input and the saved reply language are untouched.
// Run: npm test
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const side = src('showcase/tauri/sidecar/sidekick.mjs');
const swift = src('showcase/tauri/src-tauri/voice/main.swift');
const rust = src('showcase/tauri/src-tauri/src/voice.rs');
const panel = src('showcase/panel/panel.js');

assert.match(side, /'auto', 'en-US', 'bn-IN', 'bn-BD'/, 'Bangla can be picked in Listening settings');
assert.match(panel, /\['bn-IN', 'বাংলা · Bengali \(India\)'\]/, 'the panel offers Bengali');
assert.match(panel, /\['bn-BD', 'বাংলা · Bengali \(Bangladesh\)'\]/, 'both Bengali regions are offered');
assert.match(swift, /final class ParallelRecognizer: Recognizer/, 'the helper hears en and bn together');
assert.match(swift, /AVSpeechSynthesisVoice\.speechVoices\(\)\.contains/, 'it detects an installed Bangla voice');
assert.match(swift, /msg\["lang"\] = lang/, 'the final transcript carries the language');
assert.match(swift, /else if let p = rec as\? ParallelRecognizer \{ detectedLang = p\.lang \}/, 'auto mode only reports a language when both models heard it');
assert.ok(!/else \{ detectedLang = hasBengali\(text\) \? "bn" : "en" \}/.test(swift), 'an English-only fallback never overrides the saved language');
assert.match(rust, /"lang": msg\.get\("lang"\)/, 'Rust forwards it to the sidecar');
assert.match(rust, /"audio": msg\.get\("audio"\)/, 'Rust forwards the take WAV too');
assert.match(side, /onSpoken\(text, m\.area, lang\)/, 'the sidecar receives the chosen transcript and language');
assert.match(side, /const turnLang = byVoice && \(lang === 'bn' \|\| lang === 'en'\) \? lang : replyLang\(\);/, 'only spoken turns use it');
assert.match(side, /if \(turnLang !== config\.replyLang\) speech\.setLocalLanguage\?\.\(turnLang\);/, 'only this turn switches the reply model');
assert.match(side, /if \(turnLang !== config\.replyLang\) \{\s*replyLangOverride = null; promptLang = config\.replyLang; agentStale = true;\s*speech\.setLocalLanguage\?\.\(config\.replyLang\);/,
  'the saved language is restored after the turn');
assert.match(side, /replyLang\(\) !== 'bn' \|\| hasBengali\(t\)/, 'the Bangla backstop follows the turn language');

// Local Bangla ASR: the helper sends the take's audio, the sidecar tries the Bangla transducer for Bangla/auto takes,
// and Apple's transcript stays as the fallback. Typed input never has a WAV, so its path is untouched.
assert.match(swift, /msg\["audio"\] = takeAudio/, 'a final take carries its WAV path');
assert.match(swift, /beginTakeCapture\(enabled: !dryRun && \(mode == \.dictate \|\| takesForLocalAsr\)\)/, 'held-key English keeps Apple’s path; dictation always captures its WAV');
assert.match(swift, /private var takesForLocalAsr: Bool \{ speechLang == "auto" \|\| speechLang\.hasPrefix\("bn"\) \}/, 'only Bangla/auto takes are captured');
assert.match(swift, /gain\.apply\(buffer, rms: rms\)/, 'the WAV is captured after AutoGain');
assert.match(swift, /appendTake\(UnsafeBufferPointer/, 'the mic tap collects the boosted take');
assert.match(swift, /let boost = 0\.10 \/ rms/, 'speech is normalised for the local recognizer');
assert.match(swift, /if peak > 0\.85/, 'peaks are capped before writing the WAV');
assert.match(swift, /put32\(UInt32\(kTakeRate\)\)/, 'takes are written at 16 kHz');
assert.match(side, /const appleText = String\(m\.text \?\? ''\)\.trim\(\)/, 'an audio-only final does not throw');
assert.match(side, /const keepAppleEnglish = m\.lang === 'en'/, 'Apple English transcripts stay untouched');
assert.match(side, /const useAsr = !!m\.audio && wantsBanglaAsr\(speechLangId\(\)\) && !keepAppleEnglish/, 'only Bangla/auto held-key takes use local ASR');
assert.match(side, /removeTake\(m\.audio\)/, 'an unused take is deleted through the guarded cleanup');
assert.match(side, /transcribeTake\(m\.audio/, 'the sidecar runs the pinned local recognizer');
assert.match(side, /via = 'local'/, 'a local result replaces Apple’s transcript for that take');
assert.match(panel, /'asrdl'/, 'the panel can download the local model');

console.log('held-key language tests: passed');
