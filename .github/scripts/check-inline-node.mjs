// Checks the `node -e '…'` scripts inside the workflows: a stray ' ends the shell string early (v0.1.33's release
// manifest broke that way), so each script must end at a ' followed only by spaces or the line's end, and must parse.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const files = process.argv.length > 2 ? process.argv.slice(2)
  : fs.readdirSync('.github/workflows').filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join('.github/workflows', f));
let bad = 0, seen = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/node -e '/g)) {
    seen++;
    const start = m.index + m[0].length, end = text.indexOf("'", start);
    const line = text.slice(0, m.index).split('\n').length;
    const after = end < 0 ? '' : text.slice(end + 1, text.indexOf('\n', end + 1) < 0 ? undefined : text.indexOf('\n', end + 1));
    let err = end < 0 ? 'no closing quote' : /^\s*(\\|&&.*|\|\|.*|>.*|\|.*)?$/.test(after) ? null : `a ' inside the script ends it early, before: ${after.trim().slice(0, 40)}`;
    if (!err) try { new vm.Script(text.slice(start, end)); } catch (e) { err = e.message; }
    if (err) { bad++; console.error(`${file}:${line}: node -e script: ${err}`); }
  }
}
console.log(`inline node scripts: ${seen - bad}/${seen} ok`);
process.exit(bad ? 1 : 0);
