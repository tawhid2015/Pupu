import assert from 'node:assert/strict';
import { SpeechText, speakable, CueFilter, VOICE_CUES, CUE_INTENSITY, endsWithQuestion, LISTEN_SECS, listenWait, listensAfter, hasBengali } from '../speech.mjs';

const said = (chunks, flushAt = []) => {
  const out = [];
  const s = new SpeechText((t) => out.push(t));
  chunks.forEach((c, i) => { s.push(c); if (flushAt.includes(i)) s.flush(); });
  s.flush();
  return out;
};

// Sentences go out as soon as they end, even when the stream splits them oddly.
assert.deepEqual(said(['It', "'s 36. That's", ' 15 percent of 240. Want', ' the tip too?']), ["It's 36.", "That's 15 percent of 240.", 'Want the tip too?']);
// A preamble before a tool call is spoken right away (flushed at the tool call), without waiting for more text.
assert.deepEqual(said(['On it, checking the weather in Paris'], [0]), ['On it, checking the weather in Paris']);
// Cards: the one-sentence answer is said; the points and sources are only shown.
assert.deepEqual(said(['Paris will be sunny, around 18 degrees.\n- Morning: 12°C, clear\n- Afternoon: 18°C\n', 'Sources: [BBC](https://bbc.co.uk) [Met](https://x.y)']), ['Paris will be sunny, around 18 degrees.']);
// Drafts quoted with "> ", numbered steps, code blocks, tables and headings stay on screen.
assert.deepEqual(said(["Here's a draft for your landlord.\n> Hi Sam, the rent will be a few days late.\n> Thanks, Ken\nShall I send it?"]), ["Here's a draft for your landlord.", 'Shall I send it?']);
assert.deepEqual(said(['Two steps.\n1. Open Settings\n2. Click Wi-Fi\nThen try again.']), ['Two steps.', 'Then try again.']);
assert.deepEqual(said(['Run this:\n```\nnpm install\nnpm test\n```\nThat should fix it.']), ['Run this:', 'That should fix it.']);
assert.deepEqual(said(['## Title\n| a | b |\n|---|---|\nDone.']), ['Done.']);
// A list marker split across chunks is still recognised.
assert.deepEqual(said(['Ok.\n', '-', ' item one\n', 'Bye.']), ['Ok.', 'Bye.']);
assert.deepEqual(said(['Ok.\n1', '0. tenth step\nBye.']), ['Ok.', 'Bye.']);
// Decimals and versions don't end a sentence.
assert.deepEqual(said(['Version 3.5 is out. It costs $4.99 now.']), ['Version 3.5 is out.', 'It costs $4.99 now.']);
// The Bangla voice must never be handed English text: a short English progress line is dropped instead of being
// read with a Bengali model (which came out as gibberish).
assert.ok(hasBengali('আমি ভালো আছি।'));
assert.ok(!hasBengali('Checking the latest YouTube livestreams.'));
assert.ok(!hasBengali(''));
// Bengali sentences end with a danda (।), not a Latin dot: split there so TTS gets short lines, not one long run.
assert.deepEqual(said(['আমি ভালো আছি। আপনি কেমন আছেন?']), ['আমি ভালো আছি।', 'আপনি কেমন আছেন?']);
assert.deepEqual(said(['হ্যাঁ॥ ঠিক আছে।']), ['হ্যাঁ॥', 'ঠিক আছে।']);
// Run-on text is spoken in pieces instead of waiting for the end.
const long = said([`${'word '.repeat(30)}, ${'more '.repeat(30)}`]);
assert.ok(long.length >= 2 && long.every((s) => s.length <= 230), JSON.stringify(long));

