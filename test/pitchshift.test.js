// Plain Node test for js/pitchshift-worker.js:  node test/pitchshift.test.js
// Built-in modules only (node:assert, plus node:path/fs/vm to load the worker as a worker would).
'use strict';
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { pitchShift } = require(path.join(__dirname, '..', 'js', 'pitchshift-worker.js'));

const SR = 44100;
let failures = 0, passes = 0;
function test(name, fn) {
  try { fn(); passes++; console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

// Deterministic PRNG (mulberry32) so runs are reproducible.
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function sines(freqs, seconds, amp = 0.3) {
  const n = Math.round(seconds * SR), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const f of freqs) s += Math.sin(2 * Math.PI * f * i / SR); x[i] = amp * s; }
  return x;
}
// RMS over the middle 80 % of a signal (avoids edge transients).
function rms(x, lo = 0.1, hi = 0.9) {
  const a = Math.floor(x.length * lo), b = Math.floor(x.length * hi);
  let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / (b - a));
}
const db = (a, b) => 20 * Math.log10(a / b);
const diff = (a, b) => a.map((v, i) => v - b[i]);
// Dominant frequency: Hann-windowed DFT magnitude search on a coarse grid (0.5 Hz), then golden
// refinement around the best grid point.  Evaluated on a 1 s window from the middle.
function dominantFreq(x, fLo, fHi) {
  const n = SR, off = Math.floor((x.length - n) / 2), w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = x[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  const mag = f => { let re = 0, im = 0; const d = 2 * Math.PI * f / SR;
    for (let i = 0; i < n; i++) { re += w[i] * Math.cos(d * i); im -= w[i] * Math.sin(d * i); } return re * re + im * im; };
  let best = fLo, bm = -1;
  for (let f = fLo; f <= fHi; f += 0.5) { const m = mag(f); if (m > bm) { bm = m; best = f; } }
  // parabolic interpolation over the 3 grid points around the maximum
  const m0 = mag(best - 0.5), m1 = bm, m2 = mag(best + 0.5), den = m0 - 2 * m1 + m2;
  return den < 0 ? best + 0.5 * 0.5 * (m0 - m2) / den : best;
}
function finite(chs) { for (const c of chs) for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) return false; return true; }

console.log('pitchshift tests');

test('semitones 0 is identity (copied, not same buffer)', () => {
  const x = sines([440], 0.5), y = pitchShift([x], SR, 0)[0];
  assert.notStrictEqual(y, x); assert.strictEqual(y.length, x.length);
  for (let i = 0; i < x.length; i++) assert.strictEqual(y[i], x[i]);
});

test('output length equals input length (mono + stereo, odd lengths, several shifts)', () => {
  for (const n of [1, 1000, 44101, 100003]) for (const st of [-12, -3.5, 2, 12]) {
    const x = sines([300], n / SR), out = pitchShift([x, x.slice()], SR, st);
    assert.strictEqual(out.length, 2); for (const c of out) assert.strictEqual(c.length, n, `n=${n} st=${st}`);
    assert.ok(finite(out), 'finite');
  }
});

for (const [st, target, tol] of [[2, 493.88, 1], [-5, 329.63, 1], [12, 880, 2], [-12, 220, 1], [0.5, 452.89, 1]]) {
  test(`440 Hz sine ${st > 0 ? '+' : ''}${st} st -> ${target} Hz (+-${tol})`, () => {
    const x = sines([440], 3), y = pitchShift([x], SR, st)[0];
    const f = dominantFreq(y, target - 30, target + 30);
    assert.ok(Math.abs(f - target) <= tol, `measured ${f.toFixed(3)} Hz`);
    assert.ok(finite([y]), 'finite');
  });
}

