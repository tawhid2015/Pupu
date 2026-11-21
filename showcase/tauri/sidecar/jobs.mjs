// Scheduled jobs: work a background agent does on a schedule ("every weekday at 8, sum up the tech news"), unlike a
// reminder, which is only a nudge. Kept in ~/Roamies/Data/jobs.json on this computer only (never synced), so two
// computers never run the same job twice. Runs missed while the computer slept come back as one catch-up run.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { AGENT_TYPES, RETURNS } from './agents.mjs';
import { DIR, nextOccurrence, parseDue, parseRepeat, readJson, repeatLabel, writeJson } from './store.mjs';

const FILE = path.join(DIR, 'jobs.json');
export const MAX_JOBS = 30;

let jobs = null;
const load = () => {
  if (jobs) return jobs;
  const j = readJson(FILE, { backup: true });
  jobs = j?.version === 1 && Array.isArray(j.jobs) ? j : { version: 1, jobs: [] };
  return jobs;
};
const save = () => writeJson(FILE, load(), { backup: true });
const newId = () => { const taken = new Set(load().jobs.map((j) => j.id)); for (;;) { const id = `j${randomBytes(3).toString('hex')}`; if (!taken.has(id)) return id; } };
const copy = (j) => (j ? { ...j } : null);
const find = (id) => load().jobs.find((j) => j.id === String(id));

// due: a time parseDue reads, or ms. Unreadable or missing → an Error that says how to write it.
function dueOf(due, now) {
  const ms = typeof due === 'number' ? due : parseDue(due, now);
  if (ms === undefined) throw new Error(`Couldn't read the time "${due}". Use "in 10m", YYYY-MM-DDTHH:mm or YYYY-MM-DD.`);
  if (ms == null) throw new Error('A job needs due: the first time it should run.');
  return ms;
}
function repeatOf(repeat) {
  if (repeat == null || repeat === '') return null;
  const r = parseRepeat(repeat);
  if (r === undefined) throw new Error(`Couldn't read the repeat "${repeat}". Use daily, weekdays, weekly, monthly, "every 2 hours" (5 minutes or more) or days like "mon,wed,fri".`);
  return r;
}
// "Weekdays at 8" set on a Saturday: the first run is Monday's, not today's.
const firstOn = (r, due) => (r?.rule.on && !r.rule.on.includes(new Date(due).getDay()) ? nextOccurrence(r.rule, due, due) : due);

export async function addJob({ title, brief, type = 'researcher', returns, subagent, due, repeat }, now = Date.now()) {
  title = String(title ?? '').trim().slice(0, 60);
  brief = String(brief ?? '').trim();
  if (!title) throw new Error('A job needs a title: 2 to 5 words.');
  if (!brief) throw new Error('The brief is empty: say everything the agent needs each time it runs; it sees none of this conversation.');
  if (brief.length > 8000) throw new Error('Keep the brief under 8,000 characters.');
  if (!AGENT_TYPES.includes(type)) throw new Error(`type must be one of ${AGENT_TYPES.join(', ')}.`);
  if (returns != null && !RETURNS.includes(returns)) throw new Error(`returns must be one of ${RETURNS.join(', ')}.`);
  if (load().jobs.length >= MAX_JOBS) throw new Error(`There are already ${MAX_JOBS} scheduled jobs, the most there can be. Remove one first.`);
  const r = repeatOf(repeat);
  const at = firstOn(r, dueOf(due, now));
  const j = { id: newId(), title, brief, type, returns: returns ?? null, subagent: subagent ? String(subagent).slice(0, 40) : null, due: at, repeat: r?.spec ?? null, repeatFrom: r ? at : null, paused: false, createdAt: now, lastRunAt: null, lastAgentId: null, lastError: null, runs: 0 };
  load().jobs.push(j);
  await save();
  return copy(j);
}

