import { $, $$, h, clamp, fmtTime, store, toast, announce, download } from './util.js';
import { P, PARAMS, TOGGLES, saveSettings } from './settings.js';
import { AudioEngine } from './audio.js';
import { parseLRC, findLyricsOnline, guessArtistTitle } from './lyrics.js';
import { LyricsView, PitchLane } from './lyrics-view.js';
import { yin, hzToMidi, noteName, HowlDetector, Scorer } from './pitch.js';
import { DEMOS, layout, renderDemo, toWav } from './demos.js';
import { YTPlayer, parseYouTube } from './youtube.js';
import { YTPagePlayer } from './ytpage.js';
import { Library, renderLibrary, renderQueue, isMedia, isLyricsFile, baseName } from './library.js';
import { renderPane, setupTabs } from './panes.js';
import { initLyricsEditor, openLyricsEditor } from './editor.js';

const isStage = new URLSearchParams(location.search).has('stage');
if (isStage) import('./stage.js').then(m => m.startStage());
else boot();

function boot() {
  const host = window.karaokeHost || null; // present in the desktop app
  document.documentElement.classList.toggle('is-desktop', !!host);

  /* ------------------------------------------------------------------ core */
  const engine = new AudioEngine(P);
  const lib = new Library(host);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  const vid = $('#vid');
  const stageEl = $('#stage');
  const lyricsView = new LyricsView($('#lyrics'), {
    onLineChange: line => { if (P.readLyrics) $('#lyricsLive').textContent = line.text; },
  });
  const lane = new PitchLane($('#lane'));
  const yt = new YTPlayer($('#yt'), {
    onState: s => { if (ytMode() === 'local') { setPlayIcon(s.playing); if (s.ended) songEnded(); } },
    onTitle: t => ytTitle(t),
    onError: (msg, code) => ytFailed(msg, code),
  });

  const app = {
    P, engine, lib, host, audio, yt, lyricsView, lane,
    apply: () => { engine.apply(); applyLook(); saveSettings(); broadcastSettings(); },
    setKey, toggleVocalCut, openLyrics: s => openLyricsEditor(app, s || cur), clearNotches: () => { engine.clearNotches(); toast('Feedback filters cleared'); },
    get cur() { return cur; }, reloadLyrics: () => cur && loadLyricsFor(cur, true), toggleRecord, startMic, refreshPane: () => renderPane(app, currentTab()),
    duration: () => duration(), time: () => now(),
  };

  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('brk-stage') : null;
  const stage = {
    connected: false, win: null, ytRemote: false, ytTime: 0, ytDur: 0, ytPlaying: false,
    send: m => chan && chan.postMessage(m),
  };
  // Desktop only: YouTube's own watch page, for uploads that block the embedded player.
  let blockedNoticeFor = null;
  const ytp = host && host.ytPage ? new YTPagePlayer(host, stageEl, {
    onState: s => { if (ytMode() === 'page') { setPlayIcon(s.playing); if (s.ended) songEnded(); } },
    onTitle: t => ytTitle(t),
    onBlocked: msg => { if (cur && blockedNoticeFor !== cur.id) { blockedNoticeFor = cur.id; toast(`YouTube won’t play this one here either: ${msg}`, 7000); } },
  }) : null;
  // Which YouTube player is driving the current song, if any.
  const ytMode = () => !isYT() ? null : (cur.ytPage && ytp) ? 'page' : stage.ytRemote ? 'remote' : 'local';
  let cur = null;            // current song
  let curLyrics = [];        // parsed lines
  let curNotes = [];         // melody notes (sing-alongs)
  let keyJob = 0;
  const keyCache = new Map();
  let scorer = null;

  /* ------------------------------------------------------------------ look */
  function applyLook() {
    const root = document.documentElement;
    root.dataset.theme = P.theme;
    root.style.fontSize = (P.uiScale / 100 * 16) + 'px';
    root.classList.toggle('plain-font', !P.hyperFont);
    root.classList.toggle('reduce-motion', !!P.reduceMotion);
    $('#lyrics').style.setProperty('--size', P.lyricSize / 100);
    lyricsView.setOptions({ nextLine: P.nextLine, reduceMotion: P.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches });
    lane.c.hidden = !(P.guideMelody && curNotes.length);
    if (host && host.setAdBlock) host.setAdBlock(!!P.adBlock);
  }
  applyLook();

  /* ------------------------------------------------------------------ mixer header */
  const syncFaders = () => {
    for (const id of ['musicVol', 'vocalVol']) {
      $('#' + id).value = P[id]; $('#' + id + 'Val').textContent = P[id];
      $('#' + id).setAttribute('aria-valuetext', P[id] + ' percent');
    }
  };
  syncFaders();
  for (const id of ['musicVol', 'vocalVol']) {
    $('#' + id).addEventListener('input', e => {
      P[id] = +e.target.value; syncFaders(); engine.apply(); saveSettings();
      if (id === 'musicVol') setYTVolume();
    });
  }
  const setYTVolume = () => { yt.setVolume(P.musicVol); if (ytp) ytp.setVolume(P.musicVol); if (stage.ytRemote) stage.send({ type: 'yt', cmd: 'volume', arg: P.musicVol }); };
  setYTVolume();

  async function startMic() {
    try {
      const label = await engine.startMic(P.micDevice || null);
      micUI();
      toast(`Microphone on: ${label}`);
      if (currentTab() === 'voice') renderPane(app, 'voice');
    } catch (e) {
      console.error(e);
      toast(host ? 'The microphone couldn’t start. Check it’s plugged in and allowed in Windows privacy settings.' : 'The microphone is blocked. Allow it in the browser’s site settings, then try again.', 6000);
    }
  }
  function micUI() {
    const b = $('#micBtn');
    b.dataset.state = !engine.micOn ? 'off' : engine.muted ? 'muted' : 'live';
    b.textContent = !engine.micOn ? 'Turn on microphone' : engine.muted ? 'Microphone muted — unmute' : 'Mute microphone';
    b.setAttribute('aria-pressed', engine.micOn && engine.muted ? 'true' : 'false');
  }
  function toggleMute() {
    if (!engine.micOn) return startMic();
    engine.setMuted(!engine.muted); micUI();
    announce(engine.muted ? 'Microphone muted' : 'Microphone on');
  }
  $('#micBtn').onclick = toggleMute;
  if (host && P.micAuto !== false && store.get('brk2-mic-ok')) {
    // Desktop: the mic permission is granted by the app, so bring the mic back on the first click anywhere.
    document.addEventListener('pointerdown', () => { if (!engine.micOn) startMic(); }, { once: true });
  }
  engine.on('mic', on => { if (on) store.set('brk2-mic-ok', true); micUI(); });

  /* ------------------------------------------------------------------ playback */
  const isYT = () => cur && cur.kind === 'yt';
  const now = () => ({ page: () => ytp.time, remote: () => stage.ytTime, local: () => yt.time })[ytMode()]?.() ?? audio.currentTime;
  const duration = () => ({ page: () => ytp.duration, remote: () => stage.ytDur, local: () => yt.duration })[ytMode()]?.() ?? (isFinite(audio.duration) ? audio.duration : 0);
  const playing = () => ({ page: () => ytp.playing, remote: () => stage.ytPlaying, local: () => yt.playing })[ytMode()]?.() ?? !audio.paused;

  function setPlayIcon(on) {
    $('#playPath').setAttribute('d', on ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5v14l11-7z');
    $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  }
  audio.addEventListener('play', () => { setPlayIcon(true); vid.src && vid.play().catch(() => {}); pushTime(); });
  audio.addEventListener('pause', () => { setPlayIcon(false); vid.pause(); pushTime(); });
  audio.addEventListener('seeked', () => { syncVideo(true); pushTime(); });
  audio.addEventListener('ended', () => songEnded());
  audio.addEventListener('error', () => {
    if (!cur || cur.kind === 'yt' || !audio.src) return;
    toast(cur.missing ? 'That file has moved or been deleted. Remove it and add it again.' : 'This file can’t be played. Try MP3, M4A, WAV, OGG, FLAC, MP4 or WebM.', 6000);
  });
  function syncVideo(force) {
    if (!vid.getAttribute('src')) return;
    const d = vid.currentTime - audio.currentTime;
    if (force || Math.abs(d) > .12) { try { vid.currentTime = audio.currentTime; } catch {} }
    vid.playbackRate = audio.playbackRate;
  }

  async function playSong(song, { singer = '', autoplay = true } = {}) {
    if (!song) return;
    if (song.missing) { toast('That file has moved or been deleted. Remove it and add it again.', 5000); return; }
    engine.ensure();
    engine.ctx.resume();
    engine.attachMusic(audio);
    hideUpNext();
    stopAll();
    cur = song;
    cur.singer = singer || $('#singerName').value.trim();
    P.key = store.get('brk2-key:' + song.id, 0);
    P.lyricOffset = store.get('brk2-offset:' + song.id, 0);
    $('#idle').hidden = true;
    stageEl.classList.remove('has-video', 'has-yt', 'no-video');
    curNotes = []; scorer = null; $('#score').hidden = true;
    lane.setNotes([]);
    setNow();
    if (song.kind === 'yt') {
      stageEl.classList.add('has-yt');
      lyricsView.setLines([]); curLyrics = [];
      if (song.ytPage && ytp) {
        const where = stage.connected ? 'stage' : 'main';
        $('#yt').hidden = true; $('#ytRemote').hidden = where !== 'stage';
        await ytp.load(song.ytId, { vol: P.musicVol, rate: P.speed / 100, where });
      } else if (stage.connected) {
        stage.ytRemote = true; stage.ytTime = 0; stage.ytDur = 0;
        $('#ytRemote').hidden = false; $('#yt').hidden = true;
        stage.send({ type: 'yt', cmd: 'load', arg: song.ytId, vol: P.musicVol, rate: P.speed / 100 });
      } else {
        $('#yt').hidden = false; $('#ytRemote').hidden = true;
        yt.setVolume(P.musicVol);
        await yt.load(song.ytId, { autoplay });
        yt.setRate(P.speed / 100);
      }
    } else {
      $('#yt').hidden = true; $('#ytRemote').hidden = true;
      if (song.kind === 'demo') {
        await loadDemo(song, autoplay);
      } else {
        stageEl.classList.add(song.isVideo ? 'has-video' : 'no-video');
        if (song.isVideo) { vid.src = song.src; vid.muted = true; } else vid.removeAttribute('src');
        loadLyricsFor(song);
        await setAudioSource(P.key ? null : song.src, autoplay, 0);
        if (P.key) applyKey(autoplay);
      }
    }
    applyRate();
    applyLook();
    broadcastSong();
    refreshLists();
    if (currentTab() === 'mix' || currentTab() === 'lyrics') renderPane(app, currentTab());
    announce(`Now playing ${song.title}${cur.singer ? ', sung by ' + cur.singer : ''}`);
    if (P.awake) wake(true);
  }

  function setNow() {
    $('#nowTitle').textContent = cur ? cur.title : 'Nothing playing';
    const bits = [];
    if (cur && cur.singer) bits.push('Singer: ' + cur.singer);
    if (cur && cur.artist) bits.push(cur.artist);
    if (cur && P.key) bits.push(`Key ${P.key > 0 ? '+' : ''}${P.key}`);
    $('#nowSub').textContent = bits.join(' — ');
    document.title = cur ? `${cur.title} — Kami-oke` : 'Kami-oke';
  }

  function stopAll() {
    audio.pause();
    vid.pause(); vid.removeAttribute('src'); vid.load();
    yt.stop();
    if (ytp) ytp.stop();
    if (stage.ytRemote) { stage.send({ type: 'yt', cmd: 'stop' }); stage.ytRemote = false; }
  }

  function setAudioSource(src, autoplay, at) {
    return new Promise(res => {
      if (!src) return res();
      const done = () => {
        audio.removeEventListener('loadedmetadata', done);
        if (at) { try { audio.currentTime = at; } catch {} }
        applyRate();
        if (autoplay) audio.play().catch(() => toast('Press play to start'));
        res();
      };
      audio.addEventListener('loadedmetadata', done);
      audio.src = src;
      audio.load();
    });
  }
  function applyRate() {
    audio.playbackRate = P.speed / 100;
    audio.preservesPitch = true;
    vid.playbackRate = P.speed / 100;
    const m = ytMode();
    if (m === 'page') ytp.setRate(P.speed / 100);
    else if (m === 'remote') stage.send({ type: 'yt', cmd: 'rate', arg: P.speed / 100 });
    else if (m === 'local') yt.setRate(P.speed / 100);
  }
  app.applyRate = applyRate;

  /* ---- built-in sing-alongs */
  async function loadDemo(song, autoplay) {
    const d = song.demo;
    stageEl.classList.add('no-video');
    let name = cur.singer || 'friend';
    if (d.needsName) name = await askName(cur.singer);
    const L = layout(d, name, P.key);
    curLyrics = L.lines; curNotes = L.notes;
    lyricsView.setLines(L.lines);
    lane.setNotes(L.notes);
    scorer = new Scorer(L.notes);
    $('#score').hidden = !engine.micOn;
    const k = `${d.id}|${P.key}`;
    let url = keyCache.get(k);
    if (!url) {
      busy('Warming up the band…');
      const buf = await renderDemo(d, 44100, P.key);
      url = URL.createObjectURL(toWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate));
      cacheKey(k, url);
      busy(null);
    }
    if (cur !== song) return;
    await setAudioSource(url, autoplay, 0);
  }
  function askName(def) {
    return new Promise(res => {
      const dlg = $('#dlgName'), inp = $('#bdayName');
      inp.value = def || store.get('brk2-bday', '');
      dlg.onclose = () => { const v = inp.value.trim() || 'friend'; store.set('brk2-bday', v); res(v); };
      dlg.showModal(); inp.select();
    });
  }
  function cacheKey(k, url) {
    keyCache.set(k, url);
    while (keyCache.size > 6) { const [first, u] = keyCache.entries().next().value; URL.revokeObjectURL(u); keyCache.delete(first); }
  }

  /* ---- key change for your own files (offline phase vocoder in a worker) */
  let worker = null;
  function pitchWorker() {
    if (!worker) worker = new Worker('js/pitchshift-worker.js');
    return worker;
  }
  const decoded = new Map();
  async function applyKey(autoplay = !audio.paused) {
    if (!cur || cur.kind === 'yt') return;
    store.set('brk2-key:' + cur.id, P.key);
    setNow();
    if (cur.kind === 'demo') {
      const t = audio.currentTime, wasPlaying = !audio.paused;
      const song = cur;
      const L = layout(song.demo, curLyrics.length ? undefined : 'friend', P.key);
      curNotes = L.notes; lane.setNotes(L.notes); scorer = new Scorer(L.notes);
      const k = `${song.demo.id}|${P.key}`;
      let url = keyCache.get(k);
      if (!url) {
        busy('Changing key…');
        const buf = await renderDemo(song.demo, 44100, P.key);
        url = URL.createObjectURL(toWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate));
        cacheKey(k, url); busy(null);
      }
      if (cur === song) await setAudioSource(url, wasPlaying, t);
      broadcastSong();
      return;
    }
    const song = cur, semis = P.key, job = ++keyJob;
    const k = `${song.id}|${semis}`;
    const t0 = audio.currentTime;
    if (!semis) { await setAudioSource(song.src, autoplay, t0); return; }
    let url = keyCache.get(k);
    if (!url) {
      try {
        busy('Changing key… 0%');
        let buf = decoded.get(song.id);
        if (!buf) {
          const ab = await (await fetch(song.src)).arrayBuffer();
          buf = await engine.ctx.decodeAudioData(ab);
          decoded.clear(); decoded.set(song.id, buf);
        }
        if (job !== keyJob) return;
        const chans = [];
        for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c).slice());
        const out = await new Promise((res, rej) => {
          const w = pitchWorker();
          w.onmessage = e => {
            const m = e.data; if (m.id !== job) return;
            if (m.type === 'progress') busy(`Changing key… ${Math.round(m.value * 100)}%`);
            else if (m.type === 'done') res(m.channels);
            else if (m.type === 'error') rej(new Error(m.message));
          };
          w.postMessage({ id: job, channels: chans, sampleRate: buf.sampleRate, semitones: semis }, chans.map(c => c.buffer));
        });
        if (job !== keyJob) return;
        url = URL.createObjectURL(toWav(out, buf.sampleRate));
        cacheKey(k, url);
      } catch (e) {
        console.error(e);
        busy(null);
        if (job === keyJob) { toast('Couldn’t change the key of this file. Playing it in the original key.', 5000); P.key = 0; setNow(); }
        return;
      }
      busy(null);
    }
    if (job !== keyJob || cur !== song) return;
    const at = audio.src ? audio.currentTime : t0;
    await setAudioSource(url, autoplay, at);
    announce(`Key ${semis > 0 ? 'up ' + semis : 'down ' + -semis}`);
  }
  function setKey(v) {
    if (!cur) { toast('Pick a song first'); return; }
    if (cur.kind === 'yt') { toast('Key change works on your own files and the sing-alongs, not YouTube videos.'); return; }
    P.key = clamp(Math.round(v), -6, 6);
    if (currentTab() === 'mix') renderPane(app, 'mix');
    clearTimeout(setKey.t);
    setKey.t = setTimeout(() => applyKey(), 350); // let rapid presses settle
  }
  let lastCut = 100;
  function toggleVocalCut() {
    if (P.vocalCut > 0) { lastCut = P.vocalCut; P.vocalCut = 0; } else P.vocalCut = lastCut || 100;
    app.apply();
    if (currentTab() === 'mix') renderPane(app, 'mix');
    toast(P.vocalCut ? `Vocal remover on (${P.vocalCut}%)` : 'Vocal remover off');
  }

  function busy(msg) {
    const b = $('#busy');
    b.hidden = !msg;
    if (msg) b.querySelector('.busy-text').textContent = msg;
  }

  /* ---- lyrics */
  async function loadLyricsFor(song, quiet) {
    if (song.kind === 'demo') return;
    let text = store.get('brk2-lrc:' + song.id, null);
    if (!text && host && song.path) {
      text = await host.readSiblingLyrics(song.path).catch(() => null);
      if (text) store.set('brk2-lrc:' + song.id, text);
    }
    if (cur !== song) return;
    setLyricsText(text || '');
    if (!text && !quiet) {
      $('#idle').hidden = true;
      if (!song.isVideo) {
        // Try the open lyrics database quietly in the background.
        const dur = await waitDuration();
        const g = song.artist ? { artist: song.artist, title: song.title } : guessArtistTitle(song.name || song.title);
        const found = navigator.onLine === false ? null : await findLyricsOnline({ ...g, duration: dur });
        if (found && cur === song && !store.get('brk2-lrc:' + song.id)) {
          store.set('brk2-lrc:' + song.id, found);
          setLyricsText(found);
          toast('Found synced lyrics online. Edit them under Lyrics if they’re off.');
        } else if (cur === song && !curLyrics.length) {
          toast('No lyrics for this song yet. Open Lyrics to paste or find them.', 4500);
        }
      }
    }
  }
  function waitDuration() {
    return new Promise(res => {
      if (isFinite(audio.duration) && audio.duration) return res(audio.duration);
      const f = () => { audio.removeEventListener('loadedmetadata', f); res(audio.duration); };
      audio.addEventListener('loadedmetadata', f);
      setTimeout(f, 4000);
    });
  }
  function setLyricsText(text) {
    const parsed = parseLRC(text);
    curLyrics = parsed.synced ? parsed.lines : [];
    lyricsView.setLines(curLyrics);
    stageEl.classList.toggle('lyric-less', !curLyrics.length);
    broadcastSong();
  }
  app.setLyricsText = setLyricsText;

  /* ---- transport */
  async function togglePlay() {
    engine.ensure(); engine.ctx.resume();
    if (!cur) {
      const q = lib.queue[0];
      if (q) return nextFromQueue();
      return toast('Pick a song from the list first');
    }
    if (isYT()) {
      const m = ytMode();
      if (m === 'page') ytp.playing ? ytp.pause() : ytp.play();
      else if (m === 'remote') stage.send({ type: 'yt', cmd: stage.ytPlaying ? 'pause' : 'play' });
      else (yt.playing ? yt.pause() : yt.play());
      return;
    }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }
  function seekTo(t) {
    t = clamp(t, 0, duration() || 0);
    if (isYT()) { const m = ytMode(); if (m === 'page') ytp.seek(t); else if (m === 'remote') stage.send({ type: 'yt', cmd: 'seek', arg: t }); else yt.seek(t); return; }
    try { audio.currentTime = t; } catch {}
  }
  $('#play').onclick = togglePlay;
  $('#prev').onclick = () => { if (now() > 3 || !history.length) seekTo(0); else playSong(history.pop()); };
  $('#next').onclick = () => nextFromQueue(true);
  const history = [];

  let seeking = false;
  const seek = $('#seek');
  seek.addEventListener('pointerdown', () => (seeking = true));
  seek.addEventListener('pointerup', () => (seeking = false));
  seek.addEventListener('input', () => { const d = duration(); $('#clockNow').textContent = fmtTime(d * seek.value / 1000); });
  seek.addEventListener('change', () => { seeking = false; seekTo(duration() * seek.value / 1000); });

  function songEnded() {
    setPlayIcon(false);
    if (isYT()) { const m = ytMode(); if (m === 'page') ytp.stop(); else if (m === 'remote') stage.send({ type: 'yt', cmd: 'stop' }); else yt.stop(); }
    if (scorer && scorer.total > 5) toast(`Nice! You were on key ${scorer.percent}% of the time.`, 6000);
    if (cur) history.push(cur);
    if (lib.queue.length) showUpNext();
    else { wake(false); broadcast({ type: 'ended' }); }
  }

  /* ---- queue / up next */
  // Between songs: a quiet card that puts the next singer's name front and centre,
  // with a break (Settings → Break between songs) to hand over the mic.
  const up = { timer: null, left: 0, total: 0, held: false, card: null };
  const fmtLeft = s => s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
  function renderUpNext() {
    const c = up.card, box = $('#upnext');
    $('#upnextWho').textContent = c.who;
    $('#upnextTitle').textContent = c.title;
    const auto = P.autoNext && !up.held;
    box.classList.toggle('held', !auto);
    box.style.setProperty('--left', auto ? Math.max(0, up.left / up.total) : 1);
    box.querySelector('.upnext-count').textContent = auto ? `Starting in ${fmtLeft(up.left)}` : 'Start when you’re ready';
    $('#upnextWait').hidden = !P.autoNext;
    $('#upnextWait').textContent = up.held ? 'Resume' : 'Hold';
    $('#upnextWait').setAttribute('aria-pressed', String(up.held));
    broadcast({ type: 'upnext', who: c.who, title: c.title, left: auto ? up.left : null, total: up.total });
  }
  function showUpNext() {
    const q = lib.queue[0], s = q && lib.get(q.songId);
    if (!s) return;
    const singer = (q.singer || '').trim();
    up.card = singer ? { who: singer, title: s.title } : { who: s.title, title: 'Grab the mic' };
    up.total = up.left = clamp(Math.round(P.breakSecs || 20), 5, 90);
    up.held = false;
    $('#upnext').hidden = false;
    renderUpNext();
    clearInterval(up.timer);
    up.timer = setInterval(() => {
      if (!P.autoNext || up.held) return;
      up.left--;
      if (up.left <= 0) { hideUpNext(); nextFromQueue(); return; }
      renderUpNext();
    }, 1000);
    $('#upnextGo').focus();
    announce(singer ? `Up next, ${singer}, singing ${s.title}.` : `Up next: ${s.title}.`);
  }
  function hideUpNext() {
    clearInterval(up.timer); up.timer = null;
    $('#upnext').hidden = true;
    broadcast({ type: 'upnext', hide: true });
  }
  $('#upnextGo').onclick = () => { hideUpNext(); nextFromQueue(); };
  $('#upnextWait').onclick = () => { up.held = !up.held; renderUpNext(); announce(up.held ? 'Countdown on hold' : 'Countdown resumed'); };
  function nextFromQueue(skip) {
    const q = lib.shift();
    if (!q) { if (skip) toast('Nobody’s queued. Use the + next to a song.'); return; }
    if (cur && skip) history.push(cur);
    playSong(lib.get(q.songId), { singer: q.singer });
  }

  /* ------------------------------------------------------------------ library UI */
  const handlers = {
    play: s => { if (window.matchMedia('(max-width: 860px)').matches) setMobile('center'); playSong(s); },
    queue: s => {
      const singer = $('#singerName').value.trim();
      lib.enqueue(s.id, singer);
      toast(`Added ${s.title} to up next${singer ? ' for ' + singer : ''}`);
    },
    lyrics: s => openLyricsEditor(app, s),
    remove: s => {
      if (!confirm(`Remove “${s.title}” from your songs? The file itself isn’t deleted.`)) return;
      if (cur && cur.id === s.id) { stopAll(); cur = null; $('#idle').hidden = false; lyricsView.setLines([]); setNow(); }
      lib.remove(s.id);
    },
  };
  function refreshLists() {
    renderLibrary(lib, $('#libList'), $('#libFilter').value, cur && cur.id, handlers);
    renderQueue(lib, $('#queue'), { remove: q => lib.dequeue(q.qid), move: (q, d) => lib.moveQueue(q.qid, d) });
  }
  lib.onChange(refreshLists);
  $('#libFilter').addEventListener('input', refreshLists);
  refreshLists();
  lib.reconnect();
  $('#singerName').value = store.get('brk2-singer', '');
  $('#singerName').addEventListener('change', e => store.set('brk2-singer', e.target.value.trim()));

  /* ---- adding files */
  async function addFiles(files) {
    const media = [], lrcs = [];
    for (const f of files) (isMedia(f.name) ? media : isLyricsFile(f.name) ? lrcs : []).push(f);
    const added = [];
    for (const f of media) {
      let path = null, src = null, lrc = null;
      if (host) {
        path = host.getPathForFile(f);
        if (path) { const [r] = await host.registerPaths([path]); src = r && r.url; lrc = r && r.lrc; }
      }
      if (!src) src = URL.createObjectURL(f);
      added.push(lib.addFileSong({ name: f.name, src, path, lrc }));
    }
    // Pair dropped .lrc files with songs of the same name.
    for (const f of lrcs) {
      const text = await f.text();
      const target = lib.songs.find(s => s.kind === 'file' && baseName(s.name || '') === baseName(f.name)) || (media.length === 0 && cur && cur.kind === 'file' ? cur : null);
      if (target) {
        store.set('brk2-lrc:' + target.id, text);
        if (cur === target) setLyricsText(text);
        toast(`Lyrics added to ${target.title}`);
      } else if (!media.length) toast(`No song called “${baseName(f.name)}” to match those lyrics. Add the song first.`, 5000);
    }
    lib.changed();
    if (added.length) {
      toast(added.length === 1 ? `Added ${added[0].title}` : `Added ${added.length} songs`);
      if (!host) announce('Files added for this session. In the browser, add them again next visit.');
      if (!cur) playSong(added[0], { autoplay: false });
    }
  }
  $('#addFiles').onclick = async () => {
    if (host) {
      const picked = await host.pickMedia();
      if (!picked || !picked.length) return;
      for (const p of picked) lib.addFileSong(p);
      lib.changed();
      toast(picked.length === 1 ? `Added ${picked[0].name}` : `Added ${picked.length} songs`);
      if (!cur) playSong(lib.songs[0], { autoplay: false });
    } else $('#filePick').click();
  };
  $('#filePick').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#dropHint').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
    else {
      const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const p = parseYouTube(text);
      if (p && p.id) { const s = lib.addYouTube(p.id); lib.changed(); playSong(s); }
    }
  });

  /* ---- YouTube */
  const dlgYT = $('#dlgYT');
  $('#ytSearchBtn').onclick = () => {
    $('#ytSearchHint').textContent = host
      ? 'Opens a YouTube window. Click any video and it’s added to your songs here.'
      : 'Opens YouTube in a new tab. Copy the link of the video you want and paste it below.';
    dlgYT.showModal(); $('#ytQuery').focus();
  };
  $('#ytSearchForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#ytQuery').value.trim();
    if (!q) return;
    const query = /karaoke|instrumental/i.test(q) ? q : q + ' karaoke';
    if (host) { host.searchYouTube(query); dlgYT.close(); }
    else window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), '_blank', 'noopener');
  });
  $('#ytLinkForm').addEventListener('submit', e => {
    e.preventDefault();
    const p = parseYouTube($('#ytLink').value);
    if (!p) { toast('That doesn’t look like a YouTube video link.'); return; }
    if (!p.id) { toast('Playlists aren’t supported yet. Paste a single video link.'); return; }
    const s = lib.addYouTube(p.id); lib.changed();
    $('#ytLink').value = ''; dlgYT.close();
    playSong(s);
  });
  if (host) host.onYouTubePick(({ id, title }) => {
    const s = lib.addYouTube(id, title); lib.changed();
    toast(`Added ${s.title}`);
    announce(`Added ${s.title} to your songs`);
  });
  // Some uploaders block the embedded player. In the desktop app those play on YouTube's own
  // watch page instead; remember that per song so it goes straight there next time.
  const EMBED_BLOCKED = [101, 150, 153];
  function ytFailed(msg, code) {
    if (!cur || cur.kind !== 'yt') { toast(msg, 5000); return; }
    if (EMBED_BLOCKED.includes(code) && ytp && !cur.ytPage) {
      cur.ytPage = true; lib.changed();
      toast('This uploader blocks embedded playback, so it’s playing on YouTube’s own page instead.', 6000);
      playSong(cur, { singer: cur.singer });
      return;
    }
    if (EMBED_BLOCKED.includes(code) && !host) { toast('The uploader only allows this video on YouTube. The Kami-oke desktop app can still play it.', 7000); return; }
    toast(msg, 5000);
  }
  function ytTitle(t) {
    if (!cur || cur.kind !== 'yt' || !t) return;
    if (cur.title === 'YouTube video' || cur.needsTitle) {
      const g = guessArtistTitle(t);
      cur.title = g.title || t; cur.needsTitle = false; if (g.artist) cur.artist = g.artist + ' · YouTube';
      lib.changed(); setNow(); broadcastSong();
    }
  }

  /* ------------------------------------------------------------------ stage screen */
  function broadcast(m) { if (stage.connected) stage.send(m); }
  function broadcastSong() {
    if (!stage.connected) return;
    stage.send({
      type: 'song',
      song: cur ? { title: cur.title, artist: cur.artist || '', singer: cur.singer || '', kind: cur.kind, video: cur.kind === 'file' && cur.isVideo ? new URL(cur.src, location.href).href : null } : null,
      lines: curLyrics.map(l => ({ t: l.t, end: l.end, text: l.text, words: l.estimated ? null : l.words })),
      notes: P.guideMelody ? curNotes : [],
    });
    pushTime();
  }
  function broadcastSettings() {
    broadcast({ type: 'settings', theme: P.theme, lyricSize: P.lyricSize, nextLine: P.nextLine, reduceMotion: P.reduceMotion, hyperFont: P.hyperFont });
  }
  function pushTime() {
    if (!stage.connected || isYT()) return;
    broadcast({ type: 'time', t: audio.currentTime + P.lyricOffset, vt: audio.currentTime, playing: !audio.paused, rate: audio.playbackRate });
  }
  if (chan) chan.onmessage = e => {
    const m = e.data;
    if (m.type === 'hello') {
      stage.connected = true; $('#stageBtn').setAttribute('aria-pressed', 'true');
      broadcastSettings(); broadcastSong();
      if (ytMode() === 'page') { ytp.moveTo('stage'); $('#ytRemote').hidden = false; }
      else if (isYT()) { // hand YouTube over to the big screen
        const t = yt.time; yt.stop(); $('#yt').hidden = true; $('#ytRemote').hidden = false;
        stage.ytRemote = true;
        stage.send({ type: 'yt', cmd: 'load', arg: cur.ytId, at: t, vol: P.musicVol, rate: P.speed / 100 });
      }
      toast('Stage screen connected');
    } else if (m.type === 'bye') {
      stageGone();
    } else if (m.type === 'yt-state') {
      stage.ytTime = m.t; stage.ytDur = m.d;
      if (stage.ytPlaying !== m.playing) { stage.ytPlaying = m.playing; setPlayIcon(m.playing); }
      if (m.title) ytTitle(m.title);
      if (m.ended) songEnded();
    } else if (m.type === 'yt-error') ytFailed(m.message, m.code);
  };
  function stageGone() {
    if (!stage.connected) return;
    stage.connected = false; stage.win = null;
    $('#stageBtn').setAttribute('aria-pressed', 'false');
    if (ytMode() === 'page') { ytp.moveTo('main'); $('#ytRemote').hidden = true; }
    else if (stage.ytRemote && isYT()) {
      stage.ytRemote = false; $('#ytRemote').hidden = true; $('#yt').hidden = false;
      yt.load(cur.ytId, { autoplay: stage.ytPlaying, start: stage.ytTime });
    }
    toast('Stage screen closed');
  }
  function toggleStage() {
    if (stage.connected) { stage.send({ type: 'close' }); try { stage.win && stage.win.close(); } catch {} stageGone(); return; }
    stage.win = window.open('index.html?stage=1', 'brk-stage', 'popup,width=1280,height=720');
    if (!stage.win && !host) toast('Allow pop-ups for this site to open the stage screen.', 5000);
  }
  $('#stageBtn').onclick = toggleStage;
  window.addEventListener('pagehide', () => stage.send({ type: 'close' }));
  setInterval(() => { if (stage.connected && stage.win && stage.win.closed) stageGone(); }, 1000);

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => $('#app').classList.toggle('focus-stage', !!document.fullscreenElement));
  $('#fullBtn').onclick = toggleFullscreen;

  /* ------------------------------------------------------------------ recording */
  async function toggleRecord() {
    if (engine.recording) {
      const blob = await engine.stopRecording();
      $('#recBtn').setAttribute('aria-pressed', 'false');
      $('#recBtn').setAttribute('aria-label', 'Record this performance');
      if (blob && blob.size) {
        const name = `karaoke-${(cur ? cur.title : 'session').replace(/[^\w\- ]+/g, '').slice(0, 40)}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`;
        if (host && host.saveRecording) { const where = await host.saveRecording(name, await blob.arrayBuffer()); if (where) toast('Saved to ' + where, 5000); }
        else { download(blob, name); toast('Recording saved to your downloads'); }
      }
      return;
    }
    if (!engine.micOn) await startMic();
    try {
      engine.startRecording();
      $('#recBtn').setAttribute('aria-pressed', 'true');
      $('#recBtn').setAttribute('aria-label', 'Stop recording and save');
      toast(isYT() ? 'Recording your voice. YouTube audio can’t be captured.' : 'Recording the music and your voice');
    } catch (e) { toast('Recording isn’t available here.'); }
  }
  $('#recBtn').onclick = toggleRecord;

  /* ------------------------------------------------------------------ wake lock */
  let wakeLock = null;
  async function wake(on) {
    try {
      if (on && P.awake && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => (wakeLock = null); }
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing()) wake(true); });

  /* ------------------------------------------------------------------ the loop */
  const howl = { det: null, on: false, shownAt: 0 };
  const pitchScratch = new Float32Array(2048);
  let peakHold = 0, peakAt = 0, lastPitchAt = 0, lastFrame = performance.now(), lastPush = 0, recentMidi = [];
  const musicBuf = new Float32Array(512);
  const laneColors = () => {
    const cs = getComputedStyle(document.documentElement);
    return { note: 'rgba(255,255,255,.28)', past: 'rgba(255,255,255,.12)', head: cs.getPropertyValue('--marigold'), hit: cs.getPropertyValue('--leaf'), sung: cs.getPropertyValue('--rose') };
  };
  let colors = laneColors();
  new MutationObserver(() => (colors = laneColors())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(.1, (ts - lastFrame) / 1000); lastFrame = ts;
    const t = now(), d = duration();
    // transport
    if (!seeking) {
      const pct = d ? t / d * 1000 : 0;
      seek.value = pct; seek.style.setProperty('--fill', pct / 10 + '%');
      $('#clockNow').textContent = fmtTime(t); $('#clockDur').textContent = fmtTime(d);
      if (ts - (frame.aria || 0) > 1000) { frame.aria = ts; seek.setAttribute('aria-valuetext', `${fmtTime(t)} of ${fmtTime(d)}`); }
    }
    // lyrics
    if (cur && !isYT()) {
      lyricsView.render(t + P.lyricOffset);
      syncVideo(false);
      if (ts - lastPush > 250) { lastPush = ts; pushTime(); }
    }
    // music meter
    if (engine.ctx) {
      engine.N.musicAnaly.getFloatTimeDomainData(musicBuf);
      let pk = 0; for (let i = 0; i < musicBuf.length; i++) { const a = Math.abs(musicBuf[i]); if (a > pk) pk = a; }
      $('#musicMeter').style.width = clamp((20 * Math.log10(pk + 1e-9) + 48) / 48, 0, 1) * 100 + '%';
    }
    if (!engine.ctx || !engine.micOn) { lane.render(t, colors); return; }
    const { N } = engine;
    N.analy.getFloatTimeDomainData(engine.timeBuf);
    const buf = engine.timeBuf;
    let sum = 0, pk = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-9);
    const pct = clamp((db + 60) / 60, 0, 1) * 100;
    const fill = $('#micMeter');
    fill.style.width = (engine.muted ? 0 : pct) + '%';
    fill.className = pk > .96 ? 'clip' : pk > .7 ? 'hot' : '';
    if (pct >= peakHold || ts - peakAt > 900) { peakHold = pct; peakAt = ts; }
    $('#micPeak').style.left = `calc(${clamp(peakHold, 0, 100)}% - 1px)`;
    // gate
    if (P.gateOn) { const open = db > P.gateThr; N.gate.gain.setTargetAtTime(open ? 1 : 0, engine.ctx.currentTime, open ? .004 : .07); }
    else if (Math.abs(N.gate.gain.value - 1) > .001) N.gate.gain.setTargetAtTime(1, engine.ctx.currentTime, .01);
    // duck
    if (P.duckOn) {
      const amt = clamp((db + 48) / 26, 0, 1) * (P.duck / 100) * (engine.muted ? 0 : 1);
      N.music.gain.setTargetAtTime(engine.musicBase() * (1 - amt), engine.ctx.currentTime, .09);
    }
    // feedback
    if (!engine.muted && P.monitorOn) {
      if (!howl.det) howl.det = new HowlDetector(engine.ctx.sampleRate, N.howl.fftSize);
      N.howl.getFloatFrequencyData(engine.specBuf);
      const r = howl.det.push(engine.specBuf, ts);
      if (r.onset && P.howlGuard) {
        engine.addNotch(r.hz);
        engine.howlDip = .35; engine.apply();
      }
      if (r.active !== howl.on) setHowl(r.active);
    } else if (howl.on) setHowl(false);
    if (!howl.on && engine.howlDip && engine.howlDip < 1) { engine.howlDip = Math.min(1, engine.howlDip + dt * .4); engine.apply(); }
    // pitch (~30 Hz)
    if (ts - lastPitchAt > 33) {
      lastPitchAt = ts;
      let midiNow = null;
      if (db > -46 && !engine.muted) {
        const r = yin(buf, engine.ctx.sampleRate, pitchScratch);
        if (r && r.clarity > .82) {
          recentMidi.push(hzToMidi(r.hz)); if (recentMidi.length > 3) recentMidi.shift();
          midiNow = [...recentMidi].sort((a, b) => a - b)[recentMidi.length >> 1];
        }
      } else recentMidi.length = 0;
      $('#pitchRead .pr-note').textContent = midiNow == null ? '–' : noteName(midiNow);
      if (midiNow != null && cur && !isYT() && !audio.paused) {
        lane.pushSung(t, midiNow);
        broadcast({ type: 'pitch', t, midi: midiNow });
      }
      if (scorer && !audio.paused) {
        scorer.push(t, .033, midiNow);
        $('#score').hidden = false;
        $('#score .score-num').textContent = scorer.percent;
      }
    }
    lane.render(t, colors);
  }
  requestAnimationFrame(frame);

  function setHowl(on) {
    howl.on = on;
    $('#howl').dataset.on = String(on);
    $('#howl').setAttribute('aria-hidden', String(!on));
    if (on) announce('Feedback! Move the microphone away from the speakers.', true);
    broadcast({ type: 'howl', on });
    if (ytp) ytp.howl(on);
  }

  /* ------------------------------------------------------------------ panes + tabs */
  const currentTab = setupTabs(app);
  renderPane(app, 'mix');

  /* ------------------------------------------------------------------ mobile sections */
  function setMobile(m) {
    $('#app').dataset.m = m;
    $$('#mtabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  }
  $$('#mtabs button').forEach(b => (b.onclick = () => setMobile(b.dataset.m)));
  setMobile('center');

  /* ------------------------------------------------------------------ dialogs */
  $('#keysBtn').onclick = () => $('#dlgKeys').showModal();
  initLyricsEditor(app);

  /* ------------------------------------------------------------------ keyboard */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(e.target.type)) || e.target.isContentEditable || tag === 'SELECT';
    if (typing || document.querySelector('dialog[open]')) return;
    const onControl = tag === 'BUTTON' || tag === 'INPUT';
    switch (e.key) {
      case ' ': if (onControl) return; e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': if (tag === 'INPUT') return; e.preventDefault(); seekTo(now() - 5); break;
      case 'ArrowRight': if (tag === 'INPUT') return; e.preventDefault(); seekTo(now() + 5); break;
      case 'n': case 'N': nextFromQueue(true); break;
      case 'm': case 'M': toggleMute(); break;
      case '[': setKey(P.key - 1); break;
      case ']': setKey(P.key + 1); break;
      case 'v': case 'V': toggleVocalCut(); break;
      case ',': nudgeOffset(-.1); break;
      case '.': nudgeOffset(.1); break;
      case 's': case 'S': toggleStage(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'r': case 'R': toggleRecord(); break;
      case '/': e.preventDefault(); setMobile('library'); $('#libFilter').focus(); break;
      case '?': $('#dlgKeys').showModal(); break;
      default: return;
    }
  });
  function nudgeOffset(d) {
    if (!cur) return;
    P.lyricOffset = Math.round((P.lyricOffset + d) * 100) / 100;
    store.set('brk2-offset:' + cur.id, P.lyricOffset);
    toast(`Lyrics ${P.lyricOffset === 0 ? 'on time' : Math.abs(P.lyricOffset).toFixed(1) + ' s ' + (P.lyricOffset > 0 ? 'earlier' : 'later')}`);
    if (currentTab() === 'lyrics') renderPane(app, 'lyrics');
  }
  app.nudgeOffset = nudgeOffset;

  // Debug/test hook.
  window.__karaoke = { app, playSong, lib, engine, stage, ytp, ytFailed, get cur() { return cur; }, get lines() { return curLyrics; }, setHowl };
}
