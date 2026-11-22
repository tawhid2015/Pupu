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

export function cleanPublisherName(rawName, url) {
  let host = '';
  try {
    if (url) host = new URL(url).hostname.replace(/^www\./, '');
  } catch {}

  if (host) {
    const parts = host.split('.');
    let base = parts[0];
    if (parts.length > 2 && (parts[parts.length - 2] === 'co' || parts[parts.length - 2] === 'com')) {
      base = parts[0];
    } else if (parts.length >= 2 && base === 'news') {
      base = parts[1];
    }
    const map = {
      kitco: 'Kitco',
      livepriceofgold: 'LiveGold',
      goldprice: 'GoldPrice',
      reuters: 'Reuters',
      bloomberg: 'Bloomberg',
      investing: 'Investing',
      marketwatch: 'MarketWatch',
      cnbc: 'CNBC',
      fxstreet: 'FXStreet',
      forbes: 'Forbes',
      ft: 'FinancialTimes',
      wsj: 'WSJ',
      yahoo: 'YahooFinance',
      economictimes: 'EconomicTimes',
      aljazeera: 'AlJazeera',
      bbc: 'BBC',
      cnn: 'CNN',
      theguardian: 'Guardian'
    };
    if (map[base.toLowerCase()]) return map[base.toLowerCase()];
    if (base) return base.charAt(0).toUpperCase() + base.slice(1, 12);
    return host.slice(0, 14);
  }

  if (rawName && typeof rawName === 'string') {
    const trimmed = rawName.trim();
    if (trimmed.length <= 15 && !trimmed.includes('-') && !trimmed.includes('|') && !trimmed.includes(':')) {
      return trimmed;
    }
  }

  return (rawName || 'Source').slice(0, 14);
}

