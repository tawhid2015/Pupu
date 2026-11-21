// Skills: how-to memory, learned or installed from a link (a GitHub repo or folder, a skills.sh page, a SKILL.md). Each is ~/Roamies/Skills/<slug>/SKILL.md, with name and description up top
// (the agentskills / GG layout) and the steps below. Only the index (one line each) rides in the live state; the
// steps are read with use_skill when one fits. Every save goes through checkSkill (safety.mjs) and loses its keys.
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redactKeys } from './diagnostics.mjs';
import { BLOCK, checkFetch, checkSkill } from './safety.mjs';
import { roamiesRoot } from './store.mjs';

export const SKILLS_DIR = path.join(roamiesRoot(), 'Skills');
export const MAX_SKILLS = 60, MAX_STEPS = 6000, MAX_DESC = 200;

/** A name → its folder name: lower case, a-z 0-9 and dashes, at most 48 characters; '' when nothing is left. */
export const slugOf = (name) => String(name ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');

const oneLine = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** SKILL.md text → { name, description, steps }; the name falls back to the folder's. */
export function parseSkillFile(text, fallback = '') {
  const m = /^---\r?\n([^]*?)\r?\n---\r?\n?([^]*)$/.exec(String(text));
  const head = {};
  const lines = (m?.[1] ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([a-z_-]+):\s*(.*)$/i.exec(lines[i]);
    if (!kv) continue;
    let v = kv[2].trim();
    // A YAML block (description: >- or |) carries on in the indented lines below.
    if (/^[>|][-+]?$/.test(v)) { const more = []; while (i + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[i + 1])) more.push(lines[++i].trim()); v = more.join(' '); }
    if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch {} } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    head[kv[1].toLowerCase()] = v;
  }
  return { name: oneLine(head.name || fallback, 60), description: oneLine(head.description, MAX_DESC), steps: String(m ? m[2] : text).trim() };
}
export const skillText = ({ name, description, steps }) => `---\nname: ${JSON.stringify(oneLine(name, 60))}\ndescription: ${JSON.stringify(oneLine(description, MAX_DESC))}\n---\n\n${String(steps).trim()}\n`;

