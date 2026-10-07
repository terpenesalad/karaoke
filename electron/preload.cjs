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
const isSearchWindow = isYouTube && window === window.top && location.hostname === 'www.youtube.com';
if (isSearchWindow) {
  const idOf = href => { const m = /(?:[?&]v=|\/shorts\/)([\w-]{11})/.exec(href || ''); return m && m[1]; };
  const titleNear = a => {
    const card = a.closest('ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, yt-lockup-view-model');
    const t = card && card.querySelector('#video-title, a#video-title-link, h3 [title], .yt-lockup-metadata-view-model__title, h3');
    return ((t && (t.getAttribute('title') || t.textContent)) || a.getAttribute('title') || a.textContent || '').trim();
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
    tip.textContent = 'Click any video to add it to Back Room Karaoke. Close this window when you’re done.';
    document.documentElement.appendChild(tip);
    setTimeout(() => tip.remove(), 9000);
  });
}
