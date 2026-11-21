// Code-switching engine for mixed English + Bangla (Banglish) dictation and voice.
// Automatically detects and restores English words in Latin script while keeping Bangla words
// in Bengali script, preserving natural word order, meaning, grammar, and attached inflections.

export const BANGLISH_DICT = {
  // Apps, Platforms & Brands
  'হোয়াটসঅ্যাপ': 'WhatsApp',
  'হোয়াটসএপ': 'WhatsApp',
  'হোয়াটস্যাপ': 'WhatsApp',
  'হুয়াটসঅ্যাপ': 'WhatsApp',
  'হুয়াটস্যাপ': 'WhatsApp',
  'ওয়াথ সাউপ': 'WhatsApp',
  'ওয়াটসঅ্যাপ': 'WhatsApp',
  'ওয়াটস আউট': 'WhatsApp',
  'ওয়াটস আপ': 'WhatsApp',
  'ওয়াটসআপ': 'WhatsApp',
  'ওয়াটস্অ্যাপ': 'WhatsApp',
  'ওয়াটস এপ': 'WhatsApp',
  'ওয়াটস অ্যাপ': 'WhatsApp',
  'ওয়াথস আপ': 'WhatsApp',
  'ওয়াথসপ': 'WhatsApp',
  'ফেসবুক': 'Facebook',
  'ফেইসবুক': 'Facebook',
  'ইউটিউব': 'YouTube',
  'গুগল': 'Google',
  'গুগল ড্রাইভ': 'Google Drive',
  'ইনস্টাগ্রাম': 'Instagram',
  'ইন্সটাগ্রাম': 'Instagram',
  'টুইটার': 'Twitter',
  'টিকটক': 'TikTok',
  'টেলিগ্রাম': 'Telegram',
  'মেসেঞ্জার': 'Messenger',
  'ম্যাসেঞ্জার': 'Messenger',
  'লিংকডইন': 'LinkedIn',
  'নেটফ্লিক্স': 'Netflix',
  'স্পটিফাই': 'Spotify',
  'চ্যাটজিপিটি': 'ChatGPT',
  'জেমিনি': 'Gemini',
  'জেমিনাই': 'Gemini',
  'অ্যাপল': 'Apple',
  'মাইক্রোসফট': 'Microsoft',
  'উইন্ডোজ': 'Windows',
  'উইন্ডোস': 'Windows',
  'অ্যান্ড্রয়েড': 'Android',
  'এন্ড্রয়েড': 'Android',
  'ম্যাক': 'Mac',
  'আইফোন': 'iPhone',
  'আইপ্যাড': 'iPad',
  'ক্রোম': 'Chrome',
  'সাফারি': 'Safari',
  'ফায়ারফক্স': 'Firefox',
  'জুম': 'Zoom',
  'স্কাইপ': 'Skype',
  'ড্রাইভ': 'Drive',
  'ড্রপবক্স': 'Dropbox',
  'উবার': 'Uber',
  'পাঠাও': 'Pathao',
  'বিকাশ': 'bKash',
  'নগদ': 'Nagad',
  'রকেট': 'Rocket',

  // Tech, Phone, Computer & Internet Terms
  'সেটিং': 'setting',
  'সেটিংস': 'settings',
  'স্যার তিন': 'setting', // Common phonetic ASR artifact for "setting"
  'স্ক্রিনশট': 'screenshot',
  'স্ক্রিন শট': 'screenshot',
  'স্ক্রিন শত': 'screenshot', // Common phonetic ASR artifact for "screenshot"
  'মেসেজ': 'message',
  'মেসিজ': 'message',
  'ম্যাসেজ': 'message',
  'টেক্সট': 'text',
  'কল': 'call',
  'চ্যাট': 'chat',
  'ভিডিও': 'video',
  'ভিডিয়ো': 'video',
  'ভিডিও কল': 'video call',
  'অডিও': 'audio',
  'অডিয়ো': 'audio',
  'অডিও কল': 'audio call',
  'ভয়েস': 'voice',
  'ভয়েস': 'voice',
  'ভয়েস কল': 'voice call',
  'ফটো': 'photo',
  'পিক': 'pic',
  'পিকচার': 'picture',
  'ইমেজ': 'image',
  'ফাইল': 'file',
  'ফোল্ডার': 'folder',
  'ডকুমেন্ট': 'document',
  'পিডিএফ': 'PDF',
  'লিংক': 'link',
  'লিঙ্ক': 'link',
  'ইউআরএল': 'URL',
  'কোড': 'code',
  'অ্যাপ': 'app',
  'এপ': 'app',
  'অ্যাপ্লিকেশন': 'application',
  'সফটওয়্যার': 'software',
  'সফটওয়্যার': 'software',
  'হার্ডওয়্যার': 'hardware',
  'হার্ডওয়্যার': 'hardware',
  'সিস্টেম': 'system',
  'সার্ভার': 'server',
  'নেটওয়ার্ক': 'network',
  'নেটওয়ার্ক': 'network',
  'ওয়াইফাই': 'wifi',
  'ওয়াইফাই': 'wifi',
  'ওয়াই ফাই': 'wifi',
  'ব্লুটুথ': 'bluetooth',
  'ইন্টারনেট': 'internet',
  'অনলাইন': 'online',
  'অফলাইন': 'offline',
  'ওয়েবসাইট': 'website',
  'ওয়েবসাইট': 'website',
  'সাইট': 'site',
  'ওয়েব': 'web',
  'ওয়েব': 'web',
  'পেজ': 'page',
  'পেইজ': 'page',
  'ব্রাউজার': 'browser',
  'সার্চ': 'search',
  'ক্লিক': 'click',
  'স্ক্রোল': 'scroll',
  'ট্যাপ': 'tap',
  'টাইপ': 'type',
  'কপি': 'copy',
  'পেস্ট': 'paste',
  'কাট': 'cut',
  'সিলেক্ট': 'select',
  'ডিলিট': 'delete',
  'রিমুভ': 'remove',
  'সেভ': 'save',
  'এডিট': 'edit',
  'শেয়ার': 'share',
  'শেয়ার': 'share',
  'সেন্ড': 'send',
  'পোস্ট': 'post',
  'আপলোড': 'upload',
  'ডাউনলোড': 'download',
  'ইনস্টল': 'install',
  'ইন্সটল': 'install',
  'আনইনস্টল': 'uninstall',
  'আনইন্সটল': 'uninstall',
  'আপডেট': 'update',
  'আপগ্রেড': 'upgrade',
  'রিস্টার্ট': 'restart',
  'রিবুট': 'reboot',
  'স্টার্ট': 'start',
  'স্টপ': 'stop',
  'পজ': 'pause',
  'রেজ্যুম': 'resume',
  'ব্যাক': 'back',
  'নেক্সট': 'next',
  'প্রিভিয়াস': 'previous',
  'মেনু': 'menu',
  'অপশন': 'option',
  'লিস্ট': 'list',
  'আইকন': 'icon',
  'বাটন': 'button',
  'সুইচ': 'switch',
  'স্ক্রিন': 'screen',
  'ডিসপ্লে': 'display',
  'উইন্ডো': 'window',
  'ট্যাব': 'tab',
  'নোটিফিকেশন': 'notification',
  'অ্যালার্ট': 'alert',
  'এলার্ট': 'alert',
  'পপআপ': 'popup',
  'পাসওয়ার্ড': 'password',
  'পাসওয়ার্ড': 'password',
  'পিন': 'PIN',
  'ওটিপি': 'OTP',
  'লগইন': 'login',
  'লগ ইন': 'login',
  'লগআউট': 'logout',
  'লগ আউট': 'logout',
  'সাইনইন': 'sign in',
  'সাইন ইন': 'sign in',
  'সাইনআপ': 'sign up',
  'সাইন আপ': 'sign up',
  'রেজিস্টার': 'register',
  'অ্যাকাউন্ট': 'account',
  'একাউন্ট': 'account',
  'প্রোফাইল': 'profile',
  'ইউজার': 'user',
  'ইউজারনেম': 'username',
  'ইমেইল': 'email',
  'মেইল': 'mail',
  'জিমেইল': 'Gmail',
  'ইনবক্স': 'inbox',
  'ডাটা': 'data',
  'ডেটা': 'data',
  'মেমরি': 'memory',
  'মেমোরি': 'memory',
  'স্টোরেজ': 'storage',
  'হার্ডডিস্ক': 'hard disk',
  'পেনড্রাইভ': 'pen drive',
  'ক্যামেরা': 'camera',
  'মাইক্রোফোন': 'microphone',
  'স্পিকার': 'speaker',
  'হেডফোন': 'headphone',
  'চার্জার': 'charger',
  'ব্যাটারি': 'battery',
  'কেবল': 'cable',
  'ক্যাবল': 'cable',
  'মোবাইল': 'mobile',
  'ফোন': 'phone',
  'ল্যাপটপ': 'laptop',
  'কম্পিউটার': 'computer',
  'ট্যাবলেট': 'tablet',
  'মনিটর': 'monitor',
  'কীবোর্ড': 'keyboard',
  'কিবোর্ড': 'keyboard',
  'মাউস': 'mouse',
  'প্রিন্টার': 'printer',
  'হটস্পট': 'hotspot',
  'জিপিএস': 'GPS',
  'লোকেশন': 'location',
  'ম্যাপ': 'map',

  // Business, Office, Finance & Daily Terms
  'অফিস': 'office',
  'মিটিং': 'meeting',
  'টিম': 'team',
  'বস': 'boss',
  'ক্লায়েন্ট': 'client',
  'কাস্টমার': 'customer',
  'ম্যানেজার': 'manager',
  'প্রজেক্ট': 'project',
  'টাস্ক': 'task',
  'জব': 'job',
  'ওয়ার্ক': 'work',
  'ওয়ার্ক': 'work',
  'কোম্পানি': 'company',
  'বিজনেস': 'business',
  'সার্ভিস': 'service',
  'সাপোর্ট': 'support',
  'হেল্প': 'help',
  'ব্যাংক': 'bank',
  'ব্যালেন্স': 'balance',
  'কার্ড': 'card',
  'ক্রেডিট কার্ড': 'credit card',
  'ডেবিট কার্ড': 'debit card',
  'পেমেন্ট': 'payment',
  'ক্যাশ': 'cash',
  'বিল': 'bill',
  'অর্ডার': 'order',
  'ডেলিভারি': 'delivery',
  'পার্সেল': 'parcel',
  'অ্যাড্রেস': 'address',
  'এড্রেস': 'address',
  'নাম্বার': 'number',
  'নম্বর': 'number',
  'আইডি': 'ID',
  'টিকেট': 'ticket',
  'টিকিট': 'ticket',
  'বুকিং': 'booking',
  'হোটেল': 'hotel',
  'রুম': 'room',
  'রেস্টুরেন্ট': 'restaurant',
  'ট্রিপ': 'trip',
  'ট্যুর': 'tour',
  'প্ল্যান': 'plan',
  'আইডিয়া': 'idea',
  'আইডিয়া': 'idea',
  'প্রবলেম': 'problem',
  'ইস্যু': 'issue',
  'সলিউশন': 'solution',
  'কনফার্ম': 'confirm',
  'ক্যানসেল': 'cancel',
  'চেক': 'check',
  'টেস্ট': 'test',
  'ফিক্স': 'fix',
  'এরর': 'error',
  'বাগ': 'bug',
  'রেজাল্ট': 'result',
  'রিপোর্ট': 'report',
  'প্রেজেন্টেশন': 'presentation',
  'স্লাইড': 'slide',

  // Conversational English Expressions
  'হেই': 'Hey',
  'ওকে': 'OK',
  'থ্যাংকস': 'thanks',
  'থ্যাঙ্কস': 'thanks',
  'থ্যাংক ইউ': 'thank you',
  'থ্যাঙ্ক ইউ': 'thank you',
  'প্লিজ': 'please',
  'সরি': 'sorry',
  'ওয়েলকাম': 'welcome',
  'ওয়েলকাম': 'welcome',
  'হাই': 'hi',
  'হ্যালো': 'hello',
  'বাই': 'bye',
  'গুডবাই': 'goodbye',
  'ইয়েস': 'yes',
  'ইয়েস': 'yes',
  'নো': 'no',
  'শিওর': 'sure',
  'অফ কোর্স': 'of course',
  'অফকোর্স': 'of course',
  'নো প্রবলেম': 'no problem',
  'অলরাইট': 'alright',
  'পারফেক্ট': 'perfect',
  'গ্রেট': 'great',
  'গুড': 'good',
  'কুল': 'cool',
  'নাইস': 'nice',
  'সিরিয়াস': 'serious',
  'সিরিয়াস': 'serious',
  'সিম্পল': 'simple',
  'ক্লিয়ার': 'clear',
  'ক্লিয়ার': 'clear',
  'নরমাল': 'normal',
  'ডাইরেক্ট': 'direct',
  'রেডি': 'ready',
  'বিজি': 'busy',
  'ফ্রি': 'free',
  'লেট': 'late',
  'ফাস্ট': 'fast',
  'স্লো': 'slow',
  'ডান': 'done',
  'টেনশন': 'tension',
  'রিল্যাক্স': 'relax',
  'রিলাক্স': 'relax',
  'হ্যাপি': 'happy',
};

