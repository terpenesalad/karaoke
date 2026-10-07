import assert from 'node:assert/strict';
import { yin, hzToMidi, noteName, HowlDetector, Scorer } from '../js/pitch.js';

const T = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; } };
const sr = 48000;
const tone = (f, n = 2048, harmonics = 1) => Float32Array.from({ length: n }, (_, i) => {
  let s = 0; for (let k = 1; k <= harmonics; k++) s += Math.sin(2 * Math.PI * f * k * i / sr) / k; return .3 * s;
});

T('YIN finds sung pitches (pure and harmonic-rich)', () => {
  for (const [f, h] of [[110, 8], [220, 1], [261.63, 10], [440, 4], [698.46, 3]]) {
    const r = yin(tone(f, 2048, h), sr);
    assert.ok(r, 'no pitch at ' + f);
    assert.ok(Math.abs(1200 * Math.log2(r.hz / f)) < 15, `${f} -> ${r.hz}`);
  }
});
T('YIN stays quiet on silence', () => assert.equal(yin(new Float32Array(2048), sr), null));
T('note names', () => { assert.equal(noteName(hzToMidi(440)), 'A4'); assert.equal(noteName(60), 'C4'); assert.equal(noteName(61), 'C♯4'); });

// Build fake dB spectra like AnalyserNode.getFloatFrequencyData.
const fft = 4096, bins = fft / 2, binHz = sr / fft;
function spectrum(peaks, floor = -95) {
  const s = new Float32Array(bins).fill(floor);
  for (let i = 0; i < bins; i++) s[i] += Math.sin(i * 12.9898) * 3; // texture
  for (const [f, db] of peaks) { const b = Math.round(f / binHz); s[b] = db; s[b - 1] = Math.max(s[b - 1], db - 9); s[b + 1] = Math.max(s[b + 1], db - 9); }
  return s;
}
T('howl: a swelling pure tone triggers within ~0.5 s', () => {
  const d = new HowlDetector(sr, fft);
  let onsetAt = null;
  for (let t = 0; t < 1500; t += 16) {
    const db = Math.min(-10, -38 + t / 30);
    const r = d.push(spectrum([[2500, db]]), t);
    if (r.onset && onsetAt == null) onsetAt = t;
  }
  assert.ok(onsetAt != null && onsetAt < 700, 'onset ' + onsetAt);
  assert.ok(Math.abs(d.hz - 2500) < binHz * 1.5);
});
T('howl: a sung note with strong harmonics never triggers', () => {
  const d = new HowlDetector(sr, fft);
  for (let t = 0; t < 4000; t += 16) {
    const f = 330 * (1 + .01 * Math.sin(t / 1000 * 2 * Math.PI * 5.5));
    const r = d.push(spectrum([[f, -20], [2 * f, -26], [3 * f, -30], [4 * f, -36]]), t);
    assert.equal(r.active, false, 'false alarm at ' + t);
  }
});
T('howl: warning clears after the tone stops', () => {
  const d = new HowlDetector(sr, fft);
  let t = 0;
  for (; t < 1200; t += 16) d.push(spectrum([[1800, -12]]), t);
  assert.equal(d.active, true);
  for (; t < 4000; t += 16) d.push(spectrum([]), t);
  assert.equal(d.active, false);
});
T('scorer: octave-agnostic, counts on-key time', () => {
  const s = new Scorer([{ t: 0, end: 2, midi: 60 }, { t: 2, end: 4, midi: 64 }]);
  for (let t = 0; t < 2; t += .05) s.push(t, .05, 48.2);   // an octave down, slightly sharp: on key
  for (let t = 2; t < 4; t += .05) s.push(t, .05, 67);     // 3 semitones off
  assert.ok(s.percent > 40 && s.percent < 55, 'percent ' + s.percent);
});
