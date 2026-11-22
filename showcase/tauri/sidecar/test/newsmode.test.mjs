// News detail: a saved default, a one-turn spoken phrase, and sources that come from the web tools rather than from
// the model's imagination. Short never shows a source breakdown or pins; Medium names publishers but shows no links;
// Everything shows links and pins the sources card. Run: npm test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanPublisherName, extractSources, mergeSources, newsDirective, newsMode, parseNewsItems, sourceLine, wantsNewsMode } from '../newsmode.mjs';

const root = new URL('../../../../', import.meta.url);
const src = (p) => readFileSync(new URL(p, root), 'utf8');
const side = src('showcase/tauri/sidecar/sidekick.mjs');
const tools = src('showcase/tauri/sidecar/tools.mjs');
const draw = src('showcase/tauri/sidecar/draw.mjs');
const ink = src('showcase/roamies/ink.js');
const panel = src('showcase/panel/panel.js');
const markdown = src('showcase/roamies/markdown.js');
assert.match(side, /newsmode_\(short\|medium\|everything\)/, 'the panel saves a default news mode');
assert.match(side, /config\.newsMode = id\.slice\(9\)/, 'the saved mode is not sliced past its prefix');
assert.match(panel, /s\.newsMode = id\.slice\(9\)/, 'the panel preview uses the same offset');
assert.match(panel, /newsmode_/, 'the saved default has a control in Settings');
assert.match(side, /setAutoPinNews\(newsDetail === 'everything'\)/, 'pinning is on only for Everything');
assert.match(side, /noteNewsSources\(e\.result\)/, 'tool results are the source of truth');
assert.match(side, /noteNewsSources\(e\.data\)/, 'server web results too');
assert.match(side, /toolName === 'web_search' \|\| toolName === 'web_fetch'/, 'only web tool results become sources');
assert.match(side, /hasPinnedNews\(\)/, 'a missing sources card is drawn as a fallback');
assert.match(tools, /inkEvents\.pinned\(id, true\)/, 'the source card is pinned like a user click');
assert.match(tools, /m\.pinned = false/, 'a model cannot pin an arbitrary card in Short or Medium');
assert.match(side, /const pinVoice = turnVoice; turnVoice = null/, 'the automatic card adds no spoken line');
assert.match(draw, /pinned: z\.boolean\(\)\.optional\(\)/, 'pinned survives the draw schema');
assert.match(ink, /pinned: !!m\.pinned/, 'the overlay keeps a pinned sources card through clears');
assert.match(markdown, /উৎস/, 'a Bangla source line is displayed as a source row');

assert.equal(newsMode('bogus'), 'short');
assert.equal(wantsNewsMode('what happened in the news'), null, 'plain news uses the saved default');
assert.equal(wantsNewsMode('news short'), 'short');
assert.equal(wantsNewsMode('give me the brief headlines'), 'short');
assert.equal(wantsNewsMode('news medium'), 'medium');
assert.equal(wantsNewsMode('একটু মাঝারি খবর'), 'medium');
assert.equal(wantsNewsMode('news everything'), 'everything');
assert.equal(wantsNewsMode('পুরো খবর'), 'everything');
assert.equal(wantsNewsMode('[happy] news, all the details please'), 'everything');

const toolText = 'From [BBC News](https://www.bbc.com/news/world-123) and [Reuters: the story](https://www.reuters.com/world/story) plus https://example.org/raw. See javascript:alert(1).';
const sources = extractSources(toolText);
assert.deepEqual(sources.map((s) => s.name), ['BBC News', 'Reuters: the story', 'example.org']);
assert.deepEqual(sources.map((s) => s.url), ['https://www.bbc.com/news/world-123', 'https://www.reuters.com/world/story', 'https://example.org/raw']);
assert.equal(extractSources('[local](file:///etc/passwd)').length, 0, 'only web links are taken as news sources');
assert.equal(mergeSources([{ name: 'BBC News', url: 'https://www.bbc.com/news/world-123' }], sources).length, 3);

assert.equal(sourceLine(sources.slice(0, 2), 'en'), 'Sources: [BBC News](https://www.bbc.com/news/world-123), [Reuters: the story](https://www.reuters.com/world/story)');
assert.equal(sourceLine(sources.slice(0, 2), 'bn', { links: false }), 'উৎস: BBC News, Reuters: the story');

const short = newsDirective('short', sources, 'bn');
assert.match(short, /brief summary only/);
assert.match(short, /উৎস/);
assert.match(short, /no cards and no pinning/);
assert.match(short, /publisher names and URLs may stay in their original script/, 'the Bangla lock does not outlaw source names');
const medium = newsDirective('medium');
assert.match(medium, /headline/);
assert.match(medium, /publishers only \(no links\)/);
assert.match(medium, /no cards and no pinning/);
const everything = newsDirective('everything', sources);
assert.match(everything, /pinned: true/);
assert.match(everything, /exact tool-returned URL/);
assert.match(everything, /news\/world-123/);
assert.doesNotMatch(everything, /no cards/);

assert.equal(cleanPublisherName('Live Price of Gold - 24-hour live gold rates', 'https://www.livepriceofgold.com/gold-price.html'), 'LiveGold');
assert.equal(cleanPublisherName('Gold News Today - Kitco', 'https://www.kitco.com/news/article.html'), 'Kitco');
assert.equal(cleanPublisherName('Reuters', 'https://www.reuters.com/markets/commodities/gold.html'), 'Reuters');

const sampleSearch = `Web search results:
1. [Gold Rates Today](https://www.livepriceofgold.com/gold-price.html)
Gold surged to fresh highs today as investors reacted to inflation data.
2. [Fed Policy Shift](https://www.kitco.com/news/article.html)
Federal Reserve signaled potential rate cuts, lifting bullion demand.`;

const parsed = parseNewsItems(sampleSearch);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].title, 'Gold Rates Today');
assert.equal(parsed[0].source, 'LiveGold');
assert.equal(parsed[0].url, 'https://www.livepriceofgold.com/gold-price.html');
assert.match(parsed[0].snippet, /Gold surged/);

console.log('news mode tests: passed');
