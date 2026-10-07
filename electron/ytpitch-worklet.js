// Real-time pitch shifter for YouTube audio (key change without changing speed).
// Runs as an AudioWorklet inside the YouTube watch page the desktop app shows.
//
// Phase vocoder with peak-locked shifting (Laroche & Dolson): each spectral peak and the bins
// around it are moved together by a whole number of bins, and rotated in phase so the shifted
// note stays continuous from frame to frame. Keeping each note's shape intact avoids the
// smearing and level drops of shifting bins one by one. 4096-point frames, 8x overlap:
// about 85 ms of delay, which is fine for a backing track.
//
// Also loads in Node (no registerProcessor) so the DSP can be unit-tested.

class PitchShifter {
  constructor(N = 4096, osamp = 8) {
    this.N = N; this.osamp = osamp; this.step = N / osamp;
    this.latency = N - this.step;
    this.ratio = 1;
    const half = N / 2 + 1;
    this.half = half;
    this.inFIFO = new Float32Array(N); this.outFIFO = new Float32Array(N);
    this.accum = new Float32Array(2 * N);
    this.lastPhase = new Float32Array(half);
    this.mag = new Float32Array(half);
    this.aRe = new Float32Array(half); this.aIm = new Float32Array(half);
    this.rot = new Float32Array(half); this.rotNext = new Float32Array(half); // phase rotation per analysis bin
    this.peaks = new Int32Array(half);
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.win = new Float32Array(N);
    for (let i = 0; i < N; i++) this.win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
    this.rev = new Uint32Array(N);
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float32Array(N / 2); this.sin = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / N); this.sin[i] = Math.sin(2 * Math.PI * i / N); }
    this.rover = this.latency;
  }
  setSemitones(st) { this.ratio = Math.pow(2, st / 12); }
  fft(sign) { // in place, complex, sign -1 forward / +1 inverse (unscaled)
    const { re, im, rev, N } = this;
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= N; size <<= 1) {
      const halfSize = size >> 1, stride = N / size;
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < halfSize; k++) {
          const c = this.cos[k * stride], s = sign * this.sin[k * stride];
          const a = start + k, b = a + halfSize;
          const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  }
  frame() {
    const { N, step, re, im, win, half, mag, aRe, aIm, ratio } = this;
    const last = half - 1, expct = 2 * Math.PI * step / N;
    for (let k = 0; k < N; k++) { re[k] = this.inFIFO[k] * win[k]; im[k] = 0; }
    this.fft(-1);
    for (let k = 0; k < half; k++) { aRe[k] = re[k]; aIm[k] = im[k]; mag[k] = Math.hypot(re[k], im[k]); }
    // Peaks: local maxima over ±2 bins.
    let np = 0;
    for (let k = 2; k < last - 1; k++) {
      const m = mag[k];
      if (m > mag[k - 1] && m >= mag[k + 1] && m > mag[k - 2] && m >= mag[k + 2] && m > 1e-9) this.peaks[np++] = k;
    }
    for (let k = 0; k < N; k++) { re[k] = 0; im[k] = 0; }
    this.rotNext.fill(0);
    // Each peak owns the bins from the trough before it to the trough after it.
    let lo = 0;
    for (let n = 0; n < np; n++) {
      const p = this.peaks[n];
      let hi = last;
      if (n + 1 < np) { const q = this.peaks[n + 1]; hi = p; for (let k = p + 1; k < q; k++) if (mag[k] < mag[hi]) hi = k; }
      // True frequency of the peak (in bins) from its phase advance since the last frame.
      const ph = Math.atan2(aIm[p], aRe[p]);
      let d = ph - this.lastPhase[p] - p * expct;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      const f = p + d / expct;
      const shift = Math.round(f * ratio) - p;
      // Phase rotation keeps the moved note continuous: advance by the frequency change each hop.
      const rot = this.rot[p] + expct * (f * ratio - f);
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let k = lo; k <= hi; k++) {
        const j = k + shift;
        if (j < 0 || j > last) continue;
        re[j] += aRe[k] * c - aIm[k] * s;
        im[j] += aRe[k] * s + aIm[k] * c;
        this.rotNext[k] = rot;
      }
      lo = hi + 1;
    }
    for (let k = 0; k < half; k++) this.lastPhase[k] = Math.atan2(aIm[k], aRe[k]);
    [this.rot, this.rotNext] = [this.rotNext, this.rot];
    // Real output: double the positive bins (DC and Nyquist once), zero the negative ones.
    for (let k = 1; k < last; k++) { re[k] *= 2; im[k] *= 2; }
    this.fft(1);
    // Hann analysis × Hann synthesis windows overlap-add to 3/8 × osamp; divide that back out.
    const scale = 1 / (N * .375 * this.osamp);
    for (let k = 0; k < N; k++) this.accum[k] += win[k] * re[k] * scale;
    this.outFIFO.set(this.accum.subarray(0, step));
    this.accum.copyWithin(0, step, step + N); this.accum.fill(0, N);
    this.inFIFO.copyWithin(0, step);
  }
  /** Process one block: reads `inp`, writes `out` (same length). */
  process(inp, out) {
    if (this.ratio === 1) { out.set(inp); return; }
    for (let i = 0; i < inp.length; i++) {
      this.inFIFO[this.rover] = inp[i];
      out[i] = this.outFIFO[this.rover - this.latency];
      if (++this.rover >= this.N) { this.rover = this.latency; this.frame(); }
    }
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor('kamioke-pitch', class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.sh = [new PitchShifter(), new PitchShifter()];
      this.port.onmessage = e => { if (typeof e.data.semitones === 'number') this.sh.forEach(s => s.setSemitones(e.data.semitones)); };
    }
    process(inputs, outputs) {
      const inp = inputs[0], out = outputs[0];
      if (!inp || !inp.length) return true;
      for (let c = 0; c < out.length; c++) this.sh[c].process(inp[Math.min(c, inp.length - 1)], out[c]);
      return true;
    }
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { PitchShifter };
