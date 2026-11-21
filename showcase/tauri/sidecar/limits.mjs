// Unavailable models: when a platform says "you've hit your limit", or its sign-in or key stopped working, or it can't
// be reached, or the model is gone from the account, the app notes it, moves to the next model they set up (the one
// for the job, then the default, then up to two backups, in order, skipping any on an unavailable platform), and goes
// back when it's free again. Pure pieces here; the turn itself is handled in sidekick.mjs (the failed request is
// retried on the next model, with a handoff note).

const MIN = 60_000, HOUR = 60 * MIN;
// How long a platform is left alone when the error doesn't say when it resets.
export const COOLDOWN = { limit: 5 * MIN, credit: 60 * MIN, busy: 2 * MIN, auth: 10 * MIN, missing: 30 * MIN, down: 2 * MIN };

// "billing" alone isn't credit: Gemini's free-tier 429 says "check your plan and billing details", and matching that
// as a credit error parked the model for an hour instead of its 30 s retry (and told people they were out of money).
const CREDIT = /insufficient[_ ]quota|credit balance|payment required|\b402\b|out of credits?/i;
const LIMIT = /usage.?limit|rate.?limit|\b429\b|too many requests|limit (?:has been |was )?(?:reached|exceeded|hit)|hit your (?:usage )?limit|you(?:'ve| have) (?:reached|hit)|exceeded (?:your|the) (?:current )?(?:quota|limit)|quota|resource.?exhausted|tokens? per (?:minute|day)|requests? per (?:minute|day)/i;
const BUSY = /overloaded|\b529\b|\b503\b|service unavailable|at capacity|capacity/i;
// Not a limit, but the platform can't be used right now.
const AUTH = /\b40[13]\b|unauthori[sz]ed|forbidden|invalid[_ ](?:x-)?api[_ -]?key|authentication|not signed in|signed out|token (?:has )?expired|expired token|permission denied/i;
const MISSING = /\b404\b|model[_ ]not[_ ]found|does not exist|no such model|unknown model|unsupported model|not (?:available|supported) (?:on|for|with) (?:your|this)|no longer (?:available|supported)/i;
const DOWN = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|network error|socket hang up|\b50[024]\b|bad gateway|gateway time-?out|internal server error/i;

// Each error in the chain as text, with the fields that carry the news (status, code…).
function textOf(err) {
  if (err == null) return '';
  if (typeof err !== 'object') return String(err);
  const parts = [];
  for (let e = err, n = 0; e != null && n < 4; e = e.cause, n++) {
    if (typeof e !== 'object') { parts.push(String(e)); break; }
    parts.push(`${e.message ?? ''} ${['status', 'statusCode', 'code', 'reason', 'type'].map((k) => (e[k] != null && typeof e[k] !== 'object' ? `${k}=${e[k]}` : '')).join(' ')}`);
  }
  return parts.join(' <- ');
}

const UNIT = (u) => (/^h/i.test(u) ? HOUR : /^m(?!s|illi)/i.test(u) ? MIN : /^(ms|milli)/i.test(u) ? 1 : 1000);

/** When the platform says it resets (epoch ms), or null: a retry-after header, "try again in 20 minutes", "resets 3pm". */
export function resetAt(err, text, now = Date.now()) {
  const h = err?.headers ?? err?.response?.headers;
  const ra = (typeof h?.get === 'function' ? h.get('retry-after') : h?.['retry-after']) ?? err?.retryAfter;
  if (ra != null && ra !== '') {
    const n = Number(ra);
    if (Number.isFinite(n)) return now + n * 1000;
    const d = Date.parse(String(ra));
    if (Number.isFinite(d)) return d;
  }
  let m = /try again in (\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i.exec(text);
  if (m) return now + Number(m[1]) * UNIT(m[2]);
  m = /retry[- ]after[:=\s]+(\d+)/i.exec(text);
  if (m) return now + Number(m[1]) * 1000;
  // Google's quota errors say `"retryDelay": "30s"` in the details, which the provider passes on inside the message.
  m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)\s*(ms|s|m|h)"/i.exec(text);
  if (m) return now + Number(m[1]) * UNIT(m[2]);
  m = /resets?\s+in\s+(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i.exec(text);
  if (m) return now + Number(m[1]) * UNIT(m[2]);
  m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (m) {
    let hr = Number(m[1]); const min = Number(m[2] ?? 0), ap = m[3]?.toLowerCase();
    if (hr <= 24 && min < 60 && (ap || m[2] || hr > 12)) {
      if (ap === 'pm' && hr < 12) hr += 12;
      if (ap === 'am' && hr === 12) hr = 0;
      const d = new Date(now); d.setHours(hr % 24, min, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
  }
  return null;
}

/**
 * Does this error mean the model can't be used for now? { kind, until } or null for any other error. kind: 'limit' and
 * 'credit' (their quota: `until` is when it resets), 'busy' (overloaded), 'auth' (sign-in or key not working),
 * 'missing' (that model isn't on the account), 'down' (can't be reached). until: epoch ms, kept between 30 s and a day.
 */
export function limitFrom(err, now = Date.now()) {
  const text = textOf(err);
  if (!text) return null;
  const kind = CREDIT.test(text) ? 'credit' : LIMIT.test(text) ? 'limit' : BUSY.test(text) ? 'busy' : AUTH.test(text) ? 'auth' : MISSING.test(text) ? 'missing' : DOWN.test(text) ? 'down' : null;
  if (!kind) return null;
  const at = resetAt(err, text, now) ?? now + COOLDOWN[kind];
  return { kind, until: Math.min(now + 24 * HOUR, Math.max(now + 30_000, at)) };
}

/** Why, in a few words, for telling the user (and the model taking over). */
export const becauseOf = (kind) => ({
  limit: 'it has reached its usage limit', credit: "its account is out of credit", busy: "it's overloaded",
  auth: "its sign-in or key isn't working", missing: "that model isn't available on the account", down: "it can't be reached",
}[kind] ?? 'it is unavailable');
/** Is it the user's quota (their limit, or out of credit) as opposed to a platform fault? */
export const isQuota = (kind) => kind === 'limit' || kind === 'credit';

/** The platforms (key: the provider) and single models (key: 'provider:model') that can't be used now, until when. */
export function createLimits({ now = () => Date.now() } = {}) {
  const until = new Map(), kinds = new Map();
  const live = () => { const t = now(); for (const [k, v] of until) if (v <= t) { until.delete(k); kinds.delete(k); } };
  return {
    mark(key, ms, kind = 'limit') { if (ms >= (until.get(key) ?? 0)) { until.set(key, ms); kinds.set(key, kind); } },
    isLimited(key) { live(); return until.has(key); },
    until(key) { live(); return until.get(key) ?? null; },
    kind(key) { live(); return kinds.get(key) ?? null; },
    clear(key) { until.delete(key); kinds.delete(key); },
    list() { live(); return [...until].map(([key, ms]) => ({ key, until: ms, kind: kinds.get(key) })); },
    /** { until, kind } for a pick ({ provider, spec }) that's unavailable (its model first, else its platform), or null. */
    infoFor(p) { live(); const key = until.has(p.spec) ? p.spec : until.has(p.provider) ? p.provider : null; return key ? { key, until: until.get(key), kind: kinds.get(key) } : null; },
  };
}

/** The first of `order` (picks with a provider) whose platform is free; `skipped` are the limited ones before it. */
export function firstFree(order, limits) {
  const seen = new Set(), skipped = [];
  for (const p of order) {
    if (!p || seen.has(p.spec)) continue;
    seen.add(p.spec);
    if (limits.isLimited(p.provider) || limits.isLimited(p.spec)) { skipped.push(p); continue; }
    return { pick: p, skipped };
  }
  return { pick: null, skipped };
}

/** "4:10 pm", or "tomorrow 9:00 am" past midnight: for telling the user when it resets. */
export function untilWords(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms), n = new Date(now);
  const h = d.getHours() % 12 || 12, t = `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? t : `tomorrow ${t}`;
}