for (const [label, freqs] of [['sine 440', [440]], ['chord 261.6/329.6/392', [261.63, 329.63, 392.0]]]) {
  for (const st of [-12, -5, 2, 7, 12]) {
    test(`RMS within +-1 dB: ${label}, ${st} st`, () => {
      const x = sines(freqs, 3, 0.25), y = pitchShift([x], SR, st)[0];
      const d = db(rms(y), rms(x));
      assert.ok(Math.abs(d) <= 1, `gain ${d.toFixed(3)} dB`);
    });
  }
}

test('no level dip / click at start and end (first and last 50 ms within +-1.5 dB)', () => {
  const x = new Float32Array(SR * 2).fill(0); const s = sines([220, 330], 2, 0.3); x.set(s);
  for (const st of [-7, 4]) {
    const y = pitchShift([x], SR, st)[0], n = Math.floor(0.05 * SR);
    const seg = (a, from) => rms(a.subarray(from, from + n), 0, 1);
    const ref = rms(y);
    assert.ok(Math.abs(db(seg(y, 0), ref)) <= 1.5, `start ${db(seg(y, 0), ref).toFixed(2)} dB @${st}`);
    assert.ok(Math.abs(db(seg(y, y.length - n), ref)) <= 1.5, `end ${db(seg(y, y.length - n), ref).toFixed(2)} dB @${st}`);
  }
});

test('no DC offset introduced, peak not more than ~1 dB above input peak', () => {
  const R = rng(7), n = SR * 3, x = sines([196, 247, 294, 587], 3, 0.15);
  for (let i = 0; i < n; i++) x[i] += 0.05 * (R() * 2 - 1);
  for (const st of [-4, 3]) {
    const y = pitchShift([x], SR, st)[0];
    let mean = 0, pk = 0, pkx = 0;
    for (let i = 0; i < n; i++) { mean += y[i]; pk = Math.max(pk, Math.abs(y[i])); pkx = Math.max(pkx, Math.abs(x[i])); }
    mean /= n;
    assert.ok(Math.abs(mean) < 1e-3, `DC ${mean}`);
    assert.ok(db(pk, pkx) < 1.5, `peak +${db(pk, pkx).toFixed(2)} dB`);
  }
});

// Music-like test signal: chord + harmonics + a noise burst, optionally a side component.
function musicLike(seconds, seed, side) {
  const R = rng(seed), n = Math.round(seconds * SR), c = new Float32Array(n), s = new Float32Array(n);
  const notes = [130.81, 164.81, 196.0, 261.63, 329.63, 392.0, 523.25];
  for (let i = 0; i < n; i++) {
    let v = 0; const t = i / SR;
    for (let k = 0; k < notes.length; k++) v += (0.08 / (1 + k * 0.3)) * Math.sin(2 * Math.PI * notes[k] * t + k);
    v += 0.03 * Math.sin(2 * Math.PI * 1046.5 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t));
    const burst = (t % 0.5) < 0.05 ? 0.2 : 0.01;                 // percussive noise bursts
    v += burst * (R() * 2 - 1);
    c[i] = v;
    if (side) s[i] = 0.06 * Math.sin(2 * Math.PI * 659.25 * t + 0.3) + 0.03 * (R() * 2 - 1);
  }
  return { c, s };
}

test('stereo coherence: L === R stays L === R (RMS(L-R)/RMS(L) < 1e-3) at +3 and -4', () => {
  const { c } = musicLike(4, 11, false);
  for (const st of [3, -4]) {
    const [l, r] = pitchShift([c, c.slice()], SR, st);
    const ratio = rms(diff(l, r), 0, 1) / rms(l, 0, 1);
    console.log(`       ${st > 0 ? '+' : ''}${st} st: residual ${(20 * Math.log10(ratio + 1e-30)).toFixed(1)} dB`);
    assert.ok(ratio < 1e-3, `ratio ${ratio}`);
  }
});

