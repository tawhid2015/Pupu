// A stand-in model for test/agentrun.test.mjs (loaded by agentrun.mjs through ROAMIES_FAKE_AGENT): it calls the
// worker's real tools in a fixed order, like a model would, and logs each result to FAKE_LOG.
import fs from 'node:fs';

const STEPS = [
  ['plan', { now: 'Writing the page' }],
  ['write_file', { path: 'files/index.html', content: '<h1>Woof</h1>' }],
  ['write_file', { path: 'files/index.html', content: '<h1>Woof Co</h1>' }], // overwriting its own file: no yes needed
  ['run_command', { command: `node -e "require('fs').writeFileSync('work/scratch.txt', 'x')"` }], // runs code: asks once (and works in cmd too)
  ['finish', { outcome: 'Made a one-page site for Woof Co.', files: [{ path: 'files/index.html', what: 'the page' }] }],
];
// Asked for an answer (agentSystem says so): notes in work/, then a report and where it looked, no files. The first
// finish leaves the report out, so the check's error comes back and it tries again.
const ANSWER = [
  ['plan', { now: 'Reading the news' }],
  ['write_file', { path: 'work/notes.md', content: 'GPT-6, Claude 6' }],
  ['finish', { outcome: 'GPT-6 and Claude 6 came out this week.' }],
  ['finish', { outcome: 'GPT-6 and Claude 6 came out this week.', report: 'GPT-6 and Claude 6 both came out this week.\nSources: https://example.com/news', place: 'https://example.com/news' }],
];

export default class FakeAgent {
  constructor(o) { this.o = o; this.running = false; }
  steer() {}
  prompt(content) {
    const o = this;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ prompt: typeof content === 'string' ? content : content[0].text, tools: o.o.tools.map((t) => t.name), system: o.o.system }) + '\n');
    async function* run() {
      o.running = true;
      let i = 0;
      for (const [name, args] of /wants an answer, not a file/.test(o.o.system) ? ANSWER : STEPS) {
        const id = `t${++i}`;
        yield { type: 'tool_call_start', toolCallId: id, name, args };
        let isError = false, result;
        try { result = await o.o.tools.find((t) => t.name === name).execute(args, { signal: o.o.signal }); } catch (e) { isError = true; result = e.message; }
        fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ name, isError, result }) + '\n');
        yield { type: 'tool_call_end', toolCallId: id, isError, result };
        yield { type: 'turn_end', usage: { inputTokens: 100, outputTokens: 10 } };
      }
      o.running = false;
      return { message: { role: 'assistant', content: [] }, totalTurns: i, totalUsage: {} };
    }
    const g = run();
    return { [Symbol.asyncIterator]: () => g, then: (a, b) => Promise.resolve({}).then(a, b) };
  }
}
