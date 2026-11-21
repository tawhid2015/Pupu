// Opening apps on Windows (tools.mjs winOpen): a name that isn't on PATH is looked up in the Start menu (#81), and one
// that's nowhere still says "Unable to find application" for the open tool's message. Runs on Windows only (CI).
import assert from 'node:assert/strict';
import { winOpen } from '../tools.mjs';

if (process.platform !== 'win32') {
  console.log('winopen tests: skipped (Windows only)');
} else {
  const r = await winOpen('Roamies No Such App 7f3a');
  assert.ok(r.err, 'fails'); assert.match(r.stderr, /Unable to find application/);
  console.log('winopen tests: passed');
}
