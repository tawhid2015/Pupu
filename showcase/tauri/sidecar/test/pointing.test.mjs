// Screenshot pixels → screen points for draw / click_at. Run: npm test
import assert from 'node:assert/strict';
import { shotFits, shotMap, snapRect, toScreen, parseSipsSize } from '../pointing.mjs';

// Regression: an 1800×1066 pt Brave window at (0, 39) is captured at 3600 px and capped to 1568 px wide.
// Image pixels used to be treated as points, so points landed up and left of the target.
const brave = shotMap([0, 39, 1800, 1066], 1568, 929);
assert.deepEqual(toScreen(brave, 1026, 531), [1178, 648], 'scales up and adds the window origin');
assert.deepEqual(toScreen(brave, 0, 0), [0, 39], 'image corner is the window corner');
assert.deepEqual(toScreen(brave, 1568, 929), [1800, 1105], 'far corner is the far window corner');

// A small window isn't capped, so its Retina image is twice its size in points.
const small = shotMap([400, 300, 700, 500], 1400, 1000);
assert.deepEqual(toScreen(small, 700, 500), [750, 550], 'Retina 2x maps back to points');

assert.deepEqual(parseSipsSize('/tmp/a.jpg\n  pixelWidth: 1568\n  pixelHeight: 929\n'), [1568, 929]);
assert.equal(parseSipsSize('garbage'), null);
console.log('screenshot coordinate tests: passed');

// Regression: after navigating, id 70 was a pinned post instead of SETTINGS, so Sidekick pointed at the wrong thing.
{
  const { rematch, sameBounds } = await import('../pointing.mjs');
  const read = [
    { id: 69, role: 'link', label: 'Members', bounds: [1100, 560, 80, 20] },
    { id: 70, role: 'button', label: 'SETTINGS', bounds: [1060, 620, 230, 40] },
  ];
  const settings = read[1];
  const after = [
    { id: 70, role: 'link', label: '👾 Join our Discord here (a must)', bounds: [300, 400, 500, 30] },
    { id: 71, role: 'button', label: 'SETTINGS', bounds: [1060, 700, 230, 40] },
  ];
  const fresh = Array.from({ length: 69 }, (_, i) => ({ id: i + 1, role: 'link', label: `x${i}`, bounds: [0, 0, 1, 1] })).concat(after);
  assert.equal(rematch(settings, fresh, 70)?.id, 71, 'finds SETTINGS at its new id');
  const unchanged = Array.from({ length: 68 }, (_, i) => ({ id: i + 1, role: 'link', label: `x${i}`, bounds: [0, 0, 1, 1] })).concat(read);
  assert.equal(rematch(settings, unchanged, 70)?.label, 'SETTINGS', 'same page keeps the id');
  assert.equal(rematch(settings, fresh.filter((c) => c.label !== 'SETTINGS'), 70), null, 'gone from the page: refuse');
  assert.equal(rematch({ role: 'button', label: '', bounds: [0, 0, 1, 1] }, fresh, 70), null, 'unlabelled and changed: refuse');
  assert.equal(rematch(undefined, fresh, 70), null, 'id never read: refuse');
  // Two SETTINGS buttons: take the one nearest where it was.
  const two = [{ id: 1, role: 'button', label: 'SETTINGS', bounds: [10, 10, 50, 20] }, { id: 2, role: 'button', label: 'SETTINGS', bounds: [1070, 640, 230, 40] }];
  assert.equal(rematch(settings, two, 70)?.id, 2, 'nearest match wins');
  assert.ok(sameBounds([0, 39, 1800, 1066], [0, 40, 1800, 1066]) && !sameBounds([0, 39, 1800, 1066], [200, 39, 1800, 1066]));
  console.log('stale control id tests: passed');
}

