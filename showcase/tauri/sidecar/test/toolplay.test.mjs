// The Sidekick's tool performances (agent-tools.js): every tool and variant finishes on its own, none draws a prop
// (the task tag under it says what it's doing), and their poses only set the face. Runs the browser code in a sandbox.
// Run: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, u) => a + (b - a) * u;
const window = { Roamie: { clamp, lerp } };
vm.runInNewContext(fs.readFileSync(new URL('../../../roamies/agent-tools.js', import.meta.url), 'utf8'), { window, Math });
const T = window.Roamie.agentTools;
const c = { R: 70, P: 5, W: 1600, H: 1000, bx: 300, by: 700, S() {}, sq: { kick() {} }, face: { set() {} }, look() {} };

for (const [name, def] of Object.entries(T)) {
  // Regression: tools drew a prop beside the Sidekick as well as the tag under it, saying the same thing twice.
  for (const hook of ['grid', 'top', 'over']) assert.equal(def[hook], undefined, `${name} draws no ${hook} prop`);
  for (const variant of def.variants) {
    for (const extra of [{}, ...(name === 'screenshot' ? [{ live: true }, { live: true, target: [400, 120, 1400, 820] }] : [])]) {
      const st = { name, def, variant, d: {}, age: 0, seed: 3, status: null, ...extra, finish(ok = true) { st.status ??= ok ? 'ok' : 'fail'; } };
      def.start?.(st, c);
      for (let i = 0; i < 600 && !st.status; i++) { st.age += 1 / 60; def.update?.(st, c, 1 / 60); }
      assert.ok(st.status, `${name}/${variant}${extra.live ? ' live' : ''} finishes on its own`);
      assert.equal(st.status, variant === 'fail' ? 'fail' : 'ok', `${name}/${variant} ends ${variant === 'fail' ? 'badly' : 'well'}`);
      const pose = def.pose(st, c);
      if (pose) for (const k of ['arms', 'tl', 'tr']) assert.equal(pose[k], undefined, `${name} pose leaves the arms alone`);
    }
  }
}
console.log('tool performance tests: passed');