// Cleaning: no markdown, links, URLs, paths, emoji or long code; short code words stay; brackets lose their brackets.
assert.equal(speakable('**36** is the answer 🎉'), '36 is the answer');
assert.equal(speakable('See [the docs](https://fish.audio/docs) or https://example.com/a?b=1.'), 'See the docs or.');
assert.equal(speakable('Open `~/Downloads/report.pdf` now'), 'Open now');
assert.equal(speakable('Run `npm` first'), 'Run npm first');
assert.equal(speakable('Saved to /Users/ken/Documents/notes.txt.'), 'Saved to.');
assert.equal(speakable('Hi [landlord name], thanks'), 'Hi landlord name, thanks');
assert.equal(speakable('Hi [Landlord]'), 'Hi Landlord', 'not a cue: brackets go');
assert.equal(speakable('✅ 🎬'), '');
assert.equal(speakable('*waves* hello'), 'waves hello');
// Maths symbols are said as words (#120); the text on screen keeps them.
assert.equal(speakable('3² is 9.'), '3 squared is 9.');
assert.equal(speakable('A cube of side 2 has volume 2³.'), 'A cube of side 2 has volume 2 cubed.');
assert.equal(speakable('That is 10⁶, and 10⁻³ is small.'), 'That is 10 to the power of 6, and 10 to the power of minus 3 is small.');
assert.equal(speakable('x^2 + y^10'), 'x squared + y to the power of 10');
assert.equal(speakable('12 ÷ 4 = 3'), '12 divided by 4 = 3');
assert.equal(speakable('6 × 7 is 42, and 6*7 too.'), '6 times 7 is 42, and 6 times 7 too.');
assert.equal(speakable('√16 is 4.'), 'the square root of 16 is 4.');
assert.equal(speakable('It is 25°C, about 77 °F.'), 'It is 25 degrees Celsius, about 77 degrees Fahrenheit.');
assert.equal(speakable('π ≈ 3.14'), 'pi is about 3.14');
assert.equal(speakable('5 − 2 ± 1'), '5 minus 2 plus or minus 1');
// Blank lines between the spoken answer and the points (the usual card shape), streamed or all at once.
const card = "Paris looks gray, around 11 degrees. Bring an umbrella.\n\n- Calm, overcast weather.\n- No storm alerts.\n\nSources: [Sortir](https://x.y/a)";
assert.deepEqual(said([card]), ['Paris looks gray, around 11 degrees.', 'Bring an umbrella.']);
assert.deepEqual(said([...card]), ['Paris looks gray, around 11 degrees.', 'Bring an umbrella.'], 'one character at a time');
assert.deepEqual(said(['Draft below.\n\n> Hi,\n>\n> rent is late.\n\nWant changes?']), ['Draft below.', 'Want changes?']);
// Voice cues are kept for Fish (lower-cased); unknown brackets are unwrapped; a cue alone says nothing.
assert.equal(speakable('[Chuckling] Ha, nice one.'), '[chuckling] Ha, nice one.');
assert.equal(speakable('[slightly sad] Oh no. [break] Let me fix it.'), '[slightly sad] Oh no. [break] Let me fix it.');
assert.equal(speakable('[dry, amused] Sure.'), '[dry, amused] Sure.');
assert.equal(speakable('[warm and curious] Tell me more.'), '[warm and curious] Tell me more.');
assert.equal(speakable('[laughing]'), '');
assert.deepEqual(said(['[excited] We did it! ', '[break] Now rest.']), ['[excited] We did it!', '[break] Now rest.']);
// The body's emote sets the tone of the next sentence only, unless the sentence brings its own cue.
{
  const out = [], s = new SpeechText((t) => out.push(t));
  s.emote('hype'); s.push('You shipped it! Proud of you. '); s.emote('wave'); s.push('[calm] Bye now.'); s.flush();
  assert.deepEqual(out, ['[excited] You shipped it!', 'Proud of you.', '[calm] Bye now.']);
}
// On screen: cues are removed even when split across chunks; other brackets and links are untouched.
{
  const f = new CueFilter();
  const shown = ['[chuck', 'ling] Ha, nice, [landlord] ok ', '[break]', 'done [docs](https://x.y) [slightly ', 'sad] Oh.', ' [unfinished'].map((c) => f.push(c)).join('') + f.flush();
  assert.equal(shown, 'Ha, nice, [landlord] ok done [docs](https://x.y) Oh. [unfinished');
  assert.equal(new CueFilter().push('Array[0] and [x]'), 'Array[0] and [x]');
  // No stray spaces where a cue was, whatever the chunking.
  const run = (chunks) => { const g = new CueFilter(); return chunks.map((c) => g.push(c)).join('') + g.flush(); };
  assert.equal(run(['[empathetic]', ' Oh, sorry.', ' [break]', ' Losing a dog hurts.']), 'Oh, sorry. Losing a dog hurts.');
  assert.equal(run(['bugs. [chuckling] Your names']), 'bugs. Your names');
  assert.equal(run(['bugs. ', '[chuck', 'ling]', ' Your names']), 'bugs. Your names');
  assert.equal(run(['Hi', ' there']), 'Hi there', 'ordinary spaces between chunks stay');
}
// Every Fish cue is kept for the voice and hidden on screen, in any case, with or without an intensity.
{
  const all = Object.values(VOICE_CUES).flat();
  assert.ok(all.length >= 90, `all of Fish's cues (${all.length})`);
  for (const c of all) {
    assert.equal(speakable(`[${c.toUpperCase()}] Hi.`), `[${c}] Hi.`, c);
    assert.equal(new CueFilter().push(`Ok. [${c}] Hi.`), 'Ok. Hi.', c);
  }
  for (const i of CUE_INTENSITY) assert.equal(speakable(`[${i} sad] Oh.`), `[${i} sad] Oh.`, i);
  assert.equal(speakable('[sad][whispering] I miss you.'), '[sad][whispering] I miss you.', 'stacked');
  assert.equal(speakable('[very shouting] Hi.'), '[very shouting] Hi.', 'intensity on a tone');
}
// Free descriptions S2 understands: a cue at a sentence start, text anywhere else.
assert.equal(speakable('[caring] Your thesis can wait.'), '[caring] Your thesis can wait.');
assert.equal(speakable('Long day. [quietly proud] You did it.'), 'Long day. [quietly proud] You did it.');
assert.equal(speakable('Hi [landlord name], the rent is late.'), 'Hi landlord name, the rent is late.');
assert.equal(speakable('[Landlord Name] is fine.'), 'Landlord Name is fine.');
{
  const run = (chunks) => { const g = new CueFilter(); return chunks.map((c) => g.push(c)).join('') + g.flush(); };
  assert.equal(run(["It's past midnight. [caring] Your thesis can wait."]), "It's past midnight. Your thesis can wait.");
  assert.equal(run(["It's past midnight. ", '[car', 'ing] Your thesis can wait.']), "It's past midnight. Your thesis can wait.");
  assert.equal(run(['[soothing] Breathe.']), 'Breathe.');
  assert.equal(run(['Read more. [docs](https://x.y)']), 'Read more. [docs](https://x.y)', 'links stay');
  assert.equal(run(['Read more. [docs]', '(https://x.y) ok']), 'Read more. [docs](https://x.y) ok', 'links split across chunks stay');
  assert.equal(run(['Hi [landlord name], rent is late.\n> Thanks,\n> [your name]']), 'Hi [landlord name], rent is late.\n> Thanks,\n> [your name]');
}
console.log('speech text tests: passed');
{ // Plain-words delivery cues (Drama 3 performs them) are spoken but never shown.
  const f = new CueFilter();
  assert.equal(f.push('[quietly, a little embarrassed] Oops, I missed that. ') + f.push('[bright and bouncy] You did it!'), 'Oops, I missed that. You did it!');
  assert.equal(speakable('[bright and bouncy] You did it!'), '[bright and bouncy] You did it!');
}