// Regression: after switching pages or apps, Sidekick pointed using what it saw for the previous request.
{
  const { shotProblem, readProblem } = await import('../pointing.mjs');
  assert.match(shotProblem(null, 3), /Take a screenshot first/);
  assert.equal(shotProblem({ turn: 3 }, 3), null, 'a screenshot from this request is fine');
  assert.match(shotProblem({ turn: 2 }, 3), /before the user's latest message/, 'a screenshot from the last request is refused');
  assert.match(shotProblem({ turn: 3, used: true }, 3), /clicked or opened since/, 'a screenshot taken before a click is refused');
  assert.equal(readProblem({ win: 7, turn: 3 }, 7, 3), null, 'this window, this request');
  assert.match(readProblem({ win: 7, turn: 2 }, 7, 3), /before the user's latest message/, 'last request: read again');
  assert.match(readProblem({ win: 7, turn: 3 }, 9, 3), /read_window on this window first/, 'another window: read it first');
  assert.match(readProblem(null, 9, 3), /read_window on this window first/);
  console.log('freshness tests: passed');
}

// Regression: CapCut's 183×88 pt button window came back with a 1568×935 picture of the whole app, and every mark
// was squeezed into the button's corner. A picture that isn't the shape of its area isn't used to point.
assert.equal(shotFits([1625, 1029, 183, 88], 1568, 935), false, 'the button bounds with the whole-window picture');
assert.equal(shotFits([0, 39, 1800, 1066], 1568, 929), true, 'a window capped to 1568 px');
assert.equal(shotFits([0, 39, 1808, 1078], 1568, 935), true, 'a window with its child window');
assert.equal(shotFits([400, 300, 700, 500], 1400, 1000), true, 'a small Retina window');
assert.equal(shotFits([0, 0, 0, 0], 1568, 935), false, 'no area');
{
  const { shotProblem } = await import('../pointing.mjs');
  assert.match(shotProblem({ unmapped: true, turn: 1 }, 1), /doesn't line up/);
}
console.log('screenshot shape tests: passed');

// A loop guessed from screenshot pixels, a little off a real button, takes the button's exact box.
{
  const theme = [1445, 88, 37, 36], discord = [1533, 88, 37, 36];
  assert.deepEqual(snapRect([1447, 96, 37, 36], [discord, theme]), theme, 'a few points low: snapped');
  assert.equal(snapRect([1300, 300, 40, 40], [discord, theme]), null, 'nothing near: left as drawn');
  assert.equal(snapRect([1440, 85, 140, 42], [discord, theme]), null, 'round a group of icons: not shrunk to one');
  assert.equal(snapRect([1460, 100, 8, 8], [theme]), null, 'a tiny spot inside a big control: not grown');
  console.log('snap tests: passed');
}

// Regression (#63): Qwen3-VL and Qwen3.5 answer on a 0–1000 grid whatever the image size, so their points were read
// as pixels and landed up and to the left of the target.
{
  const { pointScale } = await import('@kenkaiiii/gg-core');
  const { shotUnits } = await import('../pointing.mjs');
  const grid = shotMap([0, 39, 1800, 1066], 1568, 929, 'norm1000');
  assert.deepEqual(grid.size, [1000, 1000], 'the bounds checks use the grid');
  assert.deepEqual(toScreen(grid, 500, 500), [900, 572], 'the grid centre is the window centre');
  assert.deepEqual(toScreen(grid, 1000, 1000), [1800, 1105], 'far corner is the far window corner');
  assert.deepEqual(toScreen(grid, 0, 0), [0, 39]);
  assert.deepEqual(shotMap([0, 39, 1800, 1066], 1568, 929).size, [1568, 929], 'pixels by default');
  assert.match(shotUnits(1568, 929, 'norm1000'), /1568×929 px.*0–1000 grid.*1000, 1000 its bottom right.*screenshot pixels, use this grid/);
  assert.match(shotUnits(1568, 929), /1568×929 px; for draw or click_at give x, y in this image's pixels/);
  assert.doesNotMatch(shotUnits(1568, 929), /grid/);
  assert.equal(pointScale('local/ollama/qwen3-vl:8b'), 'norm1000');
  assert.equal(pointScale('local/lmstudio/qwen3.5-27b'), 'norm1000');
  assert.equal(pointScale('claude-sonnet-5-5'), 'pixels');
  console.log('0–1000 grid tests: passed');
}
