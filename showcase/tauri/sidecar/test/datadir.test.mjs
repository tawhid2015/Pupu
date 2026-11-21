// Moving data from ~/.gg/sidekick into ~/Roamies/Data: a fresh install, a full move, running twice, a failed copy
// falling back to the old place, leftover temporary folders, the speech model, MOVED.txt and settings.json.
// Every case uses its own temp folders. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-datadir-test-'));
process.env.ROAMIES_DATA_DIR = path.join(TMP, 'import');
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const { migrateData, dataPaths, DATA_DIR, CONFIG_PATH, ROAMIES_DIR } = await import('../datadir.mjs');

assert.equal(ROAMIES_DIR, path.join(TMP, 'import', 'Roamies'), 'ROAMIES_DATA_DIR stands in for the home folder');
assert.equal(DATA_DIR, path.join(TMP, 'import', 'Roamies', 'Data'));
assert.equal(CONFIG_PATH, path.join(DATA_DIR, 'settings.json'));

let n = 0;
const setup = (files = {}) => {
  const home = path.join(TMP, `h${n++}`), old = path.join(home, '.gg');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(old, rel)), { recursive: true });
    fs.writeFileSync(path.join(old, rel), text);
  }
  fs.mkdirSync(home, { recursive: true });
  const logs = [];
  return { home, old, logs, run: (o = {}) => migrateData({ base: home, old, log: (m) => logs.push(m), ...o }) };
};
const memory = JSON.stringify({ version: 1, commitments: [{ id: 'c1', text: 'call mum' }], facts: [{ id: 'f1', text: 'likes tea' }] });
const settings = JSON.stringify({ onboarded: true, provider: 'anthropic' });
const full = {
  'sidekick.json': settings, 'sidekick.json.bak': settings,
  'sidekick/memory.json': memory, 'sidekick/memory.json.bak': memory, 'sidekick/usage.jsonl': '{"t":1}\n',
  'sidekick/sessions/20261118-101010-abcdef.json': '{"messages":[]}', 'sidekick/logs/2026-11-18.log': 'a line\n',
  'sidekick/beats/tour.json': '{}', 'sidekick/jobs.json': '[]', 'sidekick/.DS_Store': 'x', 'sidekick/memory.json.1.tmp': 'half',
  'sidekick/models/parakeet/vocab.txt': 'words',
};

// A fresh install: nothing old, nothing moved, the new place.
{
  const t = setup();
  const p = t.run();
  assert.deepEqual([p.dir, p.legacy, p.migrated], [path.join(t.home, 'Roamies', 'Data'), false, false]);
  assert.ok(!fs.existsSync(path.join(t.home, 'Roamies')), 'nothing is created until something is saved');
}

// A full move: everything copied, settings renamed, junk skipped, the model renamed across, originals kept.
{
  const t = setup(full);
  const p = t.run();
  assert.equal(p.migrated, true); assert.equal(p.legacy, false);
  const D = p.dir;
  assert.equal(p.config, path.join(D, 'settings.json'));
  assert.equal(fs.readFileSync(path.join(D, 'settings.json'), 'utf8'), settings, 'sidekick.json becomes settings.json');
  assert.equal(fs.readFileSync(path.join(D, 'settings.json.bak'), 'utf8'), settings);
  assert.equal(fs.readFileSync(path.join(D, 'memory.json'), 'utf8'), memory);
  for (const rel of ['memory.json.bak', 'usage.jsonl', 'sessions/20261118-101010-abcdef.json', 'logs/2026-11-18.log', 'beats/tour.json', 'jobs.json']) {
    assert.equal(fs.readFileSync(path.join(D, rel), 'utf8'), full[`sidekick/${rel}`], rel);
  }
  assert.ok(!fs.existsSync(path.join(D, '.DS_Store')) && !fs.existsSync(path.join(D, 'memory.json.1.tmp')), 'junk stays behind');
  assert.equal(fs.readFileSync(path.join(D, 'models', 'parakeet', 'vocab.txt'), 'utf8'), 'words', 'the speech model comes across');
  assert.ok(!fs.existsSync(path.join(t.old, 'sidekick', 'models')), 'renamed, not copied');
  assert.equal(fs.readFileSync(path.join(t.old, 'sidekick', 'memory.json'), 'utf8'), memory, 'the old copy is kept');
  assert.equal(fs.readFileSync(path.join(t.old, 'sidekick.json'), 'utf8'), settings);
  const moved = fs.readFileSync(path.join(t.old, 'sidekick', 'MOVED.txt'), 'utf8');
  assert.match(moved, /Roamies now keeps its data in/); assert.ok(moved.includes(D)); assert.match(moved, /You can delete them/);
  assert.deepEqual(fs.readdirSync(path.join(t.home, 'Roamies')), ['Data'], 'no temporary folder left');
  if (process.platform !== 'win32') assert.equal((fs.statSync(path.join(D, 'memory.json')).mode & 0o777).toString(8), '600', 'still private');

  // Running again changes nothing, even after the old copy changes.
  fs.writeFileSync(path.join(t.old, 'sidekick', 'memory.json'), '{"version":1,"commitments":[],"facts":[]}');
  const again = t.run();
  assert.deepEqual([again.dir, again.migrated, again.legacy], [D, false, false]);
  assert.equal(fs.readFileSync(path.join(D, 'memory.json'), 'utf8'), memory, 'Data/ is never overwritten');
}