// A line that ends before a tool call is spoken at once; the bubble's "On it." beat is still held by the request loop
// until the call starts streaming, so a slow drawing doesn't leave the answer on screen before the voice starts.
{
  const out = [];
  const s = new SpeechText((t) => out.push(t));
  s.push('On it, drawing the engine now.');
  assert.deepEqual(out, ['On it, drawing the engine now.'], 'a complete sentence is said as soon as it lands');
  s.flush();
  assert.deepEqual(out, ['On it, drawing the engine now.']);
  const { readFileSync } = await import('node:fs');
  const side = readFileSync(new URL('../sidekick.mjs', import.meta.url), 'utf8');
  assert.match(side, /e\.type === 'toolcall_delta'\) \{\s*spoken\?\.flush\(\)/, 'speech is flushed as soon as a tool call starts streaming');
}

// Auto-listen: only a reply whose last words are a question opens the mic.
assert.equal(endsWithQuestion('Want the tip too?'), true);
assert.equal(endsWithQuestion('Done.'), false);
assert.equal(endsWithQuestion('Shall I send it? [warm]'), true);
assert.equal(endsWithQuestion('**Which one?**'), true);
assert.equal(endsWithQuestion('Want me to check? I already sent it.'), false);
assert.equal(endsWithQuestion('Two options.\n- Paris\n- Rome\nWhich one?'), true);
assert.equal(endsWithQuestion('Ready? 🙂\n'), true);
assert.equal(endsWithQuestion('He said "really?"'), true);
assert.equal(endsWithQuestion(''), false);
assert.equal(endsWithQuestion(null), false);