// Suffix table with the corresponding spacing when attached to an English word
const SUFFIXES = [
  { s: 'গুলোর', rep: ' গুলোর' },
  { s: 'গুলো', rep: ' গুলো' },
  { s: 'গুলির', rep: ' গুলির' },
  { s: 'গুলি', rep: ' গুলি' },
  { s: 'টার', rep: ' টার' },
  { s: 'টা', rep: ' টা' },
  { s: 'টির', rep: ' টির' },
  { s: 'টি', rep: ' টি' },
  { s: 'য়ের', rep: ' এর' },
  { s: 'য়ের', rep: ' এর' },
  { s: 'এর', rep: ' এর' },
  { s: 'র', rep: ' এর' },
  { s: 'কে', rep: ' কে' },
  { s: 'তে', rep: ' তে' },
  { s: 'য়ে', rep: ' এ' },
  { s: 'য়ে', rep: ' এ' },
  { s: 'এ', rep: ' এ' },
];

/** Clean typical Whisper decoding loop artifacts and initial punctuation */
export function cleanWhisperArtifacts(text) {
  let s = String(text ?? '').trim();
  // Strip leading standalone punctuation
  s = s.replace(/^[।?,!\s]+/, '');

  // Convert introductory "হ্যাঁ?" followed by text to "হ্যাঁ,"
  s = s.replace(/([^\s,।?!]+)\?(\s+[^\s,।?!])/gu, '$1,$2');

  // Remove consecutive token repetitions like "হ্যাঁ? হ্যাঁ? হ্যাঁ?..."
  s = s.replace(/([^\s।?,!]+[\s।?,!]*)(?:\s*\1){2,}/gu, '');

  // Strip trailing repeated sentences or single-word loops
  const parts = s.split(/[।!?]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const main = parts.slice(0, -1);
    const last = parts[parts.length - 1];
    if (last.split(/\s+/).length <= 2 && main.some((m) => m.includes(last))) {
      s = main.join('। ') + '।';
    }
  }

  return s.trim();
}

