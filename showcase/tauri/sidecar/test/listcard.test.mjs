import assert from 'node:assert/strict';
import { LIST_MAX, createLists } from '../draw.mjs';

// To-do lists you can edit (#115): a drawn list is a checklist; ticks, added items and edits on the card reach the
// model once, with the next message, and the part's description follows what's on it.
{
  const l = createLists();
  l.set('p1', { kind: 'list', title: 'Groceries', items: ['milk', 'bread'] });
  assert.equal(l.note(), null, 'nothing changed yet');
  assert.deepEqual(l.change('p1', { op: 'tick', i: 0, done: true }), ['milk', 'bread']);
  assert.deepEqual(l.change('p1', { op: 'add', text: '  eggs \n' }), ['milk', 'bread', 'eggs']);
  assert.deepEqual(l.change('p1', { op: 'edit', i: 1, text: 'rye bread' }), ['milk', 'rye bread', 'eggs']);
  assert.equal(l.desc('p1'), 'list “Groceries” (milk, done; rye bread; eggs)');
  assert.equal(l.note(), 'They changed the list “Groceries” on screen: ticked off “milk”; added “eggs”; changed “bread” to “rye bread”.');
  assert.equal(l.note(), null, 'told once');
  // Ticked and unticked again before the next message: nothing to tell.
  l.change('p1', { op: 'tick', i: 2, done: true }); l.change('p1', { op: 'tick', i: 2, done: false });
  assert.equal(l.note(), null);
  l.change('p1', { op: 'tick', i: 0, done: false });
  assert.equal(l.note(), 'They changed the list “Groceries” on screen: unticked “milk”.');
  // Nothing changes: no such list or item, empty or unchanged words.
  for (const c of [{ op: 'tick', i: 9, done: true }, { op: 'add', text: '   ' }, { op: 'edit', i: 0, text: 'milk' }, { op: 'edit', i: -1, text: 'x' }, { op: 'remove', i: 0 }]) assert.equal(l.change('p1', c), null, JSON.stringify(c));
  assert.equal(l.change('p9', { op: 'add', text: 'x' }), null);
  assert.equal(l.change('p1', { op: 'add', text: 'x'.repeat(300) }).at(-1).length, 120, 'an item is at most 120 characters');
  while (l.get('p1').items.length < LIST_MAX) l.change('p1', { op: 'add', text: 'more' });
  assert.equal(l.change('p1', { op: 'add', text: 'one too many' }), null, 'a list has room for 30 items');
  l.note();
  // Closed after a change: still told once, then gone.
  l.change('p1', { op: 'tick', i: 1, done: true });
  l.drop('p1');
  assert.equal(l.get('p1'), null);
  assert.equal(l.change('p1', { op: 'tick', i: 0, done: true }), null, 'a closed list takes no more changes');
  assert.match(l.note(), /ticked off “rye bread”/);
  assert.equal(l.note(), null);
  // Cleared with nothing to tell: gone at once; kept (pinned) ones stay.
  l.set('p2', { title: 'A', items: ['a'] }); l.set('p3', { title: 'B', items: ['b'] });
  l.clear((id) => id === 'p3');
  assert.equal(l.get('p2'), null);
  assert.deepEqual(l.get('p3'), { title: 'B', items: ['b'], done: [false] });
}

// Through the draw tool: a drawn list is tracked by its part, and its description shows the items as they are now.
{
  const { createTools } = await import('../tools.mjs');
  const noop = () => {};
  const made = createTools({
    allowActions: () => true, ask: async () => false, openUrl: noop, onCommitments: noop, showList: noop, fmtWhen: String, commitmentsText: () => '', userName: 'Test',
    ui: (m) => { if (m.e?.type === 'draw') setImmediate(() => made.ink.started(m.e.id, m.e.seg)); },
  });
  await made.ink.show([{ say: 'Your list.', marks: [{ kind: 'list', title: 'Packing', items: ['passport', 'charger'] }] }], 'lists-1', { fade: 5 });
  const part = made.ink.describe().match(/(p\d+) list/)[1];
  assert.deepEqual(made.ink.list(part).items, ['passport', 'charger']);
  assert.deepEqual(made.ink.listCard(part, { op: 'add', text: 'socks' }), ['passport', 'charger', 'socks']);
  made.ink.listCard(part, { op: 'tick', i: 0, done: true });
  assert.match(made.ink.describe(), new RegExp(`${part} list “Packing” \\(passport, done; charger; socks\\)`));
  assert.equal(made.ink.listNote(), 'They changed the list “Packing” on screen: ticked off “passport”; added “socks”.');
  made.ink.closed(part);
  assert.equal(made.ink.list(part), null, 'closed on screen: no longer there to change');
  const draw = made.tools.find((t) => t.name === 'draw');
  assert.match(draw.description, /list \(title, items\): a checklist; the user can tick items off, add items and edit them/);
}
console.log('list card tests: passed');