// Auto-listen after every reply (#44): a statement opens the mic too when they chose it; a question always does.
assert.equal(listensAfter('Done, the file is saved.', false), false);
assert.equal(listensAfter('Done, the file is saved.', true), true);
assert.equal(listensAfter('Want me to open it?', false), true);
// How long the mic waits: one of the choices, else 8 s (an old or hand-edited config).
assert.deepEqual(LISTEN_SECS, [3, 5, 8, 10, 15]);
for (const s of LISTEN_SECS) assert.equal(listenWait(s), s);
for (const s of [undefined, 0, 2, 7, 60, '5']) assert.equal(listenWait(s), 8);

// VoiceStudio (early): the first chunk is cut at the first clause break 30+ characters in, or at a word past 60 with no
// sentence ended; later chunks use the normal sentence rules. The default path doesn't cut at commas.
const early = (chunks, opts = { early: true }) => {
  const out = [];
  const s = new SpeechText((t) => out.push(t), opts);
  chunks.forEach((c) => s.push(c));
  s.flush();
  return out;
};
assert.deepEqual(early(['Sure, I can check the weather in Paris for you today, one moment. Then I will tell you. Bye.']), ['Sure, I can check the weather in Paris for you today,', 'one moment.', 'Then I will tell you.', 'Bye.']);
assert.deepEqual(said(['Sure, I can check the weather in Paris for you today, one moment.']), ['Sure, I can check the weather in Paris for you today, one moment.'], 'default: no early cut');
{ // Nothing is said before the clause break is in (streamed), and a spaced dash is cut without being said.
  const out = [], s = new SpeechText((t) => out.push(t), { early: true });
  s.push('Sure, I can check the weather in Paris');
  assert.deepEqual(out, [], 'waits for the break');
  s.push(' for you today, one moment.');
  assert.deepEqual(out, ['Sure, I can check the weather in Paris for you today,', 'one moment.'], 'both complete pieces go out now');
  assert.deepEqual(early(['Paris is lovely this spring of the year - it is mild and sunny most days here.']), ['Paris is lovely this spring of the year', 'it is mild and sunny most days here.']);
}
// The built-in voice starts sooner: a short first clause (16+) or a word past 28, without touching the playback rate.
assert.deepEqual(early(['I can check your calendar for you, one moment.'], { early: true, earlyMin: 16, earlyWords: 28 }), ['I can check your calendar for you,', 'one moment.']);
{ // A complete first sentence is spoken the moment it lands, not once the next token (or a newline) arrives.
  const out = [], s = new SpeechText((t) => out.push(t), { early: true, earlyMin: 16, earlyWords: 28 });
  s.push('আজকের খবর দেখছি।');
  assert.deepEqual(out, ['আজকের খবর দেখছি।']);
  s.push('এখন বলছি।');
  assert.deepEqual(out, ['আজকের খবর দেখছি।', 'এখন বলছি।']);
  s.flush();
}
{
  const text = 'word '.repeat(20).trim();
  const got = early([text], { early: true, earlyMin: 16, earlyWords: 28 });
  assert.equal(got.length, 2); assert.equal(got[0].length, 24, 'cut at the last word before 28');
  assert.equal(got.join(' '), text);
}
// No break 30+ in, and a sentence already ended: the normal rules say the first sentence.
assert.deepEqual(early(['Hi there. Let me check the weather in Paris for you now.']), ['Hi there.', 'Let me check the weather in Paris for you now.']);
// No break and no sentence end, past 60 characters: cut at a word (the rest follows).
{
  const text = 'word '.repeat(20).trim();
  const got = early([text]);
  assert.equal(got.length, 2); assert.equal(got[0].length, 59, 'cut at the last word before 60');
  assert.equal(got.join(' '), text);
}
// A finished reply's last sentence is complete at the flush: said whole. Past 60 characters with no end, it's cut at a word.
{
  assert.deepEqual(early(['Here is the answer for you today.']), ['Here is the answer for you today.']);
  assert.deepEqual(early(['Yes, sure.']), ['Yes, sure.']);
  const long = 'It is a long sentence that goes on and on without any clause break at all.';
  assert.equal(early([long]).join(' '), long);
}
// Cap: once the spoken characters reach the cap, nothing more is said (whole chunks only); flush after it is a no-op.
{
  const out = [];
  const s = new SpeechText((t) => out.push(t), { cap: 25 });
  s.push('First sentence here. Second one. Third one is here too. Fourth.'); s.flush();
  assert.deepEqual(out, ['First sentence here.', 'Second one.'], 'the chunk that reaches the cap is whole; the rest is not said');
  s.push('More text. '); s.flush();
  assert.deepEqual(out, ['First sentence here.', 'Second one.'], 'no more after the cap, even at flush');
}
{ // Early and cap together: the first chunk is short, and the cap still applies after it.
  const out = [];
  const s = new SpeechText((t) => out.push(t), { early: true, cap: 60 });
  s.push('Sure, I can check the weather in Paris for you today, one moment. Then I will tell you more about it. Bye.'); s.flush();
  assert.deepEqual(out, ['Sure, I can check the weather in Paris for you today,', 'one moment.'], 'capped after 60 characters');
}
console.log('speech early and cap tests: passed');

