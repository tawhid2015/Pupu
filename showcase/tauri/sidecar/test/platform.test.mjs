// What the model is told about each system, and which features each one gets. Run: npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { canCircle, canSnap, hasHands, hasHotkeys, hasVoice, hasWakeWord, linuxSession, micTrouble, needsVoiceModel, platformLine, samePair, seesPointer, writeChord, writeChords } from '../platform.mjs';

const win = platformLine('win32', { arch: 'x64', release: '10.0.22631' });
assert.match(win, /^Platform: Windows 11 on x64\./);
assert.match(win, /Ctrl, not Cmd/, 'Windows keys, not Mac ones');
assert.match(win, /Ctrl\+End and Ctrl\+Home/);
assert.match(win, /cmd\.exe/, 'commands run in cmd, not a Unix shell');
assert.ok(!/Cmd\+Down|BSD/.test(win), 'none of the Mac advice');
assert.match(platformLine('win32', { release: '10.0.19045' }), /^Platform: Windows 10 /);
const mac = platformLine('darwin', { macVersion: '15.1', arch: 'arm64' });
assert.match(mac, /^Platform: macOS 15\.1 on Apple silicon\. Use Mac keys: Cmd, not Ctrl/);
assert.equal(platformLine('freebsd'), 'Platform: freebsd.');

// Linux: PC keys and GNU tools, and on Wayland what the app can't see there.
const x11 = platformLine('linux', { arch: 'x64', session: 'x11', desktop: 'XFCE', distro: 'Linux Mint 22' });
assert.match(x11, /^Platform: Linux \(Linux Mint 22\) on x64, the XFCE desktop on X11\./);
assert.match(x11, /Ctrl, not Cmd/);
assert.match(x11, /Ctrl\+End and Ctrl\+Home/);
assert.match(x11, /bash with the GNU tools/);
assert.ok(!/Cmd\+Down|BSD|cmd\.exe|Wayland/.test(x11), 'none of the Mac or Windows advice, and no Wayland limits on X11');
const wl = platformLine('linux', { arch: 'arm64', session: 'wayland', desktop: 'ubuntu:GNOME', distro: 'Ubuntu 26.04 LTS' });
assert.match(wl, /^Platform: Linux \(Ubuntu 26\.04 LTS\) on Arm, the GNOME desktop on Wayland\./, 'the desktop is the last part of XDG_CURRENT_DESKTOP');
assert.match(wl, /never waits for a click or hover/, 'Wayland: no waiting on what it cannot see');
assert.match(platformLine('linux', {}), /^Platform: Linux on x64, a desktop on Wayland\./, 'not told the session: the careful answer');

// The session: what the app says, else the same signs it reads.
assert.equal(linuxSession({ ROAMIES_SESSION: 'x11', WAYLAND_DISPLAY: 'wayland-0' }), 'x11', 'the app knows best');
assert.equal(linuxSession({ ROAMIES_SESSION: 'wayland' }), 'wayland');
assert.equal(linuxSession({ XDG_SESSION_TYPE: 'wayland' }), 'wayland');
assert.equal(linuxSession({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }), 'wayland');
assert.equal(linuxSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }), 'x11');
assert.equal(linuxSession({ ROAMIES_SESSION: 'nonsense' }), 'x11');

// The pointer over other apps and global shortcuts: everywhere but Wayland.
assert.ok(seesPointer('darwin') && seesPointer('win32') && seesPointer('linux', 'x11') && !seesPointer('linux', 'wayland') && !seesPointer('linux', ''));
assert.ok(hasHotkeys('darwin') && hasHotkeys('win32') && hasHotkeys('linux', 'x11') && !hasHotkeys('linux', 'wayland'));
// Voice: Linux has it, with the same downloaded model as Windows.
assert.ok(hasVoice('darwin') && hasVoice('win32') && hasVoice('linux') && !hasVoice('freebsd'));
assert.ok(!needsVoiceModel('darwin') && needsVoiceModel('win32') && needsVoiceModel('linux'));
// The wake word (#97): Apple's speech on macOS, the Parakeet helper on Windows and Linux.
assert.ok(hasWakeWord('darwin') && hasWakeWord('win32') && hasWakeWord('linux') && !hasWakeWord('freebsd'));
// No hands helper on Linux yet: nothing reads or works other apps, no area snap, no circling.
assert.ok(!hasHands('linux', '') && !canSnap('linux', '') && !canCircle('linux'));

// Ask About an Area needs the helper's area selection: macOS, and Windows with the helper there.
assert.ok(canSnap('darwin', '') && canSnap('win32', 'C:\\Roamies\\roamies-hands.exe'));
assert.ok(!canSnap('win32', '') && !canSnap('linux', '/x/roamies-hands'));
assert.ok(hasHands('darwin', '') && hasHands('win32', 'x') && !hasHands('win32', ''));
assert.ok(canCircle('darwin') && canCircle('win32') && !canCircle('linux'));

// With the helper there, its tools are offered on any system (Windows has one now).
const tools = new URL('../tools.mjs', import.meta.url).href;
const names = execFileSync(process.execPath, ['--input-type=module', '-e', `
  const { createTools } = await import(${JSON.stringify(tools)});
  const noop = async () => {};
  const { tools } = createTools({ allowActions: () => false, ui: () => {}, ask: noop, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'T' });
  console.log(tools.map((t) => t.name).join(','));`], { env: { ...process.env, ROAMIES_HANDS: 'fake-hands.mjs' }, encoding: 'utf8' }).trim().split(',');