test('stereo with L != R is not mono-collapsed (L-R energy preserved within +-2 dB)', () => {
  const { c, s } = musicLike(4, 12, true);
  const L = c.map((v, i) => v + s[i]), R = c.map((v, i) => v - s[i]);
  for (const st of [3, -4]) {
    const [l, r] = pitchShift([L, R], SR, st);
    const d = db(rms(diff(l, r)), rms(diff(L, R)));
    const dm = db(rms(l.map((v, i) => v + r[i])), rms(L.map((v, i) => v + R[i])));
    assert.ok(Math.abs(d) <= 2, `side gain ${d.toFixed(2)} dB @${st}`);
    assert.ok(Math.abs(dm) <= 2, `mid gain ${dm.toFixed(2)} dB @${st}`);
  }
});

test('module does not install a message handler under Node', () => {
  assert.strictEqual(typeof globalThis.onmessage, 'undefined');
});

test('worker protocol: progress (<= ~51, 0..1), done with transferred buffers, error path', () => {
  // Run the script as a classic worker would: in a sandbox with self/importScripts/postMessage, no module.
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'pitchshift-worker.js'), 'utf8');
  const posted = [];
  const sandbox = { importScripts() {}, Float32Array, Float64Array, Int32Array, Uint32Array, Math, Number, Array, Error, RangeError, String };
  sandbox.self = sandbox;
  sandbox.postMessage = (msg, transfer) => posted.push({ msg, transfer });
  vm.runInNewContext(src, sandbox);
  assert.strictEqual(typeof sandbox.onmessage, 'function', 'self.onmessage installed');
  const l = sines([440], 2), r = sines([550], 2);
  sandbox.onmessage({ data: { id: 7, channels: [l, r], sampleRate: SR, semitones: 3 } });
  const prog = posted.filter(p => p.msg.type === 'progress'), done = posted.filter(p => p.msg.type === 'done');
  assert.ok(prog.length >= 1 && prog.length <= 51, `progress msgs ${prog.length}`);
  for (const p of prog) assert.ok(p.msg.id === 7 && p.msg.value >= 0 && p.msg.value <= 1);
  assert.strictEqual(done.length, 1); assert.strictEqual(posted[posted.length - 1].msg.type, 'done');
  const d = done[0];
  assert.strictEqual(d.msg.id, 7); assert.strictEqual(d.msg.channels.length, 2);
  assert.strictEqual(d.msg.channels[0].length, l.length);
  assert.ok(d.transfer && d.transfer.length === 2 && d.transfer[0] === d.msg.channels[0].buffer, 'buffers transferred');
  posted.length = 0;
  sandbox.onmessage({ data: { id: 8, channels: [l], sampleRate: SR, semitones: 40 } });
  assert.strictEqual(posted.length, 1); assert.strictEqual(posted[0].msg.type, 'error'); assert.strictEqual(posted[0].msg.id, 8);
  assert.ok(typeof posted[0].msg.message === 'string' && posted[0].msg.message.length > 0);
});

test('progress callback: monotonic, <= ~51 calls, ends at 1', () => {
  const x = sines([440], 5), seen = [];
  pitchShift([x], SR, 2, v => seen.push(v));
  assert.ok(seen.length >= 2 && seen.length <= 52, `calls ${seen.length}`);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
  assert.strictEqual(seen[seen.length - 1], 1);
});

test('performance: 180 s stereo 44.1 kHz, +2 st in < 6000 ms', () => {
  const { c, s } = musicLike(180, 99, true);
  const L = c.map((v, i) => v + s[i]), R = c.map((v, i) => v - s[i]);
  const t0 = process.hrtime.bigint();
  const out = pitchShift([L, R], SR, 2);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`       180 s stereo processed in ${ms.toFixed(0)} ms (${(180000 / ms).toFixed(1)}x realtime)`);
  assert.strictEqual(out[0].length, L.length);
  assert.ok(finite(out), 'NaN/Infinity in output');
  assert.ok(ms < 6000, `took ${ms.toFixed(0)} ms`);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