export function parseNewsItems(rawSearchText) {
  const items = [];
  if (!rawSearchText || typeof rawSearchText !== 'string') return items;
  const lines = rawSearchText.split('\n');
  let curTitle = '', curSnippet = '', curUrl = '';
  for (const line of lines) {
    const m = /^\d+\.\s+\[(.*?)\]\((.*?)\)/.exec(line);
    if (m) {
      if (curTitle) {
        items.push({
          title: curTitle.trim(),
          snippet: curSnippet.trim().replace(/\bhttps?:\/\/\S+/g, ''),
          url: curUrl,
          source: cleanPublisherName(curTitle, curUrl)
        });
      }
      curTitle = m[1];
      curUrl = m[2];
      curSnippet = '';
    } else if (curTitle && line.trim() && !line.startsWith('Web search results')) {
      curSnippet += ' ' + line.trim();
    }
  }
  if (curTitle) {
    items.push({
      title: curTitle.trim(),
      snippet: curSnippet.trim().replace(/\bhttps?:\/\/\S+/g, ''),
      url: curUrl,
      source: cleanPublisherName(curTitle, curUrl)
    });
  }
  return items;
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

/** Categorizes a Todoist task or research topic based on content and description */
export function categorizeTask(task) {
  const content = String(task?.content || '').toLowerCase();
  const desc = String(task?.description || '').toLowerCase();
  const fullText = `${content} ${desc}`;

  // 1. Economic Calendar & Events
  if (/(?:calendar|ক্যালেন্ডার|fomc|fed meeting|interest rate decision|cpi|pce|nfp|nonfarm|unemployment|gdp|powell speech|high-impact|economic events)/i.test(fullText)) {
    return {
      id: 'calendar',
      name: 'Economic Calendar',
      badge: '📅',
      order: 3
    };
  }

  // 2. Macro & Fundamental Research
  if (/(?:fundamental|ফান্ডামেন্টাল|central bank|institutional demand|etf flow|fed policy|yield|treasury|dxy|us dollar|dollar index|interest rate outlook|monetary policy)/i.test(fullText)) {
    return {
      id: 'fundamental',
      name: 'Fundamental Research',
      badge: '📊',
      order: 2
    };
  }

  // 3. Market & Asset News
  if (/(?:gold|xauusd|swarna|shona|সোনা|স্বর্ণ|silver|oil|crude|crypto|btc|bitcoin|stock|market news|breaking|volatility|bullion|lab gold)/i.test(fullText)) {
    return {
      id: 'market_news',
      name: 'Market News',
      badge: '📈',
      order: 1
    };
  }

  return {
    id: 'general',
    name: 'General Research',
    badge: '🔍',
    order: 4
  };
}

export function isResearchableTask(task) {
  if (!task || !task.content) return false;
  const c = String(task.content).toLowerCase();
  const d = String(task.description || '').toLowerCase();
  const full = `${c} ${d}`;
  return (
    /(?:gold|xauusd|swarna|shona|সোনা|স্বর্ণ|dollar|usd|dxy|news|khobor|খবর|সংবাদ|weather|forecast|rate|price|market|analysis|fundamental|calendar|fomc|fed|yield|lab gold)/i.test(full) ||
    /^(?:chk|check|find|get|analyze|research|look up|search)\b/i.test(c) ||
    d.length > 25
  );
}

export function formulateResearchPlan(task) {
  const category = categorizeTask(task);
  const content = String(task?.content || '').trim();
  const desc = String(task?.description || '').trim();

  // Extract focus bullet points from description
  const focusAreas = desc
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.]+\s*/, '').trim())
    .filter((line) => line.length > 5);

  let primaryQuery = '';
  const lowerContent = content.toLowerCase();

  if (/gold news/i.test(lowerContent) || (/xauusd/i.test(lowerContent) && /news/i.test(lowerContent))) {
    primaryQuery = 'gold price XAUUSD news market analysis today';
  } else if (/gold fundamental/i.test(lowerContent)) {
    primaryQuery = 'gold fundamental analysis central bank buying fed rate outlook';
  } else if (/gold latest updates/i.test(lowerContent)) {
    primaryQuery = 'gold XAUUSD latest news updates 24h breaking';
  } else if (/us dollar|usd/i.test(lowerContent)) {
    primaryQuery = 'US Dollar Index DXY news analysis gold impact today';
  } else if (/financial & economic news|economic news/i.test(lowerContent)) {
    primaryQuery = 'US financial economic news Fed yields today';
  } else if (/economic calendar/i.test(lowerContent)) {
    primaryQuery = 'economic calendar today USD high impact events';
  } else if (/lab gold/i.test(lowerContent)) {
    primaryQuery = 'lab grown gold price rates India USA news';
  } else {
    const cleanContent = content.replace(/^(?:chk|check|find|get|analyze|research)\s+/i, '');
    const firstFocus = focusAreas[0] ? focusAreas[0].slice(0, 40) : '';
    primaryQuery = `${cleanContent} ${firstFocus} today`.trim();
  }

  return {
    category,
    primaryQuery,
    focusAreas,
    targetTitle: content
  };
}

