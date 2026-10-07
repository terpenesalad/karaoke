// Desktop only: plays a YouTube video on YouTube's own watch page, shown over the stage area,
// for uploads that block the embedded player. Same interface as YTPlayer in youtube.js.
// The page sits above the app's own layers, so it is hidden while a dialog is open and
// the feedback warning is drawn inside it.
export class YTPagePlayer {
  constructor(host, stageEl, ev = {}) {
    this.host = host; this.stageEl = stageEl; this.ev = ev;
    this.active = false; this.where = 'main';
    this.s = { t: 0, d: 0, playing: false, title: '' };
    host.ytPage.onState(st => {
      if (!this.active) return;
      if (st.ended) { this.s.playing = false; this.ev.onState?.({ playing: false, ended: true }); return; }
      if (st.keyOk || st.keyFailed) { this.ev.onKey?.(!!st.keyOk, st.keyFailed); return; }
      if (st.blocked) { this.ev.onBlocked?.(st.blocked); return; }
      const was = this.s.playing;
      if (!st.ad) Object.assign(this.s, { t: st.t, d: st.d });
      this.s.playing = st.playing;
      if (st.title && st.title !== this.s.title) { this.s.title = st.title; this.ev.onTitle?.(st.title); }
      if (was !== st.playing) this.ev.onState?.({ playing: st.playing, ended: false });
    });
    const sync = () => this.syncBounds();
    new ResizeObserver(sync).observe(stageEl);
    window.addEventListener('resize', sync);
    document.addEventListener('fullscreenchange', () => requestAnimationFrame(sync));
    // Native page layers draw over HTML, so step aside while any dialog is open.
    new MutationObserver(() => {
      if (this.active) host.ytPage.visible(!document.querySelector('dialog[open]'));
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  bounds() {
    const r = this.stageEl.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  syncBounds() { if (this.active && this.where === 'main') this.host.ytPage.bounds(this.bounds()); }
  async load(id, { start = 0, vol = 80, rate = 1, key = 0, where = 'main' } = {}) {
    this.active = true; this.where = where;
    this.s = { t: start, d: 0, playing: false, title: '' };
    await this.host.ytPage.open({ id, at: start, vol, rate, key, host: where, bounds: this.bounds() });
    this.syncBounds();
  }
  moveTo(where) {
    if (!this.active) return;
    this.where = where;
    this.host.ytPage.host(where);
    this.syncBounds();
  }
  get time() { return this.s.t; }
  get duration() { return this.s.d; }
  get playing() { return this.s.playing; }
  get title() { return this.s.title; }
  play() { this.host.ytPage.cmd('play'); }
  pause() { this.host.ytPage.cmd('pause'); }
  seek(t) { this.s.t = t; this.host.ytPage.cmd('seek', t); }
  setVolume(v) { if (this.active) this.host.ytPage.cmd('volume', v); }
  setRate(r) { if (this.active) this.host.ytPage.cmd('rate', r); }
  setKey(st) { if (this.active) this.host.ytPage.cmd('key', st); }
  howl(on) { if (this.active) this.host.ytPage.cmd('howl', !!on); }
  stop() { if (this.active) { this.active = false; this.host.ytPage.close(); } }
}
