// Renders synced lyrics (the karaoke wipe) and the melody lane. Used by both the main window
// and the stage screen, so it only depends on the data it is given.
import { lineAt, wordsFor, wordProgress } from './lyrics.js';
import { h } from './util.js';

export class LyricsView {
  constructor(root, { onLineChange } = {}) {
    this.root = root;
    this.onLineChange = onLineChange;
    this.lines = [];
    this.idx = -2;
    this.shownIdx = -2;
    this.opts = { nextLine: true, reduceMotion: false };
    this.cur = h('p.ly-line.ly-cur', { 'aria-hidden': 'true' });
    this.next = h('p.ly-line.ly-next', { 'aria-hidden': 'true' });
    this.count = h('div.ly-count', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
    this.root.replaceChildren(this.count, this.cur, this.next);
  }
  setOptions(o) {
    Object.assign(this.opts, o);
    this.next.hidden = !this.opts.nextLine;
    this.root.classList.toggle('still', !!this.opts.reduceMotion);
  }
  setLines(lines) {
    this.lines = (lines || []).filter(l => isFinite(l.t));
    this.lines.forEach(l => wordsFor(l));
    this.idx = -2; this.shownIdx = -2;
    this.cur.replaceChildren(); this.next.replaceChildren();
    this.root.classList.toggle('empty', !this.lines.length);
  }
  fill(el, line) {
    el.replaceChildren(...(line ? line.words.map(w => h('span.w', { dataset: { w: w.text } }, w.text)) : []));
    el._line = line || null;
  }
  render(t) {
    const L = this.lines;
    if (!L.length) return;
    let i = lineAt(L, t);
    const line = L[i];
    // Between lines: once a line has finished and the next is a while off, preview the next.
    let showing = i;
    const nextLine = L[i + 1];
    if (i < 0) showing = 0;
    else if (line && t > line.end + .6 && nextLine && nextLine.t - t < 6) showing = i + 1;
    else if (line && t > line.end + 1.5 && nextLine) showing = i + 1;
    if (showing !== this.shownIdx) {
      const forward = showing === this.shownIdx + 1;
      this.shownIdx = showing;
      this.fill(this.cur, L[showing]);
      this.fill(this.next, L[showing + 1]);
      if (forward && !this.opts.reduceMotion) {
        this.cur.classList.remove('rise'); void this.cur.offsetWidth; this.cur.classList.add('rise');
      }
    }
    if (i !== this.idx) { this.idx = i; if (i >= 0 && this.onLineChange) this.onLineChange(L[i], i); }
    // Wipe.
    const cl = this.cur._line;
    if (cl) {
      const spans = this.cur.children;
      for (let k = 0; k < cl.words.length; k++) {
        const p = this.opts.reduceMotion ? (t >= cl.words[k].t ? 1 : 0) : wordProgress(cl.words[k], t);
        const s = spans[k];
        if (s && s._p !== p) { s._p = p; s.style.setProperty('--p', p.toFixed(3)); }
      }
    }
    // Count-in dots before a line that follows a gap.
    const target = L[showing];
    const prevEnd = showing > 0 ? L[showing - 1].end : 0;
    const wait = target ? target.t - t : 0;
    const gap = target ? target.t - prevEnd : 0;
    const dots = target && wait > 0 && wait <= 3.2 && gap >= 3 ? Math.ceil(wait) : 0;
    if (dots !== this.dots) {
      this.dots = dots;
      [...this.count.children].forEach((d, k) => d.classList.toggle('on', k < dots));
      this.count.classList.toggle('show', dots > 0);
    }
  }
}

/** Melody lane: target notes scroll right-to-left past a playhead; the singer's pitch trails behind. */
export class PitchLane {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.notes = []; this.trail = [];
    this.lo = 55; this.hi = 76;
  }
  setNotes(notes) {
    this.notes = notes || []; this.trail = [];
    if (this.notes.length) {
      const ms = this.notes.map(n => n.midi);
      this.lo = Math.min(...ms) - 3; this.hi = Math.max(...ms) + 3;
    }
    this.c.hidden = !this.notes.length;
  }
  pushSung(t, midi) {
    this.trail.push({ t, midi });
    if (this.trail.length > 400) this.trail.splice(0, this.trail.length - 400);
  }
  render(t, colors) {
    const c = this.c, g = this.g;
    if (c.hidden) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    g.clearRect(0, 0, W, H);
    const past = 2, ahead = 5;
    const px = W / (past + ahead);
    const x = tt => (tt - t + past) * px;
    const span = this.hi - this.lo;
    const y = m => H - ((m - this.lo) / span) * H;
    const rowH = Math.max(4, H / span * .8);
    // Fold the sung pitch into the octave nearest the current target so low/high voices both fit.
    const near = (m, ref) => ref == null ? m : m + 12 * Math.round((ref - m) / 12);
    let ref = null;
    g.lineCap = 'round';
    for (const n of this.notes) {
      if (n.end < t - past || n.t > t + ahead) continue;
      if (n.t <= t && t < n.end) ref = n.midi;
      const x0 = x(n.t) + 2, x1 = x(n.end) - 2, yy = y(n.midi);
      g.fillStyle = n.end < t ? colors.past : colors.note;
      roundRect(g, x0, yy - rowH / 2, Math.max(rowH, x1 - x0), rowH, rowH / 2);
    }
    // Playhead.
    g.fillStyle = colors.head; g.fillRect(x(t) - dpr, 0, 2 * dpr, H);
    // Trail.
    for (let k = 0; k < this.trail.length; k++) {
      const p = this.trail[k];
      if (p.t < t - past) continue;
      const target = this.notes.find(n => n.t <= p.t && p.t < n.end);
      const m = near(p.midi, target ? target.midi : ref);
      const on = target && Math.abs(m - target.midi) <= .5;
      g.fillStyle = on ? colors.hit : colors.sung;
      g.beginPath(); g.arc(x(p.t), y(m), (on ? 3.5 : 2.5) * dpr, 0, Math.PI * 2); g.fill();
    }
  }
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  g.fill();
}
