/*
 * pitchshift-worker.js - dependency-free, stereo-coherent pitch shifter.
 *
 * Classic Web Worker script (no imports) that is also a CommonJS module for Node tests.
 *
 *   pitchShift(channels, sampleRate, semitones, onProgress?) -> Float32Array[]
 *     channels:   [Float32Array] or [Float32Array, Float32Array] of equal length
 *     semitones:  -12..+12, fractional allowed (0 returns untouched copies)
 *     onProgress: optional fn(value 0..1), called at most ~50 times
 *     returns:    new Float32Array per channel, same length as the input
 *
 *   Worker protocol:
 *     in : {id, channels, sampleRate, semitones}            (channel buffers transferred)
 *     out: {id, type:'progress', value}                     (0..1, <= ~50 messages)
 *          {id, type:'done', channels}                      (output buffers transferred)
 *          {id, type:'error', message}
 *
 * Method: phase-vocoder time stretch by r = 2^(semitones/12), then windowed-sinc resampling
 * by r back to the original length (pitch moves, duration stays).
 *  - FFT size N = power of two nearest sampleRate*0.093 (4096 @ 44.1/48 kHz), hop N/4,
 *    Hann analysis + synthesis windows, overlap-add gain normalised to exactly 1.
 *  - Identity phase locking (Laroche & Dolson 1999): spectral peaks get a properly advanced
 *    phase, every bin in a peak's region of influence inherits that peak's phase rotation.
 *  - Stereo coherence: the per-bin rotation theta(k) = synthPhase - analysisPhase is derived
 *    once from the mid signal (L+R)/2 and applied identically to every channel, so
 *    inter-channel phase/amplitude relations (and therefore L-R centre cancellation) survive
 *    exactly. Bins where the side signal dominates use (L-R)/2 as reference instead; the
 *    rotation is still shared by both channels, so coherence is unaffected.
 *  - Because the rotation is shared, L and R are packed as one complex signal z = L + iR: one
 *    complex FFT analyses both channels and one inverse FFT synthesises both
 *    (Z[k] -> Z[k]e^{i theta}, Z[N-k] -> Z[N-k]e^{-i theta}).
 *  - Input is virtually zero-padded (>= N each side) and frame centres are mapped exactly,
 *    so there is no latency, no edge dip and no click. Resampling is streamed from a small
 *    sliding buffer, so memory stays ~ input + output.
 */
'use strict';

// ------------------------------------------- FFT (iterative radix-4 + one radix-2 stage, in place)
// Forward: X[k] = sum x[n] e^{-2 pi i k n / N}; inverse uses +i and is NOT scaled.
// Input is bit-reversal permuted, then radix-4 passes merge 4 sub-DFTs of length q into length 4q.
function makeFFT(N) {
  const bits = Math.round(Math.log2(N)), rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) { let r = 0; for (let b = 0, v = i; b < bits; b++, v >>= 1) r = (r << 1) | (v & 1); rev[i] = r; }
  const cs = new Float64Array(N), sn = new Float64Array(N);
  for (let i = 0; i < N; i++) { cs[i] = Math.cos(2 * Math.PI * i / N); sn[i] = Math.sin(2 * Math.PI * i / N); }
  return function fft(re, im, inverse) {
    for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    const sg = inverse ? 1 : -1;
    let q = 1;
    if (bits & 1) { // odd log2(N): one radix-2 stage first
      for (let i = 0; i < N; i += 2) { const ar = re[i], ai = im[i], br = re[i + 1], bi = im[i + 1]; re[i] = ar + br; im[i] = ai + bi; re[i + 1] = ar - br; im[i + 1] = ai - bi; }
      q = 2;
    }
    for (; q < N; q <<= 2) {
      const step = N / (4 * q);
      for (let j = 0; j < q; j++) {
        const t1 = j * step, t2 = 2 * t1, t3 = 3 * t1;
        const w1r = cs[t1], w1i = sg * sn[t1], w2r = cs[t2], w2i = sg * sn[t2], w3r = cs[t3], w3i = sg * sn[t3];
        for (let i = j; i < N; i += 4 * q) {
          const i1 = i + q, i2 = i1 + q, i3 = i2 + q; // bit-reversed: blocks hold x0, x2, x1, x3
          const ar = re[i], ai = im[i];
          const br = re[i1] * w2r - im[i1] * w2i, bi = re[i1] * w2i + im[i1] * w2r;
          const cr = re[i2] * w1r - im[i2] * w1i, ci = re[i2] * w1i + im[i2] * w1r;
          const dr = re[i3] * w3r - im[i3] * w3i, di = re[i3] * w3i + im[i3] * w3r;
          const e0r = ar + br, e0i = ai + bi, e1r = ar - br, e1i = ai - bi;
          const o0r = cr + dr, o0i = ci + di, jr = -sg * (ci - di), ji = sg * (cr - dr); // (W1x1 - W3x3) * (+-i)
          re[i] = e0r + o0r; im[i] = e0i + o0i; re[i2] = e0r - o0r; im[i2] = e0i - o0i;
          re[i1] = e1r + jr; im[i1] = e1i + ji; re[i3] = e1r - jr; im[i3] = e1i - ji;
        }
      }
    }
  };
}

