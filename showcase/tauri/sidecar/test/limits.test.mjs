// Usage limits (limits.mjs): spotting a limit, when it resets, and which model is free. Run: npm test
import assert from 'node:assert/strict';
import { COOLDOWN, becauseOf, createLimits, firstFree, isQuota, limitFrom, resetAt, untilWords } from '../limits.mjs';

const now = new Date(2026, 10, 16, 14, 30, 0).getTime(); // 2:30 pm, local
const HOUR = 3600_000, MIN = 60_000;
const err = (message, extra = {}) => Object.assign(new Error(message), extra);

// What is a limit
assert.equal(limitFrom(err('429 Too Many Requests'), now).kind, 'limit');
assert.equal(limitFrom(err('Rate limit exceeded'), now).kind, 'limit');
assert.equal(limitFrom(err("You've hit your usage limit"), now).kind, 'limit');
assert.equal(limitFrom(err('Request failed', { status: 429 }), now).kind, 'limit');
assert.equal(limitFrom(err('boom', { cause: err('quota exceeded for this project') }), now).kind, 'limit', 'found in the chain');
assert.equal(limitFrom(err('Your credit balance is too low'), now).kind, 'credit');
assert.equal(limitFrom(err('insufficient_quota'), now).kind, 'credit', 'credit wins over quota');
// Gemini free tier: the 429's "check your plan and billing details" is a rate limit, not an empty wallet.
assert.equal(limitFrom(err('Gemini API error (429): {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}', { status: 429 }), now).kind, 'limit');
assert.equal(limitFrom(err('You exceeded your current quota, please check your plan and billing details.', { status: 402 }), now).kind, 'credit', '402 is credit even without the word');
// Its retryDelay is the wait, not the 5-minute default.
assert.equal(resetAt(null, '{"retryDelay": "30s"}', now), now + 30_000);
assert.equal(resetAt(null, '"retryDelay": "2m"', now), now + 2 * MIN);
assert.equal(limitFrom(err('Overloaded'), now).kind, 'busy');
assert.equal(limitFrom(err('Request failed', { status: 529 }), now).kind, 'busy');
// Unavailable for other reasons: sign-in or key, the model gone from the account, can't be reached
assert.equal(limitFrom(err('Request failed', { status: 401 }), now).kind, 'auth');
assert.equal(limitFrom(err('Invalid API key provided'), now).kind, 'auth');
assert.equal(limitFrom(err('The token has expired, sign in again'), now).kind, 'auth');
assert.equal(limitFrom(err('model_not_found: no such model'), now).kind, 'missing');
assert.equal(limitFrom(err('Request failed', { status: 404 }), now).kind, 'missing');
assert.equal(limitFrom(err('connect ECONNREFUSED 127.0.0.1:11434'), now).kind, 'down');
assert.equal(limitFrom(err('fetch failed', { cause: err('getaddrinfo ENOTFOUND api.example.com') }), now).kind, 'down');
assert.equal(limitFrom(err('Bad Gateway'), now).kind, 'down');
assert.equal(limitFrom(err('boom', { status: 500 }), now).kind, 'down');
assert.equal(limitFrom(err('429 quota exceeded'), now).kind, 'limit', 'a limit is a limit even with a status in it');
assert.equal(limitFrom(err('boom', { status: 403 }), now).until, now + COOLDOWN.auth);
assert.equal(limitFrom(err('model_not_found'), now).until, now + COOLDOWN.missing);
assert.ok(isQuota('limit') && isQuota('credit') && !isQuota('auth') && !isQuota('down'));
assert.match(becauseOf('auth'), /sign-in or key/);
assert.match(becauseOf('missing'), /isn't available on the account/);

// Not about the model at all
for (const bad of ['ENOENT: no such file or directory', 'Unexpected token < in JSON at position 0', 'The operation was aborted', 'Invalid tool arguments', '', null, undefined]) {
  assert.equal(limitFrom(bad instanceof Error || bad == null ? bad : err(bad), now), null, String(bad));
}

// When it resets: the platform's own words first, else a cool-down by kind
assert.equal(limitFrom(err('429'), now).until, now + COOLDOWN.limit);
assert.equal(limitFrom(err('insufficient_quota'), now).until, now + COOLDOWN.credit);
assert.equal(limitFrom(err('overloaded'), now).until, now + COOLDOWN.busy);
assert.equal(resetAt(err('x', { headers: { 'retry-after': '90' } }), 'x', now), now + 90_000);
assert.equal(resetAt(err('x', { headers: { get: (k) => (k === 'retry-after' ? '30' : null) } }), 'x', now), now + 30_000);
assert.equal(resetAt(err('Rate limit. Please try again in 20 minutes.'), 'Rate limit. Please try again in 20 minutes.', now), now + 20 * MIN);
assert.equal(resetAt(null, 'try again in 1.5s', now), now + 1500);
assert.equal(resetAt(null, 'limit reached, resets in 2 hours', now), now + 2 * HOUR);
assert.equal(resetAt(null, "You've hit your limit · resets 4pm", now), new Date(2026, 10, 16, 16, 0).getTime());
assert.equal(resetAt(null, 'resets at 5:15 pm', now), new Date(2026, 10, 16, 17, 15).getTime());
assert.equal(resetAt(null, 'resets 1am', now), new Date(2026, 10, 17, 1, 0).getTime(), 'a time already past is tomorrow');
assert.equal(resetAt(null, 'resets 12am', now), new Date(2026, 10, 17, 0, 0).getTime());
assert.equal(resetAt(null, 'nothing useful here', now), null);
// Kept sane: at least 30 s, at most a day
assert.equal(limitFrom(err('429 try again in 1s'), now).until, now + 30_000);
assert.equal(limitFrom(err('429 resets in 90 hours'), now).until, now + 24 * HOUR);

// The tracker forgets a limit once it has reset
{
  let t = now;
  const lim = createLimits({ now: () => t });
  assert.equal(lim.isLimited('anthropic'), false);
  lim.mark('anthropic', now + 10 * MIN);
  assert.equal(lim.isLimited('anthropic'), true);
  assert.equal(lim.until('anthropic'), now + 10 * MIN);
  lim.mark('anthropic', now + 5 * MIN); // a shorter one never shortens it
  assert.equal(lim.until('anthropic'), now + 10 * MIN);
  assert.deepEqual(lim.list(), [{ key: 'anthropic', until: now + 10 * MIN, kind: 'limit' }]);
  t = now + 11 * MIN;
  assert.equal(lim.isLimited('anthropic'), false, 'reset');
  assert.deepEqual(lim.list(), []);
  lim.mark('openai', t + MIN); lim.clear('openai');
  assert.equal(lim.isLimited('openai'), false);
}

// The chain: default, then the backups, in order; the first free one is used
{
  const lim = createLimits({ now: () => now });
  const luna = { provider: 'openai', model: 'gpt-6-luna', spec: 'openai:gpt-6-luna' };
  const haiku = { provider: 'anthropic', model: 'claude-haiku-5-5', spec: 'anthropic:claude-haiku-5-5' };
  const gem = { provider: 'gemini', model: 'gemini-3.8-flash', spec: 'gemini:gemini-3.8-flash' };
  const order = [luna, haiku, gem];
  assert.equal(firstFree(order, lim).pick, luna);
  lim.mark('openai', now + HOUR);
  let r = firstFree(order, lim);
  assert.equal(r.pick, haiku); assert.deepEqual(r.skipped, [luna]);
  lim.mark('anthropic', now + HOUR);
  r = firstFree(order, lim);
  assert.equal(r.pick, gem); assert.deepEqual(r.skipped, [luna, haiku]);
  lim.mark('gemini', now + HOUR);
  assert.equal(firstFree(order, lim).pick, null, 'all at their limit');
  // Duplicates and gaps are ignored; two models on one platform share its limit
  assert.equal(firstFree([null, luna, luna, undefined], createLimits({ now: () => now })).pick, luna);
  const luna2 = { provider: 'openai', model: 'gpt-6.1-sol', spec: 'openai:gpt-6.1-sol' };
  const l2 = createLimits({ now: () => now }); l2.mark('openai', now + HOUR);
  assert.equal(firstFree([luna, luna2, haiku], l2).pick, haiku);
}

// One model gone from the account is skipped on its own; its platform's other models stay usable
{
  const lim = createLimits({ now: () => now });
  const a = { provider: 'anthropic', model: 'claude-opus-5-5', spec: 'anthropic:claude-opus-5-5' };
  const b = { provider: 'anthropic', model: 'claude-haiku-5-5', spec: 'anthropic:claude-haiku-5-5' };
  lim.mark('anthropic:claude-opus-5-5', now + HOUR, 'missing');
  assert.equal(firstFree([a, b], lim).pick, b);
  assert.deepEqual(lim.infoFor(a), { key: 'anthropic:claude-opus-5-5', until: now + HOUR, kind: 'missing' });
  assert.equal(lim.infoFor(b), null);
  assert.equal(lim.kind('anthropic:claude-opus-5-5'), 'missing');
}
// The order they asked for: the model for the job, then the default, then the backups; each skipped when its platform
// is unavailable, so a backup on the same dead platform as the first two is passed over too
{
  const lim = createLimits({ now: () => now });
  const job = { provider: 'anthropic', model: 'claude-opus-5-5', spec: 'anthropic:claude-opus-5-5' };
  const dflt = { provider: 'anthropic', model: 'claude-haiku-5-5', spec: 'anthropic:claude-haiku-5-5' };
  const b1 = { provider: 'anthropic', model: 'claude-sonnet-5-5', spec: 'anthropic:claude-sonnet-5-5' };
  const b2 = { provider: 'gemini', model: 'gemini-3.8-flash', spec: 'gemini:gemini-3.8-flash' };
  assert.equal(firstFree([job, dflt, b1, b2], lim).pick, job);
  lim.mark('anthropic', now + HOUR, 'auth'); // the whole platform is out: job, default and first backup all on it
  const r = firstFree([job, dflt, b1, b2], lim);
  assert.equal(r.pick, b2);
  assert.deepEqual(r.skipped.map((x) => x.model), ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
  // Only the job's own platform down: the default takes it
  const lim2 = createLimits({ now: () => now }); lim2.mark('openai', now + HOUR, 'down');
  const jobO = { provider: 'openai', model: 'gpt-6.1-sol', spec: 'openai:gpt-6.1-sol' };
  assert.equal(firstFree([jobO, dflt, b1, b2], lim2).pick, dflt);
}

// Telling them when
assert.equal(untilWords(new Date(2026, 10, 16, 16, 10).getTime(), now), '4:10 pm');
assert.equal(untilWords(new Date(2026, 10, 16, 9, 5).getTime() + 24 * HOUR, now), 'tomorrow 9:05 am');
assert.equal(untilWords(new Date(2026, 10, 16, 0, 0).getTime(), now), '12:00 am');
assert.equal(untilWords(NaN, now), '');

console.log('limits tests: passed');