/** Check if token has an attached Bengali inflection */
export function splitInflection(token) {
  if (BANGLISH_DICT[token]) return { root: BANGLISH_DICT[token], suffix: '' };

  for (const m of SUFFIXES) {
    if (token.length > m.s.length && token.endsWith(m.s)) {
      const base = token.slice(0, -m.s.length);
      if (BANGLISH_DICT[base]) return { root: BANGLISH_DICT[base], suffix: m.rep };
    }
  }

  // Locative e-kar vowel mark: e.g. ল্যাপটপে -> ল্যাপটপ + ে
  if (token.endsWith('\u09C7')) {
    const base = token.slice(0, -1);
    if (BANGLISH_DICT[base]) return { root: BANGLISH_DICT[base], suffix: ' এ' };
  }

  return null;
}

// Native Bengali core words (pronouns, common verbs, prepositions, particles, adverbs).
// When these are present, the speech contains Bengali and CANNOT be classified as pure English.
export const BN_CORE_WORDS = new Set([
  'আমি', 'আমার', 'আমাকে', 'আমরা', 'আমাদের',
  'তুমি', 'তোমার', 'তোমাকে', 'তোমরা', 'তোমাদের',
  'তুই', 'তোর', 'তোকে',
  'আপনি', 'আপনার', 'আপনাকে', 'আপনারা', 'আপনাদের',
  'তাকে', 'তারা', 'তাদের',
  'তিনি', 'তাঁর', 'তাঁকে', 'তাঁরা',
  'সেটা', 'সেগুলো', 'এটা', 'ওটা',
  'কাকে', 'কোথায়', 'কখন', 'কিভাবে', 'কীভাবে', 'কেমন',
  'হ্যাঁ', 'কিন্তু', 'তবে', 'যদি', 'তাহলে',
  'কারণ', 'যেহেতু', 'সেখানে', 'কোথাও',
  'কখনও', 'সবাই', 'সবকিছু', 'অনেক', 'শুধু',
  'থেকে', 'দিয়ে', 'চেয়ে', 'পরে', 'আগে', 'জন্য',
  'সাথে', 'পাশে', 'কাছে', 'ভেতরে', 'ভিতরে', 'বাইরে', 'উপরে', 'নিচে',
  'করে', 'করুন', 'করবেন', 'করি', 'করো', 'করিস', 'করছি', 'করছে', 'করছেন',
  'করেছি', 'করেছেন', 'করব', 'করবে', 'করতে', 'করা', 'করানো',
  'হয়ে', 'হবে', 'হবেন', 'হচ্ছে', 'হয়েছে', 'হয়েছেন', 'হলো', 'হলে', 'হতে',
  'গিয়ে', 'যান', 'যাবেন', 'যাব', 'যাবে', 'যাচ্ছি', 'যাচ্ছে', 'গেল', 'গেলো',
  'আসুন', 'আসবেন', 'আসি', 'আসছি', 'আসছে', 'এসে', 'এসেছে', 'এলেন',
  'দিন', 'দেবেন', 'দিতে', 'দিয়েছি', 'দিয়েছে', 'দিচ্ছি', 'দিচ্ছে', 'দাও',
  'নিন', 'নেবেন', 'নিতে', 'নিয়ে', 'নিয়েছে', 'নিচ্ছি', 'নিচ্ছে',
  'বলুন', 'বলবেন', 'বলি', 'বলছি', 'বলছে', 'বলেছে', 'বলব',
  'দেখুন', 'দেখবেন', 'দেখি', 'দেখছি', 'দেখছে', 'দেখেছে', 'দেখাও',
  'শুনুন', 'শুনবেন', 'শুনি', 'শুনছি', 'শুনছে', 'শুনেছে',
  'থাকুন', 'থাকবেন', 'থাকছি', 'থাকছে',
  'আছেন', 'আছি', 'আছে', 'আছো', 'ছিলেন', 'ছিলাম',
  'পারেন', 'পারবেন', 'পারি', 'পারবে', 'পারছি', 'পারছে', 'পেরেছি',
  'ভালো', 'খারাপ', 'নতুন', 'পুরনো'
]);

