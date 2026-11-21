// Where Roamies keeps everything: one visible folder, ~/Roamies, with Agents/, Skills/ and Data/ (settings, memory,
// chats, logs, usage, jobs, MCP servers, sync state, catalogs). Sign-in stays in ~/.gg/auth.json (shared with GG Coder).
// Data used to live in ~/.gg/sidekick and ~/.gg/sidekick.json. The first run after the update copies it across,
// checks the copy and only then switches; the old copy is never deleted, and if anything fails this run keeps using it.
// ROAMIES_DATA_DIR (tests and benchmarks) stands in for the home folder, so they exercise the same migration.
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SKIP = (name) => name === '.DS_Store' || name.endsWith('.tmp') || name === 'MOVED.txt';
const TMP = /^\.Data-(\d+)\.tmp$/;

export const baseDir = (env = process.env) => env.ROAMIES_DATA_DIR || os.homedir();
export const roamiesDir = (env = process.env) => path.join(baseDir(env), 'Roamies');

// The old layout: ~/.gg/sidekick and ~/.gg/sidekick.json, or <ROAMIES_DATA_DIR>/sidekick(.json) in tests.
export const oldBase = (env = process.env) => env.ROAMIES_DATA_DIR || path.join(os.homedir(), '.gg');

/** Every path, new and old: `base` holds Roamies/, `old` holds the old sidekick/ and sidekick.json. */
export function layout(base, old) {
  const root = path.join(base, 'Roamies');
  return { root, dir: path.join(root, 'Data'), config: path.join(root, 'Data', 'settings.json'), oldDir: path.join(old, 'sidekick'), oldConfig: path.join(old, 'sidekick.json') };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Files to bring across, as [from, to-relative-to-Data]; models/ is renamed across afterwards instead.
function plan(L) {
  const out = [];
  const walk = (from, rel) => {
    for (const e of readdirSync(from, { withFileTypes: true })) {
      if (SKIP(e.name) || (!rel && e.name === 'models')) continue;
      const src = path.join(from, e.name), dst = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { out.push([src, dst, true]); walk(src, dst); } else if (e.isFile()) out.push([src, dst, false]);
    }
  };
  if (isDir(L.oldDir)) walk(L.oldDir, '');
  if (existsSync(L.oldConfig)) out.push([L.oldConfig, 'settings.json', false]);
  if (existsSync(`${L.oldConfig}.bak`)) out.push([`${L.oldConfig}.bak`, 'settings.json.bak', false]);
  return out;
}

function copyOne(src, dst) {
  copyFileSync(src, dst);
  chmodSync(dst, 0o600); // the store keeps every data file private
  const st = statSync(src);
  const fd = openSync(dst, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  utimesSync(dst, st.atime, st.mtime);
}

const parses = (file) => { try { JSON.parse(readFileSync(file, 'utf8')); return true; } catch { return false; } };

function verify(files, tmp) {
  for (const [src, rel, dir] of files) {
    const dst = path.join(tmp, rel);
    if (dir) { if (!isDir(dst)) throw new Error(`${rel} is missing from the copy`); continue; }
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) throw new Error(`${rel} didn't copy whole`);
    if ((rel === 'memory.json' || rel === 'settings.json') && parses(src) && !parses(dst)) throw new Error(`${rel} doesn't read back`);
  }
}

/**
 * Moves old data into Roamies/Data once: copy to a temporary folder, check it, rename it into place in one step.
 * Returns the paths to use this run; `legacy` means the copy failed and the old location is still in use.
 * `agent` (a background agent's process) never migrates, it follows whatever the main process left.
 * `afterCopy(tmp)` is for tests.
 */
export function migrateData({ base = baseDir(), old = oldBase(), agent = false, log = (m) => console.error(`[datadir] ${m}`), afterCopy } = {}) {
  const L = layout(base, old);
  const paths = { root: L.root, dir: L.dir, config: L.config, legacy: false, migrated: false };
  const hasOld = isDir(L.oldDir) || existsSync(L.oldConfig);
  if (existsSync(L.dir) || !hasOld) return paths;
  const legacy = { ...paths, dir: L.oldDir, config: L.oldConfig, legacy: true };
  if (agent) return legacy;
  let tmp = null;
  try {
    mkdirSync(L.root, { recursive: true });
    for (const n of readdirSync(L.root)) {
      const m = TMP.exec(n);
      if (m && (Number(m[1]) === process.pid || !alive(Number(m[1])))) rmSync(path.join(L.root, n), { recursive: true, force: true });
    }
    tmp = path.join(L.root, `.Data-${process.pid}.tmp`);
    mkdirSync(tmp, { mode: 0o700 });
    const files = plan(L);
    for (const [src, rel, dir] of files) {
      const dst = path.join(tmp, rel);
      if (dir) mkdirSync(dst, { recursive: true, mode: 0o700 }); else copyOne(src, dst);
    }
    afterCopy?.(tmp);
    verify(files, tmp);
    renameSync(tmp, L.dir);
    tmp = null;
  } catch (e) {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    log(`couldn't move data to ${L.dir}, using ${L.oldDir} for now: ${e.message}`);
    return legacy;
  }
  const models = path.join(L.oldDir, 'models');
  if (isDir(models)) {
    try { renameSync(models, path.join(L.dir, 'models')); } catch (e) { log(`left the speech model in ${models} (it downloads again if needed): ${e.message}`); }
  }
  if (isDir(L.oldDir)) {
    try {
      writeFileSync(path.join(L.oldDir, 'MOVED.txt'), `Roamies now keeps its data in ${L.dir}\n(settings are ${L.config}).\n\nThis folder and ${L.oldConfig} are the copy from before the move,\nkept in case you go back to an older version. You can delete them.\n`);
    } catch (e) { log(`couldn't write MOVED.txt: ${e.message}`); }
  }
  log(`moved data to ${L.dir}`);
  return { ...paths, migrated: true };
}

const cache = new Map();
/** Paths for the current home (or ROAMIES_DATA_DIR), migrating on first use; resolved once per folder. */
export function dataPaths(env = process.env) {
  const base = baseDir(env);
  if (!cache.has(base)) cache.set(base, migrateData({ base, old: oldBase(env), agent: !!env.ROAMIES_AGENT }));
  return cache.get(base);
}

const here = dataPaths();
export const ROAMIES_DIR = here.root;
export const DATA_DIR = here.dir;
export const CONFIG_PATH = here.config;