const fileOf = (slug) => path.join(SKILLS_DIR, slug, 'SKILL.md');
/** Every skill, newest change first: { slug, name, description, path, updatedAt }. */
export function listSkills() {
  let names = [];
  try { names = readdirSync(SKILLS_DIR); } catch { return []; }
  const out = [];
  for (const slug of names) {
    if (slug.startsWith('.')) continue; // an install still being written
    const file = fileOf(slug);
    try {
      const st = statSync(file);
      const s = parseSkillFile(readFileSync(file, 'utf8'), slug);
      out.push({ slug, name: s.name, description: s.description, path: file, updatedAt: st.mtimeMs });
    } catch {}
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** One skill by name or slug, with its steps; null when there's none. */
export function readSkill(name) {
  const slug = slugOf(name);
  if (!slug || !existsSync(fileOf(slug))) return null;
  try { return { slug, path: fileOf(slug), ...parseSkillFile(readFileSync(fileOf(slug), 'utf8'), slug) }; } catch { return null; }
}

/** Creates or replaces a skill. Throws (with a reason fit to pass on) when it's empty, too big, unsafe or one too many. */
export async function saveSkill({ name, description, steps }) {
  const slug = slugOf(name);
  if (!slug) throw new Error('A skill needs a short name, like "export-figma-frames".');
  const desc = oneLine(redactKeys(description), MAX_DESC);
  const body = redactKeys(String(steps ?? '')).trim();
  if (!desc) throw new Error('A skill needs a description: one line saying when to use it.');
  if (!body) throw new Error('A skill needs its steps.');
  if (body.length > MAX_STEPS) throw new Error(`Keep a skill's steps under ${MAX_STEPS} characters; split it into two skills.`);
  const v = checkSkill(`${name}\n${desc}\n${body}`);
  if (v.level === BLOCK) throw new Error(v.reason);
  const had = existsSync(fileOf(slug));
  if (!had && listSkills().length >= MAX_SKILLS) throw new Error(`There are already ${MAX_SKILLS} skills, the most there can be. Remove one first.`);
  const file = fileOf(slug);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  await fs.writeFile(tmp, skillText({ name: oneLine(name, 60), description: desc, steps: body }), { mode: 0o600 });
  await fs.rename(tmp, file);
  return { slug, name: oneLine(name, 60), description: desc, path: file, created: !had };
}

/** Deletes a skill's folder; the skill it was, or null. */
export async function deleteSkill(name) {
  const s = readSkill(name);
  if (!s) return null;
  await fs.rm(path.dirname(s.path), { recursive: true, force: true });
  return s;
}

/** One line per skill, for the live state's memory section. */
export const skillIndex = (list = listSkills()) => list.map((s) => `- ${s.slug}: ${s.description}`).join('\n');

// ---------- Installing a skill from a link ----------

export const MAX_INSTALL_FILES = 40, MAX_INSTALL_BYTES = 600_000, MAX_SKILL_MD = 60_000, MAX_PICK = 20;
// The files a skill folder brings along: text only (references, templates, scripts); images and binaries stay behind.
const TEXT_FILE = /(^|\/)(LICENSE|README)$|\.(md|markdown|mdx|txt|json|jsonc|ya?ml|toml|csv|tsv|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|sh|bash|zsh|ps1|rb|go|rs|java|kt|swift|sql|ini|cfg|conf|svg|tex|r)$/i;
const SKILL_MD = /(^|\/)SKILL\.md$/i;
const BOM = String.fromCharCode(0xfeff), NUL = String.fromCharCode(0);
const isText = (t) => typeof t === 'string' && !t.includes(NUL);

/** What someone gave as a skill's address → { kind: 'github', owner, repo, ref, dir, pick } or { kind: 'file', url };
 *  null when it isn't one. Takes repo links, folder and file links, skills.sh pages, owner/repo and `npx skills add …`. */
export function skillSource(input) {
  let s = String(input ?? '').trim().replace(/^npx\s+(?:-y\s+)?skills(?:@\S+)?\s+add\s+/i, '').split(/\s+/)[0] ?? '';
  const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@([\w.-]+))?$/.exec(s);
  if (short && !/^(www\.)?(github\.com|skills\.sh)$/i.test(short[1])) return { kind: 'github', owner: short[1], repo: short[2], ref: null, dir: '', pick: short[3] ?? null };
  if (/^(www\.)?(github\.com|skills\.sh)\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const parts = u.pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'github.com' && parts.length >= 2) {
    const [owner, repo0, kind, ref, ...rest] = parts, repo = repo0.replace(/\.git$/, '');
    if (kind === 'tree' && ref) return { kind: 'github', owner, repo, ref, dir: rest.join('/'), pick: null };
    if (kind === 'blob' && ref) {
      const file = rest.join('/');
      return SKILL_MD.test(file) ? { kind: 'github', owner, repo, ref, dir: rest.slice(0, -1).join('/'), pick: null } : { kind: 'file', url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${file}` };
    }
    return { kind: 'github', owner, repo, ref: null, dir: '', pick: null };
  }
  if (host === 'skills.sh' && parts.length >= 2 && parts[0] !== 'site' && parts[0] !== 'agent') return { kind: 'github', owner: parts[0], repo: parts[1], ref: null, dir: '', pick: parts[2] ?? null };
  if (host === 'raw.githubusercontent.com' && parts.length >= 4 && SKILL_MD.test(parts.at(-1))) return { kind: 'github', owner: parts[0], repo: parts[1], ref: parts[2], dir: parts.slice(3, -1).join('/'), pick: null };
  return { kind: 'file', url: u.href };
}

/** GET with the web_fetch rules (public addresses only, each redirect checked), a time limit and a size cap. */
export async function httpGet(url, { json = false, limit = MAX_SKILL_MD * 4, timeout = 15000 } = {}) {
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    const v = await checkFetch(at);
    if (v.level === BLOCK) throw new Error(v.reason);
    const res = await fetch(at, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'user-agent': 'Roamies', accept: json ? 'application/vnd.github+json' : 'text/plain, text/markdown, */*' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { at = new URL(res.headers.get('location'), at).href; continue; }
    if (res.status === 404) throw new Error(`Nothing at ${at} (404).`);
    if (res.status === 403 || res.status === 429) throw new Error('GitHub is limiting requests right now; try again in a few minutes.');
    if (!res.ok) throw new Error(`${at} answered ${res.status}.`);
    const text = await res.text();
    if (text.length > limit) throw new Error(`${at} is too big for a skill.`);
    return json ? JSON.parse(text) : text;
  }
  throw new Error('Too many redirects.');
}

const rawUrl = (src, file) => `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${encodeURIComponent(src.ref)}/${file.split('/').map(encodeURIComponent).join('/')}`;
const dirOf = (p) => p.split('/').slice(0, -1).join('/');
const baseOf = (p) => p.split('/').filter(Boolean).pop() ?? '';

// One skill's text → { slug, name, description, text } (the SKILL.md as it was written), or a reason it can't be.
function skillFrom(text, folder) {
  const t = String(text ?? '').replace(new RegExp(`^${BOM}`), '');
  if (!t.trim()) throw new Error('That SKILL.md is empty.');
  if (t.length > MAX_SKILL_MD) throw new Error(`That skill is over ${MAX_SKILL_MD / 1000}k characters, too big to use.`);
  if (!isText(t)) throw new Error("That isn't a text file.");
  const p = parseSkillFile(t, folder);
  const description = p.description || oneLine(p.steps.split('\n').find((l) => l.trim() && !/^#/.test(l.trim())) ?? '', MAX_DESC);
  const slug = slugOf(p.name) || slugOf(folder);
  if (!slug) throw new Error('That skill has no name.');
  return { slug, name: p.name || folder, description, text: t };
}

/** Fetches what a link points at: { skills: [{ slug, name, description, text, files: [{ path, text }], skipped, from }] },
 *  or { choices: [names], from } when a repo holds several and none was picked. pick: a skill's name, or 'all'. */
export async function fetchSkills(input, { pick = null, get = httpGet } = {}) {
  const src = skillSource(input);
  if (!src) throw new Error("That doesn't look like a link to a skill. Give a GitHub repo or folder link, a skills.sh page, or a link to a SKILL.md.");
  if (src.kind === 'file') {
    const text = await get(src.url);
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("That link is a web page, not a skill. Find the skill's GitHub repo or its SKILL.md link.");
    const file = new URL(src.url).pathname;
    const folder = SKILL_MD.test(file) ? baseOf(dirOf(file)) : baseOf(file).replace(/\.(md|markdown)$/i, '');
    return { skills: [{ ...skillFrom(text, folder), files: [], skipped: 0, from: src.url }] };
  }
  const from = `github.com/${src.owner}/${src.repo}`;
  const api = `https://api.github.com/repos/${encodeURIComponent(src.owner)}/${encodeURIComponent(src.repo)}`;
  if (!src.ref) src.ref = (await get(api, { json: true }))?.default_branch || 'main';
  const tree = (await get(`${api}/git/trees/${encodeURIComponent(src.ref)}?recursive=1`, { json: true, limit: 20_000_000 }))?.tree ?? [];
  const blobs = tree.filter((e) => e?.type === 'blob' && typeof e.path === 'string');
  const under = (p) => !src.dir || p.startsWith(`${src.dir}/`);
  const dirs = blobs.filter((e) => SKILL_MD.test(e.path) && under(e.path)).map((e) => dirOf(e.path))
    .filter((d) => !/(^|\/)(node_modules|\.git|tests?|fixtures)\//.test(`${d}/`));
  if (!dirs.length) throw new Error(`There's no SKILL.md in ${from}${src.dir ? `/${src.dir}` : ''}, so it isn't a skill.`);
  const nameOf = (d) => baseOf(d) || src.repo;
  const want = pick ?? src.pick;
  let chosen;
  if (want && String(want).toLowerCase() === 'all') chosen = dirs.slice(0, MAX_PICK);
  else if (want) {
    chosen = dirs.filter((d) => slugOf(nameOf(d)) === slugOf(want)).slice(0, 1);
    if (!chosen.length) throw new Error(`${from} has no skill called "${want}". It has: ${dirs.map(nameOf).join(', ')}.`);
  } else if (dirs.length === 1) chosen = dirs;
  else return { choices: dirs.map(nameOf), from };
  const skills = [];
  for (const d of chosen) {
    const pre = d ? `${d}/` : '';
    // Its own files: under its folder, but not inside another skill's folder nested in it.
    // A skill at the repo's top brings only the folders skills use (and files beside it), not the whole repo.
    const own = blobs.filter((e) => e.path.startsWith(pre) && e.path !== `${pre}SKILL.md` && !dirs.some((o) => o !== d && o.startsWith(pre) && e.path.startsWith(`${o}/`))
      && (d || !e.path.includes('/') || /^(scripts|references|assets|templates|examples)\//.test(e.path)));
    const sk = { ...skillFrom(await get(rawUrl(src, `${pre}SKILL.md`)), nameOf(d)), files: [], skipped: 0, from: `${from}${d ? `/${d}` : ''}` };
    let bytes = sk.text.length;
    for (const e of own) {
      const rel = e.path.slice(pre.length);
      if (!TEXT_FILE.test(rel) || /(^|\/)\./.test(rel) || sk.files.length >= MAX_INSTALL_FILES || bytes + (e.size ?? 0) > MAX_INSTALL_BYTES) { sk.skipped++; continue; }
      const text = await get(rawUrl(src, e.path)).catch(() => null);
      if (!isText(text)) { sk.skipped++; continue; }
      bytes += text.length;
      sk.files.push({ path: rel, text });
    }
    skills.push(sk);
  }
  return { skills };
}

/** Screens a fetched skill and every file with it: null when it's fine, else the reason it can't be installed. */
export function screenSkill(sk) {
  for (const f of [{ path: 'SKILL.md', text: sk.text }, ...sk.files]) {
    const v = checkSkill(f.text);
    if (v.level === BLOCK) return `${sk.name} can't be installed: ${f.path === 'SKILL.md' ? '' : `${f.path}: `}${v.reason.replace(/^That skill can't be saved: /, '')}`;
  }
  return null;
}

/** Writes a fetched skill as its own folder (replacing one of the same name): { slug, path, created }. */
export async function installSkill(sk) {
  const why = screenSkill(sk);
  if (why) throw new Error(why);
  const slug = slugOf(sk.slug);
  if (!slug) throw new Error('That skill has no name.');
  const had = existsSync(fileOf(slug));
  if (!had && listSkills().length >= MAX_SKILLS) throw new Error(`There are already ${MAX_SKILLS} skills, the most there can be. Remove one first.`);
  const dest = path.join(SKILLS_DIR, slug), tmp = path.join(SKILLS_DIR, `.${slug}.${process.pid}.${randomBytes(3).toString('hex')}`);
  await fs.mkdir(tmp, { recursive: true, mode: 0o700 });
  try {
    for (const f of [{ path: 'SKILL.md', text: sk.text }, ...sk.files]) {
      const to = path.resolve(tmp, f.path);
      if (!to.startsWith(tmp + path.sep)) throw new Error(`${f.path} points outside the skill's folder.`);
      await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
      await fs.writeFile(to, f.text, { mode: 0o600 });
    }
    if (had) await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(tmp, dest);
  } catch (e) { await fs.rm(tmp, { recursive: true, force: true }); throw e; }
  return { slug, path: fileOf(slug), created: !had };
}

/** The other files in a skill's folder (relative paths), for use_skill to mention. */
export function skillFiles(slug) {
  const root = path.join(SKILLS_DIR, slugOf(slug)), out = [];
  const walk = (dir, pre) => {
    let es = [];
    try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const rel = pre ? `${pre}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(dir, e.name), rel); else if (rel !== 'SKILL.md') out.push(rel); }
  };
  walk(root, '');
  return out.sort();
}

/** One file from a skill's folder, by its relative path; null when there's none (or it leads outside the folder). */
export function readSkillFile(slug, rel) {
  const root = path.join(SKILLS_DIR, slugOf(slug)), to = path.resolve(root, String(rel ?? ''));
  if (!to.startsWith(root + path.sep)) return null;
  try { return readFileSync(to, 'utf8'); } catch { return null; }
}
