// Stage screen: a second window (TV, projector) that shows only the video and lyrics.
// It follows the main window over a BroadcastChannel. For YouTube songs it hosts the
// player itself (one audible player, on the big screen) and reports time back.
import { $ } from './util.js';
import { LyricsView, PitchLane } from './lyrics-view.js';
import { YTPlayer } from './youtube.js';

export function startStage() {
  document.title = 'Kami-oke — Stage';
  const chan = new BroadcastChannel('brk-stage');
  const send = m => chan.postMessage(m);
  const stageEl = $('#stage');
  const vid = $('#vid');
  const view = new LyricsView($('#lyrics'));
  const lane = new PitchLane($('#lane'));
  let clock = { t: 0, vt: 0, at: performance.now(), playing: false, rate: 1 };
  let ytMode = false;
  const yt = new YTPlayer($('#yt'), {
    onState: s => report(s.ended),
    onTitle: () => report(false),
    onError: (message, code) => send({ type: 'yt-error', message, code }),
  });
  function report(ended) {
    send({ type: 'yt-state', t: yt.time, d: yt.duration, playing: yt.playing, title: yt.title, ended: !!ended });
  }
  setInterval(() => { if (ytMode) report(false); }, 250);

  const idle = (big, small = '') => {
    $('#idle').hidden = false;
    $('#idle .idle-big').textContent = big;
    $('#idle .idle-small').textContent = small;
  };
  idle('Kami-oke', '');

  chan.onmessage = e => {
    const m = e.data;
    switch (m.type) {
      case 'settings':
        document.documentElement.dataset.theme = m.theme;
        document.documentElement.classList.toggle('plain-font', !m.hyperFont);
        $('#lyrics').style.setProperty('--size', m.lyricSize / 100);
        view.setOptions({ nextLine: m.nextLine, reduceMotion: m.reduceMotion });
        break;
      case 'song': {
        $('#upnext').hidden = true;
        stageEl.classList.remove('has-video', 'has-yt', 'no-video');
        if (!m.song) { idle('Kami-oke'); break; }
        $('#idle').hidden = true;
        if (m.song.kind !== 'yt') { ytMode = false; yt.stop(); $('#yt').hidden = true; }
        if (m.song.video) {
          stageEl.classList.add('has-video');
          if (vid.getAttribute('src') !== m.song.video) vid.src = m.song.video;
        } else {
          vid.removeAttribute('src'); vid.load();
          stageEl.classList.add(m.song.kind === 'yt' ? 'has-yt' : 'no-video');
        }
        view.setLines(m.lines);
        lane.setNotes(m.notes);
        if (!m.lines.length && m.song.kind !== 'yt') idle(m.song.title, m.song.singer ? 'Singer: ' + m.song.singer : '');
        break;
      }
      case 'time':
        clock = { t: m.t, vt: m.vt, at: performance.now(), playing: m.playing, rate: m.rate };
        if (vid.getAttribute('src')) {
          vid.playbackRate = m.rate;
          if (m.playing && vid.paused) vid.play().catch(() => {});
          if (!m.playing && !vid.paused) vid.pause();
          if (Math.abs(vid.currentTime - m.vt) > .15) { try { vid.currentTime = m.vt; } catch {} }
        }
        break;
      case 'pitch': lane.pushSung(m.t, m.midi); break;
      case 'howl':
        $('#howl').dataset.on = String(m.on);
        break;
      case 'upnext': {
        const box = $('#upnext');
        if (m.hide) { box.hidden = true; break; }
        box.hidden = false;
        $('#upnextWho').textContent = m.who;
        $('#upnextTitle').textContent = m.title;
        box.classList.toggle('held', m.left == null);
        box.style.setProperty('--left', m.left == null ? 1 : Math.max(0, m.left / m.total));
        box.querySelector('.upnext-count').textContent = m.left == null ? '' : `Starting in ${m.left >= 60 ? Math.floor(m.left / 60) + ':' + String(m.left % 60).padStart(2, '0') : m.left + ' s'}`;
        break;
      }
      case 'ended':
        idle('Thanks for singing!', '');
        view.setLines([]); lane.setNotes([]);
        break;
      case 'yt':
        handleYT(m);
        break;
      case 'close':
        window.close();
        break;
    }
  };

  function handleYT(m) {
    switch (m.cmd) {
      case 'load':
        ytMode = true;
        $('#idle').hidden = true;
        $('#yt').hidden = false;
        stageEl.classList.add('has-yt');
        if (m.vol != null) yt.setVolume(m.vol);
        yt.load(m.arg, { autoplay: true, start: m.at || 0 }).then(() => { if (m.rate) yt.setRate(m.rate); });
        break;
      case 'play': yt.play(); break;
      case 'pause': yt.pause(); break;
      case 'seek': yt.seek(m.arg); break;
      case 'volume': yt.setVolume(m.arg); break;
      case 'rate': yt.setRate(m.arg); break;
      case 'stop': ytMode = false; yt.stop(); $('#yt').hidden = true; break;
    }
  }

  const colors = { note: 'rgba(255,255,255,.28)', past: 'rgba(255,255,255,.12)', head: '#ffb21e', hit: '#6fe3a3', sung: '#ff6f9a' };
  function frame() {
    requestAnimationFrame(frame);
    if (ytMode) return;
    const t = clock.t + (clock.playing ? (performance.now() - clock.at) / 1000 * clock.rate : 0);
    view.render(t);
    lane.render(t, colors);
  }
  requestAnimationFrame(frame);

  // Double-click or F toggles fullscreen on the TV.
  const fs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  document.addEventListener('dblclick', fs);
  document.addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') fs(); if (e.key === 'Escape' && !document.fullscreenElement) window.close(); });
  window.addEventListener('pagehide', () => send({ type: 'bye' }));
  send({ type: 'hello' });
}