// Only settings (no sidekick folder yet), or only the folder: each moves alone.
{
  const t = setup({ 'sidekick.json': settings });
  const p = t.run();
  assert.ok(p.migrated); assert.equal(fs.readFileSync(p.config, 'utf8'), settings);
  assert.ok(!fs.existsSync(path.join(t.old, 'sidekick')), 'no old folder appears for MOVED.txt');
  const u = setup({ 'sidekick/memory.json': memory });
  assert.equal(fs.readFileSync(path.join(u.run().dir, 'memory.json'), 'utf8'), memory);
}

// A copy that doesn't check out: the temporary folder goes, this run uses the old place, and the next run tries again.
{
  const t = setup(full);
  const p = t.run({ afterCopy: (tmp) => fs.writeFileSync(path.join(tmp, 'memory.json'), '{"version":1') });
  assert.equal(p.legacy, true); assert.equal(p.migrated, false);
  assert.equal(p.dir, path.join(t.old, 'sidekick')); assert.equal(p.config, path.join(t.old, 'sidekick.json'));
  assert.deepEqual(fs.readdirSync(path.join(t.home, 'Roamies')), [], 'the temporary folder is removed and Data/ never appears');
  assert.ok(fs.existsSync(path.join(t.old, 'sidekick', 'models')) && !fs.existsSync(path.join(t.old, 'sidekick', 'MOVED.txt')), 'the old place is untouched');
  assert.match(t.logs.join('\n'), /couldn't move data .*didn't copy whole/);
  const missing = setup(full).run({ afterCopy: (tmp) => fs.rmSync(path.join(tmp, 'sessions'), { recursive: true }) });
  assert.equal(missing.legacy, true, 'a missing folder fails the check');
  const bad = setup(full).run({ afterCopy: (tmp) => fs.writeFileSync(path.join(tmp, 'settings.json'), 'x'.repeat(Buffer.byteLength(settings))) });
  assert.equal(bad.legacy, true, 'settings that no longer parse fail the check');
  assert.ok(t.run().migrated, 'the next launch tries again');
}

// A memory file that was already unreadable still moves (the store sets it aside as before), rather than blocking forever.
{
  const t = setup({ 'sidekick/memory.json': '{"version":1,"comm' });
  assert.ok(t.run().migrated);
}

// Temporary folders left by a crash are cleared first; a live process's is left alone.
{
  const t = setup(full);
  const dead = path.join(t.home, 'Roamies', '.Data-999999999.tmp'), live = path.join(t.home, 'Roamies', `.Data-${process.ppid}.tmp`);
  fs.mkdirSync(path.join(dead, 'sessions'), { recursive: true }); fs.writeFileSync(path.join(dead, 'memory.json'), 'half');
  fs.mkdirSync(live, { recursive: true });
  assert.ok(t.run().migrated);
  assert.ok(!fs.existsSync(dead), 'a crashed copy is cleared');
  assert.ok(fs.existsSync(live), "another running process's copy is left alone");
}

// A background agent's process never migrates: it follows the old place until the main process has moved the data.
{
  const t = setup(full);
  const p = t.run({ agent: true });
  assert.equal(p.legacy, true); assert.ok(!fs.existsSync(path.join(t.home, 'Roamies')));
  t.run();
  assert.equal(t.run({ agent: true }).legacy, false, 'and the new place once it exists');
}

// dataPaths resolves once per folder, migrating ROAMIES_DATA_DIR's old layout (sidekick/ beside Roamies/).
{
  const base = path.join(TMP, 'env');
  fs.mkdirSync(path.join(base, 'sidekick'), { recursive: true });
  fs.writeFileSync(path.join(base, 'sidekick', 'memory.json'), memory);
  fs.writeFileSync(path.join(base, 'sidekick.json'), settings);
  const p = dataPaths({ ROAMIES_DATA_DIR: base });
  assert.equal(p.dir, path.join(base, 'Roamies', 'Data')); assert.ok(p.migrated);
  assert.equal(fs.readFileSync(path.join(p.dir, 'settings.json'), 'utf8'), settings);
  assert.equal(dataPaths({ ROAMIES_DATA_DIR: base }), p, 'resolved once');
}
console.log('datadir tests: passed');