for (const n of ['list_windows', 'read_window', 'act_in_app']) assert.ok(names.includes(n), `${n} is offered with the helper`);
// The microphone: each reason the voice helper gives gets its own advice, not "I can't find a microphone".
assert.match(micTrouble('darwin'), /^I can't find a microphone\. Plug one in and try again\.$/, 'the Mac helper sends no reason');
assert.match(micTrouble('win32', 'missing'), /input picked in Settings > System > Sound > Input/, 'a plugged-in mic that isn\'t the default');
assert.match(micTrouble('linux', 'missing'), /input picked in your sound settings/);
assert.match(micTrouble('win32', 'busy'), /exclusive control/);
assert.ok(!/exclusive control/.test(micTrouble('linux', 'busy')), 'a Windows-only setting');
assert.match(micTrouble('win32', 'blocked'), /Let desktop apps access your microphone/);
assert.match(micTrouble('win32', 'blocked'), /antivirus or work settings/, 'when the switches are already on');
assert.ok(!/Windows/.test(micTrouble('linux', 'blocked')));
assert.match(micTrouble('win32', 'lost'), /Bluetooth/);
assert.match(micTrouble('win32', 'failed', 'unsupported sample format I48'), /\(unsupported sample format I48\)/);
assert.ok(micTrouble('win32', 'failed', 'x'.repeat(500)).length < 300, 'the system\'s words are cut short');
for (const r of ['busy', 'blocked', 'lost', 'failed']) assert.ok(!/can't find a microphone/.test(micTrouble('win32', r)), `${r} isn't reported as a missing mic`);

// The type-to-ask shortcut: a tap of two modifier keys, never the pair that talks.
const TALK = ['control', 'option'];
assert.deepEqual(writeChord('darwin', TALK, undefined), ['option', 'command'], 'the Mac default, also for a config from before the shortcut');
assert.deepEqual(writeChord('win32', TALK, undefined), ['control', 'shift'], 'the PC default');
assert.deepEqual(writeChord('linux', TALK, undefined), ['control', 'shift']);
assert.deepEqual(writeChord('darwin', TALK, ['shift', 'control']), ['control', 'shift'], 'a saved pair, in whichever order it was written');
assert.deepEqual(writeChord('darwin', ['command', 'option'], undefined), ['control', 'command'], 'talk already has the default: the next one');
assert.deepEqual(writeChord('darwin', TALK, ['option', 'control']), ['option', 'command'], 'saved the same as talk: never both on one pair');
assert.deepEqual(writeChord('win32', ['control', 'shift'], ['control', 'shift']), ['control', 'option'], 'on a PC too, where there are only two');
for (const bad of ['option+command', ['option'], ['option', 'option'], ['command', 'shift'], ['control', 'hyper'], 7, null, {}]) {
  assert.deepEqual(writeChord('darwin', TALK, bad), ['option', 'command'], `a bad saved value (${JSON.stringify(bad)}) falls back to the default`);
}
assert.deepEqual(writeChord('win32', TALK, ['option', 'command']), ['control', 'shift'], 'a Mac pair saved on a PC (no Win key there)');
for (const p of ['darwin', 'win32', 'linux']) {
  for (const c of writeChords(p)) assert.ok(c.length === 2 && new Set(c).size === 2 && c.every((m) => ['control', 'option', 'shift', 'command'].includes(m)), `${p}: ${c} is two different modifiers`);
  for (const talk of writeChords(p)) assert.ok(!samePair(writeChord(p, talk, talk), talk), `${p}: never the talk pair (${talk})`);
}
assert.ok(!writeChords('win32').some((c) => c.includes('command')) && !writeChords('linux').some((c) => samePair(c, ['option', 'shift'])), 'no Win key and no Alt+Shift on a PC');
assert.ok(samePair(['a', 'b'], ['b', 'a']) && !samePair(['a', 'b'], ['a', 'c']) && !samePair(['a', 'a'], ['a', 'b']) && !samePair(null, ['a', 'b']));
console.log('platform tests: passed');

// Regression (#65): the type-to-ask tap can be turned off, and then no pair is taken.
assert.equal(writeChord('darwin', TALK, 'off'), null, "saved as 'off': no pair");
assert.equal(writeChord('win32', TALK, 'off'), null);

// The mic picker's list (#59): only usable entries, cut to size, and what automatic uses.
{
  const { cleanMics } = await import('../platform.mjs');
  const m = cleanMics({ list: [{ id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone' }, { id: '', name: 'blank' }, { name: 'no id' }, null, { id: 'usb-1' }], default: 'airpods', auto: 'BuiltInMicrophoneDevice' });
  assert.deepEqual(m.list, [{ id: 'BuiltInMicrophoneDevice', name: 'MacBook Pro Microphone' }, { id: 'usb-1', name: 'usb-1' }]);
  assert.equal(m.auto, 'BuiltInMicrophoneDevice', 'automatic: the mic it really uses');
  assert.equal(cleanMics({ list: [], default: 'Mic (Realtek)' }).auto, 'Mic (Realtek)', 'Windows and Linux send only the default');
  assert.equal(cleanMics({ list: Array.from({ length: 60 }, (_, i) => ({ id: `m${i}` })) }).list.length, 40);
  assert.deepEqual(cleanMics(null), { list: [], auto: '' });
}

// The talk pairs the panel's Shortcuts page offers: the setup guide's, the default first, never the Win key on a PC.
{
  const { talkChords } = await import('../platform.mjs');
  assert.deepEqual(talkChords('darwin')[0], ['control', 'option']);
  assert.equal(talkChords('darwin').length, 5);
  for (const p of ['win32', 'linux']) assert.ok(talkChords(p).every((c) => !c.includes('command')), `${p}: no Win/Super key`);
}
