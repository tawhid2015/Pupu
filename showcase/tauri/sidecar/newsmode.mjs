// News detail levels: a saved default in Settings, with a phrase in one request overriding it for that turn only.
// The prompt rule is deliberately explicit about "no sources/pin" in Short and Medium: models otherwise dump the
// whole article onto a pinned card even when they were asked for a brief summary.
import { SAFE, checkLink } from './safety.mjs';

export const NEWS_MODES = ['short', 'medium', 'everything'];
export const newsMode = (v) => NEWS_MODES.includes(v) ? v : 'short';

// "News" alone uses the saved setting. These phrases are one-turn overrides, never written back to config.
const SHORT = [
  /\b(?:news|headlines?)\b[\s\S]{0,30}\b(?:short|brief|quick|headlines? only|just (?:the )?headlines)\b/i,
  /\b(?:short|brief|quick)\s+(?:news|headlines?|summary)\b/i,
  /(?:সংক্ষিপ্ত|সংক্ষেপে|চমু)\s*(?:খবর|সংবাদ|সারাংশ)|(?:খবর|সংবাদ)\s*(?:সংক্ষিপ্ত|সংক্ষেপে|চমু)/,
];
const MEDIUM = [
  /\b(?:news|headlines?|story|story update)\b[\s\S]{0,30}\b(?:medium|moderate|key (?:facts|points)|main (?:facts|points))\b/i,
  /\b(?:medium|moderate)\s+(?:news|summary|detail)\b/i,
  /মাঝারি\s*(?:খবর|সংবাদ|বিবরণ)|(?:খবর|সংবাদ)\s*মাঝারি/,
];
const EVERYTHING = [
  /\b(?:news|headlines?|story|article)\b[\s\S]{0,40}\b(?:everything|full|complete|all (?:the )?(?:details|stories)|details|with sources|source links?|pin(?:ned)?)\b/i,
  /\b(?:full|complete|everything|all)\s+(?:news|story|article|details)\b/i,
  /(?:পুরো|সম্পূর্ণ|সব)\s*(?:খবর|সংবাদ|বিবরণ|গল্প)|(?:খবর|সংবাদ)\s*(?:সম্পূর্ণ|সব|পুরো)/,
];

/** The one-turn override in what they said, or null when the saved default should be used. */
export function wantsNewsMode(text) {
  const s = String(text ?? '').replace(/^\[[^\]]*\]\s*/, '');
  if (!s.trim()) return null;
  if (EVERYTHING.some((re) => re.test(s))) return 'everything';
  if (SHORT.some((re) => re.test(s))) return 'short';
  if (MEDIUM.some((re) => re.test(s))) return 'medium';
  return null;
}

/** URLs actually returned by a web tool this turn, for the "never invent a source" rule. */
export function extractSources(result, { max = 8 } = {}) {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  const out = [], seen = new Set();
  const add = (label, raw) => {
    let url = String(raw ?? '').replace(/[.,;:!?]+$/, '');
    try { url = new URL(url).href; } catch { return; }
    if (seen.has(url) || checkLink(url).level !== SAFE) return;
    seen.add(url);
    let name = String(label ?? '').replace(/\*\*/g, '').replace(/[\[\]\n\r()]/g, ' ').trim().slice(0, 40);
    if (!name) { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch { return; } }
    out.push({ name, url });
  };
  for (const m of text.matchAll(/\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/gi)) add(m[1], m[2]);
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) add('', m[0]);
  return out.slice(0, max);
}

/** Adds tool-returned sources without duplicating ones the model already printed. */
export function mergeSources(have = [], more = [], max = 8) {
  const out = [];
  const seen = new Set();
  for (const s of [...have, ...more]) {
    if (!s?.url || seen.has(s.url)) continue;
    seen.add(s.url); out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** A short display line, appended from verified tool URLs rather than trusted to the model. */
export function sourceLine(sources = [], lang = 'en', { links = true } = {}) {
  if (!sources.length) return '';
  const label = lang === 'bn' ? 'উৎস' : 'Sources';
  const items = sources.map((s) => links ? `[${s.name}](${s.url})` : s.name);
  return `${label}: ${items.join(', ')}`;
}

/** The standing rule added to the system prompt. Sources are only shown in Everything mode. */
export function newsDirective(mode = 'short', sources = [], lang = 'en') {
  const m = newsMode(mode);
  const label = lang === 'bn' ? 'উৎস' : 'Sources';
  const verified = sources.length
    ? `\nVerified links from the tools this turn (use these exact URLs, or other URLs the tools returned; never make one up):\n${sources.slice(0, 8).map((s) => `- ${s.name}: ${s.url}`).join('\n')}`
    : '';
  const script = lang === 'bn' ? ' Keep the prose in Bengali; publisher names and URLs may stay in their original script.' : '';
  const common = `News detail (${m}): this applies to requests for news, headlines, an article or a round-up. Use only sources and links that appeared in web_search or web_fetch results this turn; never invent a publisher, headline, quote or URL. If no link was returned, say so instead of guessing.${script}${verified}`;
  if (m === 'short') return `${common}\nGive a brief summary only: the answer and at most two short sentences of context. No source breakdown, no "${label}:" line, no full article, no cards and no pinning, even if the web tools returned several stories.`;
  if (m === 'medium') return `${common}\nGive a moderate summary: the headline, two to four key facts and the publisher's name in the reply. You may end with one short "${label}:" line naming publishers only (no links), but no full article, no cards and no pinning.`;
  return `${common}\nGive everything the sources make available: the full account, the headline, publisher, dates, key figures and the context that matters, without padding or repeating yourself. Draw one "sources" card whose title names the headline and publisher and whose sources list carries each publisher/headline with its exact tool-returned URL, and set pinned: true on that card so it stays up for this request. Displaying source links and keeping that card pinned are required in Everything mode; never pin cards in Short or Medium.`;
}
