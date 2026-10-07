// Pitch tools: a YIN pitch detector for the singer, note naming, a howl (feedback) detector,
// and a simple melody-following score. Pure functions, unit-tested in Node.

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = m => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);
export const hzToMidi = f => 69 + 12 * Math.log2(f / 440);

/**
 * YIN (de Cheveigné & Kawahara 2002) on a time-domain frame.
 * Returns { hz, clarity } or null when unvoiced/too quiet. `scratch` is a reusable Float32Array.
 */
export function yin(buf, sampleRate, scratch, { minHz = 70, maxHz = 1100, threshold = 0.12 } = {}) {
  const n = buf.length;
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minHz));
  const W = n - tauMax;
  if (W < 64) return null;
  let energy = 0;
  for (let i = 0; i < W; i++) energy += buf[i] * buf[i];
  if (energy / W < 1e-6) return null; // ~ -60 dBFS
  const d = scratch && scratch.length >= tauMax + 1 ? scratch : new Float32Array(tauMax + 1);
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    running += s;
    d[tau] = running > 0 ? s * tau / running : 1; // cumulative mean normalised difference
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation around the minimum.
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (den !== 0) better = tau + (a - c) / (2 * den);
  }
  return { hz: sampleRate / better, clarity: 1 - d[tau] };
}

/**
 * Feedback (howl) detector. Feed it one magnitude spectrum (dB, from AnalyserNode
 * getFloatFrequencyData) per animation frame. A howl is a single near-pure tone that
 * dominates the spectrum, holds its frequency, has weak harmonics (a sung note has strong
 * ones) and is loud or growing. Returns { active, hz, onset } each frame.
 */
export class HowlDetector {
  constructor(sampleRate, fftSize) {
    this.binHz = sampleRate / fftSize;
    this.lo = Math.max(2, Math.floor(180 / this.binHz));
    this.hi = Math.floor(Math.min(9000, sampleRate / 2 - 100) / this.binHz);
    this.track = null;       // { bin, since, firstDb, lastDb }
    this.active = false;
    this.clearAt = 0;
    this.sorted = null;
  }
  push(spec, now) {
    const { lo, hi } = this;
    let pk = lo, pdb = -Infinity;
    for (let i = lo; i <= hi; i++) if (spec[i] > pdb) { pdb = spec[i]; pk = i; }
    // Median of the band as the "everything else" floor.
    const n = hi - lo + 1;
    if (!this.sorted || this.sorted.length !== n) this.sorted = new Float32Array(n);
    for (let i = 0; i < n; i++) this.sorted[i] = spec[lo + i];
    this.sorted.sort();
    const median = this.sorted[n >> 1];
    // Strength of the 2nd and 3rd harmonics relative to the peak.
    const harm = k => { const b = Math.round(pk * k); return b < spec.length - 1 ? Math.max(spec[b - 1], spec[b], spec[b + 1]) : -160; };
    const harmonicGap = pdb - Math.max(harm(2), harm(3));
    // Peak should be narrow: neighbours 3 bins away well below it.
    const narrow = pdb - Math.max(spec[pk - 3] ?? -160, spec[pk + 3] ?? -160);
    const candidate = pdb > -42 && pdb - median > 32 && harmonicGap > 22 && narrow > 14;

    if (candidate) {
      if (this.track && Math.abs(this.track.bin - pk) <= 1) {
        this.track.lastDb = pdb; this.track.bin = pk;
      } else {
        this.track = { bin: pk, since: now, firstDb: pdb, lastDb: pdb };
      }
    } else if (this.track && now - this.track.since > 0 && !this.active) {
      this.track = null;
    }
    let howling = false;
    if (candidate && this.track) {
      const held = now - this.track.since;
      const growing = this.track.lastDb - this.track.firstDb > 5;
      howling = (held > 220 && (growing || pdb > -18)) || held > 650;
    }
    if (howling) { this.active = true; this.clearAt = now + 1600; this.hz = this.track.bin * this.binHz; }
    else if (this.active && now > this.clearAt) { this.active = false; this.track = null; }
    return { active: this.active, hz: this.hz || 0, onset: howling && !this.wasHowling ? true : false, howling: (this.wasHowling = howling) };
  }
}

/**
 * Melody scoring for songs that carry their tune (the built-in sing-alongs).
 * Octave-agnostic: singing an octave below or above counts.
 */
export class Scorer {
  constructor(notes) { this.notes = notes || []; this.reset(); }
  reset() { this.hit = 0; this.total = 0; this.i = 0; this.streak = 0; }
  target(t) {
    const N = this.notes;
    while (this.i > 0 && N[this.i].t > t) this.i--;
    while (this.i < N.length - 1 && N[this.i].end <= t) this.i++;
    const n = N[this.i];
    return n && n.t <= t && t < n.end ? n : null;
  }
  /** Call ~30x/s while playing. sungMidi may be null (silence). Returns cents off or null. */
  push(t, dt, sungMidi) {
    const n = this.target(t);
    if (!n || t - n.t < 0.08) return null; // give singers a moment to land each note
    this.total += dt;
    if (sungMidi == null) { this.streak = 0; return null; }
    let diff = sungMidi - n.midi;
    diff = ((diff % 12) + 18) % 12 - 6; // fold octaves into -6..+6
    if (Math.abs(diff) <= 1) { this.hit += dt * (Math.abs(diff) <= .5 ? 1 : .6); this.streak += dt; }
    else this.streak = 0;
    return diff * 100;
  }
  get percent() { return this.total > 0 ? Math.round(100 * this.hit / this.total) : 0; }
}
