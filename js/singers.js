// Remembered singers: names are saved as you use them (most recent first), offered as
// one-click picks under the Singer box, and can be renamed or deleted in the Singers dialog.
import { store, h } from './util.js';

const KEY = 'brk2-singers';
const MAX = 60;
const norm = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

export class Singers {
  constructor() {
    this.names = (store.get(KEY, []) || []).map(norm).filter(Boolean);
    this.listeners = [];
  }
  onChange(fn) { this.listeners.push(fn); }
  save() { store.set(KEY, this.names); this.listeners.forEach(f => f()); }
  /** Remember a name (moves it to the front). */
  use(name) {
    const n = norm(name);
    if (!n) return;
    this.names = [n, ...this.names.filter(x => !same(x, n))].slice(0, MAX);
    this.save();
  }
  /** Rename everywhere it's saved. Returns the cleaned new name, or null if nothing changed. */
  rename(oldName, newName) {
    const n = norm(newName);
    if (!n || n === oldName) return null;
    const i = this.names.indexOf(oldName);
    if (i < 0) return null;
    this.names = this.names.filter((x, j) => j === i || !same(x, n)); // merge with an existing same name
    this.names[this.names.indexOf(oldName)] = n;
    this.save();
    return n;
  }
  remove(name) { this.names = this.names.filter(x => x !== name); this.save(); }
}

/** Quick-pick buttons under the Singer box. */
export function renderSingerChips(singers, el, current, pick) {
  if (!singers.names.length) { el.replaceChildren(); el.hidden = true; return; }
  el.hidden = false;
  el.replaceChildren(...singers.names.slice(0, 12).map(n => {
    const on = !!current && same(n, current);
    return h('button.chip', { type: 'button', 'aria-pressed': String(on), onclick: () => pick(on ? '' : n), title: on ? `Clear ${n}` : `Sing as ${n}` }, n);
  }));
}

/** The Singers dialog: rename by editing a name, or delete it. */
export function renderSingerEditor(singers, list, { onRename, onRemove }) {
  if (!singers.names.length) {
    list.replaceChildren(h('li.empty', null, 'No saved singers yet. Names are remembered when you type them in the Singer box.'));
    return;
  }
  list.replaceChildren(...singers.names.map((n, i) => {
    const id = 'singer-edit-' + i;
    const input = h('input', { id, type: 'text', value: n, maxlength: 40, autocomplete: 'off', 'aria-label': `Name for ${n}` });
    const commit = () => {
      const v = input.value.trim();
      if (!v) { input.value = n; return; }
      if (v !== n) onRename(n, v);
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { input.value = n; } });
    return h('li', null, input, h('button.btn.small.danger', { type: 'button', onclick: () => onRemove(n), 'aria-label': `Delete ${n}` }, 'Delete'));
  }));
}
