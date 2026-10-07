// Runs in every frame of every window (sandboxed). Three jobs:
//  • In the app's own pages: expose a small, typed `karaokeHost` API.
//  • In YouTube frames: strip ads from player data and skip any that slip through.
//  • In the YouTube search window: turn a click on a video into "add to my songs".
'use strict';
const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

const isApp = /^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin);
const isYouTube = /(^|\.)(youtube|youtube-nocookie)\.com$/.test(location.hostname);

/* ------------------------------------------------------------------ app API */
if (isApp && window === window.top) {
  contextBridge.exposeInMainWorld('karaokeHost', {
    isDesktop: true,
    getPathForFile: f => { try { return webUtils.getPathForFile(f) || null; } catch { return null; } },
    registerPaths: paths => ipcRenderer.invoke('media:register', paths),
    pickMedia: () => ipcRenderer.invoke('media:pick'),
    readSiblingLyrics: p => ipcRenderer.invoke('lyrics:read', p),
    saveSiblingLyrics: (p, text) => ipcRenderer.invoke('lyrics:save', p, text),
    saveRecording: (name, data) => ipcRenderer.invoke('rec:save', name, data),
    searchYouTube: q => ipcRenderer.send('yt:search', q),
    onYouTubePick: cb => ipcRenderer.on('yt:picked', (_e, v) => cb(v)),
    setAdBlock: on => ipcRenderer.send('adblock:set', !!on),
    ytPage: {
      open: o => ipcRenderer.invoke('ytpage:open', o),
      bounds: b => ipcRenderer.send('ytpage:bounds', b),
      visible: on => ipcRenderer.send('ytpage:visible', !!on),
      host: which => ipcRenderer.send('ytpage:host', which),
      cmd: (cmd, arg) => ipcRenderer.send('ytpage:cmd', { cmd, arg }),
      close: () => ipcRenderer.send('ytpage:close'),
      onState: cb => ipcRenderer.on('ytpage:state', (_e, st) => cb(st)),
    },
  });
}

/* ------------------------------------------------------------------ YouTube ad blocking */
// Runs in the page's own JavaScript world (serialised by Electron, so it must be self-contained).
function adScriptlet() {
  if (window.__brkAdBlock) return; window.__brkAdBlock = true;
  const KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
  const prune = o => {
    if (!o || typeof o !== 'object') return o;
    try {
      for (const k of KEYS) if (k in o) delete o[k];
      if (o.playerResponse) prune(o.playerResponse);
    } catch (e) {}
    return o;
  };
  const parse = JSON.parse;
  JSON.parse = function () { return prune(parse.apply(this, arguments)); };
  const rjson = Response.prototype.json;
  Response.prototype.json = function () { return rjson.apply(this, arguments).then(prune); };
  for (const name of ['ytInitialPlayerResponse']) {
    let v = window[name];
    try { Object.defineProperty(window, name, { configurable: true, get: () => v, set: x => { v = prune(x); } }); } catch (e) {}
  }
  // Fallback: mute, fast-forward and skip anything that still plays as an ad.
  let mutedByUs = false;
  setInterval(() => {
    const player = document.querySelector('.html5-video-player');
    const v = player && player.querySelector('video');
    if (!v) return;
    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) {
      if (!v.muted) { v.muted = true; mutedByUs = true; }
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - .1) { try { v.currentTime = v.duration; } catch (e) {} }
      document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip-ad"]').forEach(b => b.click());
    } else if (mutedByUs) { v.muted = false; mutedByUs = false; }
    document.querySelectorAll('.ytp-ad-overlay-close-button').forEach(b => b.click());
  }, 250);
}

if (isYouTube) {
  let adBlock = true;
  try { adBlock = ipcRenderer.sendSync('adblock:get'); } catch {}
  if (adBlock) {
    try {
      if (contextBridge.executeInMainWorld) contextBridge.executeInMainWorld({ func: adScriptlet });
      else webFrame.executeJavaScript(`(${adScriptlet.toString()})()`);
    } catch {
      webFrame.executeJavaScript(`(${adScriptlet.toString()})()`).catch(() => {});
    }
  }
}