// ------------------------------------------------- windowed-sinc polyphase resampling table
function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 60; k++) { term *= (x / (2 * k)) * (x / (2 * k)); sum += term; if (term < sum * 1e-17) break; }
  return sum;
}
// Low-pass at fc (fraction of Nyquist of the source), 16 zero crossings per side, Kaiser beta 8.
// Rows = PHASES+1 fractional offsets; each row normalised to unit DC gain.
function makeSincTable(fc, PHASES) {
  const ZC = 16, BETA = 8;
  const K = Math.ceil(ZC / fc), T = 2 * K, table = new Float64Array((PHASES + 1) * T);
  const i0b = besselI0(BETA);
  for (let q = 0; q <= PHASES; q++) {
    const frac = q / PHASES, row = q * T;
    let sum = 0;
    for (let j = 0; j < T; j++) {
      const t = (j - K + 1) - frac, x = Math.PI * fc * t, u = t / K;
      const win = Math.abs(u) >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - u * u)) / i0b;
      const h = (x === 0 ? fc : fc * Math.sin(x) / x) * win;
      table[row + j] = h; sum += h;
    }
    for (let j = 0; j < T; j++) table[row + j] /= sum;
  }
  return { table, K, T };
}

// ------------------------------------------------------------------------------ main API
function pitchShift(channels, sampleRate, semitones, onProgress) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) throw new Error('pitchShift: expected 1 or 2 channels');
  const C = channels.length, L = channels[0].length;
  for (const ch of channels) if (!(ch instanceof Float32Array) || ch.length !== L) throw new Error('pitchShift: channels must be Float32Arrays of equal length');
  if (!(sampleRate > 0)) throw new Error('pitchShift: invalid sampleRate');
  if (!Number.isFinite(semitones) || Math.abs(semitones) > 12 + 1e-9) throw new RangeError('pitchShift: semitones must be within -12..+12');
  if (semitones === 0 || L === 0) return channels.map(ch => new Float32Array(ch));

  const r = Math.pow(2, semitones / 12);                         // stretch = resample ratio
  const N = 1 << Math.max(8, Math.round(Math.log2(sampleRate * 0.093)));
  const H = N >> 2, NB = N >> 1;                                 // synthesis hop, Nyquist bin
  const fft = makeFFT(N);
  const xL = channels[0], xR = C > 1 ? channels[1] : null;

  const win = new Float64Array(N), wsyn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);         // periodic Hann
    wsyn[i] = win[i] / (1.5 * N);                                // sum(w^2) at 75% overlap = 1.5; 1/N for IFFT
  }
  // Resampler: output n reads the stretched signal at u(n) = (n + N/2) r + N/2 (exact frame-centre map,
  // input virtually padded by N). Cut-off just below the lower of the two Nyquists (anti-alias/anti-image).
  const PH = 4096, { table, K, T } = makeSincTable(0.9 * Math.min(1, 1 / r), PH);
  const uOf = n => (n + N / 2) * r + N / 2;

  // Work buffers (allocated once).
  const zr = new Float64Array(N), zi = new Float64Array(N), pzr = new Float64Array(N), pzi = new Float64Array(N);
  const pow = new Float64Array(NB + 1), theta = new Float64Array(NB + 1);
  const peaks = new Int32Array(NB), tPk = new Float64Array(NB), pCos = new Float64Array(NB), pSin = new Float64Array(NB);
  const B = 4 * N + 4 * T;                                        // sliding stretched-signal buffer
  const S0 = new Float64Array(B), S1 = C > 1 ? new Float64Array(B) : null;
  let sBase = 0;                                                  // stretched index of S[0]
  const out = channels.map(() => new Float32Array(L));

  const TWO_PI = 2 * Math.PI, binW = TWO_PI / N;
  const princ = x => x - TWO_PI * Math.round(x / TWO_PI);
  const totalFrames = Math.ceil((uOf(L - 1) + K) / H) + 1;
  const progEvery = Math.max(1, Math.ceil(totalFrames / 50));
  let nOut = 0, prevA = 0;

  for (let f = 0; nOut < L; f++) {
    // ---- analysis: frame f at padded position a (rounded), actual analysis hop Ha for phase advance
    const a = Math.round(f * H / r), Ha = a - prevA; prevA = a;
    const start = a - N;                                          // original-signal index of frame start
    if (start >= 0 && start + N <= L) {                           // fast path: frame fully inside
      for (let j = 0; j < N; j++) zr[j] = xL[start + j] * win[j];
      if (xR) for (let j = 0; j < N; j++) zi[j] = xR[start + j] * win[j]; else zi.fill(0);
    } else {
      for (let j = 0; j < N; j++) {
        const idx = start + j, inside = idx >= 0 && idx < L;
        zr[j] = inside ? xL[idx] * win[j] : 0;
        zi[j] = inside && xR ? xR[idx] * win[j] : 0;
      }
    }
    fft(zr, zi, false);

    // ---- power spectrum |XL|^2 + |XR|^2, unpacked from Z = XL + i XR
    for (let k = 0; k <= NB; k++) {
      const m = (N - k) & (N - 1), ar = zr[k], ai = zi[k], br = zr[m], bi = zi[m];
      const lr = ar + br, li = ai - bi, rr = ai + bi, ri = br - ar; // 2*XL, 2*XR
      pow[k] = lr * lr + li * li + rr * rr + ri * ri;
    }
    // ---- peak picking: larger than 2 neighbours on each side
    let nP = 0;
    for (let k = 2; k <= NB - 2; k++) {
      const p = pow[k];
      if (p > 1e-24 && p > pow[k - 1] && p >= pow[k + 1] && p > pow[k - 2] && p >= pow[k + 2]) peaks[nP++] = k;
    }
    // ---- phase propagation at peaks: theta(p) = theta_prev(p) + (H - Ha) * trueFreq(p)
    for (let i = 0; i < nP; i++) {
      const k = peaks[i], m = N - k;
      // mid M = (XL+XR)/2, side S = (XL-XR)/2 for current (c) and previous (p) frames (scaled x4, harmless)
      let cr = zr[k] + zr[m] + zi[k] + zi[m], ci = zi[k] - zi[m] + zr[m] - zr[k];
      let pr = pzr[k] + pzr[m] + pzi[k] + pzi[m], pi = pzi[k] - pzi[m] + pzr[m] - pzr[k];
      const sr = zr[k] + zr[m] - zi[k] - zi[m], si = zi[k] - zi[m] - zr[m] + zr[k];
      if (sr * sr + si * si > 4 * (cr * cr + ci * ci)) {          // side-dominated bin: use side as reference
        cr = sr; ci = si;
        pr = pzr[k] + pzr[m] - pzi[k] - pzi[m]; pi = pzi[k] - pzi[m] - pzr[m] + pzr[k];
      }
      let th = 0;                                                 // first frame: rotation 0
      if (Ha > 0) {
        const dphi = Math.atan2(ci * pr - cr * pi, cr * pr + ci * pi); // measured phase advance
        const omega = binW * k, wTrue = omega + princ(dphi - omega * Ha) / Ha; // true frequency
        th = princ(theta[k] + (H - Ha) * wTrue);                  // (phiS_prev + H w) - phiA_now
      }
      tPk[i] = th; pCos[i] = Math.cos(th); pSin[i] = Math.sin(th);
    }
    // save current spectrum as "previous" for the next frame (before rotating Z)
    pzr.set(zr); pzi.set(zi);

    // ---- identity phase locking: every bin takes the rotation of the peak whose region it is in
    if (nP > 0) {
      let lo = 0;
      for (let i = 0; i < nP; i++) {
        let hi = NB;                                              // region end (inclusive)
        if (i + 1 < nP) {                                         // trough between this and next peak
          let mk = peaks[i] + 1;
          for (let k = mk + 1; k < peaks[i + 1]; k++) if (pow[k] < pow[mk]) mk = k;
          hi = mk;
        }
        const c = pCos[i], s = pSin[i], th = tPk[i];
        for (let k = lo; k <= hi; k++) {
          theta[k] = th;
          if (k === 0 || k === NB) continue;                      // keep DC/Nyquist real
          const m = N - k, ar = zr[k], ai = zi[k], br = zr[m], bi = zi[m];
          zr[k] = ar * c - ai * s; zi[k] = ar * s + ai * c;       // Z[k]   * e^{+i th}
          zr[m] = br * c + bi * s; zi[m] = bi * c - br * s;       // Z[N-k] * e^{-i th}
        }
        lo = hi + 1;
      }
    }
    fft(zr, zi, true);

    // ---- overlap-add into the sliding stretched buffer at f*H
    let w0 = f * H - sBase;
    if (w0 + N > B) {                                             // slide: drop what the resampler no longer needs
      const keep = Math.min(f * H, Math.floor(uOf(nOut)) - K + 1);
      const sh = keep - sBase;
      S0.copyWithin(0, sh); S0.fill(0, B - sh);
      if (S1) { S1.copyWithin(0, sh); S1.fill(0, B - sh); }
      sBase = keep; w0 = f * H - sBase;
    }
    for (let j = 0; j < N; j++) S0[w0 + j] += zr[j] * wsyn[j];
    if (S1) for (let j = 0; j < N; j++) S1[w0 + j] += zi[j] * wsyn[j];

    // ---- resample every output sample whose taps are now final (stretched index < (f+1)H)
    const finalEnd = (f + 1) * H;
    const o0 = out[0], o1 = C > 1 ? out[1] : null;
    while (nOut < L) {
      const u = uOf(nOut), i0 = Math.floor(u);
      if (i0 + K >= finalEnd) break;
      const row = Math.round((u - i0) * PH) * T, b = i0 - K + 1 - sBase;
      let acc0 = 0, acc1 = 0;
      if (S1) for (let j = 0; j < T; j++) { const h = table[row + j]; acc0 += S0[b + j] * h; acc1 += S1[b + j] * h; }
      else for (let j = 0; j < T; j++) acc0 += S0[b + j] * table[row + j];
      o0[nOut] = acc0; if (o1) o1[nOut] = acc1;
      nOut++;
    }
    if (onProgress && (f + 1) % progEvery === 0) onProgress(Math.min(1, nOut / L));
  }
  if (onProgress) onProgress(1);
  return out;
}

// ------------------------------------------------------------------------- environments
if (typeof module !== 'undefined' && module.exports) module.exports = { pitchShift };

// Install the message handler only inside a worker (never in Node / CommonJS, never on a window).
if (typeof self !== 'undefined' && typeof module === 'undefined' && typeof importScripts === 'function') {
  self.onmessage = function (e) {
    const { id, channels, sampleRate, semitones } = e.data || {};
    try {
      let last = -1;
      const res = pitchShift(Array.from(channels || []), sampleRate, semitones, v => {
        if (v - last >= 0.02 || v === 1) { last = v; self.postMessage({ id, type: 'progress', value: v }); }
      });
      self.postMessage({ id, type: 'done', channels: res }, res.map(c => c.buffer));
    } catch (err) {
      self.postMessage({ id, type: 'error', message: String(err && err.message || err) });
    }
  };
}
