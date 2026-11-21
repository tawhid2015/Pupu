// What gets said out loud in voice mode. The reply streams in as text (emote tags already removed); this
// picks out the spoken part a sentence at a time, so speech can start before the reply is finished:
// - prose is spoken; list lines ("- ", "1. "), quotes ("> ", drafts), headings, tables, code blocks and the
//   "Sources:" line are for the screen only (lists and drafts show on screen, never read out).
// - markdown, links, URLs, emoji, file paths and long code are dropped from what's said.
// Bengali full stop (।) and double danda (॥) end sentences too; Bangla replies use them instead of a Latin dot.
const BENGALI = /[\u0980-\u09FF]/;
/** True when text actually contains Bangla letters. Used to keep English model output away from the Bangla voice. */
export const hasBengali = (s) => BENGALI.test(String(s ?? ''));
const SENTENCE_END = /[.!?…।॥]+["'”’)\]]*(?=\s|$)/g;
const SCREEN_ONLY = /^\s*(?:[-*•+]\s|\d{1,2}[.)]\s|>|#{1,6}\s|\||sources?\s*:)/i;
const LONG = 220; // speak a run-on sentence in pieces rather than wait for its end

// Fish Audio S2 voice cues: [chuckling], [warm], [break]… shape how a line is said (tested on the JARVIS voice:
// they're performed, not read out). Only these are kept for the voice; on screen they're never shown.
// Every cue in Fish Audio's emotion guide (docs.fish.audio/developer-guide/core-features/emotions), plus the
// extra moods its examples use and a few of ours. All verified on the JARVIS voice by voice-samples.
export const VOICE_CUES = {
  // 24 basic and 25 advanced emotions, then the ones Fish's examples use, then ours.
  emotions: [
    'happy', 'sad', 'angry', 'excited', 'calm', 'nervous', 'confident', 'surprised', 'satisfied', 'delighted', 'scared', 'worried',
    'upset', 'frustrated', 'depressed', 'empathetic', 'embarrassed', 'disgusted', 'moved', 'proud', 'relaxed', 'grateful', 'curious', 'sarcastic',
    'disdainful', 'unhappy', 'anxious', 'hysterical', 'indifferent', 'uncertain', 'doubtful', 'confused', 'disappointed', 'regretful', 'guilty',
    'ashamed', 'jealous', 'envious', 'hopeful', 'optimistic', 'pessimistic', 'nostalgic', 'lonely', 'bored', 'contemptuous', 'sympathetic',
    'compassionate', 'determined', 'resigned',
    'friendly', 'enthusiastic', 'encouraging', 'mysterious', 'relieved', 'urgent', 'furious', 'terrified', 'interested', 'ecstatic',
    'helpful', 'concerned', 'triumphant', 'brave', 'narrator',
    'warm', 'playful', 'amused', 'thoughtful', 'serious', 'gentle', 'teasing', 'dry',
    'caring', 'kind', 'soothing', 'reassuring', 'cheerful', 'apologetic', 'sincere', 'tender', 'upbeat', 'solemn', 'sheepish',
    'impressed', 'wistful', 'mischievous', 'deadpan', 'cheeky',
  ],
  // How it's said: anywhere in a sentence ([emphasis] right before the word).
  tones: ['in a hurry tone', 'shouting', 'screaming', 'whispering', 'soft tone', 'emphasis'],
  // Human sounds: best followed by the sound in words ("[laughing] Ha ha").
  sounds: ['laughing', 'chuckling', 'sobbing', 'crying loudly', 'sighing', 'groaning', 'panting', 'gasping', 'yawning', 'snoring', 'clear throat'],
  // Background and pauses.
  effects: ['audience laughing', 'background laughter', 'crowd laughing', 'break', 'long-break'],
};
// What each cue looks like on the face while it's said (agent.js FEEL draws these): the cues grouped into a few
// feelings. Cues not listed (narrator, emphasis, pauses, clear throat) leave the face as it is.
export const FEELS = {
  joy: ['happy', 'excited', 'satisfied', 'delighted', 'proud', 'hopeful', 'optimistic', 'enthusiastic', 'relieved', 'ecstatic', 'triumphant', 'playful', 'amused', 'cheerful', 'upbeat'],
  laugh: ['laughing', 'chuckling', 'audience laughing', 'background laughter', 'crowd laughing'],
  warm: ['calm', 'empathetic', 'moved', 'relaxed', 'grateful', 'sympathetic', 'compassionate', 'friendly', 'helpful', 'warm', 'gentle', 'caring', 'kind', 'soothing', 'reassuring', 'sincere', 'tender', 'whispering', 'soft tone'],
  sad: ['sad', 'depressed', 'embarrassed', 'unhappy', 'disappointed', 'regretful', 'guilty', 'ashamed', 'pessimistic', 'nostalgic', 'lonely', 'concerned', 'apologetic', 'sheepish', 'wistful', 'sighing'],
  cry: ['sobbing', 'crying loudly'],
  angry: ['angry', 'upset', 'frustrated', 'disgusted', 'jealous', 'envious', 'furious', 'groaning'],
  shout: ['shouting', 'screaming'],
  surprised: ['surprised', 'impressed', 'gasping'],
  scared: ['nervous', 'scared', 'worried', 'anxious', 'hysterical', 'terrified', 'panting'],
  curious: ['curious', 'uncertain', 'doubtful', 'confused', 'mysterious', 'interested', 'thoughtful'],
  smug: ['sarcastic', 'disdainful', 'contemptuous', 'teasing', 'mischievous', 'cheeky'],
  flat: ['indifferent', 'bored', 'resigned', 'dry', 'deadpan', 'solemn'],
  determined: ['confident', 'determined', 'encouraging', 'urgent', 'brave', 'serious', 'in a hurry tone'],
  tired: ['yawning', 'snoring'],
};
const FEEL_OF = new Map(Object.entries(FEELS).flatMap(([f, cues]) => cues.map((c) => [c, f])));
/** The feeling of a sentence: its first cue that has one, read from the cue's words ("[slightly sad]", "[warm and
 * curious]", "[quietly, a little embarrassed]"), or null. */
export function cueFeel(sentence) {
  for (const [, inner] of String(sentence).matchAll(/\[([^\]\n]{1,60})\]/g)) {
    for (const part of inner.toLowerCase().split(/,|\band\b/)) {
      const words = part.trim().replace(/^(?:slightly|very|extremely|a bit|a little|quietly|deeply)\s+/, '');
      const f = FEEL_OF.get(words) ?? words.split(/\s+/).map((w) => FEEL_OF.get(w)).find(Boolean);
      if (f) return f;
    }
  }
  return null;
}
export const CUE_INTENSITY = ['slightly', 'very', 'extremely', 'a bit', 'a little', 'quietly', 'deeply'];
const alt = (list) => list.slice().sort((a, b) => b.length - a.length).map((x) => x.replace(/[-]/g, '\\-')).join('|');
const MOOD = alt(VOICE_CUES.emotions);
const DELIVERY = alt([...VOICE_CUES.tones, ...VOICE_CUES.sounds, ...VOICE_CUES.effects]);
const CUE_BODY = `(?:(?:${alt(CUE_INTENSITY)})\\s+)?(?:(?:${MOOD})(?:(?:,\\s*|\\s+and\\s+)(?:${MOOD}))?|${DELIVERY})`;
export const CUE = new RegExp(`\\[(?:${CUE_BODY})\\]`, 'gi');
const IS_CUE = new RegExp(`^\\[(?:${CUE_BODY})\\]$`, 'i');
// S2 also takes free descriptions ("[caring]", "[quietly proud]"). One that isn't on the list counts as a cue
// only where cues go: lowercase, a few words, at the start of a sentence. Mid-sentence brackets (a draft's
// "[landlord name]") stay text.
const LOOSE = /^\[[a-z]+(?:[ ,-]+[a-z]+){0,3}\]$/;
const SENTENCE_START = /(?:^|[.!?…]["'”’)]*)\s*$/;
// The body's emote tags set the tone of what follows when the model gave none.
export const EMOTE_TONE = { hype: '[excited]', upset: '[frustrated]', motivate: '[encouraging]', wave: '[warm]', remind: '[serious]' };

/** Streaming: drops voice cues from text that's shown, even when a cue is split across chunks. */
export class CueFilter {
  constructor() { this.held = ''; this.trim = true; this.space = true; this.before = ''; } // before: the end of what's been shown // space: what's been shown so far ends in a space (or is nothing) // trim: drop the spaces a removed cue leaves behind
  push(text) {
    let s = this.held + text, out = '';
    this.held = '';
    if (this.trim) { s = s.replace(/^[ \t]+/, ''); if (!s) return ''; this.trim = false; }
    for (;;) {
      const i = s.indexOf('[');
      if (i < 0) { out += s; return this.shown(out); }
      out += s.slice(0, i);
      const j = s.indexOf(']', i);
      if (j < 0) {
        // Could still become a cue: wait for more (up to the longest cue's length).
        if (s.length - i <= 40) { this.held = s.slice(i); return this.shown(out); }
        out += s[i]; s = s.slice(i + 1); continue;
      }
      const tag = s.slice(i, j + 1);
      const loose = !IS_CUE.test(tag) && LOOSE.test(tag) && SENTENCE_START.test(this.before + out);
      // A link's "[name](url)" is never a cue: wait to see what follows the "]".
      if (loose && j + 1 === s.length) { this.held = s.slice(i); return this.shown(out); }
      if (IS_CUE.test(tag) || (loose && s[j + 1] !== '(')) {
        s = s.slice(j + 1);
        // "a. [cue] b" → "a. b": the space before the cue stays, the one after goes (now or in the next chunk).
        if (/\s$/.test(out) || (!out && this.space)) { s = s.replace(/^[ \t]+/, ''); if (!s) this.trim = true; }
      }
      else { out += s[i]; s = s.slice(i + 1); }
    }
  }
  shown(out) { if (out) { this.space = /\s$/.test(out); this.before = (this.before + out).slice(-12); } return out; }
  flush() { const h = this.held; this.held = ''; return h; }
}

const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const power = (minus, n) => (minus ? ` to the power of minus ${n} ` : n === '2' ? ' squared ' : n === '3' ? ' cubed ' : ` to the power of ${n} `);
const MATH_WORDS = [
  [/(?<=\d)\s*°\s*C\b/g, ' degrees Celsius'], [/(?<=\d)\s*°\s*F\b/g, ' degrees Fahrenheit'], [/°/g, ' degrees'],
  [/÷/g, ' divided by '], [/[×✕]/g, ' times '], [/(?<=\d)\s*[*·⋅]\s*(?=\d)/g, ' times '], [/−/g, ' minus '],
  [/±/g, ' plus or minus '], [/∛/g, ' the cube root of '], [/√/g, ' the square root of '],
  [/≈/g, ' is about '], [/≠/g, ' is not equal to '], [/≤/g, ' is less than or equal to '], [/≥/g, ' is greater than or equal to '],
  [/π/g, ' pi '], [/∞/g, ' infinity '], [/½/g, ' one half '], [/¼/g, ' one quarter '], [/¾/g, ' three quarters '],
];
// Voices read raw maths symbols oddly (3² or ÷), so they are said as words (#120).
function mathWords(s) {
  s = s.replace(/(⁻)?([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, m, d) => power(m, [...d].map((c) => SUPERSCRIPT[c]).join('')))
    .replace(/(?<=[\p{L}\p{N})])\^(-)?(\d+)/gu, (_, m, n) => power(m, n));
  for (const [re, word] of MATH_WORDS) s = s.replace(re, word);
  return s;
}

export function speakable(text) {
  let s = String(text ?? '');
  s = s.replace(/\[([^\]]*)\]\((?:https?:|mailto:)[^)]*\)/g, '$1') // [name](url) → name
    .replace(/<?\b(?:https?:\/\/|www\.)\S+/gi, (u) => u.match(/[.,!?;:)>]*$/)[0].replace(/>/g, '')) // bare URLs (keep the full stop)
    .replace(/`([^`]*)`/g, (_, c) => (c.length > 24 || /[/\\{}();=<>]|^\S+\.[a-z0-9]{1,5}$/i.test(c) ? '' : c)) // code: short words only
    .replace(/(\*\*|__|\*|~~)(?=\S)([^*~]*?\S)\1/g, '$2') // bold, italic, strike
    .replace(/(?:^|\s)(?:~|\/)?(?:[\w.-]+\/){2,}[\w-]*(?:\.\w+)*/g, ' ') // file paths (the sentence's full stop stays)
    .replace(/\[([^\]]{1,40})\]/g, (m, inner, at, all) => (IS_CUE.test(m) || (LOOSE.test(m) && SENTENCE_START.test(all.slice(0, at))) ? m.toLowerCase() : inner)) // voice cues stay; [placeholders] lose their brackets (Fish would act them out)
    .replace(/[\s\S]+/, mathWords)
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(s.replace(CUE, '')) ? s : '';
}

// The first chunk (early): cut at the first clause break or sentence end that is min characters in, else at a word
// once words are in with no sentence ended. Returns { end, from } (the chunk is line.slice(0, end) and the text goes
// on from `from`), or null to take the normal sentence rules. The built-in voice passes smaller numbers so its
// synthesis can start while the model is still writing the reply; the playback rate never changes.
const EARLY_MIN = 30, EARLY_WORDS = 60;
function earlyCut(line, nl, all, min = EARLY_MIN, words = EARLY_WORDS) {
  let best = null;
  const take = (end, from) => { if (end >= min && (!best || end < best.end)) best = { end, from }; };
  for (const m of line.matchAll(/[,;:](?=\s)/g)) take(m.index + 1, m.index + 1);
  for (const m of line.matchAll(/\s[-–—](?=\s)/g)) take(m.index, m.index + m[0].length); // a spaced dash: not said
  let ended = false;
  for (const m of line.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    ended = true;
    // A complete first sentence is safe to say the moment it lands, even when it's all we have so far: waiting for
    // the next token (or a newline) is dead air before synthesis can start. A shorter first sentence is left to the
    // normal rules, so "Hi there. Let me check…" still starts with "Hi there." rather than one long chunk.
    if (end >= min) { take(end, end); break; }
    break;
  }
  if (best) return best;
  if (ended || line.length < words) return null;
  const sp = line.lastIndexOf(' ', words);
  return sp > 0 ? { end: sp, from: sp } : null;
}

/**
 * opts: early (VoiceStudio: the first chunk is short, see earlyCut) and cap (characters; 0: no cap). Once the spoken
 * characters reach cap, nothing more is emitted (the caller still shows the whole reply as text).
 */
export class SpeechText {
  constructor(emit, { early = false, cap = 0, earlyMin = EARLY_MIN, earlyWords = EARLY_WORDS } = {}) {
    this.emit = emit; // (sentence) => void, each one cleaned and non-empty
    this.buf = '';
    this.atLineStart = true;
    this.fence = false;
    this.skip = false; // inside a screen-only line
    this.tone = null; // a cue for the next sentence, from the body's emote, when it has none of its own
    this.early = !!early;
    this.earlyMin = Math.max(8, Number(earlyMin) || EARLY_MIN);
    this.earlyWords = Math.max(this.earlyMin + 4, Number(earlyWords) || EARLY_WORDS);
    this.cap = Math.max(0, Number(cap) || 0);
    this.chunks = 0; // chunks emitted so far
    this.spoken = 0; // characters emitted so far
    this.capped = false;
  }

  /** The body's emote ([hype] etc.) colours the next sentence. */
  emote(action) { if (EMOTE_TONE[action]) this.tone = EMOTE_TONE[action]; }

  push(text) { this.buf += text; this.drain(false); }

  /** Before a tool call and at the end of a turn: say what's there even without a sentence end. */
  flush() { this.drain(true); }

  out(s) {
    if (this.capped) return;
    let t = speakable(s);
    if (!t) return;
    if (this.tone) { if (!/^\[/.test(t)) t = `${this.tone} ${t}`; this.tone = null; }
    this.emit(t);
    this.chunks++; this.spoken += t.length;
    if (this.cap && this.spoken >= this.cap) this.capped = true;
  }

  drain(all) {
    for (;;) {
      if (this.capped) { this.buf = ''; return; } // past the spoken cap: the rest is text only
      if (!this.buf) return;
      if (this.atLineStart) {
        const nl = this.buf.indexOf('\n');
        const head = (nl < 0 ? this.buf : this.buf.slice(0, nl)).trimStart();
        // Not enough of the line yet to know what kind it is ("1" could become "1. ").
        const maybeSources = head && 'sources:'.startsWith(head.toLowerCase().replace(/\s+$/, ''));
        if (nl < 0 && !all && (maybeSources || (head.length < 9 && !/[\p{L}]{3}/u.test(head)))) return;
        this.atLineStart = false;
        if (/^```|^~~~/.test(head)) { this.fence = !this.fence; this.skip = true; }
        else this.skip = this.fence || SCREEN_ONLY.test(head);
      }
      const nl = this.buf.indexOf('\n');
      if (this.skip) {
        if (nl < 0) { if (all) this.buf = ''; return; }
        this.buf = this.buf.slice(nl + 1);
        this.atLineStart = true; this.skip = false;
        continue;
      }
      if (nl === 0) { this.buf = this.buf.slice(1); this.atLineStart = true; continue; } // blank line
      // Prose: a full line, or a sentence that has ended.
      const line = nl < 0 ? this.buf : this.buf.slice(0, nl);
      const first = this.early && !this.chunks ? earlyCut(line, nl, all, this.earlyMin, this.earlyWords) : null;
      let cut = -1, from = -1;
      if (first) { cut = first.end; from = first.from; }
      else {
        SENTENCE_END.lastIndex = 0;
        let m;
        // Say a sentence as soon as its ending lands. Waiting for the next token held whole replies until the model
        // finished, which is where most of the pause before the voice began came from.
        if ((m = SENTENCE_END.exec(line))) cut = m.index + m[0].length;
        if (cut < 0 && nl >= 0) cut = nl;
        if (cut < 0 && line.length > LONG) { const sp = line.lastIndexOf(', ', LONG); cut = sp > 40 ? sp + 1 : line.lastIndexOf(' ', LONG); }
        if (cut <= 0) {
          if (all) { this.out(this.buf); this.buf = ''; }
          return;
        }
        from = cut;
      }
      this.out(line.slice(0, cut));
      this.buf = this.buf.slice(from);
      if (from === nl || /^\n/.test(this.buf)) { this.buf = this.buf.replace(/^\n/, ''); this.atLineStart = true; }
      else this.buf = this.buf.replace(/^[ \t]+/, '');
    }
  }
}

/** Whether a reply's last words are a question (voice cues, markdown, emoji and closing quotes ignored). */
export function endsWithQuestion(text) {
  const s = String(text ?? '')
    .replace(CUE, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [name](url) → name
    .replace(/\[[a-z]+(?:[ ,-]+[a-z]+){0,3}\]\s*$/, '') // a free-form cue at the very end
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/[\s*_~`"'”’»)\]]+$/u, '');
  return /[?？]$/.test(s);
}

// Auto-listen (#44): after a spoken reply that asks something, or after every one if they chose so. The mic then
// waits one of these many seconds for words (8 unless picked).
export const LISTEN_SECS = [3, 5, 8, 10, 15];
export const listenWait = (secs) => (LISTEN_SECS.includes(secs) ? secs : 8);
export const listensAfter = (reply, every) => !!every || endsWithQuestion(reply);
