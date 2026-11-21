// Subagents: the crew, its models (its own or hybrid's), and the brief a specialist gets (subagents.mjs). Run: npm test
import assert from 'node:assert/strict';
import { JOB_OF, SUBAGENTS, activeCrew, crewText, delegateNote, findSubagent, specialistFor, withRole } from '../subagents.mjs';

const all = () => true;
// Nobody on the crew until a model is picked
assert.deepEqual(activeCrew({}, all), []);
assert.deepEqual(activeCrew(undefined, all), []);
// Own models, in roster order; one that can't run (signed out) is left out
let c = activeCrew({ builder: 'openai:gpt-6.1-sol', scout: 'gemini:gemini-3.8-flash', tidier: 'x:y' }, (p) => p !== 'x');
assert.deepEqual(c.map((s) => s.id), ['scout', 'builder']);
assert.equal(c[0].spec.model, 'gemini-3.8-flash'); assert.equal(c[0].slot, 'sub_scout'); assert.equal(c[0].via, 'own');
// With hybrid on, a specialist with no model of its own follows the model set for its kind of job
const heavy = { code: 'anthropic:claude-opus-5-5', web: 'gemini:gemini-3.8-flash', draw: 'openai:gpt-6-luna' };
c = activeCrew({ builder: 'openai:gpt-6.1-sol' }, all, heavy);
assert.deepEqual(c.map((s) => `${s.id}:${s.via}:${s.spec.spec}`), ['scout:hybrid:gemini:gemini-3.8-flash', 'builder:own:openai:gpt-6.1-sol', 'reviewer:hybrid:anthropic:claude-opus-5-5', 'tidier:hybrid:anthropic:claude-opus-5-5']);
assert.equal(c[0].slot, 'web'); // thinks with the effort set for that job
assert.ok(!c.some((s) => s.id === 'writer'), 'the writer has no job kind, so it needs a model of its own');
// ...but not when hybrid is off (heavy not passed)
assert.deepEqual(activeCrew({}, all, null), []);
// A hybrid model that can't run leaves the specialist off
assert.deepEqual(activeCrew({}, (p) => p !== 'gemini', { web: 'gemini:gemini-3.8-flash' }), []);
// Every job kind named exists
for (const k of Object.values(JOB_OF)) assert.ok(['computer', 'code', 'agents', 'draw', 'web'].includes(k));

// Finding one by what the chat called it
const crew = activeCrew({ scout: 'a:b', builder: 'a:b' }, all);
assert.equal(findSubagent('scout', crew).id, 'scout');
assert.equal(findSubagent('the Builder agent', crew).id, 'builder');
assert.equal(findSubagent('writer', crew), null);
assert.equal(findSubagent('', crew), null);

// The brief: role first, then the chat's brief
const b = withRole(SUBAGENTS[0], 'Brief from Sam:\nfind chairs');
assert.ok(b.startsWith('You are the Scout') && b.endsWith('find chairs'));

// The line for the chat
assert.equal(crewText([]), '');
const t = crewText(crew, (s) => s.model);
assert.ok(t.includes('- scout:') && t.includes('- builder:') && !t.includes('- writer:') && t.includes('up to 3'));

// Hand off modes: 'ask' says only on request; 'auto' allows it, and nudges by the request's words
const full = activeCrew({ scout: 'a:b', builder: 'a:b', writer: 'a:b', reviewer: 'a:b', tidier: 'a:b' }, all);
assert.ok(crewText(crew, (s) => s.model, 'ask').includes('only when they ask'));
assert.ok(crewText(crew, (s) => s.model, 'auto').includes('Proactive delegation is on'));
const who = (t, c = full) => specialistFor(t, c)?.id ?? null;
assert.equal(who('what is the latest news about dentist chair prices'), 'scout');
assert.equal(who('write a python script that renames these'), 'builder');
assert.equal(who('draft a report on our Q3 numbers'), 'writer');
assert.equal(who('review my login function for bugs'), 'reviewer');
assert.equal(who('tidy up the files in my downloads folder'), 'tidier');
// Not for chit-chat, system lines, the screen, or a specialist that isn't on the crew
for (const t of ['thanks!', 'how are you', '(Reminder: stand up)', 'click the blue button', 'draw a diagram of DNS', '']) assert.equal(who(t), null, t);
assert.equal(who('search the web for dentist chairs', activeCrew({ builder: 'a:b' }, all)), null);
// The nudge only in auto mode, and it points at a specialist without taking the decision
assert.equal(delegateNote('search the web for chairs', full, 'ask'), '');
assert.match(delegateNote('search the web for chairs', full, 'auto'), /Scout subagent.*subagent "scout"/);
assert.equal(delegateNote('how are you', full, 'auto'), '');

console.log('subagents tests: passed');