export function synthesizeResearchDossier(task, rawOrParsedResults, lang = 'en') {
  const plan = formulateResearchPlan(task);
  const items = Array.isArray(rawOrParsedResults)
    ? rawOrParsedResults
    : parseNewsItems(rawOrParsedResults);
  const sources = extractSources(typeof rawOrParsedResults === 'string' ? rawOrParsedResults : JSON.stringify(rawOrParsedResults));

  const content = String(task?.content || '').trim();
  const category = plan.category;

  const headlines = items.map((it) => it.title).filter(Boolean);
  const snippets = items.map((it) => it.snippet).filter(Boolean);
  const combinedContext = snippets.join(' ');

  let bias = 'Neutral / Consolidation';
  let biasTone = 'neutral';
  if (/(?:rally|surged?|record high|gains|bullish|safe-?haven demand|escalat|rate cuts?|upside)/i.test(combinedContext)) {
    bias = 'Bullish (Safe-Haven Demand & Rate Expectations)';
    biasTone = 'bullish';
  } else if (/(?:slump|drops?|fell|tumble|bearish|hawkish|strong dollar|yields surge|downside)/i.test(combinedContext)) {
    bias = 'Bearish (Dollar Strength & Yield Pressure)';
    biasTone = 'bearish';
  }

  const keyPoints = [];
  if (category.id === 'market_news') {
    if (headlines[0]) keyPoints.push(`Latest Action: ${headlines[0]}`);
    if (snippets[0]) keyPoints.push(`Key Catalyst: ${snippets[0].slice(0, 105)}`);
    keyPoints.push(`Market Bias: ${bias}`);
    if (snippets[1]) keyPoints.push(`Volatility Factor: ${snippets[1].slice(0, 105)}`);
  } else if (category.id === 'fundamental') {
    keyPoints.push(`Fundamental Bias: ${bias}`);
    if (headlines[0]) keyPoints.push(`Driver: ${headlines[0]}`);
    if (snippets[0]) keyPoints.push(`Central Bank / Fed: ${snippets[0].slice(0, 105)}`);
    if (snippets[1]) keyPoints.push(`Institutional & Yield Outlook: ${snippets[1].slice(0, 105)}`);
  } else if (category.id === 'calendar') {
    if (headlines[0]) keyPoints.push(`High Impact Event: ${headlines[0]}`);
    if (snippets[0]) keyPoints.push(`Details & Outlook: ${snippets[0].slice(0, 105)}`);
    keyPoints.push(`Scheduled Focus: USD High-Impact Releases (GMT+6 priority)`);
    keyPoints.push(`Volatility Warning: Potential spread widening around data prints`);
  } else {
    if (headlines[0]) keyPoints.push(`Update: ${headlines[0]}`);
    if (snippets[0]) keyPoints.push(`Overview: ${snippets[0].slice(0, 105)}`);
    keyPoints.push(`Status: Completed deep research`);
  }

  const cleanKeyPoints = keyPoints.filter(Boolean).slice(0, 4);
  const mainHeadline = headlines[0] || `${content} Overview`;
  const summarySnippet = snippets[0]
    ? `${mainHeadline} — ${snippets[0].slice(0, 140)}.`
    : `Comprehensive deep research for ${content} covering key catalysts and market bias.`;

  const leadParagraph = `In today's research on ${content}, market signals indicate a ${bias.toLowerCase()} stance. ${snippets[0] || 'Key drivers reflect active macro positioning and institutional interest.'}`;
  const secondParagraph = snippets[1]
    ? `Further developments highlight: ${snippets[1]}. Factors affecting current valuations continue to revolve around interest rate trajectory, geopolitical safe-haven demand, and liquidity flows.`
    : `Institutional demand, central bank reserves, and currency momentum remain the dominant catalysts dictating price trends.`;
  const conclusionParagraph = `Outlook summary: Watch for scheduled releases and key technical levels. Risk management is advised as sudden headline volatility may impact market spreads.`;

  const fullContent = `${leadParagraph}\n\n${secondParagraph}\n\n${conclusionParagraph}`;

  const spokenText = lang === 'bn'
    ? `এখানে ${content}-এর বিস্তারিত গবেষণা প্রতিবেদন। ${mainHeadline}। বর্তমান দৃষ্টিভঙ্গি হলো ${bias}। ${snippets[0] || ''}। পরবর্তী প্রভাব এবং কেন্দ্রীয় ব্যাংকের অবস্থান পর্যবেক্ষণ করা হচ্ছে।`
    : `Here is your detailed research report on ${content}. ${mainHeadline}. The current market bias is evaluated as ${bias}. ${snippets[0] || 'Key institutional and geopolitical factors are shaping market momentum.'} ${snippets[1] || ''}. You can monitor support and resistance levels as upcoming economic drivers unfold.`;

  const topUrl = items[0]?.url || sources[0]?.url || '';
  const topSource = items[0]?.source || sources[0]?.name || cleanPublisherName(mainHeadline, topUrl);

  return {
    id: task?.id || `dossier-${Date.now()}`,
    category: category.name,
    categoryBadge: category.badge,
    categoryOrder: category.order,
    title: content,
    headline: mainHeadline,
    summarySnippet,
    bias,
    biasTone,
    keyPoints: cleanKeyPoints,
    fullContent,
    spokenText,
    sources: sources.slice(0, 4),
    url: topUrl,
    source: topSource
  };
}
