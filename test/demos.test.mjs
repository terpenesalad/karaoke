import assert from 'node:assert/strict';
import { DEMOS, layout, midi } from '../js/demos.js';

const T = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; } };

T('note names', () => { assert.equal(midi('C4'), 60); assert.equal(midi('Bb4'), 70); assert.equal(midi('F#3'), 54); });
for (const d of DEMOS) {
  T(`${d.title}: melody fills exactly the chord bars`, () => {
    let beats = 0;
    for (const section of d.sections) for (const line of section) for (const [, , b] of line) beats += b;
    // The melody starts `pickup` beats before bar 1; the last chord bar is the closing chord.
    const bars = (beats - d.pickup) / d.beatsPerBar;
    const expected = d.chords.length - 1;
    assert.ok(Math.abs(bars - expected) < 1 + 1e-6, `melody ${bars} bars vs ${expected} chord bars`);
  });
  T(`${d.title}: lyric lines and notes are ordered and non-overlapping`, () => {
    const L = layout(d, 'Sam');
    assert.ok(L.lines.length > 0 && L.notes.length > 0);
    for (let i = 1; i < L.notes.length; i++) assert.ok(L.notes[i].t >= L.notes[i - 1].end - 1e-9);
    for (const l of L.lines) for (let i = 1; i < l.words.length; i++) assert.ok(l.words[i].t >= l.words[i - 1].t);
    assert.ok(L.duration > L.notes[L.notes.length - 1].end);
  });
}
T('birthday song uses the name', () => {
  const L = layout(DEMOS.find(d => d.id === 'demo-birthday'), 'Sam');
  assert.ok(L.lines.some(l => l.text.includes('dear Sam')));
});
T('transpose moves the melody', () => {
  const d = DEMOS[1];
  assert.equal(layout(d, 'x', 3).notes[0].midi - layout(d, 'x', 0).notes[0].midi, 3);
});
