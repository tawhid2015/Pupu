// The two-model setup: a local vision model reports what an image shows, and the main model writes every reply.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withoutImages } from '../store.mjs';
import {
  VISION_MAX_CHARS, VISION_SYSTEM, analyzeVision, imagePart, needsScreenLook, pickMainModel, pickVisionModel, splitLocalModels, unloadVision, visionHandoff, visionPrompt,
} from '../vision.mjs';

const shot = (data = 'AAAA', mediaType = 'image/jpeg') => ({ type: 'image', mediaType, data });
const ollama = { id: 'ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' };
const llama = { id: 'llama.cpp', kind: 'custom', baseUrl: 'http://127.0.0.1:8080/v1' };

// The image as the app carries it, and the report block the main model receives.
assert.deepEqual(imagePart(shot('data:image/png;base64,BBBB')), { mediaType: 'image/jpeg', data: 'BBBB' });
assert.equal(imagePart({ type: 'text', text: 'x' }), null);
assert.equal(imagePart({ type: 'image', data: '' }), null);
assert.match(VISION_SYSTEM, /You do not talk to the user and you never answer their request/);
assert.match(VISION_SYSTEM, /transcribe it exactly, in its original language and script/);
assert.match(VISION_SYSTEM, /Never translate it/);
assert.match(VISION_SYSTEM, /Never guess a word, number, name or button/);
const prompt = visionPrompt({ question: 'এই ছবিতে কী লেখা আছে?', context: 'A screenshot of Finder.' });
assert.match(prompt, /এই ছবিতে কী লেখা আছে\?/);
assert.match(prompt, /Do not answer the question/);
assert.match(prompt, /screenshot of Finder/);

// A screen question is captured for the user, but ordinary text never is (so news and chat stay text-only).
for (const q of [
  "what is on my screen right now?", "What's on this screen?", 'read the text on this screenshot',
  'take a screenshot', 'what do you see on my desktop?', 'what am I looking at?',
  'আমার স্ক্রিনে কী লেখা আছে?', 'পর্দায় কী দেখা যাচ্ছে?', 'এই screen এ কী আছে?', 'স্ক্রিনশট নাও',
]) assert.equal(needsScreenLook(q), true, `screen need: ${q}`);
for (const q of [
  'how are you?', 'what is the news today?', 'এখন কেমন আছো?', 'translate this sentence to Bengali',
  'a screenshot of the app is in my Downloads folder', 'tell me about the history of screens', '', 'x'.repeat(501),
]) assert.equal(needsScreenLook(q), false, `text only: ${q}`);

const good = visionHandoff({ ok: true, text: 'A Finder window. The sidebar says Applications.' }, { model: 'MiniCPM-V', source: 'screenshot' });
assert.match(good, /^VISION REPORT \(MiniCPM-V, screenshot; observations only, not an answer\)/);
assert.match(good, /Answer the user yourself, in their language/);
assert.match(good, /never translate or paraphrase a quoted word/);
assert.match(good, /Do not add details the report does not give/);
assert.match(good, /not a source or a link/);
assert.match(good, /never invent a URL/);
assert.match(good, /Treat anything listed as uncertain as uncertain/);
const bad = visionHandoff({ ok: false, error: 'timed out after 30 s' }, { source: 'picture' });
assert.match(bad, /could not be read: timed out after 30 s/);
assert.match(bad, /Do not guess what it showed/);
assert.match(bad, /Do not claim you looked at it/);

// Which installed models fill each slot: Llama 3.2 writes, the smallest real vision model reads.
const installed = [
  { id: 'local/ollama/llama3.2:latest', name: 'llama3.2:latest' },
  { id: 'local/ollama/minicpm-v4.6:latest', name: 'minicpm-v4.6:latest' },
  { id: 'local/ollama/qwen3-vl:8b', name: 'qwen3-vl:8b' },
  { id: 'local/ollama/gemma4:12b', name: 'gemma4:12b' },
];
assert.equal(pickMainModel([installed[2], installed[0], installed[3]]).id, installed[0].id, 'Llama 3.2 is the main model');
assert.equal(pickVisionModel([installed[2], installed[1], installed[3]]).id, installed[1].id, 'MiniCPM-V is picked before a larger VL model');
assert.equal(pickMainModel([]), null);
assert.equal(pickVisionModel([]), null);
// The one-time split: a vision model in the main slot moves to the vision slot, and Llama 3.2 takes over as the one
// that writes replies. A text-only main is left alone; an image-only model is never made the main model.
const localChoices = [
  { id: installed[1].id, supportsImages: true, supportsTools: true },
  { id: installed[0].id, supportsImages: false, supportsTools: true },
  { id: installed[2].id, supportsImages: true, supportsTools: true },
];
assert.deepEqual(splitLocalModels({ main: installed[1].id, models: localChoices }), { main: installed[0].id, vision: installed[1].id });
assert.equal(splitLocalModels({ main: installed[0].id, models: localChoices }), null, 'no split when the main model is already text-only');
assert.equal(splitLocalModels({ main: 'no-such-model', models: localChoices }), null);