// Banglish (Romanized Bengali) transliterations commonly produced by Apple English recognizer
// when listening to Bengali speech. These must NEVER be treated as English words!
export const BANGLISH_CORE_WORDS = new Set([
  'ami', 'amar', 'amake', 'amra', 'amader',
  'tumi', 'tomar', 'tomake', 'tomra', 'tomader',
  'apni', 'apnar', 'apnake', 'apnara', 'apnader',
  'kore', 'korun', 'korben', 'kori', 'koro', 'korchi', 'korche', 'korechi', 'korbo', 'korte',
  'hoye', 'hobe', 'hocche', 'hoyeche', 'holo',
  'giye', 'jaben', 'jabo', 'jachhi',
  'ashun', 'ashben', 'esheche',
  'deben', 'diyechi', 'diyeche', 'dicchi',
  'bolun', 'bolben', 'bolchi', 'boleche',
  'dekhun', 'dekhben', 'dekhchi', 'dekheche',
  'shunun', 'shunben', 'shuneche',
  'thakun', 'thakben', 'thakchi',
  'achen', 'achi', 'chilo', 'chilen',
  'parben', 'parchi',
  'bhalo', 'kharap', 'kemon'
]);

// Consonant phonetic mapper for dynamic alignment
const BN_CONSONANTS = {
  'ক': 'k', 'খ': 'k', 'গ': 'g', 'ঘ': 'g',
  'চ': 'c', 'ছ': 'c', 'জ': 'j', 'ঝ': 'j',
  'ট': 't', 'ঠ': 't', 'ড': 'd', 'ঢ': 'd',
  'ত': 't', 'থ': 't', 'দ': 'd', 'ধ': 'd', 'ন': 'n',
  'প': 'p', 'ফ': 'f', 'ব': 'b', 'ভ': 'v', 'ম': 'm',
  'য': 'y', 'র': 'r', 'ল': 'l', 'শ': 's', 'ষ': 's', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'r', 'য়': 'y'
};

