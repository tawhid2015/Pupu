import assert from 'node:assert/strict';
import { aboutRoamies } from '../about.mjs';

// The app's manual for about_roamies: each platform's own wording, and only the features this copy has.
const base = { name: 'JARVIS', looks: ['Roamie', 'JARVIS', 'Anime Girl'], mac: false, linux: false, snap: false, pointer: false, voice: false, hotkeys: false };
const mac = aboutRoamies({ ...base, mac: true, snap: true, pointer: true, voice: true, hotkeys: true, wake: true });
const win = aboutRoamies(base);
const linux = aboutRoamies({ ...base, linux: true, voice: true, wake: true });
assert.match(mac, /lives in the menu bar at the top of the screen/);
assert.match(mac, /Show JARVIS, Ask JARVIS…, Ask About an Area…, Stop, Quit Roamies/);
assert.match(mac, /Look: Roamie, JARVIS or Anime Girl/);
assert.match(mac, /Wake word \(say "Hey Roamies"/);
assert.match(mac, /Voice Provider: Fish Audio, Gemini or VoiceStudio/);
assert.match(win, /bottom right of the taskbar/);
assert.ok(!/Ask About an Area|Wake word|Voice Control|Cursor, a little arrow/.test(win), 'features this copy lacks are left out');
assert.match(linux, /AppIndicator extension/);
assert.match(linux, /installs? by themselves when Roamies runs as an AppImage/);
assert.match(linux, /Wake word \(say "Hey Roamies"/, 'the wake word on Windows and Linux too (#97)');
// The settings pages as the panel names them (Speaking, Listening, Shortcuts, General since the split; Routines is an Abilities tab).
assert.match(mac, /Speaking \(Replies:.*Listening \(Voice Control.*Shortcuts \(.*General \(Sound Effects/);
assert.match(linux, /Shortcuts \(the commands to bind/, 'no global keys there: the commands to bind');
for (const t of [mac, win, linux]) assert.ok(!/Behavior \(|, Voice \(/.test(t), 'no old page names');
// The Model page's local servers (#63, #66): Ollama, LM Studio and any other server, as the panel names them.
assert.match(win, /Model \(.*Ollama and LM Studio, each with Connect or Disconnect.*Another server with Add server.*Its models can see images/);
for (const t of [mac, win, linux]) {
  assert.match(t, /Save Diagnostics/);
  assert.match(t, /github\.com\/KenKaiii\/Roamies/);
  assert.ok(!/\$\{|undefined/.test(t), 'every part is filled in');
}
console.log('about tests: passed');
// Scheduled jobs, skills and connections: one Abilities page with a tab each, and that they're made by asking.
for (const t of [mac, win, linux]) {
  assert.match(t, /Memory: two tabs, What I Remember[^]*and Commitments \(/);
  assert.match(t, /Abilities: three tabs, Skills \(how-tos you learned, each with View[^]*Learn Skills on the General page[^]*Connections \([^]*and Routines \(Morning Briefing/);
  assert.ok(!/, (Routines|Connections) \(/.test(t.slice(t.indexOf('Then the settings pages'))), 'not settings pages any more');
  assert.match(t, /Scheduled Jobs: work a background agent does at set times, made by asking you \(schedule_job\)[^]*Run Now, Pause or Resume, and Remove/);
  assert.match(t, /Connections \(apps and services you use through their MCP servers[^]*only added by asking you[^]*the button Connect an App/);
}
assert.match(mac, /kept in the Keychain\) and Routines/);
assert.match(win, /kept in the Windows key store\) and Routines/);
console.log('about (jobs, skills, connections) tests: passed');