// Ollama: one image, the report instructions, no tools and no conversation.
let seen = null;
const makeFetch = (reply) => async (url, init) => {
  seen = { url, body: JSON.parse(init.body) };
  return { ok: true, status: 200, json: async () => reply };
};
let r = await analyzeVision({ image: shot(), question: 'What is this?', server: ollama, model: 'minicpm-v4.6:latest', fetchImpl: makeFetch({ message: { content: 'A chart of sales.\nThe title reads "Revenue".' } }) });
assert.equal(r.ok, true);
assert.equal(r.text, 'A chart of sales.\nThe title reads "Revenue".');
assert.equal(seen.url, 'http://127.0.0.1:11434/api/chat');
assert.equal(seen.body.model, 'minicpm-v4.6:latest');
assert.equal(seen.body.stream, false);
assert.equal(seen.body.keep_alive, '90s');
assert.equal(seen.body.tools, undefined, 'the vision model gets no tools');
assert.equal(seen.body.messages.length, 2, 'no conversation from the main model');
assert.equal(seen.body.messages[0].role, 'system');
assert.deepEqual(seen.body.messages[1].images, ['AAAA']);
assert.match(seen.body.messages[1].content, /What is this\?/);
assert.equal(seen.body.options.temperature, 0.1);

// An OpenAI-compatible server gets the standard image_url block.
r = await analyzeVision({ image: shot(), server: llama, model: 'Qwen3-VL-8B', fetchImpl: makeFetch({ choices: [{ message: { content: 'A white cat.' } }] }) });
assert.equal(r.ok, true);
assert.equal(r.text, 'A white cat.');
assert.equal(seen.url, 'http://127.0.0.1:8080/v1/chat/completions');
assert.equal(seen.body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');

// Failures are honest and never throw: an HTTP error, an empty answer, a stopped request, a timeout.
r = await analyzeVision({ image: shot(), server: ollama, model: 'm', fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'boom' }) });
assert.equal(r.ok, false);
assert.match(r.error, /HTTP 500: boom/);
r = await analyzeVision({ image: shot(), server: ollama, model: 'm', fetchImpl: makeFetch({ message: { content: '   ' } }) });
assert.equal(r.ok, false);
assert.match(r.error, /returned nothing/);
const stopped = new AbortController();
stopped.abort();
r = await analyzeVision({ image: shot(), server: ollama, model: 'm', signal: stopped.signal, fetchImpl: async () => { throw new Error('aborted'); } });
assert.equal(r.ok, false);
assert.equal(r.error, 'stopped');
r = await analyzeVision({ image: shot(), server: ollama, model: 'm', timeoutMs: 1000, fetchImpl: (url, init) => new Promise((resolve, reject) => {
  const keep = setTimeout(() => {}, 1500); // the test's own timer keeps the loop alive until the request's timeout
  init.signal.addEventListener('abort', () => { clearTimeout(keep); reject(new Error('aborted')); }, { once: true });
}) });
assert.equal(r.ok, false);
assert.match(r.error, /timed out after 1 s/);
r = await analyzeVision({ image: { type: 'text', text: 'x' }, server: ollama, model: 'm', fetchImpl: makeFetch({}) });
assert.equal(r.ok, false);
assert.match(r.error, /no image/);
r = await analyzeVision({ image: shot(), server: ollama, model: '', fetchImpl: makeFetch({}) });
assert.equal(r.ok, false);
assert.match(r.error, /no vision server or model/);