function consonantSkeleton(str) {
  let res = '';
  for (const ch of str.toLowerCase()) {
    if (BN_CONSONANTS[ch]) res += BN_CONSONANTS[ch];
    else if (/[bcdfghjklmnpqrstvwxyz]/.test(ch)) res += ch;
  }
  return res;
}

/** Match an unknown Bengali token against words heard by Apple English recognizer */
function matchFromApple(token, appleWords) {
  const cleanToken = token.replace(/[।?,!;:]+/g, '');
  if (BN_CORE_WORDS.has(cleanToken)) return null;

  const sk = consonantSkeleton(token);
  if (sk.length < 2) return null;
  for (const aw of appleWords) {
    const cleanAw = aw.toLowerCase().replace(/[^a-z]/g, '');
    if (BANGLISH_CORE_WORDS.has(cleanAw)) continue;

    const ask = consonantSkeleton(aw);
    if (ask.length < 2) continue;
    if (sk === ask || sk.startsWith(ask) || ask.startsWith(sk)) return aw;
  }
  return null;
}

/** Has Bengali script characters */
export const hasBengali = (s) => /[\u0980-\u09FF]/.test(String(s ?? ''));

/** Has Latin script characters */
export const hasLatin = (s) => /[a-zA-Z]/.test(String(s ?? ''));

