// Real-time YouTube pitch shifter: correct pitch, unity gain, steady delay, cheap enough for real time.
const assert = require('node:assert/strict');
const { PitchShifter } = require('../electron/ytpitch-worklet.js');
const T = (name, fn) => { try { fn(); console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };
const sr = 48000;
const run = (sig, st) => {
  const sh = new PitchShifter(); sh.setSemitones(st);
  const out = new Float32Array(sig.length), blk = new Float32Array(128);
  for (let i = 0; i + 128 <= sig.length; i += 128) { sh.process(sig.subarray(i, i + 128), blk); out.set(blk, i); }
  return { out, sh };
};
const sine = (f, secs = 2, a = .5) => Float32Array.from({ length: sr * secs }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));
function peakHz(x) { // DFT peak search with parabolic interpolation over a window of the steady part
  const n = 16384, off = x.length - n - 2000, w = i => .5 - .5 * Math.cos(2 * Math.PI * i / n);
  const mag = f => { let r = 0, im = 0; for (let i = 0; i < n; i++) { const v = x[off + i] * w(i), p = 2 * Math.PI * f * i / sr; r += v * Math.cos(p); im -= v * Math.sin(p); } return Math.hypot(r, im); };
  let best = 0, bf = 0; for (let f = 150; f < 1500; f += 2) { const m = mag(f); if (m > best) { best = m; bf = f; } }
  const a = mag(bf - 1), b = mag(bf), c = mag(bf + 1); return bf + .5 * (a - c) / (a - 2 * b + c);
}
const rms = (x, from) => { let s = 0, n = 0; for (let i = from; i < x.length - 2000; i++) { s += x[i] * x[i]; n++; } return Math.sqrt(s / n); };
for (const [st, want] of [[2, 493.88], [-3, 369.99], [5, 587.33], [-6, 311.13]]) {
  T(`440 Hz ${st > 0 ? '+' : ''}${st} st -> ${want} Hz`, () => {
    const { out } = run(sine(440), st);
    const got = peakHz(out);
    assert.ok(Math.abs(1200 * Math.log2(got / want)) < 8, `got ${got.toFixed(2)} Hz`);
  });
}
T('loudness stays within 1.5 dB (sine and chord)', () => {
  for (const sig of [sine(440), (() => { const a = sine(261.6, 2, .2), b = sine(329.6, 2, .2), c = sine(392, 2, .2); return a.map((v, i) => v + b[i] + c[i]); })()]) {
    for (const st of [-4, 3]) {
      const { out } = run(sig, st);
      const db = 20 * Math.log10(rms(out, 12000) / rms(sig, 12000));
      assert.ok(Math.abs(db) < 1.5, `st ${st}: ${db.toFixed(2)} dB`);
    }
  }
});
T('zero semitones passes audio straight through', () => {
  const sig = sine(440, .5); const { out } = run(sig, 0);
  for (let i = 0; i < out.length - 128; i++) assert.equal(out[i], sig[i]);
});
T('delay is under 100 ms', () => { const sh = new PitchShifter(); assert.ok(sh.latency / sr < .1, `${(sh.latency / sr * 1000).toFixed(0)} ms`); });
T('fast enough for real time (stereo, 10 s of audio)', () => {
  const sig = sine(440, 10); const t = Date.now(); run(sig, 3); run(sig, 3);
  const ms = Date.now() - t; console.log(`       10 s stereo in ${ms} ms (${(20000 / ms).toFixed(0)}x real time)`);
  assert.ok(ms < 2500);
});
