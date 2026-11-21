// What the setup guide offers to connect. Run: npm test
import assert from 'node:assert/strict';
import { AUTH_PROVIDERS, apiKeyStorageKeys, getAuthStorageKeys, getModelsForProvider, storageKeyProvider } from '@kenkaiiii/gg-core';
import { KEY_LINKS, fallbackModel, keyCards, keyKinds, seesImages, signInCards } from '../providers.mjs';
import { SAFE, checkLink } from '../safety.mjs';

const cards = signInCards(['anthropic', 'openai'], (id) => id === 'openai');
assert.deepEqual(cards.map((c) => c.name), ['Claude', 'ChatGPT'], 'Kimi, Grok and Google sign-ins were retired in gg-core 5.95');
assert.deepEqual(cards.filter((c) => c.connected).map((c) => c.id), ['openai']);

// Regression: only the providers in a <select> were offered, and it showed one name until opened.
const keys = keyCards(AUTH_PROVIDERS, (id) => id === 'deepseek');
assert.deepEqual(keys.map((k) => k.id), ['anthropic', 'openai', 'gemini', 'xai', 'kimi-code', 'moonshot', 'glm', 'minimax', 'xiaomi', 'xiaomi-credits', 'deepseek', 'sakana', 'opencode-go', 'opencode', 'openrouter', 'huggingface'],
  'every kind of API key, Anthropic and OpenAI included; Kimi and Xiaomi have a plan key and a pay-per-token key');
assert.equal(keys.find((k) => k.id === 'kimi-code').name, 'Kimi Code', 'short names, so each card is one line');
assert.deepEqual(['opencode-go', 'opencode'].map((id) => keys.find((k) => k.id === id).name), ['OpenCode Go', 'OpenCode'], 'the two OpenCode keys have different names');
assert.deepEqual(keys.filter((k) => k.connected).map((k) => k.id), ['deepseek']);
for (const k of keys) {
  assert.ok(k.link, `${k.id} has a "Get a key" link`);
  assert.equal(new URL(k.link).protocol, 'https:');
  assert.equal(checkLink(k.link).level, SAFE, `${k.id}'s link passes open_link`);
  assert.ok(k.name.length <= 13, `${k.id}'s name fits a one-line card`);
}
assert.deepEqual(Object.keys(KEY_LINKS).sort(), keys.map((k) => k.id).sort(), 'no links for providers that are gone');

// Regression: a Moonshot key was saved as a Kimi Code plan key (the first kind) and never worked.
for (const p of AUTH_PROVIDERS.filter((x) => x.methods.includes('apikey'))) {
  const kinds = keyKinds(p).map(([id]) => id);
  for (const id of kinds) assert.equal(storageKeyProvider(id), p.value, `${id} saves under ${p.value}`);
  if (kinds.length > 1) assert.deepEqual(kinds.sort(), apiKeyStorageKeys(p.value).sort(), `${p.value}: a card for each kind of key`);
  // Every model can be reached by a sign-in or a key the guide offers.
  for (const m of getModelsForProvider(p.value)) {
    assert.ok(getAuthStorageKeys(p.value, m.id).some((k) => k === p.value || apiKeyStorageKeys(p.value).includes(k)), `${m.id} has a way in`);
  }
}
console.log('providers ok');

// Regression (#29): a saved key or sign-in couldn't be removed. Removing clears every place a provider keeps one.
{
  const { AuthStorage, OPENAI_CHATGPT_KEY } = await import('@kenkaiiii/gg-core');
  const { accountKeys } = await import('../providers.mjs');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'roamies-auth-'));
  const auth = new AuthStorage(path.join(dir, 'auth.json'));
  const creds = { accessToken: 'k', refreshToken: '', expiresAt: Date.now() + 864e5 };
  const apiProviders = AUTH_PROVIDERS.filter((x) => x.methods.includes('apikey'));
  // Where apiKeyLogin saves each kind (Gemini's key goes under gemini-api).
  for (const p of apiProviders) for (const k of apiKeyStorageKeys(p.value)) await auth.setCredentials(k, creds);
  await auth.setCredentials(OPENAI_CHATGPT_KEY, creds);
  for (const p of apiProviders) {
    assert.ok(await auth.hasProviderAuth(p.value), `${p.value} starts connected`);
    for (const k of accountKeys(p.value)) await auth.clearCredentials(k);
    assert.equal(await auth.hasProviderAuth(p.value), false, `${p.value}: removing it leaves no key or sign-in`);
  }
  assert.deepEqual(await auth.listProviders(), [], 'nothing left behind');
  await fs.rm(dir, { recursive: true, force: true });
}

// Roamies reads screenshots: models that can't see images are left out, and every provider keeps one that can.
assert.equal(seesImages('glm', 'glm-5.3'), false, 'GLM 5.3 reads text only');
assert.equal(seesImages('deepseek', 'deepseek-v4-pro'), false);
assert.equal(seesImages('opencode', 'opencode/glm-5.3'), false);
assert.equal(seesImages('anthropic', 'glm-5.3'), false, 'checked against the provider asked about');
assert.equal(seesImages('glm', 'no-such-model'), false);
for (const p of AUTH_PROVIDERS.map((x) => x.value)) {
  const models = getModelsForProvider(p);
  if (models.length) assert.ok(models.some((m) => seesImages(p, m.id)), `${p}: has a model that can see images`);
}

// Regression (#94): signing out and in again (or an update) dropped the picked Sonnet for the fast Haiku.
{
  const runs = ['claude-haiku-5-5', 'claude-sonnet-5-5'];
  const can = (id) => runs.includes(id), runnable = runs.map((id) => ({ id }));
  assert.equal(fallbackModel(['claude-sonnet-5-5', 'claude-haiku-5-5'], can, runnable), 'claude-sonnet-5-5', 'the last pick wins');
  assert.equal(fallbackModel([undefined, 'claude-haiku-5-5'], can, runnable), 'claude-haiku-5-5', 'nothing picked yet: the fast one');
  assert.equal(fallbackModel(['gone', 'also-gone'], can, runnable), 'claude-haiku-5-5', 'none can run: the first runnable');
}