/** Detect if the take audio was pure English */
export function isPureEnglish(appleText, banglaText) {
  const apple = String(appleText ?? '').trim();
  const bangla = String(banglaText ?? '').trim();
  if (!apple || hasBengali(apple)) return false;
  const appleWords = apple.match(/[a-zA-Z0-9]+/g) || [];
  if (appleWords.length < 2) return false;

  // If Apple transcript has Banglish transliterations of core Bengali words, it is not pure English
  for (const aw of appleWords) {
    if (BANGLISH_CORE_WORDS.has(aw.toLowerCase())) return false;
  }

  // If Bangla recognizer produced only transliterated English words or empty
  if (!bangla) return false;

  // If the Bangla transcript contains ANY genuine Bengali core words,
  // it is code-switched or Bangla speech, NOT pure English!
  const bnTokens = bangla.replace(/[।?,!;:]+/g, ' ').split(/\s+/).filter(Boolean);
  for (const t of bnTokens) {
    if (BN_CORE_WORDS.has(t)) return false;
  }

  let recognizedEnglish = 0;
  for (const w of bnTokens) {
    if (BANGLISH_DICT[w] || splitInflection(w) || matchFromApple(w, appleWords)) {
      recognizedEnglish++;
    }
  }
  return recognizedEnglish >= Math.floor(bnTokens.length * 0.6);
}

/**
 * Restore natural code-switched text from mixed Bangla + English speech.
 * Ensures Bangla words are in Bengali script, and English words are in Latin script.
 */
export function restoreCodeSwitch(banglaRaw, appleRaw = '') {
  const cleaned = cleanWhisperArtifacts(banglaRaw);
  const apple = String(appleRaw ?? '').trim();

  // If pure English speech is detected, Apple's native transcript wins cleanly
  if (isPureEnglish(apple, cleaned)) {
    return apple;
  }

  // If Bangla produced nothing, fall back to Apple text
  if (!cleaned) return apple;

  // Extract English words from Apple transcript for dynamic matching
  const appleWords = (apple.match(/[a-zA-Z0-9]+/g) || []).filter((w) => w.length > 2);

  let text = cleaned;

  // 1. Process multi-word dictionary phrases first using Unicode boundary checks
  const multiWords = Object.keys(BANGLISH_DICT)
    .filter((k) => k.includes(' '))
    .sort((a, b) => b.length - a.length);

  for (const k of multiWords) {
    const v = BANGLISH_DICT[k];
    const reg = new RegExp(`(?<=^|[^\\p{L}\\p{M}\\p{N}])${k}(?=[^\\p{L}\\p{M}\\p{N}]|$)`, 'gu');
    text = text.replace(reg, v);
  }

  // 2. Tokenize preserving spaces and punctuation
  const tokens = text.split(/(\s+|[।?,!;:]+)/);
  const out = [];

  for (let token of tokens) {
    if (!token || /^\s+$/.test(token) || /^[।?,!;:]+$/.test(token)) {
      out.push(token);
      continue;
    }

    // Direct match
    if (BANGLISH_DICT[token]) {
      out.push(BANGLISH_DICT[token]);
      continue;
    }

    // Match with attached inflection
    const infl = splitInflection(token);
    if (infl) {
      out.push(infl.root + infl.suffix);
      continue;
    }

    // Dynamic match against Apple's recognized English words
    if (appleWords.length > 0) {
      const matched = matchFromApple(token, appleWords);
      if (matched) {
        out.push(matched);
        continue;
      }
    }

    // Native Bengali word -> stays in Bengali script
    out.push(token);
  }

  let result = out.join('');

  // Clean spacing around punctuation and between Latin and Bengali words
  result = result
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\s+([।?,!;:])/, '$1')
    .replace(/([,;:])(?=[^\s])/g, '$1 ')
    .trim();

  return result;
}
