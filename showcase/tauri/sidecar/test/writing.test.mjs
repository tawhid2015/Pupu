// Fix grammar and style rewrites are side calls: they never become a chat turn or a spoken reply. Run: npm test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { noStyle, rewriteNote, rewriteSystem, styleFrom, writingCommand, writingLang } from '../writing.mjs';

const root = new URL('../../../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const side = src('showcase/tauri/sidecar/sidekick.mjs');
const panel = src('showcase/panel/panel.js');

assert.deepEqual(writingCommand('fix grammar'), { kind: 'fix', style: null });
assert.deepEqual(writingCommand('correct this please'), { kind: 'fix', style: null });
assert.deepEqual(writingCommand('ব্যাকরণ ঠিক করো'), { kind: 'fix', style: null });
assert.deepEqual(writingCommand('make it more natural'), { kind: 'style', style: 'natural' });
assert.deepEqual(writingCommand('rewrite this naturally'), { kind: 'style', style: 'natural' });
assert.deepEqual(writingCommand('make it sound human'), { kind: 'style', style: 'human' });
assert.deepEqual(writingCommand('make it friendly'), { kind: 'style', style: 'friendly' });
assert.deepEqual(writingCommand('make it professional'), { kind: 'style', style: 'professional' });
assert.deepEqual(writingCommand('প্রাকৃতিক করে লিখো'), { kind: 'style', style: 'natural' });
assert.equal(writingCommand('what is the weather today'), null);
assert.equal(styleFrom('make it friendlier'), 'friendly');
assert.equal(writingLang('bn-BD'), 'bn');
assert.equal(writingLang('en-US', 'নমস্কার'), 'bn');
assert.equal(noStyle("No, that's fine"), true);
assert.equal(noStyle('না, ঠিক আছে'), true);
assert.equal(noStyle('make it professional'), false);

assert.match(rewriteSystem('en'), /Correct grammar, spelling, punctuation and sentence structure/);
assert.match(rewriteSystem('en'), /Return only the rewritten text/);
assert.match(rewriteSystem('bn'), /ব্যাকরণ/);
assert.match(rewriteSystem('bn', 'friendly'), /বন্ধুত্বপূর্ণ/);
assert.match(rewriteSystem('en', 'human'), /not AI-generated/);
assert.match(rewriteNote('bn', true), /বদলে দেওয়া/);

assert.match(side, /writingCommand\(text\)/, 'spoken text is checked before it becomes a chat turn');
assert.match(side, /oneShot\(\{ \.\.\.\(await sideRoute\(\)\), system: rewriteSystem/, 'the rewrite uses a side call with no tools');
assert.match(side, /checkTextAction\(\{ kind: 'paste'/, 'paste goes through the safety rule');
assert.match(side, /config\.fixAskStyle/, 'the style question uses the saved setting');
assert.match(side, /function askStyle\(langId, signal\)/, 'the follow-up can be answered by voice or by typing');
assert.match(side, /if \(styleReply\) \{ const reply = styleReply; reply\(text\); return; \}/, 'a spoken style answer is not sent to chat');
assert.match(panel, /fixaskstyle/, 'Settings exposes the style-question toggle');

console.log('writing command tests: passed');
