// Scheduled jobs: adding, the next time, one catch-up after a sleep, pausing, and that a run never moves the schedule.
// Runs against a throwaway HOME. Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'roamies-jobs-test-'));
process.env.HOME = TMP; process.env.USERPROFILE = TMP; delete process.env.ROAMIES_DATA_DIR;
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const J = await import('../jobs.mjs');
const { DIR, flushWrites } = await import('../store.mjs');
assert.ok(DIR.startsWith(TMP), 'jobs must live under the test HOME');

const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 11, 18, 7); // a Wednesday

// Validation says how to fix it.
await assert.rejects(J.addJob({ title: 'x', brief: 'y', due: 'whenever' }, now), /Couldn't read the time/);
await assert.rejects(J.addJob({ title: 'x', brief: 'y' }, now), /needs due/);
await assert.rejects(J.addJob({ title: 'x', brief: '', due: 'in 5m' }, now), /brief is empty/);
await assert.rejects(J.addJob({ title: 'x', brief: 'y', due: 'in 5m', repeat: 'every 1 minute' }, now), /Couldn't read the repeat/);
await assert.rejects(J.addJob({ title: 'x', brief: 'y', due: 'in 5m', type: 'poet' }, now), /type must be/);

// A daily job: runs at its time, then moves to the next day.
const daily = await J.addJob({ title: 'Tech news', brief: 'Sum up the tech news.', due: at(2026, 11, 18, 8), repeat: 'every day' }, now);
assert.equal(daily.repeat, 'daily');
assert.equal(J.nextJobDue(), at(2026, 11, 18, 8));
assert.deepEqual(await J.takeDueJobs(at(2026, 11, 18, 7, 59)), [], 'not due yet');
const fired = await J.takeDueJobs(at(2026, 11, 18, 8));
assert.deepEqual(fired.map((j) => j.id), [daily.id]);
assert.equal(J.getJob(daily.id).due, at(2026, 11, 19, 8), 'moved on to tomorrow');

// Asleep for three days: one catch-up run, then the next time still to come.
const late = await J.takeDueJobs(at(2026, 11, 22, 10));
assert.equal(late.length, 1, 'one catch-up run, not a stack');
assert.equal(J.getJob(daily.id).due, at(2026, 11, 23, 8));

// Weekdays set on a Saturday starts on Monday.
const wk = await J.addJob({ title: 'Inbox', brief: 'Check it.', due: at(2026, 11, 21, 8), repeat: 'weekdays', returns: 'answer' }, now);
assert.equal(wk.due, at(2026, 11, 23, 8));

// A one-off runs once and is left with no next time.
const once = await J.addJob({ title: 'Prices', brief: 'Check flight prices.', due: 'in 2m' }, now);
assert.equal((await J.takeDueJobs(now + 120_000)).filter((j) => j.id === once.id).length, 1);
assert.equal(J.getJob(once.id).due, null);
assert.equal((await J.takeDueJobs(now + 999_000_000)).filter((j) => j.id === once.id).length, 0, 'never runs again');

// Run now (markRun) records the run without moving the schedule.
const before = J.getJob(daily.id).due;
const ran = await J.markRun(daily.id, { agentId: 'a12' }, now);
assert.equal(ran.due, before); assert.equal(ran.lastAgentId, 'a12'); assert.equal(ran.runs, 1);
assert.equal((await J.markRun(daily.id, { error: 'Allow File Edits is off' }, now)).lastError, 'Allow File Edits is off');

// Paused jobs never fire; resuming skips the times that went by.
await J.updateJob(daily.id, { paused: true }, now);
assert.deepEqual((await J.takeDueJobs(at(2026, 11, 30, 9))).map((j) => j.id).filter((id) => id === daily.id), []);
const resumed = await J.updateJob(daily.id, { paused: false }, at(2026, 12, 2, 9));
assert.equal(resumed.due, at(2026, 12, 3, 8), 'resumes at the next time still to come');

// Stopping the repeat leaves a one-off; listing puts paused and finished ones last; the text says it plainly.
assert.equal((await J.updateJob(wk.id, { repeat: 'none' }, now)).repeat, null);
await J.updateJob(wk.id, { paused: true }, now);
const order = J.listJobs().map((j) => j.id);
assert.equal(order[0], daily.id);
const text = J.jobsText((ms) => new Date(ms).toISOString());
assert.match(text, new RegExp(`${wk.id}: Inbox \\(researcher\\) \\[paused\\]`));
assert.match(text, /\[repeats daily\]/);
assert.match(text, /\[ran; no next time\]/);
assert.match(J.jobBrief(J.getJob(daily.id), 'Ken'), /scheduled job Ken set up \("Tech news", runs daily\)[^]*Sum up the tech news\./);

// Removed for good; unknown ids are null, not a throw.
assert.equal((await J.removeJob(once.id)).id, once.id);
assert.equal(J.getJob(once.id), null);
assert.equal(await J.updateJob('nope', { paused: true }), null);
await flushWrites();
assert.ok(fs.existsSync(path.join(DIR, 'jobs.json')), 'saved next to memory.json');
console.log('jobs ok');
