// Handoffs between models and agents carry what the user actually said, word for word. A brief someone else wrote
// from it can drift ("make the logo bigger" → "enlarge branding"); the quoted words can't. These build the pieces.
const CAP = 1500;

/** The words in curly quotes, verbatim. Only the ends are trimmed; if there are more than `max` characters, the rest
 *  is left out and the quote says how many, so nobody takes a cut-off for the whole. '' for nothing. */
export function exactWords(text, max = CAP) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  if (t.length <= max) return `“${t}”`;
  return `“${t.slice(0, max)}… [${t.length - max} more characters not shown]”`;
}

/** The block that opens a background agent's brief: their words, then the rule for the assistant's reading of them. */
export function userWordsBlock(userName, words) {
  const q = exactWords(words);
  return q ? `${userName}'s exact words, quoted verbatim. The brief below is their assistant's reading of them; if the two ever differ, their words win:\n${q}` : '';
}

/** `message` with their exact words after it, unless the message already holds them. */
export function withWords(message, userName, words) {
  const m = String(message ?? ''), w = String(words ?? '').trim();
  if (!w || m.includes(w)) return m;
  return `${m}\n\n${userName}'s exact words: ${exactWords(w)}`;
}

/**
 * The note for a model taking over (hybrid models and limits): what happened, and their exact words. reason:
 * 'job' (a heavy job set to this model), 'named' (they asked for it by name), 'limit' (the model before it hit its
 * usage limit, `until` = when it resets, so it opens its reply by saying so), 'back' (the default is free again).
 */
export function handoffNote({ userName, assistant, reason = 'job', from, kind, words, untilText, because }) {
  const q = exactWords(words), theirs = q ? `${userName}'s exact words, quoted verbatim: ${q}. ` : '';
  const rule = "Do exactly what they asked, in the sense of their own words: don't reword it, add tasks or ask for what they already said.";
  if (reason === 'back') return `(Heads up, not from ${userName}: ${from} is available again, so you're back on it. Mention it in a few words only if it fits.)`;
  if (reason === 'unavailable') return `(Handoff, not from ${userName}: ${from} isn't available right now${because ? ` (${because})` : ''}${untilText ? `; it'll be tried again around ${untilText}` : ''}, so you're taking over as ${assistant}, with the conversation so far. ${theirs}${rule} Open your reply with one short sentence, in character, saying ${from} isn't available and you're covering; then do what they asked.)`;
  if (reason === 'limit') return `(Handoff, not from ${userName}: ${from} has reached its usage limit${untilText ? ` and resets about ${untilText}` : ''}, so you're taking over as ${assistant}, with the conversation so far. ${theirs}${rule} Open your reply with one short sentence, in character, saying ${from} is at its limit and you're covering${untilText ? ` until about ${untilText}` : ' for now'}; then do what they asked.)`;
  if (reason === 'named') return `(Handoff, not from ${userName}: ${from} was chatting with them as ${assistant}, and they asked for you by name to take this. ${theirs}${rule} Answer as ${assistant}, in character, as usual.)`;
  return `(Handoff, not from ${userName}: ${from} was chatting with them as ${assistant} and passed this ${kind} job to you, because you're the model set up for it. ${theirs}${rule} Answer as ${assistant}, in character, as usual.)`;
}

/** One line for a report or status: what was asked, kept short but still verbatim as far as it goes. */
export const askedLine = (userName, words, max = 300) => {
  const q = exactWords(words, max);
  return q ? `${userName} asked, in their words: ${q}` : '';
};
