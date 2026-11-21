// Hybrid models: which kind of job a request is, and which model it should run on (route.mjs). Run: npm test
import assert from 'node:assert/strict';
import { findModelByName, findModelMention, hybridOn, isChitchat, jobKinds, kindOfTool, parseSpec, pickHeavy } from '../route.mjs';

const no = () => false; // the agent check: not under test here
const kinds = (t) => jobKinds(t, { agentCheck: no });

// Computer use
assert.deepEqual(kinds('Click the blue button in the toolbar'), ['computer']);
assert.deepEqual(kinds('can you open the Slack app and read my messages'), ['computer']);
assert.deepEqual(kinds("what's on my screen right now?"), ['computer']);
assert.deepEqual(kinds('type my address into the form'), ['computer']);

// Code, files and commands
assert.deepEqual(kinds('fix the bug in my login function'), ['code']);
assert.deepEqual(kinds('write a python script that renames these'), ['code']);
assert.deepEqual(kinds('run the tests please'), ['code']);
assert.deepEqual(kinds('git push my changes'), ['code']);
assert.deepEqual(kinds('tidy up the files in my downloads folder'), ['code']);

// Drawing and web
assert.deepEqual(kinds('draw a diagram of how DNS works'), ['draw']);
assert.deepEqual(kinds('what is the latest news about the election'), ['web']);
assert.deepEqual(kinds('search the web for dentist chairs'), ['web']);

// A request can be several kinds; computer use is listed first
assert.deepEqual(kinds('open the Figma app and draw a flowchart of the checkout'), ['computer', 'draw']);

// Ordinary chat is none, so it stays on the default model
for (const t of ['how are you today?', 'tell me a joke', "what's the capital of France", 'remind me to call mum at 5', 'thanks!', 'ok', '(Reminder: stand up)', '', null]) {
  assert.deepEqual(kinds(t), [], String(t));
}
assert.ok(isChitchat('Thanks.') && isChitchat('yes') && !isChitchat('yes, then run the tests'));

// Background agents use wantsAgent (agents.mjs)
assert.equal(jobKinds('send an agent to research dentist chairs')[0], 'agents');
assert.ok(jobKinds('send an agent to tidy my desktop').includes('agents'));
assert.ok(!jobKinds('what is an agent?').includes('agents'));

// Tools that mean a job is under way
assert.equal(kindOfTool('run_command'), 'code');
assert.equal(kindOfTool('act_in_app'), 'computer');
assert.equal(kindOfTool('web_search'), 'web');
assert.equal(kindOfTool('remember_commitment'), null);

// 'provider:model' specs (model ids may hold colons)
assert.deepEqual(parseSpec('anthropic:claude-opus-5-5'), { provider: 'anthropic', model: 'claude-opus-5-5', spec: 'anthropic:claude-opus-5-5' });
assert.equal(parseSpec('local:ollama:qwen3-vl:8b').provider, 'local');
assert.equal(parseSpec('local:ollama:qwen3-vl:8b').model, 'ollama:qwen3-vl:8b');
for (const bad of ['', ':x', 'x:', 'nocolon', null, undefined]) assert.equal(parseSpec(bad), null, String(bad));

// Picking: the first kind that has a runnable model set
const heavy = { computer: 'anthropic:claude-opus-5-5', code: 'openai:gpt-6.1-sol', web: '', draw: 'gemini:gone' };
const can = (p, m) => !(p === 'gemini');
assert.equal(pickHeavy(['code', 'computer'], heavy, can).kind, 'code'); // the order given decides
assert.equal(pickHeavy(['computer'], heavy, can).model, 'claude-opus-5-5');
assert.equal(pickHeavy(['web'], heavy, can), null); // no model set
assert.equal(pickHeavy(['draw'], heavy, can), null); // not runnable (signed out, key removed)
assert.equal(pickHeavy([], heavy, can), null);
assert.equal(hybridOn(heavy), true);
assert.equal(hybridOn({ code: '', web: '' }), false);
assert.equal(hybridOn(undefined), false);


// Naming a model in their own words: any kind of work, only models that can run
{
  const cands = [
    { provider: 'anthropic', id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
    { provider: 'anthropic', id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    { provider: 'anthropic', id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    { provider: 'openai', id: 'gpt-6-luna', name: 'GPT-6 Luna' },
    { provider: 'openai', id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    { provider: 'openai', id: 'gpt-6.1-sol-fast', name: 'GPT-6.1 Sol Fast' },
    { provider: 'gemini', id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
    { provider: 'gemini', id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
  ];
  const defaults = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-6.1-sol', gemini: 'gemini-3.8-flash' };
  const pick = (t) => findModelMention(t, cands, defaults)?.spec ?? null;
  assert.equal(pick('hand this off to Opus please'), 'anthropic:claude-opus-5-5');
  assert.equal(pick('use haiku for this one'), 'anthropic:claude-haiku-5-5');
  assert.equal(pick('ask Luna to plan my week'), 'openai:gpt-6-luna');
  assert.equal(pick('can you do the taxes summary with gemini'), 'gemini:gemini-3.8-flash', 'a platform alone: its default');
  assert.equal(pick('let claude handle it'), 'anthropic:claude-sonnet-5-5', 'default of the platform');
  assert.equal(pick('switch to Sol'), 'openai:gpt-6.1-sol', 'the plain one, not the fast variant');
  assert.equal(pick('give this to gemini 3.1 pro preview'), 'gemini:gemini-3.1-pro-preview', 'a full name wins');
  assert.equal(pick('hand it over to Claude Opus 5.5 and keep it short'), 'anthropic:claude-opus-5-5');
  // Not a hand-over, or not the model
  for (const t of ['what is Opus?', 'is haiku better than sonnet', 'write a haiku about spring', 'use the Gemini API in my script', 'use claude code to fix it', 'tell me about luna', '(Reminder: use opus)', '']) {
    assert.equal(pick(t), null, t);
  }
  // A model they can't run is never picked
  assert.equal(findModelMention('use grok for this', cands, defaults), null);
  assert.equal(findModelMention('use opus', [], defaults), null);
  // By name, for send_agent's model argument
  const by = (n) => findModelByName(n, cands, defaults)?.spec ?? null;
  assert.equal(by('opus'), 'anthropic:claude-opus-5-5');
  assert.equal(by('Gemini'), 'gemini:gemini-3.8-flash');
  assert.equal(by('openai:gpt-6-luna'), 'openai:gpt-6-luna');
  assert.equal(by('Claude Haiku 5.5'), 'anthropic:claude-haiku-5-5');
  assert.equal(by('grok'), null);
  assert.equal(by(''), null);
}

console.log('route tests: passed');