/* ------------------------------------------------------------------ YouTube search window */
/* ------------------------------------------------------------------ YouTube page player */
// For videos whose uploader blocks embedding, the app shows YouTube's own watch page in the
// stage area. Here we trim that page to just the picture and let the app drive it.
let pageInit = null;
if (!isApp && window === window.top) { try { pageInit = ipcRenderer.sendSync('ytpage:init'); } catch {} }
if (pageInit) {
  webFrame.insertCSS(`
    html, body { overflow: hidden !important; background: #000 !important; }
    #masthead-container, #secondary, #below, #comments, ytd-mealbar-promo-renderer, tp-yt-paper-dialog, ytd-popup-container,
    .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom, .ytp-ce-element, .ytp-pause-overlay,
    .ytp-endscreen-content, .ytp-cards-teaser, .ytp-paid-content-overlay, .ytp-autonav-endscreen, .iv-branding, .ytp-watermark,
    .ytp-suggested-action, .ytp-contextmenu { display: none !important; }
    #movie_player, #player-full-bleed-container, #full-bleed-container {
      position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
      max-height: none !important; z-index: 2147483000 !important; background: #000 !important; }
    #movie_player video { width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
    #kamioke-howl { position: fixed; right: 2.4vw; bottom: 2.4vw; z-index: 2147483647; pointer-events: none;
      font: 800 clamp(15px, 2.3vw, 26px)/1.15 system-ui, sans-serif; letter-spacing: .06em; color: #fff;
      text-shadow: 0 1px 12px rgba(0,0,0,.8); display: flex; align-items: center; gap: .6em; opacity: 0; transition: opacity .6s; }
    #kamioke-howl::before { content: ""; width: .6em; height: .6em; border-radius: 50%; background: #ff3d3d; box-shadow: 0 0 0 .18em rgba(255,61,61,.3); }
    #kamioke-howl.on { opacity: 1; transition-duration: .25s; animation: kamioke-breathe 1.4s ease-in-out infinite; }
    @keyframes kamioke-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
  `);
  const video = () => document.querySelector('#movie_player video') || document.querySelector('video');
  // Key change: route the page's audio through the shifter (built on first use; a media element
  // can only be connected once, so after that the audio always flows through it).
  const audio = { ctx: null, node: null, gain: null, el: null, failed: false };
  async function setKey(st) {
    pageInit.key = st;
    if (audio.node) { audio.node.port.postMessage({ semitones: st }); return; }
    const v = video();
    if (!st || !v || audio.failed) return;
    try {
      audio.ctx = new AudioContext({ latencyHint: 'playback' });
      const url = URL.createObjectURL(new Blob([pageInit.pitchSrc], { type: 'text/javascript' }));
      await audio.ctx.audioWorklet.addModule(url);
      audio.node = new AudioWorkletNode(audio.ctx, 'kamioke-pitch', { outputChannelCount: [2] });
      audio.gain = audio.ctx.createGain();
      audio.el = v;
      audio.ctx.createMediaElementSource(v).connect(audio.node);
      audio.node.connect(audio.gain); audio.gain.connect(audio.ctx.destination);
      audio.node.port.postMessage({ semitones: pageInit.key });
      if (audio.ctx.state !== 'running') await audio.ctx.resume();
      if (pageInit.debug) { // automated tests only: publish levels at a few test-tone frequencies
        const an = audio.ctx.createAnalyser(); an.fftSize = 16384; audio.gain.connect(an);
        const spec = new Float32Array(an.frequencyBinCount), hz = audio.ctx.sampleRate / an.fftSize;
        setInterval(() => {
          an.getFloatFrequencyData(spec);
          const at = f => { const b = Math.round(f / hz); return Math.round(Math.max(spec[b - 1], spec[b], spec[b + 1])); };
          document.documentElement.dataset.kamiokeSpec = JSON.stringify(Object.fromEntries([82.4, 92.5, 261.6, 293.7, 329.6, 370, 392, 440].map(f => [f, at(f)])));
        }, 400);
      }
      ipcRenderer.send('ytpage:state', { keyOk: true });
    } catch (err) {
      audio.failed = true;
      ipcRenderer.send('ytpage:state', { keyFailed: String(err && err.message || err).slice(0, 200) });
    }
  }
  const player = () => document.getElementById('movie_player');
  let applied = false, lastSent = '', endedSent = false;
  const apply = v => {
    v.volume = Math.min(1, Math.max(0, pageInit.vol / 100));
    v.muted = false;
    if (pageInit.rate) v.playbackRate = pageInit.rate;
    applied = true;
  };
  setInterval(() => {
    const v = video(), pl = player();
    // Some videos still can't play here (age checks, region locks); pass YouTube's own message on.
    const err = document.querySelector('.ytp-error-content-wrap-reason, yt-playability-error-supported-renderers #reason');
    if (err && err.textContent.trim()) { send({ blocked: err.textContent.trim() }); return; }
    if (!v) return;
    window.dispatchEvent(new Event('resize'));
    const ad = !!(pl && (pl.classList.contains('ad-showing') || pl.classList.contains('ad-interrupting')));
    if (!ad && !applied && v.readyState > 0) { apply(v); if (pageInit.key) setKey(pageInit.key); }
    if (!ad && v.ended && !endedSent) { endedSent = true; ipcRenderer.send('ytpage:state', { ended: true }); return; }
    send({ t: ad ? 0 : v.currentTime, d: ad ? 0 : v.duration || 0, playing: !v.paused && !ad, ad,
      title: document.title.replace(/^\(\d+\)\s*/, '').replace(/\s+-\s+YouTube$/, '') });
  }, 250);
  function send(st) {
    const key = JSON.stringify(st);
    if (key !== lastSent || st.playing) { lastSent = key; ipcRenderer.send('ytpage:state', st); }
  }
  ipcRenderer.on('ytpage:cmd', (_e, c = {}) => {
    const v = video();
    switch (c.cmd) {
      case 'play': v && v.play().catch(() => {}); break;
      case 'pause': v && v.pause(); break;
      case 'seek': if (v && isFinite(c.arg)) { v.currentTime = c.arg; endedSent = false; } break;
      case 'volume': pageInit.vol = +c.arg || 0; if (v) v.volume = Math.min(1, Math.max(0, pageInit.vol / 100)); break;
      case 'rate': pageInit.rate = +c.arg || 1; if (v) v.playbackRate = pageInit.rate; break;
      case 'key': setKey(Math.max(-6, Math.min(6, Math.round(+c.arg || 0)))); break;
      case 'howl': {
        let el = document.getElementById('kamioke-howl');
        if (!el) { el = document.createElement('div'); el.id = 'kamioke-howl'; el.textContent = 'MOVE MICROPHONE AWAY FROM SPEAKERS'; document.documentElement.appendChild(el); }
        el.classList.toggle('on', !!c.arg);
        break;
      }
    }
  });
}

