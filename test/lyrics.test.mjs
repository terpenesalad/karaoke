import assert from 'node:assert/strict';
import { parseLRC, toLRC, wordsFor, lineAt, wordProgress, guessArtistTitle, findLyricsOnline, fmtStamp } from '../js/lyrics.js';

const T = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; } };

T('plain LRC lines, sorted, with meta', () => {
  const r = parseLRC('[ti:Made Up]\n[ar:Nobody]\n[00:05.50]second\n[00:01.00]first\n');
  assert.equal(r.synced, true);
  assert.equal(r.meta.ti, 'Made Up');
  assert.deepEqual(r.lines.map(l => [l.t, l.text]), [[1, 'first'], [5.5, 'second']]);
});
T('repeated stamps expand a chorus line', () => {
  const r = parseLRC('[00:10.00][01:20.00]la la la\n');
  assert.deepEqual(r.lines.map(l => l.t), [10, 80]);
});
T('enhanced word stamps, including text before the first stamp', () => {
  const r = parseLRC('[00:01.00]Alpha <00:01.50>beta <00:02.00>gamma\n[00:04.00]next\n');
  const w = r.lines[0].words;
  assert.deepEqual(w.map(x => x.text), ['Alpha ', 'beta ', 'gamma']);
  assert.deepEqual(w.map(x => x.t), [1, 1.5, 2]);
  assert.equal(w[0].end, 1.5);
  assert.equal(r.lines[0].text, 'Alpha beta gamma');
});
T('offset tag shifts lyrics earlier', () => {
  const r = parseLRC('[offset:+500]\n[00:02.00]x\n');
  assert.equal(r.lines[0].t, 1.5);
});
T('unsynced text is reported as not synced', () => {
  const r = parseLRC('just some words\nand more');
  assert.equal(r.synced, false);
  assert.equal(r.lines.length, 2);
});
T('line end does not span a long instrumental gap', () => {
  const r = parseLRC('[00:01.00]short\n[00:40.00]later\n');
  assert.ok(r.lines[0].end < 10, 'end ' + r.lines[0].end);
});
T('estimated word timings cover the line', () => {
  const r = parseLRC('[00:00.00]one two three\n[00:03.00]x\n');
  const w = wordsFor(r.lines[0]);
  assert.equal(w.length, 3);
  assert.equal(w[0].t, 0);
  assert.ok(Math.abs(w[2].end - r.lines[0].end) < 1e-9);
  assert.equal(wordProgress(w[0], -1), 0);
  assert.equal(wordProgress(w[0], 100), 1);
});
T('lineAt binary search', () => {
  const lines = [{ t: 1 }, { t: 2 }, { t: 5 }];
  assert.equal(lineAt(lines, .5), -1);
  assert.equal(lineAt(lines, 1), 0);
  assert.equal(lineAt(lines, 4.9), 1);
  assert.equal(lineAt(lines, 99), 2);
});
T('round trip through toLRC', () => {
  const src = '[00:01.00]Alpha <00:01.50>beta\n[00:04.25]next';
  const back = parseLRC(toLRC(parseLRC(src).lines));
  assert.deepEqual(back.lines.map(l => [l.t, l.text]), [[1, 'Alpha beta'], [4.25, 'next']]);
  assert.equal(fmtStamp(65.5), '01:05.50');
});
T('artist/title guessing from file names', () => {
  assert.deepEqual(guessArtistTitle('Some Band - A Song (Karaoke Version).mp3'), { artist: 'Some Band', title: 'A Song' });
  assert.deepEqual(guessArtistTitle('just_a_title.wav'), { artist: '', title: 'just a title' });
});
await (async () => {
  // Online lookup uses an injected fetch so the test is offline.
  const calls = [];
  const fake = async url => {
    calls.push(url);
    if (url.includes('/get?')) return { ok: false };
    return { ok: true, json: async () => [{ duration: 100, syncedLyrics: '[00:01.00]far' }, { duration: 181, syncedLyrics: '[00:01.00]near' }] };
  };
  const got = await findLyricsOnline({ artist: 'A', title: 'B', duration: 180 }, fake);
  try { assert.equal(got, '[00:01.00]near'); assert.equal(calls.length, 2); console.log('  ok   online lookup picks the closest duration'); }
  catch (e) { console.error('  FAIL online lookup', e); process.exitCode = 1; }
  const none = await findLyricsOnline({ artist: 'A', title: 'B' }, async () => { throw new Error('offline'); });
  try { assert.equal(none, null); console.log('  ok   network failure resolves to null'); } catch (e) { console.error('  FAIL', e); process.exitCode = 1; }
})();
