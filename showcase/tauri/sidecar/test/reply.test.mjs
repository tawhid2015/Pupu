// Reply stream: emote tags are parsed out of the model's text, and a turn that only repeats the
// previous one is dropped. Run: npm test
import assert from 'node:assert/strict';
const { ReplyStream } = await import('../reply.mjs');
const run = (turns, chunk = 3) => {
  const out = []; const r = new ReplyStream((e) => out.push(e));
  turns.forEach((t, i) => { for (let k = 0; k < t.length; k += chunk) r.push(t.slice(k, k + chunk)); if (i < turns.length - 1) r.endTurn(); });
  r.finish();
  return { text: out.filter((e) => e.type === 'text').map((e) => e.text).join(''), emotes: out.filter((e) => e.type === 'emote').map((e) => e.action) };
};
const reply = "Hey Ken! Not much, just glowing on your screen. What are we doing?";
// The bug: same reply repeated after a tool turn → shown once.
let r = run([`[wave] ${reply}`, reply]);
assert.equal(r.text, reply); assert.deepEqual(r.emotes, ['wave']);
// Repeat with different whitespace/case still dropped.
r = run([reply, '  hey ken!   Not much, just glowing on your screen.  What are we doing?']);
assert.equal(r.text, reply);
// A new turn that only starts like the old one is kept, joined with a space.
r = run(['Let me look.', 'Let me look. Your screen shows Brave.']);
assert.equal(r.text, 'Let me look. Let me look. Your screen shows Brave.');
// Genuinely different follow-up after a tool → appended with a space.
r = run(['Let me check your screen.', 'You have Brave open.']);
assert.equal(r.text, 'Let me check your screen. You have Brave open.');
// Tags split across every chunk size, in the middle too.
for (const n of [1, 2, 3, 5, 8]) {
  r = run(['[hype] Nice work! [motivate]Now post it.'], n);
  assert.equal(r.text, 'Nice work! Now post it.', `chunk ${n}`); assert.deepEqual(r.emotes, ['hype', 'motivate']);
}
// Brackets that aren't tags are left alone, including at the very end.
r = run(['Use [Cmd] and [h] keys [1]', ], 1);
assert.equal(r.text, 'Use [Cmd] and [h] keys [1]'); assert.deepEqual(r.emotes, []);
r = run(['ends with [hyp'], 1);
assert.equal(r.text, 'ends with [hyp');
// Tag-only first turn (emote then tool), text in next turn → no leading space.
r = run(['[remind]', 'Your video is due at 2pm.']);
assert.equal(r.text, 'Your video is due at 2pm.'); assert.deepEqual(r.emotes, ['remind']);
// Regression: after a restart the conversation is handed over as a transcript, and the model copied its tool-call
// lines into a reply ("Reading the page now. [called read_window {…}]"): the voice read them out. They're dropped,
// whatever the chunking, mid-line too; ordinary brackets and text around them stay.
{
  const { EchoFilter } = await import('../reply.mjs');
  const filter = (text, n) => { const f = new EchoFilter(); let out = ''; for (let k = 0; k < text.length; k += n) out += f.push(text.slice(k, k + n)); return out + f.flush(); };
  for (const n of [1, 2, 3, 7, 1000]) {
    assert.equal(filter('Reading the page now.\n[called read_window {"target":"browser"}]\nIt says hi.', n), 'Reading the page now.\nIt says hi.', `own line, chunk ${n}`);
    assert.equal(filter('Reading the page now. [called read_window {"target":"browser"}]', n), 'Reading the page now.', `end of a line, chunk ${n}`);
    assert.equal(filter('Tool use: draw {"beats":[]}\nDone.', n), 'Done.', `new transcript form, chunk ${n}`);
    assert.equal(filter('Press [Cmd] and [called] it a day. Tool use is fun.', n), 'Press [Cmd] and [called] it a day. Tool use is fun.', `ordinary text, chunk ${n}`);
    assert.equal(filter('[warm] Hi there.\n- Tools: use the hammer', n), '[warm] Hi there.\n- Tools: use the hammer', `cues and lists stay, chunk ${n}`);
  }
}
console.log('reply stream tests: all passed');
