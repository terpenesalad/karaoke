// Built-in sing-alongs. Every song here is in the public domain (words and tune first
// published before 1929); the arrangements are original and synthesised on the fly, so the
// app ships with no audio files. Each song carries its melody, which gives us syllable-timed
// lyrics for free and lets us score the singer's pitch.

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name) {
  const m = /^([A-G])(b|#)?(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return 12 * (parseInt(m[3], 10) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

// Melody lines: each entry is [syllable, note, beats]. A syllable ending in '-' joins the next
// one without a space. A '~' syllable holds the previous syllable over a new note (melisma).
// [null, null, beats] is a rest. '{name}' is replaced by the singer's name.
// Chords: one entry per bar, or [chord, chord] for two per bar, matching `beatsPerBar`.

export const DEMOS = [
  {
    id: 'demo-birthday',
    title: 'Happy Birthday',
    artist: 'Traditional (1893 / 1912)',
    bpm: 96, beatsPerBar: 3, key: 'F', style: 'waltz', needsName: true,
    intro: ['F', 'C7'],
    pickup: 1,
    sections: [[
      [['Hap-', 'C4', .75], ['py ', 'C4', .25], ['birth-', 'D4', 1], ['day ', 'C4', 1], ['to ', 'F4', 1], ['you', 'E4', 2]],
      [['Hap-', 'C4', .75], ['py ', 'C4', .25], ['birth-', 'D4', 1], ['day ', 'C4', 1], ['to ', 'G4', 1], ['you', 'F4', 2]],
      [['Hap-', 'C4', .75], ['py ', 'C4', .25], ['birth-', 'C5', 1], ['day ', 'A4', 1], ['dear ', 'F4', 1], ['{name}', 'E4', 1], ['~', 'D4', 1]],
      [['Hap-', 'Bb4', .75], ['py ', 'Bb4', .25], ['birth-', 'A4', 1], ['day ', 'F4', 1], ['to ', 'G4', 1], ['you!', 'F4', 3]],
    ]],
    chords: ['F', 'C', 'C', 'F', 'F7', 'Bb', ['F', 'C7'], 'F', 'F'],
  },
  {
    id: 'demo-twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    artist: 'Jane Taylor (1806), traditional tune',
    bpm: 100, beatsPerBar: 4, key: 'C', style: 'lullaby',
    intro: ['C', 'G'],
    pickup: 0,
    sections: (() => {
      const A = w => [[w[0], 'C4', 1], [w[1], 'C4', 1], [w[2], 'G4', 1], [w[3], 'G4', 1], [w[4], 'A4', 1], [w[5], 'A4', 1], [w[6], 'G4', 2]];
      const B = w => [[w[0], 'F4', 1], [w[1], 'F4', 1], [w[2], 'E4', 1], [w[3], 'E4', 1], [w[4], 'D4', 1], [w[5], 'D4', 1], [w[6], 'C4', 2]];
      const C = w => [[w[0], 'G4', 1], [w[1], 'G4', 1], [w[2], 'F4', 1], [w[3], 'F4', 1], [w[4], 'E4', 1], [w[5], 'E4', 1], [w[6], 'D4', 2]];
      const twinkle = ['Twin-', 'kle, ', 'twin-', 'kle, ', 'lit-', 'tle ', 'star,'];
      const wonder = ['How ', 'I ', 'won-', 'der ', 'what ', 'you ', 'are!'];
      return [
        [A(twinkle), B(wonder),
         C(['Up ', 'a-', 'bove ', 'the ', 'world ', 'so ', 'high,']),
         C(['Like ', 'a ', 'dia-', 'mond ', 'in ', 'the ', 'sky.']),
         A(twinkle), B(wonder)],
        [A(['When ', 'the ', 'bla-', 'zing ', 'sun ', 'is ', 'gone,']),
         B(['When ', 'he ', 'no-', 'thing ', 'shines ', 'up-', 'on,']),
         C(['Then ', 'you ', 'show ', 'your ', 'lit-', 'tle ', 'light,']),
         C(['Twin-', 'kle, ', 'twin-', 'kle, ', 'all ', 'the ', 'night.']),
         A(twinkle), B(wonder)],
      ];
    })(),
    chords: (() => {
      const v = [['C', 'C'], ['F', 'C'], ['F', 'C'], ['G', 'C'], ['C', 'F'], ['C', 'G'], ['C', 'F'], ['C', 'G'], ['C', 'C'], ['F', 'C'], ['F', 'C'], ['G', 'C']];
      return [...v, ...v, 'C'];
    })(),
  },
  {
    id: 'demo-rowboat',
    title: 'Row, Row, Row Your Boat',
    artist: 'Traditional (1852)',
    bpm: 92, beatsPerBar: 4, key: 'C', style: 'shuffle',
    intro: ['C', 'G7'],
    pickup: 0,
    sections: (() => {
      const t = 1 / 3;
      const verse = () => [
        [['Row, ', 'C4', 1], ['row, ', 'C4', 1], ['row ', 'C4', 2 * t], ['your ', 'D4', t], ['boat', 'E4', 1]],
        [['Gent-', 'E4', 2 * t], ['ly ', 'D4', t], ['down ', 'E4', 2 * t], ['the ', 'F4', t], ['stream.', 'G4', 2]],
        [['Mer-', 'C5', t], ['ri-', 'C5', t], ['ly, ', 'C5', t], ['mer-', 'G4', t], ['ri-', 'G4', t], ['ly, ', 'G4', t],
         ['mer-', 'E4', t], ['ri-', 'E4', t], ['ly, ', 'E4', t], ['mer-', 'C4', t], ['ri-', 'C4', t], ['ly,', 'C4', t]],
        [['Life ', 'G4', 2 * t], ['is ', 'F4', t], ['but ', 'E4', 2 * t], ['a ', 'D4', t], ['dream.', 'C4', 2]],
      ];
      return [verse(), verse(), verse()];
    })(),
    chords: (() => {
      const v = ['C', 'C', 'C', ['G7', 'C']];
      return [...v, ...v, ...v, 'C'];
    })(),
  },
  {
    id: 'demo-clementine',
    title: 'Oh My Darling, Clementine',
    artist: 'Traditional (1884)',
    bpm: 112, beatsPerBar: 3, key: 'F', style: 'waltz',
    intro: ['F', 'C7'],
    pickup: 1,
    sections: (() => {
      // Both halves of the tune take 15 syllables; verses and chorus share it.
      const h1 = ['F4', 'F4', 'F4', 'C4', 'A4', 'A4', 'A4', 'F4', 'F4', 'A4', 'C5', 'C5', 'Bb4', 'A4', 'G4'];
      const h2 = ['G4', 'A4', 'Bb4', 'Bb4', 'A4', 'G4', 'A4', 'F4', 'F4', 'A4', 'G4', 'C4', 'E4', 'G4', 'F4'];
      const beats = [.75, .25, 1, 1, .75, .25, 1, 1, .75, .25, 1, 1, .75, .25, 2];
      // Each half is 12 beats including its 1-beat pickup, so sections stay on the bar line.
      const half = (notes, syl) => syl.map((s, i) => [s, notes[i], beats[i]]);
      const sect = (a, b) => [half(h1, a), half(h2, b)];
      const chorus = sect(
        ['Oh ', 'my ', 'dar-', 'ling, ', 'oh ', 'my ', 'dar-', 'ling, ', 'oh ', 'my ', 'dar-', 'ling ', 'Clem-', 'en-', 'tine,'],
        ['You ', 'are ', 'lost ', 'and ', 'gone ', 'for-', 'ev-', 'er, ', 'dread-', 'ful ', 'sor-', 'ry, ', 'Clem-', 'en-', 'tine.']);
      return [
        sect(['In ', 'a ', 'cav-', 'ern, ', 'in ', 'a ', 'can-', 'yon, ', 'ex-', 'ca-', 'va-', 'ting ', 'for ', 'a ', 'mine,'],
             ['Dwelt ', 'a ', 'min-', 'er, ', 'for-', 'ty-', 'nin-', 'er, ', 'and ', 'his ', 'daugh-', 'ter ', 'Clem-', 'en-', 'tine.']),
        chorus,
        sect(['Light ', 'she ', 'was ', 'and ', 'like ', 'a ', 'fai-', 'ry, ', 'and ', 'her ', 'shoes ', 'were ', 'num-', 'ber ', 'nine,'],
             ['Her-', 'ring ', 'box-', 'es, ', 'with-', 'out ', 'top-', 'ses, ', 'san-', 'dals ', 'were ', 'for ', 'Clem-', 'en-', 'tine.']),
        chorus,
      ];
    })(),
    // 8 bars per section (bar 0 = first downbeat after the pickup).
    chords: (() => {
      const s = ['F', 'F', 'F', 'C7', 'C7', 'F', 'C7', 'F'];
      return [...s, ...s, ...s, ...s, 'F'];
    })(),
  },
];

/* ------------------------------------------------------------------ timeline */

/** Lay the song out in seconds: lyric lines (syllable words), melody notes, and section info. */
export function layout(song, name = 'friend', transpose = 0) {
  const spb = 60 / song.bpm;
  const introBeats = song.intro.length * song.beatsPerBar;
  let beat = introBeats - (song.pickup || 0);
  const lines = [], notes = [];
  for (const section of song.sections) {
    for (const line of section) {
      const words = [];
      for (const [syl, note, beats] of line) {
        const t = beat * spb, end = (beat + beats) * spb;
        beat += beats;
        if (note) notes.push({ t, end, midi: midi(note) + transpose });
        if (syl == null) continue;
        if (syl === '~' && words.length) { words[words.length - 1].end = end; continue; }
        let text = syl.replace('{name}', name);
        if (text.endsWith('-')) text = text.slice(0, -1);
        words.push({ t, end, text });
      }
      // Hold the last syllable's colour until its note ends; tidy trailing space.
      if (words.length) {
        words[words.length - 1].text = words[words.length - 1].text.trimEnd();
        lines.push({ t: words[0].t, end: words[words.length - 1].end, text: words.map(w => w.text).join(''), words });
      }
    }
  }
  const songBeats = introBeats + song.chords.length * song.beatsPerBar;
  return { lines, notes, spb, introBeats, duration: songBeats * spb + 2.5 };
}

/* ------------------------------------------------------------------- chords */

const CHORD_SHAPES = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
function chordNotes(name, transpose = 0) {
  const m = /^([A-G])(b|#)?(m7|maj7|m|7)?$/.exec(name);
  const root = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + transpose;
  return { root, tones: CHORD_SHAPES[m[3] || ''].map(i => root + i) };
}
// Voice chord tones close to middle C (MIDI 55..67) for smooth movement.
function voicing(tones) {
  return tones.map(pc => { let n = 48 + ((pc % 12) + 12) % 12; while (n < 55) n += 12; return n; }).sort((a, b) => a - b);
}
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

/* ------------------------------------------------------------------ renderer */

// The band is synthesised sample-by-sample in plain JS (additive synthesis, so only the
// samples a note actually covers cost anything), then a tiny OfflineAudioContext adds the
// room reverb and a gentle limiter. A one-minute song renders in well under a second.

const TABN = 4096;
const SINE = new Float32Array(TABN + 1);
for (let i = 0; i <= TABN; i++) SINE[i] = Math.sin(2 * Math.PI * i / TABN);

function makeRand(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * 2 - 1;
}

class Mix {
  constructor(len, sr) {
    this.sr = sr; this.len = len;
    this.L = new Float32Array(len); this.R = new Float32Array(len); this.S = new Float32Array(len); // S = reverb send
    this.rand = makeRand(12345);
  }
  /**
   * Additive voice. amps: harmonic amplitudes (1st = fundamental). darken: how much faster
   * upper harmonics fade (piano-like). vib: vibrato depth as a fraction of pitch.
   */
  tone(t, dur, f, { amps, attack = .005, decay = .3, sustain = .4, release = .12, darken = 0, pan = 0, gain = 1, send = .25, vib = 0 }) {
    const sr = this.sr, i0 = Math.max(0, Math.floor(t * sr));
    const n = Math.min(this.len - i0, Math.floor((dur + release * 5) * sr));
    if (n <= 0) return;
    const gl = Math.cos((pan + 1) * Math.PI / 4) * gain, gr = Math.sin((pan + 1) * Math.PI / 4) * gain;
    const H = amps.length, ph = new Float64Array(H), inc = new Float64Array(H), amp = new Float64Array(H), dm = new Float64Array(H);
    let used = 0;
    for (let k = 0; k < H; k++) {
      if (f * (k + 1) > sr * .45) break;
      inc[k] = f * (k + 1) / sr * TABN; amp[k] = amps[k]; dm[k] = Math.exp(-darken * k / sr); used = k + 1;
    }
    const aN = Math.max(1, Math.floor(attack * sr)), dN = Math.floor(dur * sr);
    const dk = Math.exp(-1 / (decay * sr)), rk = Math.exp(-1 / (release * sr));
    const vibInc = 5.2 / sr * TABN;
    let env = 0, dec = 1, rel = 1, vph = 0;
    const { L, R, S } = this;
    for (let s = 0; s < n; s++) {
      if (s < aN) env = s / aN; else { dec *= dk; env = sustain + (1 - sustain) * dec; }
      if (s >= dN) rel *= rk;
      let fm = 1;
      if (vib) { vph += vibInc; fm = 1 + vib * SINE[(vph | 0) & (TABN - 1)] * Math.min(1, s / (.35 * sr)); }
      let v = 0;
      for (let k = 0; k < used; k++) {
        ph[k] += inc[k] * fm;
        v += amp[k] * SINE[(ph[k] | 0) & (TABN - 1)];
        amp[k] *= dm[k];
      }
      v *= env * rel;
      const i = i0 + s;
      L[i] += v * gl; R[i] += v * gr; S[i] += v * send * gain;
    }
  }
  kick(t, g = 1) {
    const sr = this.sr, i0 = Math.floor(t * sr), n = Math.min(this.len - i0, Math.floor(.35 * sr));
    let ph = 0;
    for (let s = 0; s < n; s++) {
      const tt = s / sr;
      const f = 42 + 88 * Math.exp(-tt / .03);
      ph += f / sr * TABN;
      const v = SINE[(ph | 0) & (TABN - 1)] * Math.exp(-tt / .09) * .55 * g;
      this.L[i0 + s] += v; this.R[i0 + s] += v; this.S[i0 + s] += v * .05;
    }
  }
  /** Filtered noise burst (state-variable filter). mode: 'bp' | 'hp' */
  noise(t, { f = 2000, q = .8, mode = 'bp', amp = .2, decay = .12, pan = 0, send = .1 }) {
    const sr = this.sr, i0 = Math.floor(t * sr), n = Math.min(this.len - i0, Math.floor(decay * 6 * sr));
    const F = 2 * Math.sin(Math.PI * Math.min(f, sr / 6) / sr), damp = 1 / Math.max(.5, q);
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    let low = 0, band = 0;
    const k = Math.exp(-1 / (decay * sr));
    let env = amp;
    for (let s = 0; s < n; s++) {
      const x = this.rand();
      low += F * band; const high = x - low - damp * band; band += F * high;
      const v = (mode === 'hp' ? high : band) * env;
      env *= k;
      this.L[i0 + s] += v * gl; this.R[i0 + s] += v * gr; this.S[i0 + s] += v * send;
    }
  }
}

// Harmonic recipes.
const KEYS = [1, .5, .32, .2, .12, .08, .05, .03];                 // soft electric piano
const BASS = [1, .45, .12, .05];
const GUIDE = (() => {                                               // "ooh" vowel: formants ~420 and ~900 Hz
  const out = [];
  for (let k = 1; k <= 14; k++) out.push(1 / Math.pow(k, .6));
  return out;
})();
function guideAmps(f) {
  const form = (x, c, b) => 1 / (1 + ((x - c) / b) ** 2);
  const a = GUIDE.map((g, i) => { const fk = f * (i + 1); return g * (form(fk, 420, 140) + .7 * form(fk, 900, 180) + .12); });
  const norm = a.reduce((s, x) => s + x, 0);
  return a.map(x => x / norm * 1.6);
}

/**
 * Render the backing track. Accompaniment sits left/right of centre; the guide melody sits
 * dead centre, so the vocal-cut control removes it like a real lead vocal. Returns an AudioBuffer.
 */
export async function renderDemo(song, sampleRate = 44100, transpose = 0) {
  const lay = layout(song, 'friend', transpose);
  const spb = lay.spb, bpb = song.beatsPerBar;
  const len = Math.ceil(lay.duration * sampleRate);
  const mx = new Mix(len, sampleRate);
  const key = (m, t, dur, vel, pan) => mx.tone(t, dur, hz(m), { amps: KEYS, attack: .004, decay: .35, sustain: .25, release: .14, darken: 9, pan, gain: .085 * vel, send: .3 });
  const bass = (m, t, dur) => mx.tone(t, dur, hz(m), { amps: BASS, attack: .008, decay: .25, sustain: .55, release: .06, darken: 3, gain: .32, send: .04 });
  const snare = (t, v = 1) => mx.noise(t, { f: 1800, q: .9, amp: .5 * v, decay: .05, pan: .1, send: .15 });
  const hat = (t, v = 1) => mx.noise(t, { f: 7000, mode: 'hp', amp: .09 * v, decay: .012, pan: .45, send: .05 });

  const bars = [...song.intro, ...song.chords];
  let prevV = null;
  bars.forEach((spec, bar) => {
    const t0 = bar * bpb * spb;
    const parts = Array.isArray(spec) ? spec : [spec];
    const span = bpb / parts.length;
    parts.forEach((name, pi) => {
      const ts = t0 + pi * span * spb;
      const { root, tones } = chordNotes(name, transpose);
      let v = voicing(tones);
      if (prevV) {
        const shift = Math.round((prevV[prevV.length - 1] - v[v.length - 1]) / 12) * 12;
        if (Math.abs(shift) === 12) v = v.map(n => n + shift);
      }
      prevV = v;
      const bassRoot = 36 + ((root % 12) + 12) % 12;
      const side = i => (i % 2 ? .85 : -.85);
      if (bar === bars.length - 1) {
        v.forEach((n, i) => key(n, ts, 2.4, .9, side(i)));
        bass(bassRoot, ts, 2.2); mx.kick(ts, .8);
        mx.noise(ts, { f: 6000, mode: 'hp', amp: .05, decay: .5, pan: .45, send: .3 });
        return;
      }
      for (let b = 0; b < span; b++) {
        const tb = ts + b * spb;
        if (song.style === 'waltz') {
          if (b === 0) { bass(bassRoot, tb, spb * .9); mx.kick(tb, .8); }
          else { v.forEach((n, i) => key(n, tb, spb * .5, .7, side(i))); hat(tb, .8); }
        } else if (song.style === 'lullaby') {
          if (b === 0 || (b === 2 && span === 4)) bass(b === 2 ? bassRoot + 7 : bassRoot, tb, spb * 1.8);
          const n = v[(b + pi) % v.length] + (b % 2 ? 12 : 0);
          key(n, tb, spb * 1.3, .6, b % 2 ? .85 : -.85);
          if (b === 0) v.forEach((n2, i) => key(n2 - 12, tb, spb * span * .95, .35, side(i)));
          if (b % 2 === 0) mx.kick(tb, .45);
          hat(tb + spb / 2, .5);
        } else { // shuffle
          if (b === 0 || (b === 2 && span === 4)) bass(b === 2 ? bassRoot + 7 : bassRoot, tb, spb * 1.6);
          v.forEach((n2, i) => key(n2, tb + (b % 2 ? 2 / 3 * spb : 0), spb * .4, .65, side(i)));
          if (b % 2 === 0) mx.kick(tb); else snare(tb, .7);
          hat(tb, .7); hat(tb + 2 / 3 * spb, .45);
        }
      }
    });
  });
  // Count-in clicks on the first intro bar so singers know the tempo.
  for (let b = 0; b < bpb; b++) mx.noise(b * spb, { f: 4200, q: 4, amp: .35, decay: .012, pan: 0, send: 0 });
  // Guide melody, dead centre.
  for (const n of lay.notes) {
    const f = hz(n.midi), d = n.end - n.t;
    mx.tone(n.t, Math.max(.05, d - .03), f, { amps: guideAmps(f), attack: Math.min(.05, d * .3), decay: 1, sustain: 1, release: .05, pan: 0, gain: .2, send: .09, vib: .006 });
  }

  // Room reverb + limiter.
  const ctx = new OfflineAudioContext(2, len, sampleRate);
  const dry = ctx.createBuffer(2, len, sampleRate);
  dry.copyToChannel(mx.L, 0); dry.copyToChannel(mx.R, 1);
  const wet = ctx.createBuffer(1, len, sampleRate);
  wet.copyToChannel(mx.S, 0);
  const irLen = Math.floor(sampleRate * 1.6);
  const ir = ctx.createBuffer(2, irLen, sampleRate);
  const rnd = makeRand(777);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < irLen; i++) d[i] = rnd() * Math.pow(1 - i / irLen, 3.2); }
  const sDry = ctx.createBufferSource(); sDry.buffer = dry;
  const sWet = ctx.createBufferSource(); sWet.buffer = wet;
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
  const wetG = ctx.createGain(); wetG.gain.value = .5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .2;
  const out = ctx.createGain(); out.gain.value = .95;
  sDry.connect(comp); sWet.connect(conv); conv.connect(lp); lp.connect(wetG); wetG.connect(comp);
  comp.connect(out); out.connect(ctx.destination);
  sDry.start(); sWet.start();
  return ctx.startRendering();
}

/** Encode an AudioBuffer (or channel arrays) as a 16-bit PCM WAV Blob. */
export function toWav(channels, sampleRate) {
  const nCh = channels.length, len = channels[0].length;
  const buf = new ArrayBuffer(44 + len * nCh * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * nCh * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = channels[c][i]; s = s < -1 ? -1 : s > 1 ? 1 : s;
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
