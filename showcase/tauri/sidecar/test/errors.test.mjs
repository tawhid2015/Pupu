// Errors as people see them: one short line, never the raw error; the raw error only in Copy details, scrubbed. Run: npm test
import assert from 'node:assert/strict';
import { AREA_NAMES, GUIDE_LINE, GUIDE_LINKED, MAX_LINE, detailsText, everyLine, explain } from '../errors.mjs';

// ---- every line, under every name it might carry: short, one line, plain words
const NAMES = [undefined, 'ChatGPT', 'Claude', 'OpenAI', 'Anthropic', 'Kimi (Moonshot)', 'Xiaomi (MiMo)', 'Hugging Face', 'A Provider With A Very Long Name Indeed', '{"x":1}\n<b>"hi"</b> 500'];
const STORES = [undefined, 'Keychain', 'keyring'];
const allowed = new Set();
for (const who of NAMES) for (const store of STORES) {
  for (const { area, code, text, copy, max } of everyLine({ who, store })) {
    const at = `${area} ${code} "${text}"`;
    // The setup guide shows sign-in and key errors on one row, with Copy details beside the ones that have it.
    assert.equal(max, !['sign-in', 'key'].includes(area) ? MAX_LINE : copy ? GUIDE_LINKED : GUIDE_LINE);
    assert.ok(text.length <= max, `${at} is ${text.length} characters, over ${max}`);
    assert.ok(text.length >= 12 && /[.!?]$/.test(text), `${at} is a sentence`);
    assert.doesNotMatch(text, /[\n\r\t{}[\]"`<>\\]/, `${at} is one line of plain words`);
    assert.doesNotMatch(text, /\b\d{3}\b/, `${at} has no status number`);
    assert.match(text, /^[A-Z]/, `${at} starts with a capital`);
    allowed.add(text);
  }
}
assert.deepEqual([MAX_LINE, GUIDE_LINE, GUIDE_LINKED], [60, 55, 41]);
assert.deepEqual(AREA_NAMES, ['sign-in', 'reply', 'key', 'update', 'hearing', 'screen', 'diagnostics']);
const lines = everyLine({ who: 'ChatGPT' });
assert.equal(new Set(lines.map((l) => l.code)).size, lines.length, 'each cause has its own code');
for (const l of lines) assert.match(l.code, /^E[1-7][0-9A-F]$/);

// ---- a cause Roamies doesn't know: the area's code in the line, and Copy details offered
for (const area of AREA_NAMES) {
  const p = explain(area, new Error('zxqv never seen before'), { who: 'ChatGPT' });
  assert.equal(p.known, false);
  assert.equal(p.copy, true);
  assert.match(p.code, /^E[1-7]0$/);
  assert.ok(p.text.includes(`(${p.code})`), `${area}: "${p.text}" carries its code`);
  assert.match(p.raw, /zxqv never seen before/, 'the raw error is kept for the log');
}
assert.equal(explain('sign-in', 'zxqv').text, "Sign-in didn't work (E10). Try again.");
assert.equal(explain('no such area', 'zxqv').code, 'E20', 'an unknown area is worded as a reply');

// ---- nasty input never reaches the line
const circular = {}; circular.self = circular;
const NASTY = [
  '{ "error": { "message": "Incorrect thing", "type": "weird_error", "param": null, "code": "nope" } }',
  '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr>cloudflare</body></html>',
  'TypeError: Cannot read properties of undefined (reading \'x\')\n    at prompt (file:///Applications/Roamies.app/sidekick.mjs:882:17)\n    at async run (node:internal/x:1:1)',
  'x'.repeat(5000),
  `zxqv ${'{"a":"b"},'.repeat(600)}`,
  '', null, undefined, 0, 404, NaN, {}, [], circular, { message: { nested: '"quoted"' } }, Symbol('s').toString(), () => 'fn',
  Object.assign(new Error('line one\nline two "quoted" {brace} `tick` 503'), { cause: { message: 'inner\n<b>html</b>' } }),
  Object.assign(new Error('zxqv'), { cause: 'a string cause', code: { toString() { return '{}'; } } }),
];
for (const area of [...AREA_NAMES, 'nope']) for (const bad of NASTY) for (const who of ['ChatGPT', bad]) {
  const p = explain(area, bad, { who, store: who });
  assert.ok(allowed.has(p.text) || everyLine({ who, store: who }).some((l) => l.text === p.text), `${area}: "${p.text}" is one of the fixed lines`);
  assert.ok(p.text.length <= MAX_LINE);
  assert.ok(!p.copy || !['sign-in', 'key'].includes(area) || p.text.length <= GUIDE_LINKED, `${area}: "${p.text}" leaves room for Copy details`);
  assert.doesNotMatch(p.text, /[\n{}"<>`]/);
  assert.equal(typeof p.raw, 'string');
  assert.ok(p.raw.length <= 6000);
}

// ---- issue #17: OpenAI refused the one-time code
const seventeen = 'ChatGPT token exchange failed (400): {\n  "error": "invalid_grant"\n}';
for (const err of [
  new Error(seventeen), seventeen,
  // gg-core's typed error, as thrown after the fix
  Object.assign(new Error('ChatGPT token exchange failed (400): invalid_grant'), { name: 'ChatGPTSignInError', reason: 'invalid_grant', status: 400, detail: 'Invalid authorization code', retried: true, returning: false, callbackToExchangeMs: 412 }),
]) {
  const p = explain('sign-in', err, { who: 'ChatGPT' });
  assert.deepEqual([p.code, p.text, p.known, p.copy], ['E13', "ChatGPT sign-in didn't finish. Try again.", true, true]);
}
const typed = explain('sign-in', Object.assign(new Error('ChatGPT token exchange failed (400): invalid_grant'), { name: 'ChatGPTSignInError', reason: 'invalid_grant', status: 400, detail: 'Invalid authorization code', retried: true, returning: false, callbackToExchangeMs: 412 }));
assert.match(typed.raw, /reason=invalid_grant status=400 detail=Invalid authorization code returning=false retried=true callbackToExchangeMs=412/, 'what OpenAI said is in the details');

// ---- known causes, by area
const fetchFailed = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND auth.openai.com'), { code: 'ENOTFOUND' }) });
const planOff = Object.assign(new Error("ChatGPT plan use isn't enabled for GG Coder. Allow Use your ChatGPT plan, or add an OpenAI API key."), { name: 'ChatGPTPlanNotEnabledError' });
const CASES = [
  ['sign-in', planOff, 'ChatGPT', "Your ChatGPT plan can't be used here. Use an API key."],
  ['sign-in', fetchFailed, 'ChatGPT', "Can't reach ChatGPT. Check your internet."],
  ['sign-in', new Error("ChatGPT sign-in didn't come back from the browser. Try again."), 'ChatGPT', "ChatGPT didn't come back from the browser. Try again."],
  ['sign-in', new Error('Sign-in listener closed without a callback.'), 'ChatGPT', "ChatGPT didn't come back from the browser. Try again."],
  ['sign-in', new Error('Sign-in cancelled.'), 'Claude', 'Sign-in cancelled.'],
  ['sign-in', Object.assign(new Error('ChatGPT sign-in was cancelled.'), { name: 'AbortError' }), 'ChatGPT', 'Sign-in cancelled.'],
  ['sign-in', new Error('ChatGPT token exchange failed (401): invalid_client'), 'ChatGPT', "ChatGPT setup didn't finish. Try again."],
  ['sign-in', new Error('That was a different ChatGPT account. Continue with ChatGPT again to connect it.'), 'ChatGPT', 'That was a different ChatGPT account. Try again.'],
  ['sign-in', new Error('ChatGPT ID token nonce mismatch.'), 'ChatGPT', "ChatGPT's answer looked wrong. Try again."],
  ['sign-in', new Error("Claude sign-in didn't finish. Try again."), 'Claude', "Claude sign-in didn't finish. Try again."],
  ['reply', new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), 'Anthropic', 'My Anthropic login stopped working. Sign in again.'],
  ['reply', new Error('Not logged in'), 'OpenAI', 'My OpenAI login stopped working. Sign in again.'],
  ['reply', new Error('429 Too Many Requests: rate limit reached'), 'OpenAI', "I've hit this model's usage limit. Pick another model."],
  ['reply', new Error('You exceeded your current quota (insufficient_quota)'), 'OpenAI', 'This account is out of credit. Top up or switch model.'],
  // Gemini's free-tier 429 says "check your plan and billing details": that is a rate limit, not an empty wallet.
  ['reply', Object.assign(new Error('Gemini API error (429): {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}'), { status: 429 }), 'Gemini', "I've hit this model's usage limit. Pick another model."],
  ['reply', new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'), 'Anthropic', 'Anthropic is having trouble right now. Try again soon.'],
  ['reply', new Error('prompt is too long: 250000 tokens > 200000 maximum'), 'Anthropic', 'This chat got too long. Start a new one.'],
  ['reply', new Error('The model `gpt-9` does not exist or you do not have access to it.'), 'OpenAI', "That model isn't available. Pick another one."],
  ['reply', fetchFailed, 'Kimi (Moonshot)', "Can't reach Kimi (Moonshot). Check your internet."],
  ['reply', new Error('Claude Code is updating. Ask me again in a minute.'), 'Anthropic', 'Claude Code is updating. Ask me again in a minute.'],
  ['reply', new Error("Claude Code didn't update: fetch failed"), 'Anthropic', "Can't reach Anthropic. Check your internet."],
  ['reply', new Error('API Error: Output blocked by content filtering policy'), 'Anthropic', "Anthropic's filter stopped that answer. Ask another way."],
  ['reply', new Error('finish_reason: content_filter'), 'OpenAI', "OpenAI's filter stopped that answer. Ask another way."],
  // #107: a model on this computer that didn't load was "Something went wrong (E20)", or "check your internet".
  ['reply', new Error('400 No models loaded. Please load a model in the developer page or use the `lms load` command.'), 'Local', "The model didn't load. Check its app or pick a smaller one."],
  ['reply', new Error('500 model requires more system memory (9.1 GiB) than is available (4.2 GiB)'), 'Local', "The model didn't load. Check its app or pick a smaller one."],
  ['reply', new Error('500 timed out waiting for llama runner to start - progress 0.00'), 'Local', "The model didn't load. Check its app or pick a smaller one."],
  ['reply', new Error('CUDA error: out of memory'), 'Local', "The model didn't load. Check its app or pick a smaller one."],
  ['reply', new Error('400 the request exceeds the available context size, try increasing it'), 'Local', 'This chat got too long. Start a new one.'],
  ['key', new Error('keychain unavailable'), 'x', "Keychain didn't save the key. Try again.", 'Keychain'],
  ['key', new Error("the keyring didn't answer (Cannot autolaunch D-Bus); a keyring app such as GNOME Keyring or KWallet needs to be running"), 'x', "Keyring didn't save the key. Try again.", 'keyring'],
  ['key', new Error('Windows could not protect the key'), 'x', "The key didn't save safely. Try again."],
  ['key', new Error("secret-tool isn't installed (it comes in libsecret-tools on Debian and Ubuntu, libsecret on Fedora and Arch)"), 'x', 'Install secret-tool (libsecret), then try again.', 'keyring'],
  ['key', new Error('401 Incorrect API key provided'), 'x', "That key didn't work. Copy it again and retry."],
  ['key', Object.assign(new Error("EACCES: permission denied, open '/Users/jane/.gg/auth.json'"), { code: 'EACCES' }), 'x', "The key didn't save to disk. Try again."],
  ['update', 'error sending request for url (https://github.com/KenKaiii/Roamies/releases/latest/download/latest.json)', 'x', "The update didn't download. Check your internet."],
  ['update', 'Could not fetch a valid release JSON from the remote', 'x', "Couldn't check for updates. Check your internet."],
  ['update', 'The signature verification failed', 'x', "The update didn't pass its safety check. Try again later."],
  ['update', 'Permission denied (os error 13)', 'x', "I couldn't replace the app. Reinstall it from GitHub."],
  ['update', 'No space left on device (os error 28)', 'x', 'Not enough disk space for the update. Free some up.'],
  ['hearing', 'The network connection was lost.', 'x', 'Speech recognition needs the internet. Try again.'],
  ['hearing', 'Load model from parakeet.onnx failed', 'x', "My voice model didn't load. Restart Roamies."],
  ['screen', new Error('Screen Recording permission is off'), 'x', 'I need Screen Recording permission for that.'],
  ['screen', new Error("Roamies didn't answer in time."), 'x', 'The screenshot took too long. Try again.'],
  ['diagnostics', Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }), 'x', 'Not enough disk space for the diagnostics file.'],
  ['diagnostics', Object.assign(new Error("EACCES: permission denied, open '/Users/jane/Downloads/roamies-diagnostics.log'"), { code: 'EACCES' }), 'x', "I couldn't write the diagnostics file there."],
];
for (const [area, err, who, text, store] of CASES) {
  const p = explain(area, err, { who, store });
  assert.equal(p.text, text, `${area}: ${String(err?.message ?? err).slice(0, 60)}`);
  assert.equal(p.known, true);
  assert.ok(!p.text.includes(`(${p.code})`), 'a known cause needs no code in its line');
}
// Where to fix it, for the lines whose fix is on the Model page.
assert.equal(explain('reply', new Error('Not logged in')).where, 'model');
assert.equal(explain('reply', fetchFailed).where, null);
// Words in a stack's file paths don't pick a cause.
const pathy = new Error('zxqv');
pathy.stack = 'Error: zxqv\n    at f (/Users/jane/network/quota/401/keychain.mjs:1:1)';
assert.equal(explain('reply', pathy).known, false);
assert.match(explain('reply', pathy).raw, /keychain\.mjs/, 'the stack is still in the details');

// ---- Copy details: enough to trace it, nothing secret
const who = { home: '/Users/jane', user: 'jane' };
const leaky = new Error('POST https://api.example.com/v1?api_key=SECRETVALUE failed for jane.doe@example.com with Authorization: Bearer abcdefghijklmnop123456 and sk-ant-REDACTME1234567890abcdef and eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl in /Users/jane/.gg/auth.json {"refresh_token":"rt-0123456789"}');
const problem = { ...explain('sign-in', leaky, { who: 'ChatGPT' }), area: 'sign-in', at: Date.UTC(2026, 10, 11, 9, 30) };
const details = detailsText(problem, { version: '0.1.40', os: 'macOS 15.1 (darwin arm64)' }, who);
assert.match(details, /^Roamies error E10 \(sign-in\)\nVersion: 0\.1\.40\nOS: macOS 15\.1 \(darwin arm64\)\nTime: 2026-11-11T09:30:00\.000Z\nShown: Sign-in didn't work \(E10\)\. Try again\.\n\n/);
for (const secret of ['SECRETVALUE', 'jane.doe', 'abcdefghijklmnop123456', 'REDACTME', 'eyJhbGciOiJSUzI1NiJ9', '/Users/jane', 'rt-0123456789']) assert.ok(!details.includes(secret), `${secret} is scrubbed`);
assert.match(details, /POST https:\/\/api\.example\.com\/v1\?api_key=<redacted> failed for <email>/);
assert.ok(detailsText({ ...problem, raw: 'y'.repeat(20000) }, {}, who).length < 6400, 'details stay a pasteable size');
assert.match(detailsText(undefined), /^Roamies error \? \(\?\)/, 'nothing to report still makes text');

// Regression: prompt() kept readyAgent()'s message in a local `problem`, hiding problem(), so a failed request
// crashed with "problem is not a function" instead of saying what went wrong.
{
  const side = (await import('node:fs')).readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  assert.deepEqual(side.split('\n').flatMap((l, i) => (/\b(const|let|var)\s+problem\b/.test(l) ? [i + 1] : [])), [], 'nothing in sidekick.mjs hides problem()');
}

console.log('errors tests: passed');
