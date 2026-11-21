// Voice-driven text work. These commands are handled before the chat agent so the corrected text is never spoken,
// stored as a chat turn, or used to start another reply. The model only returns replacement text.
export const STYLES = ['natural', 'human', 'friendly', 'professional'];

const STYLE_WORDS = {
  natural: /natural|fluent|rewrite this naturally|make it flow|প্রাকৃতিক|স্বাভাবিক|প্রবাহিত|প্রাকৃতিকভাবে/i,
  human: /human|not ai|authentic|manush|মানবিক|মানুষের মতো|মানুষী|কৃত্রিম নয়/i,
  friendly: /friendl(?:y|ier|iest)|casual|warm|conversational|বন্ধুত্বপূর্ণ|কাছের|আন্তরিক|অনানুষ্ঠানিক/i,
  professional: /professional|polished|formal|কর্মক্ষেত্রের|পেশাদার|পেশাগত|কর্পোরেট/i,
};

const FIX = /\b(?:fix|correct|proofread|proof read)\s+(?:the\s+)?(?:grammar|spelling|punctuation|writing|text|sentence|this|it)\b|\bfix\s+(?:my\s+)?(?:grammar|writing)\b|\bcorrect\s+this\b|\bgrammar\s+check\b|ব্যাকরণ\s*(?:ঠিক|সংশোধন|শুধর)|গ্রামার\s*ঠিক|ঠিক\s*করে\s*দে|শুধরে\s*দে|সংশোধন\s*করে\s*দে/i;

export const writingLang = (lang, text = '') => {
  const id = String(lang ?? '');
  if (id.startsWith('bn') || /[\u0980-\u09FF]/.test(String(text))) return 'bn';
  return 'en';
};

export const styleFrom = (text) => {
  const s = String(text ?? '');
  for (const style of STYLES) if (STYLE_WORDS[style].test(s)) return style;
  return null;
};

/** A spoken command, or null for an ordinary question. A style command works whether or not Fix grammar came first. */
export const writingCommand = (text) => {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const style = styleFrom(s);
  if (/\brewrite\b|\bmake (?:it|this)\b|\bsound\b|\bwrite (?:it|this)\b|করে\s*লিখ|করে\s*দে|লিখে\s*দে/i.test(s) || /[\u0980-\u09FF]/.test(s)) {
    if (style) return { kind: 'style', style };
  }
  if (FIX.test(s)) return { kind: 'fix', style: null };
  return null;
};

const NO_EN = /^\s*(?:no(?:[,.\s]+thanks)?|that'?s fine|it'?s fine|leave it|done|ok(?:ay)?)\b/i;
const NO_BN = /^\s*(?:না(?:\s*ধন্যবাদ)?|ঠিক\s*আছে|চলবে|রাখুন|কিছু\s*যাবে\s*না)(?=\s|$|[.,!])/;
export const noStyle = (text) => NO_EN.test(String(text ?? '')) || NO_BN.test(String(text ?? ''));

export const rewriteSystem = (lang, style = null) => {
  const bn = writingLang(lang) === 'bn';
  const task = style === 'natural'
    ? (bn ? 'এটিকে স্বাভাবিক ও প্রবাহিত বাংলায় লিখুন।' : 'Make it sound natural and fluent.')
    : style === 'human'
      ? (bn ? 'এটিকে মানুষের লেখা স্বাভাবিক বাংলায় লিখুন, কৃত্রিম অনুভূতি দূর করুন।' : 'Make it sound authentic and human, not AI-generated.')
      : style === 'friendly'
        ? (bn ? 'এটিকে বন্ধুত্বপূর্ণ, কাছের ও কথ্য স্বরে লিখুন।' : 'Make it casual, warm and conversational.')
        : style === 'professional'
          ? (bn ? 'এটিকে পেশাদার, পরিচ্ছন্ন ও স্পষ্ট ভাষায় লিখুন।' : 'Make it polished, clear and professional.')
          : (bn ? 'ব্যাকরণ, বানান, যতি-চিহ্ন ও বাক্য গঠন ঠিক করুন।' : 'Correct grammar, spelling, punctuation and sentence structure.');
  return [
    bn ? 'আপনি একজন নিখুঁত সম্পাদক।' : 'You are a precise text editor.',
    task,
    bn
      ? 'মূল অর্থ, প্রসঙ্গ ও স্বর অটুট রাখুন। নতুন তথ্য বা শব্দ যোগ করবেন না। শুধু লেখাটি ফেরত দিন; কোনো ব্যাখ্যা, উদ্ধৃতি বা শিরোনাম নয়। ইংরেজি ও বাংলা মিশ্রণ থাকলে সেটি ঠিক রাখুন।'
      : 'Preserve the original meaning, context and tone. Never add information. Return only the rewritten text — no explanation, quotes or headings. Keep any mixed English words where they belong.',
  ].join(' ');
};

export const rewriteNote = (lang, pasted) => {
  if (writingLang(lang) === 'bn') return pasted ? 'ঠিক করা হয়েছে এবং বদলে দেওয়া হয়েছে।' : 'ঠিক করা হয়েছে এবং কপি করা হয়েছে।';
  return pasted ? 'Fixed and pasted back.' : 'Fixed and copied to the clipboard.';
};
