// "Skip Allow prompts": with it on, an ASK step runs without the Allow / Don't allow question; BLOCK steps still refuse
// and never ask. Off, the question is asked and a no keeps the step from running. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTools } from '../tools.mjs';

const noop = async () => {};
const base = { allowActions: () => true, ui: () => {}, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test' };

// run_command with `rm -f` is ASK (it deletes), so it goes through confirm.
function runCommandWith({ skipAllow, answer }) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'skipallow-'));
  const file = path.join(workdir, 'x.txt');
  fs.writeFileSync(file, 'hi');
  const asked = [];
  const ask = async (opts) => { asked.push(opts.placeholder); return answer; };
  const { tools } = createTools({ ...base, ask, workdir, skipAllow: skipAllow ? () => true : () => false });
  const run = tools.find((t) => t.name === 'run_command');
  return { run, file, asked, workdir };
}

// 1. Skip on: the command runs and ask is never called.
{
  const { run, file, asked, workdir } = runCommandWith({ skipAllow: true, answer: null });
  const out = await run.execute({ command: 'rm -f x.txt' }, undefined);
  assert.deepEqual(asked, [], 'skipAllow on: no Allow question');
  assert.equal(fs.existsSync(file), false, 'skipAllow on: the command ran');
  assert.equal(typeof out, 'string');
  fs.rmSync(workdir, { recursive: true, force: true });
}

// 2. Skip off: the Allow question is asked, and a "no" stops the command.
{
  const { run, file, asked, workdir } = runCommandWith({ skipAllow: false, answer: null });
  await assert.rejects(run.execute({ command: 'rm -f x.txt' }, undefined), /said no/, 'skipAllow off: a no refuses');
  assert.equal(asked.length, 1, 'skipAllow off: ask is called once');
  assert.equal(fs.existsSync(file), true, 'skipAllow off: the command did not run');
  fs.rmSync(workdir, { recursive: true, force: true });
}

// 3. Skip on does not unblock: a BLOCK verdict still refuses, and never asks.
{
  const { run, asked, workdir } = runCommandWith({ skipAllow: true, answer: 'yes' });
  await assert.rejects(run.execute({ command: 'sudo rm -rf /' }, undefined), /Blocked for safety/, 'BLOCK stays blocked');
  assert.deepEqual(asked, [], 'BLOCK never asks, even with skip on');
  fs.rmSync(workdir, { recursive: true, force: true });
}

console.log('skipallow: ok');

// The working folder (~/Roamies for the chat): commands run there, and the tool says so instead of "home folder".
{
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'workdir-'));
  const { tools } = createTools({ ...base, ask: async () => null, workdir });
  const run = tools.find((t) => t.name === 'run_command');
  assert.ok(run.description.includes(`its working folder (${workdir})`), 'run_command names its folder');
  assert.ok(!run.description.includes("the user's home folder"));
  const out = await run.execute({ command: process.platform === 'win32' ? 'cd' : 'pwd' }, undefined);
  assert.ok(String(out).includes(fs.realpathSync(workdir)) || String(out).includes(workdir), 'and runs there');
  fs.rmSync(workdir, { recursive: true, force: true });
  console.log('workdir tests: passed');
}
