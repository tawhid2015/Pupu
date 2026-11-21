// Showing the tray icon on Windows 11 (wintray.mjs): reading reg's output and picking this program's entry. Run: npm test
import assert from 'node:assert/strict';
import { entriesFor, showTrayIcon, trayEntries } from '../wintray.mjs';

const OUT = [
  '',
  'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\1234567890',
  '    ExecutablePath    REG_SZ    {F1B32785-6FBA-4FCF-9D55-7B8E7F157091}\\Roamies\\roamies.exe',
  '',
  'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\99',
  '    ExecutablePath    REG_SZ    C:\\Program Files\\Other\\roamies.exe',
  '',
  'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\42',
  '    ExecutablePath    REG_SZ    {6D809377-6AF0-444B-8957-A3773F02200E}\\Slack\\slack.exe',
  'End of search: 3 match(es) found.',
].join('\r\n');
const all = trayEntries(OUT);
assert.equal(all.length, 3);
assert.deepEqual(all[0], { key: 'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\1234567890', path: '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}\\Roamies\\roamies.exe' });
const exe = 'C:\\Users\\jo\\AppData\\Local\\Roamies\\Roamies.exe';
assert.deepEqual(entriesFor(all, exe).map((e) => e.key.split('\\').pop()), ['1234567890'], 'its folder and file name, any case, past the known-folder GUID');
assert.deepEqual(entriesFor(all, 'roamies.exe'), [], 'a bare file name matches nothing');
assert.deepEqual(entriesFor(all, ''), []);

const calls = [];
const exec = (out, code = 0) => async (cmd, args) => { calls.push([cmd, ...args]); return args[0] === 'query' ? { code, stdout: out } : { code: 0, stdout: '' }; };
assert.equal(await showTrayIcon({ exe, exec: exec(OUT) }), 'shown');
assert.deepEqual(calls.at(-1), ['reg', 'add', 'HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\1234567890', '/v', 'IsPromoted', '/t', 'REG_DWORD', '/d', '1', '/f']);
assert.equal(calls.filter((c) => c[1] === 'add').length, 1, "only Roamies' own entry is changed");
assert.equal(await showTrayIcon({ exe, exec: exec('', 1) }), 'missing', 'no entries yet (Windows 10, or Explorer has not added it)');
assert.equal(await showTrayIcon({ exe: 'C:\\x\\Elsewhere\\roamies.exe', exec: exec(OUT) }), 'missing');
assert.equal(await showTrayIcon({ exe, exec: async (c, a) => (a[0] === 'query' ? { code: 0, stdout: OUT } : { code: 1, stdout: '' }) }), 'failed');
console.log('windows tray tests: passed');