/** paused, due (a new first time; it moves the series), repeat (null or 'none' stops repeating), title, brief. */
export async function updateJob(id, { paused, due, repeat, title, brief } = {}, now = Date.now()) {
  const j = find(id);
  if (!j) return null;
  if (title !== undefined && String(title).trim()) j.title = String(title).trim().slice(0, 60);
  if (brief !== undefined && String(brief).trim()) j.brief = String(brief).trim().slice(0, 8000);
  if (due !== undefined) { j.due = dueOf(due, now); if (j.repeat) j.repeatFrom = j.due; }
  if (repeat !== undefined) {
    const r = repeat === 'none' ? null : repeatOf(repeat);
    if (r && j.due == null) j.due = now; // a finished one-off made to repeat starts again now
    j.repeat = r?.spec ?? null; j.repeatFrom = r ? j.due : null;
    if (r) j.due = j.repeatFrom = firstOn(r, j.due);
  }
  if (paused !== undefined) {
    j.paused = !!paused;
    // Resumed after a while: carry on from the next time still to come, not with the ones that went by.
    if (!j.paused && j.repeat && j.due != null && j.due <= now) j.due = nextOccurrence(parseRepeat(j.repeat).rule, j.repeatFrom ?? j.due, now);
  }
  await save();
  return copy(j);
}

export async function removeJob(id) {
  const all = load().jobs, i = all.findIndex((j) => j.id === String(id));
  if (i < 0) return null;
  const [j] = all.splice(i, 1);
  await save();
  return j;
}

export const getJob = (id) => copy(find(id));
/** Soonest next run first; paused and finished one-offs last. */
export const listJobs = () => load().jobs.map(copy).sort((a, b) => ((a.paused || a.due == null) - (b.paused || b.due == null)) || ((a.due ?? Infinity) - (b.due ?? Infinity)) || a.createdAt - b.createdAt);

/** When the next job is due (ms), so the timer can sleep until then; null for none. */
export function nextJobDue() {
  const t = load().jobs.filter((j) => !j.paused && j.due != null).map((j) => j.due);
  return t.length ? Math.min(...t) : null;
}

/** The jobs whose time has come. A repeating one moves on to its next time after `now` (runs missed meanwhile are
 *  skipped, so there's one catch-up run, never a stack of them); a one-off is left with no next time. */
export async function takeDueJobs(now = Date.now()) {
  const due = load().jobs.filter((j) => !j.paused && j.due != null && j.due <= now);
  if (!due.length) return [];
  const fired = due.map(copy);
  for (const j of due) {
    const r = j.repeat ? parseRepeat(j.repeat) : null;
    j.due = r ? nextOccurrence(r.rule, j.repeatFrom ?? j.due, now) : null;
  }
  await save();
  return fired;
}

/** A run started (agentId) or couldn't (error). Doesn't touch the schedule: "run now" leaves the next time as it was. */
export async function markRun(id, { agentId = null, error = null } = {}, now = Date.now()) {
  const j = find(id);
  if (!j) return null;
  j.lastRunAt = now; j.runs = (j.runs ?? 0) + 1;
  if (agentId) j.lastAgentId = agentId;
  j.lastError = error ? String(error).slice(0, 200) : null;
  await save();
  return copy(j);
}

/** One line per job for the live state and list_jobs. */
export function jobsText(fmtWhen, list = listJobs()) {
  return list.map((j) => `- ${j.id}: ${j.title} (${j.type}${j.subagent ? `, ${j.subagent}` : ''})${j.paused ? ' [paused]' : j.due != null ? ` next ${fmtWhen(j.due)}` : ' [ran; no next time]'}${j.repeat ? ` [repeats ${repeatLabel(j.repeat)}]` : ''}${j.lastRunAt ? `, last ran ${fmtWhen(j.lastRunAt)}${j.lastAgentId ? ` as agent ${j.lastAgentId}` : ''}${j.lastError ? ` but didn't start: ${j.lastError}` : ''}` : ''}`).join('\n');
}

/** What the agent is given each run: the job's brief, said to be a scheduled run, so it doesn't wait for anyone. */
export const jobBrief = (j, userName = 'the user') => `This is a scheduled job ${userName} set up ("${j.title}"${j.repeat ? `, runs ${repeatLabel(j.repeat)}` : ''}). Nobody is waiting at the screen: do the work, then report.\n\n${j.brief}`;