{ // The face follows the voice: every mood, tone and sound has a feeling (but the plain ones), and the feelings read.
  const { cueFeel, FEELS } = await import('../speech.mjs');
  const plain = new Set(['narrator', 'emphasis', 'clear throat']);
  for (const c of [...VOICE_CUES.emotions, ...VOICE_CUES.tones, ...VOICE_CUES.sounds]) if (!plain.has(c)) assert.ok(cueFeel(`[${c}] Hi.`), `${c} has a feeling`);
  const all = Object.values(FEELS).flat();
  assert.equal(new Set(all).size, all.length, 'each cue in one feeling');
  assert.equal(cueFeel('[slightly sad] Oh no.'), 'sad');
  assert.equal(cueFeel('[warm and curious] Tell me.'), 'warm');
  assert.equal(cueFeel('[quietly, a little embarrassed] Oops.'), 'sad');
  assert.equal(cueFeel('[laughing] Ha ha, fair.'), 'laugh');
  assert.equal(cueFeel('It is [emphasis] today, [excited] wow.'), 'joy', 'the first cue with a feeling');
  assert.equal(cueFeel('No cue here.'), null);
  assert.equal(cueFeel('[narrator] Once.'), null);
  const agent = (await import('node:fs')).readFileSync(new URL('../../../roamies/agent.js', import.meta.url), 'utf8');
  const drawn = agent.slice(agent.indexOf('const FEEL = {'), agent.indexOf('};', agent.indexOf('const FEEL = {')));
  for (const f of Object.keys(FEELS)) assert.match(drawn, new RegExp(`\\n\\s+${f}: \\{`), `the face draws ${f}`);
  console.log('cue feeling tests: passed');
}