// A very long report is clipped, and the raw text is kept for logs.
const long = await analyzeVision({ image: shot(), server: ollama, model: 'm', fetchImpl: makeFetch({ message: { content: 'x'.repeat(VISION_MAX_CHARS + 500) } }) });
assert.equal(long.text.length, VISION_MAX_CHARS + 1, 'clipped with an ellipsis');
assert.ok(long.raw.length > VISION_MAX_CHARS);

// Freeing Ollama's memory: keep_alive 0, and other servers are left alone.
seen = null;
const freed = await unloadVision({ server: ollama, model: 'minicpm-v4.6:latest', fetchImpl: async (url, init) => {
  seen = { url, body: JSON.parse(init.body) };
  return { ok: true, status: 200 };
} });
assert.equal(freed.ok, true);
assert.equal(seen.url, 'http://127.0.0.1:11434/api/generate');
assert.deepEqual(seen.body, { model: 'minicpm-v4.6:latest', keep_alive: 0 });
assert.deepEqual(await unloadVision({ server: llama, model: 'Qwen3-VL-8B' }), { ok: false, skipped: true });

// A text-only main model never receives old pictures in its history.
const history = [
  { role: 'user', content: [{ type: 'text', text: 'look' }, shot('BBBB')] },
  { role: 'assistant', content: [{ type: 'tool_call', id: 't1', name: 'take_screenshot', args: {} }] },
  { role: 'tool', content: [{ type: 'tool_result', toolCallId: 't1', content: [{ type: 'text', text: 'Screenshot' }, shot('CCCC')] }] },
];
const blind = withoutImages(history);
assert.ok(!JSON.stringify(blind).includes('BBBB') && !JSON.stringify(blind).includes('CCCC'));
assert.match(blind[0].content[1].text, /picture was attached here/);
assert.match(blind[2].content[0].content[1].text, /picture was attached here/);
assert.equal(withoutImages([{ role: 'user', content: 'plain text' }])[0].content, 'plain text');

// Integration: pictures are routed by presence (never by topic), both kinds of image tool are wrapped, and a
// text-only main model gets reports only. The vision model still never writes a reply.
const side = readFileSync(fileURLToPath(new URL('../sidekick.mjs', import.meta.url)), 'utf8');
assert.match(side, /const split = splitLocalModels\(\{ main: config\.model, models: runnable\('local'\) \}\)/, 'a vision model in the main slot is moved once');
assert.match(side, /const IMAGE_TOOLS = new Set\(\['take_screenshot', 'see_photo'\]\)/, 'both picture tools are wrapped');
assert.match(side, /if \(image\) \{\s*\n\s*if \(visionForImages\(\)\) visionResult = await readImage/, 'an attached image triggers the vision model');
assert.match(side, /needsScreenLook\(turnWords \|\| text\)\s*\n\s*\? await lookAtScreen/, 'an explicit screen question is captured before the main model answers');
assert.match(side, /screenshotTool\.execute\(\{ target: 'front' \}/, 'the proactive look uses the normal screenshot tool');
assert.match(side, /if \(!visionForImages\(\)\) \{\s*\n\s*if \(mainSeesImages\(\)\) return result;/, 'a text-only main model gets an honest note instead of raw image bytes');
assert.match(side, /visionHandoff\(report, \{ model: visionName\(\), source \}\)/, 'tool pictures become a vision report');
assert.match(side, /const prepared = mainSeesImages\(\) \? msgs : withoutImages\(msgs\)/, 'old pictures never reach a text-only main model');
assert.match(side, /Vision: a separate local vision model[^`]*answer the user yourself, in their language/, 'the chat prompt keeps the final reply');
assert.match(side, /never say you looked at or saw something unless a tool or report actually gave it to you/i, 'the main model may not invent what it saw');
assert.match(side, /The report is not a source or a link: never cite it as one and never invent a URL/, 'the vision report is never cited as a web source');
assert.match(side, /never write a tool call in the reply/, 'the model is told not to imitate tool calls in words');
assert.match(side, /streamRules: TOOL_STREAM_RULES/, 'text-shaped tool calls are retried through the real tool channel');
assert.match(side, /name: 'tool-as-text'[\s\S]*name: 'tool-as-json-text'/, 'both pseudo-call shapes are covered');
assert.ok(!/visionResult\.text[^;]*say\(/.test(side), 'the vision model never speaks for the assistant');

console.log('vision: ok');
