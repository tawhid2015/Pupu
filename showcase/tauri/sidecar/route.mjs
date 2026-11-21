// Hybrid models: a fast default model for chatting, and other models, picked by the user, for heavier jobs.
// This file decides what kind of job a request is (jobKinds, by words, like wantsAgent in agents.mjs: no extra model
// call, so it costs nothing and adds no delay) and which model that kind should run on (pickHeavy). The turn itself
// switches in sidekick.mjs. A wrong guess is cheap either way: a heavy job on the default model is how it always
// worked, and a light one on a strong model only costs a little more.
import { wantsAgent } from './agents.mjs';

// The kinds of job, in the order they're checked: the first with a model set (and runnable) wins. Computer use first
// (clicking needs the strongest model), then code, background agents, drawing and web research.
export const JOB_KINDS = [
  { kind: 'computer', label: 'Computer use' },
  { kind: 'code', label: 'Coding and commands' },
  { kind: 'agents', label: 'Background agents' },
  { kind: 'draw', label: 'Drawing' },
  { kind: 'web', label: 'Web research' },
];
export const KINDS = JOB_KINDS.map((j) => j.kind);

// Words that say what a request is about. Specific on purpose: a miss falls back to the default model, as before.
export const JOB_PATTERNS = {
  computer: [
    /\b(click|double.?click|right.?click|scroll|drag)\b/i,
    /\b(type|enter|paste|fill)\b[^.?!]{0,30}\b(into|in the|on the|in this|on this)\b/i,
    /\b(open|launch|switch to|quit|close)\s+(?:the\s+|my\s+)?[\w .]{0,25}\b(app|application|window|tab|browser|finder|safari|chrome|firefox|excel|word|powerpoint|photoshop|figma|slack|mail|messages|notes|xcode|terminal|spotify|zoom|obsidian|notion|calendar|system settings|preferences)\b/i,
    /\b(on|in|at) my (screen|desktop|mac|computer)\b|\bscreenshot\b|\blook at (this|my|the) (window|screen|page|tab)\b|\b(control|use|take over) my (mac|computer|screen)\b/i,
  ],
  code: [
    /\b(write|create|make|build|edit|fix|debug|refactor|rewrite|implement|add|change|update)\b[^.?!]{0,50}\b(code|script|function|program|app|website|web ?page|file|bug|class|component|tests?|endpoint|api|feature|repo|module|query|css|html|sql|regex|config)\b/i,
    /\b(run|execute)\s+(?:the\s+|my\s+|this\s+|a\s+)?(?:\w+\s+)?(?:command|script|tests?|build|code|program)\b/i,
    /\b(stack ?trace|traceback|syntax error|compile error|segfault|npm|pnpm|yarn|pip|brew install|cargo|git|docker|kubectl|python|typescript|javascript|swift|rust|golang|json|yaml|dockerfile|makefile|bash|zsh|ssh|curl|sudo|chmod)\b/i,
    /\b(rename|move|delete|organi[sz]e|sort|tidy|clean up|zip|unzip|copy)\b[^.?!]{0,40}\b(files?|folders?|downloads|directory|directories)\b/i,
  ],
  draw: [/\b(draw|diagram|sketch|flow ?chart|mind ?map|infographic|timeline|bar chart|pie chart|line graph|illustrate|visuali[sz]e|plot)\b/i],
  web: [
    /\b(search the (web|internet)|search online|look (it|this|that) up|google (it|this|that|for)|browse the web|find out online)\b/i,
    /\b(latest|current|today'?s|recent|newest)\b[^.?!]{0,30}\b(news|price|prices|version|release|score|scores|update|updates)\b/i,
    /\b(research|compare)\b[^.?!]{0,60}\b(online|web|prices?|reviews?|options|sources|articles?|products?)\b/i,
  ],
};

// Thanks, yes, ok…: never a reason to stay on (or switch to) a heavy model.
const CHITCHAT = /^\s*(thanks?( you)?|thx|ok(ay)?|cool|nice|great|got it|perfect|awesome|yes|yep|yeah|no|nope|sure|stop|never ?mind|good|hi|hello|hey)\b[\s.!?]*$/i;
export const isChitchat = (text) => CHITCHAT.test(String(text ?? ''));

/** The kinds of job a request looks like, in JOB_KINDS order. System lines ("(Reminder…)") and chit-chat are none. */
export function jobKinds(text, { agentCheck = wantsAgent } = {}) {
  const t = String(text ?? '').trim();
  if (!t || t.startsWith('(') || isChitchat(t)) return [];
  const out = [];
  for (const { kind } of JOB_KINDS) {
    if (kind === 'agents' ? agentCheck(t) : JOB_PATTERNS[kind].some((re) => re.test(t))) out.push(kind);
  }
  return out;
}

// The tools that mean a job of that kind is under way (so a follow-up shortly after stays on the same model).
const TOOL_KIND = {
  act_in_app: 'computer', read_window: 'computer', list_windows: 'computer', take_screenshot: 'computer',
  write_file: 'code', run_command: 'code',
  send_agent: 'agents', draw: 'draw', web_search: 'web', web_fetch: 'web',
};
export const kindOfTool = (name) => TOOL_KIND[name] ?? null;

/** 'anthropic:claude-opus-5-5' → { provider, model, spec }; '' or junk → null. Model ids may contain colons. */
export function parseSpec(spec) {
  const s = String(spec ?? '').trim(), i = s.indexOf(':');
  if (i <= 0 || i === s.length - 1) return null;
  return { provider: s.slice(0, i), model: s.slice(i + 1), spec: s };
}

/** The first of `kinds` that has a model set in `heavy` ({ kind: 'provider:model' }) which canRun(provider, model). */
export function pickHeavy(kinds, heavy, canRun) {
  for (const kind of kinds) {
    const h = parseSpec(heavy?.[kind]);
    if (h && canRun(h.provider, h.model)) return { kind, ...h };
  }
  return null;
}

/** Is any job set to its own model? */
export const hybridOn = (heavy) => KINDS.some((k) => !!parseSpec(heavy?.[k]));

// ---------- naming a model in their own words ----------
// "use Opus for this", "hand it off to Gemini", "ask Luna": the user picks the model for a job that isn't in the list
// (or overrides the list). Models come in as candidates ({ provider, id, name }: the ones that can run now), so only a
// model they can actually use is ever picked. Each model is known by the words in its name ("haiku", "luna"), each
// platform by its own ("claude", "chatgpt", "gemini"); a platform alone means its default model.
const PROVIDER_WORDS = {
  anthropic: ['claude', 'anthropic'], openai: ['openai', 'chatgpt', 'gpt'], gemini: ['gemini', 'google'], 'gemini-api': ['gemini'],
  xai: ['grok', 'xai'], moonshot: ['kimi', 'moonshot'], 'kimi-code': ['kimi'], glm: ['glm', 'zhipu'], minimax: ['minimax'],
  xiaomi: ['mimo', 'xiaomi'], 'xiaomi-credits': ['mimo'], deepseek: ['deepseek'], sakana: ['fugu', 'sakana'], openrouter: ['openrouter'],
};
// Words in model names that say nothing about which model it is.
const GENERIC = new Set(['claude', 'gpt', 'model', 'models', 'fast', 'preview', 'code', 'the', 'and', 'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'flash', 'high', 'speed', 'highspeed', 'ultraspeed', 'latest', 'new', 'turbo', 'free', 'instruct', 'chat']);
// Before the name: they're handing something over. After it: they mean the product, not the model.
const HANDOVER = /\b(use|using|with|via|ask|have|let|hand|handoff|hand-off|pass|give|send|switch|route|delegate|go with|try|run it on|do it on)\b/i;
const NOT_THE_MODEL = /^\W{0,3}(api|apis|sdk|key|keys|library|package|docs?|documentation|endpoint|client|credits?|pricing|price|plan|cli|account|code|app|website)\b/i;
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsOf = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 3 && !/^[\d.]+$/.test(w) && !GENERIC.has(w));

function resolve(word, text, cands, defaults, byWord) {
  const provs = Object.entries(PROVIDER_WORDS).filter(([, ws]) => ws.includes(word)).map(([p]) => p);
  let set = provs.length ? cands.filter((c) => provs.includes(c.provider)) : (byWord.get(word) ?? []);
  if (!set.length) return null;
  const low = text.toLowerCase();
  const exact = set.find((c) => low.includes(String(c.name ?? '').toLowerCase()) || low.includes(String(c.id).toLowerCase()));
  if (exact) return exact;
  if (set.length === 1) return set[0];
  return set.find((c) => c.id === defaults?.[c.provider]) ?? [...set].sort((a, b) => a.id.length - b.id.length)[0];
}

function index(cands) {
  const byWord = new Map();
  for (const c of cands) for (const w of new Set([...wordsOf(c.name), ...wordsOf(c.id)])) byWord.set(w, [...(byWord.get(w) ?? []), c]);
  const words = new Set([...byWord.keys(), ...Object.values(PROVIDER_WORDS).flat().filter((w) => cands.some((c) => (PROVIDER_WORDS[c.provider] ?? []).includes(w)))]);
  return { byWord, words };
}

/** The model they asked for in this request, or null: { provider, model, spec, name }. A word must follow a hand-over
 *  verb ("use", "ask", "hand it to"…) closely, and not be the product ("the Gemini API"). */
export function findModelMention(text, candidates, defaults = {}) {
  const t = String(text ?? '');
  if (!t || t.startsWith('(') || !candidates?.length) return null;
  const { byWord, words } = index(candidates);
  if (!words.size) return null;
  const re = new RegExp(`\\b(${[...words].map(esc).join('|')})\\b`, 'gi');
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index - 36), m.index), after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (!HANDOVER.test(before) || NOT_THE_MODEL.test(after)) continue;
    const c = resolve(m[0].toLowerCase(), t, candidates, defaults, byWord);
    if (c) return { provider: c.provider, model: c.id, spec: `${c.provider}:${c.id}`, name: c.name ?? c.id };
  }
  return null;
}

/** A model by what they called it ("gemini", "Claude Opus 5.5", or 'provider:model'): for send_agent's model argument. */
export function findModelByName(name, candidates, defaults = {}) {
  const n = String(name ?? '').trim();
  if (!n || !candidates?.length) return null;
  const spec = parseSpec(n);
  const direct = spec && candidates.find((c) => c.provider === spec.provider && c.id === spec.model);
  if (direct) return { provider: direct.provider, model: direct.id, spec: spec.spec, name: direct.name ?? direct.id };
  const { byWord, words } = index(candidates);
  const low = n.toLowerCase();
  for (const w of low.split(/[^a-z0-9.]+/)) {
    if (!words.has(w)) continue;
    const c = resolve(w, n, candidates, defaults, byWord);
    if (c) return { provider: c.provider, model: c.id, spec: `${c.provider}:${c.id}`, name: c.name ?? c.id };
  }
  return null;
}