const isSearchWindow = !pageInit && isYouTube && window === window.top && location.hostname === 'www.youtube.com';
if (isSearchWindow) {
  const idOf = href => { const m = /(?:[?&]v=|\/shorts\/)([\w-]{11})/.exec(href || ''); return m && m[1]; };
  const titleNear = a => {
    const card = a.closest('ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, yt-lockup-view-model');
    // Only the title element itself: the card also holds the hover-preview player and its overlay text.
    const t = card && card.querySelector('#video-title, a#video-title-link, .yt-lockup-metadata-view-model__title');
    const text = (t && (t.getAttribute('title') || t.textContent)) || a.getAttribute('title') || '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 150);
  };
  const added = new Set();
  let badge;
  const flash = (title, again) => {
    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('role', 'status');
      badge.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;background:#ffb21e;color:#2a1600;font:700 16px/1.3 system-ui,sans-serif;padding:12px 18px;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:80vw;transition:opacity .25s';
      document.documentElement.appendChild(badge);
    }
    badge.textContent = (again ? 'Already in your songs: ' : 'Added to your songs: ') + (title || 'video');
    badge.style.opacity = '1';
    clearTimeout(flash.t); flash.t = setTimeout(() => (badge.style.opacity = '0'), 2600);
  };
  const pick = (id, title) => {
    const again = added.has(id);
    added.add(id);
    if (!again) ipcRenderer.send('yt:pick', { id, title });
    flash(title, again);
  };
  window.addEventListener('click', e => {
    if (e.button !== 0) return;
    const a = e.target.closest && e.target.closest('a[href*="watch?v="], a[href*="/shorts/"]');
    const id = a && idOf(a.getAttribute('href'));
    if (!id) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pick(id, titleNear(a));
  }, true);
  ipcRenderer.on('yt:intercepted', (_e, id) => { if (!added.has(id)) pick(id, ''); });
  window.addEventListener('DOMContentLoaded', () => {
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;right:16px;top:64px;z-index:2147483646;background:#1c1222;color:#f6f0fa;font:600 14px/1.35 system-ui,sans-serif;padding:10px 14px;border-radius:8px;border:1px solid #46344f;max-width:260px;box-shadow:0 8px 30px rgba(0,0,0,.4)';
    tip.textContent = 'Click any video to add it to Kami-oke. Close this window when you’re done.';
    document.documentElement.appendChild(tip);
    setTimeout(() => tip.remove(), 9000);
  });
}
