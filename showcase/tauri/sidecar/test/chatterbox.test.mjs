// The built-in voice's file layout: what the Speaking page lists and whether the app thinks it's installed.
// Nothing is spawned here: the engine itself needs the GPU and is exercised by hand on the target Mac.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinLanguages, builtinStatus, builtinVoices, engineModels, enginePython, getEngineLanguage, hasEngine, setEngineLanguage } from '../chatterbox.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-builtin-voice-'));
const dir = path.join(root, 'chatterbox');
fs.mkdirSync(path.join(dir, 'voices'), { recursive: true });
fs.mkdirSync(path.join(dir, 'runtime', 'bin'), { recursive: true });
fs.mkdirSync(path.join(dir, 'models', 'chatterbox-4bit'), { recursive: true });
fs.writeFileSync(path.join(dir, 'engine.py'), '# engine\n');
fs.writeFileSync(path.join(dir, 'runtime', 'bin', 'python3'), '# python\n');
fs.writeFileSync(path.join(dir, 'models', 'chatterbox-4bit', 'model.safetensors'), 'weights');
fs.writeFileSync(path.join(dir, 'voices', 'jarvis.wav'), 'wav');
fs.writeFileSync(path.join(dir, 'voices', 'anime.wav'), 'wav');
fs.writeFileSync(path.join(dir, 'voices', 'voices.json'), JSON.stringify({ anime: 'Anime Girl', jarvis: 'JARVIS' }));

assert.deepEqual(builtinVoices(dir), [{ id: 'anime', name: 'Anime Girl' }, { id: 'jarvis', name: 'JARVIS' }], 'clips and their names come from voices/');
assert.equal(hasEngine(dir), true, 'engine + python + weights: installed');
assert.equal(enginePython(dir), path.join(dir, 'runtime', 'bin', 'python3'), 'the Python travels with the app');
assert.equal(engineModels(dir), path.join(dir, 'models'), 'the weights travel with the app');
const s = builtinStatus(dir);
assert.equal(s.ok, true);
assert.equal(s.engine, 'builtin');
assert.equal(s.builtin, true);
assert.equal(s.voices.length, 2);

assert.deepEqual(builtinLanguages(dir), ['en'], 'English ships on its own too');
fs.mkdirSync(path.join(dir, 'models', 'chatterbox-bangla'));
assert.deepEqual(builtinLanguages(dir), ['en', 'bn'], 'the Bangla fine-tune adds the Bangla option');

assert.equal(getEngineLanguage(), 'en', 'English is the default reply language');
setEngineLanguage('bn');
assert.equal(getEngineLanguage(), 'bn');
setEngineLanguage('fr');
assert.equal(getEngineLanguage(), 'en', 'anything else falls back to English');

assert.equal(hasEngine(path.join(root, 'missing')), false, 'a build without the engine says so');
assert.equal(builtinStatus(path.join(root, 'missing')).ok, false);
assert.deepEqual(builtinVoices(path.join(root, 'missing')), []);
fs.rmSync(root, { recursive: true, force: true });
console.log('built-in voice: passed');
