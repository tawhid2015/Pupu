// Subagents: a small crew of specialists the user picks models for. The chat model (the main agent) hands each one a
// prompt through send_agent's `subagent` argument; the specialist runs as an ordinary background agent (agents.mjs) on
// the model chosen for it, with its role in front of the brief. Pure pieces here; the launch is in agents.mjs and the
// settings in sidekick.mjs. A specialist with no model picked is not part of the crew.
import { isChitchat, jobKinds, parseSpec } from './route.mjs';

export const SUBAGENTS = [
  { id: 'scout', label: 'Scout', type: 'researcher', hint: 'Web research.',
    role: 'You are the Scout: you find things out. Search widely, open the sources, cross-check, and report what is true with where it came from. Say plainly what you could not confirm.' },
  { id: 'builder', label: 'Builder', type: 'maker', hint: 'Code, pages and scripts.',
    role: 'You are the Builder: you make working things. Write the code or page, run it, fix what breaks, and hand back something that works rather than a plan.' },
  { id: 'writer', label: 'Writer', type: 'maker', hint: 'Documents, slides and copy.',
    role: 'You are the Writer: you produce finished text. Match the tone and length asked for, keep every name, number and quote as given, and hand back the finished piece.' },
  { id: 'reviewer', label: 'Reviewer', type: 'researcher', hint: 'Checks work for mistakes.',
    role: 'You are the Reviewer: you check work. Read it carefully, run what can be run, and report real problems first, with where they are and how to fix them. Do not rewrite what is fine.' },
  { id: 'tidier', label: 'Tidier', type: 'organizer', hint: 'Sorts, renames and moves files.',
    role: 'You are the Tidier: you put files in order. Propose one clear structure, move and rename with care, never delete, and say what went where.' },
];
export const SUBAGENT_IDS = SUBAGENTS.map((s) => s.id);
export const MAX_AT_ONCE = 3;

// The kind of hybrid job each specialist's work is (route.mjs JOB_KINDS): with hybrid models on and no model of its own
// picked, a specialist uses the model set for that kind, so the two settings agree instead of competing.
export const JOB_OF = { scout: 'web', builder: 'code', reviewer: 'code', tidier: 'code' };

/** The crew: specialists with a model of their own (crew = { id: 'provider:model' }), or else the one hybrid models set
 *  for their kind of job (heavy = { kind: 'provider:model' }, passed only while hybrid is on), that can run now.
 *  Each has spec (parsed), slot (the effort slot it thinks with) and via ('own' | 'hybrid'). */
export function activeCrew(crew, canRun = () => true, heavy = null) {
  const out = [];
  for (const s of SUBAGENTS) {
    const own = parseSpec(crew?.[s.id]), kind = JOB_OF[s.id], mine = own && canRun(own.provider, own.model);
    const h = !mine && heavy && kind ? parseSpec(heavy[kind]) : null;
    if (mine) out.push({ ...s, spec: own, slot: `sub_${s.id}`, via: 'own' });
    else if (h && canRun(h.provider, h.model)) out.push({ ...s, spec: h, slot: kind, via: 'hybrid' });
  }
  return out;
}

/** A specialist by what the chat called it ("scout", "the Builder", "builder agent"), among the crew. */
export function findSubagent(name, crew) {
  const n = String(name ?? '').toLowerCase();
  if (!n.trim()) return null;
  return crew.find((s) => n === s.id || new RegExp(`\\b${s.id}\\b`).test(n) || n.includes(s.label.toLowerCase())) ?? null;
}

/** The brief a specialist gets: its role first, then the brief the chat wrote (which opens with the user's own words). */
export const withRole = (sub, brief) => `${sub.role}\n\n${brief}`;

export const DELEGATE_MODES = ['ask', 'auto'];

/** The line that tells the chat who is on the crew, or '' when nobody is. mode 'ask': only when they ask for an agent or
 *  background work; 'auto': it may also hand off long or separable work by itself (and still does when asked). */
export function crewText(crew, nameOf = (spec) => spec, mode = 'ask') {
  if (!crew.length) return '';
  const when = mode === 'auto'
    ? 'Proactive delegation is on: besides when they ask, hand work to a specialist on your own when it is long, hands-off or has separate parts (research, building, writing, reviewing, tidying), and not when it is a quick answer or needs the screen. This replaces the rule about asking first; the launch on screen is your reply, so say nothing more.'
    : 'Delegate only when they ask for an agent or for work in the background.';
  return `Subagents (specialists you can hand work to: send_agent with subagent set to one of these; each runs on its own model, in the background, and you may start up to ${MAX_AT_ONCE} at once for separate parts of one request). ${when}\n${crew.map((s) => `- ${s.id}: ${s.hint} (${nameOf(s.spec)})`).join('\n')}`;
}

// Words that point at a specialist beyond the job kind (route.mjs jobKinds says web or code).
const ROLE_WORDS = {
  reviewer: /\b(review|proofread|audit|double.?check|look over|check (?:my|the|this) (?:code|work|draft|essay|doc))\b/i,
  tidier: /\b(tidy|organi[sz]e|rename|clean up|sort)\b[^.?!]{0,40}\b(files?|folders?|downloads|desktop|photos|pictures)\b/i,
  writer: /\b(write|draft|compose)\b[^.?!]{0,40}\b(essay|report|article|email|letter|post|slides?|deck|document|doc|proposal|summary|blog)\b|\b(slides?|slide deck|presentation)\b/i,
};

/** For proactive delegation: the specialist a request looks like work for, from its words (no model call), or null.
 *  Never for chit-chat, system lines or anything that needs the screen. */
export function specialistFor(text, crew, jobs = jobKinds) {
  const t = String(text ?? '').trim();
  if (!crew.length || !t || t.startsWith('(') || isChitchat(t)) return null;
  const kinds = jobs(t);
  if (kinds.includes('computer') || kinds.includes('draw')) return null;
  const by = (id) => crew.find((s) => s.id === id) ?? null;
  for (const id of ['reviewer', 'tidier', 'writer']) if (ROLE_WORDS[id].test(t) && by(id)) return by(id);
  if (kinds.includes('web') && by('scout')) return by('scout');
  if (kinds.includes('code') && by('builder')) return by('builder');
  return null;
}

/** The nudge added to a request in proactive mode, '' when none. It points at a specialist; the chat still decides. */
export function delegateNote(text, crew, mode, jobs = jobKinds) {
  if (mode !== 'auto') return '';
  const s = specialistFor(text, crew, jobs);
  return s ? `(This looks like work for the ${s.label} subagent: unless it is a quick answer, call send_agent with subagent "${s.id}" and its own complete prompt.)` : '';
}
