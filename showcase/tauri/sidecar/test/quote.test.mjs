// Handoffs carry the user's exact words (quote.mjs): to a background agent, to a model that takes a job over, and
// back in the news. Run: npm test
import assert from 'node:assert/strict';
import { askedLine, exactWords, handoffNote, userWordsBlock, withWords } from '../quote.mjs';

// Verbatim, in curly quotes; only the ends are trimmed
assert.equal(exactWords('  make the logo bigger, and keep "Woof & Co" in caps  '), '“make the logo bigger, and keep "Woof & Co" in caps”');
assert.equal(exactWords(''), '');
assert.equal(exactWords(null), '');
// Too long: cut, and it says how much is missing
const long = 'a'.repeat(1600);
assert.match(exactWords(long), /^“a{1500}… \[100 more characters not shown\]”$/);
assert.equal(exactWords('x'.repeat(40), 10), '“xxxxxxxxxx… [30 more characters not shown]”');

// An agent's brief opens with their words and says whose win
const block = userWordsBlock('Ken', 'build a page for Woof Co in blue');
assert.match(block, /^Ken's exact words, quoted verbatim\./);
assert.match(block, /their words win/);
assert.match(block, /“build a page for Woof Co in blue”$/);
assert.equal(userWordsBlock('Ken', ''), '');

// Steering: their words ride along, unless the message already has them
assert.equal(withWords('Use blue', 'Ken', ''), 'Use blue');
assert.equal(withWords('Use blue', 'Ken', 'make it blue'), 'Use blue\n\nKen\'s exact words: “make it blue”');
assert.equal(withWords('Do "make it blue" now', 'Ken', 'make it blue'), 'Do "make it blue" now');

// The note for a model taking a job over
const note = handoffNote({ userName: 'Ken', assistant: 'JARVIS', from: 'Claude Haiku 5.5', kind: 'Coding and commands', words: 'fix the login bug in app.js' });
assert.match(note, /^\(Handoff, not from Ken:/);
assert.match(note, /Claude Haiku 5\.5 was chatting with them as JARVIS/);
assert.match(note, /passed this Coding and commands job to you/);
assert.match(note, /exact words, quoted verbatim: “fix the login bug in app\.js”/);
assert.match(note, /don't reword it/);
assert.doesNotMatch(handoffNote({ userName: 'Ken', assistant: 'JARVIS', from: 'x', kind: 'y', words: '' }), /exact words/);

// Taking over after a usage limit: says who hit it and when it resets, asks for the one-line notice, keeps their words
const lim = handoffNote({ userName: 'Ken', assistant: 'JARVIS', reason: 'limit', from: 'Claude Haiku 5.5', untilText: '4:10 pm', words: 'summarise my inbox' });
assert.match(lim, /Claude Haiku 5\.5 has reached its usage limit and resets about 4:10 pm/);
assert.match(lim, /taking over as JARVIS, with the conversation so far/);
assert.match(lim, /exact words, quoted verbatim: “summarise my inbox”/);
assert.match(lim, /Open your reply with one short sentence, in character, saying Claude Haiku 5\.5 is at its limit and you're covering until about 4:10 pm/);
assert.match(handoffNote({ userName: 'Ken', assistant: 'J', reason: 'limit', from: 'X', words: '' }), /covering for now/, 'no reset time known');
// Unavailable for another reason: says why, still keeps their words
const un = handoffNote({ userName: 'Ken', assistant: 'JARVIS', reason: 'unavailable', from: 'Claude Opus 5.5', because: "its sign-in or key isn't working", untilText: '3:00 pm', words: 'fix the build' });
assert.match(un, /Claude Opus 5\.5 isn't available right now \(its sign-in or key isn't working\); it'll be tried again around 3:00 pm/);
assert.match(un, /exact words, quoted verbatim: “fix the build”/);
assert.match(un, /saying Claude Opus 5\.5 isn't available and you're covering/);
// A model they asked for by name, and the default coming back
assert.match(handoffNote({ userName: 'Ken', assistant: 'JARVIS', reason: 'named', from: 'GPT-6 Luna', words: 'use opus for this' }), /they asked for you by name/);
assert.match(handoffNote({ userName: 'Ken', assistant: 'JARVIS', reason: 'back', from: 'GPT-6 Luna' }), /GPT-6 Luna is available again, so you're back on it/);

// What was asked, in a report line
assert.equal(askedLine('Ken', 'tidy my downloads'), 'Ken asked, in their words: “tidy my downloads”');
assert.equal(askedLine('Ken', ''), '');

console.log('quote tests: passed');
