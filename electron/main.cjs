// Kami-oke — desktop shell.
// Serves the web app from a private localhost server (stable origin, so settings persist and
// YouTube embeds work), streams your own media files by path with seeking support, grants the
// microphone, opens the YouTube search window and blocks YouTube ads.
'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, screen, shell, Menu, net } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { AD_URL_PATTERNS, COSMETIC_CSS } = require('./adblock.cjs');

const ROOT = path.join(__dirname, '..');

// The app used to be called Back Room Karaoke. Keep using its data folder (songs, lyrics,
// settings) so nothing is lost after the rename.
try {
  const legacy = path.join(app.getPath('appData'), 'Back Room Karaoke');
  if (fs.existsSync(legacy)) app.setPath('userData', legacy);
} catch {}
const PORT_BASE = 47823;
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|mp4|m4v|webm|mkv|mov|ogv)$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.opus': 'audio/ogg', '.flac': 'audio/flac', '.wma': 'audio/x-ms-wma', '.mp4': 'video/mp4', '.m4v': 'video/mp4',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
};
const STATIC_OK = /^(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js|fonts\/[\w.-]+\.(woff2|txt)|build\/icon\.svg)$/;
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "media-src 'self' blob:",
  "connect-src 'self' blob: https://lrclib.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
].join('; ');

let ORIGIN = '';
let mainWin = null;
let ytWin = null;
const media = new Map(); // hash -> absolute path the user chose

/* ------------------------------------------------------------------ prefs */
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { adBlock: true };
try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch {}
const savePrefs = () => fsp.writeFile(prefsFile(), JSON.stringify(prefs)).catch(() => {});

/* ------------------------------------------------------------------ local server */
function serveFile(req, res, file, type) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const headers = { 'Content-Type': type || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? st.size - Number(range[2]) : Number(range[1]);
      let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : st.size - 1;
      if (!(start >= 0 && start <= end && end < st.size)) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function handler(req, res) {
  let u;
  try { u = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  // Only our own windows may talk to this server.
  const host = req.headers.host || '';
  if (!/^127\.0\.0\.1:\d+$/.test(host)) { res.writeHead(403); return res.end(); }
  const m = /^\/media\/([a-f0-9]{16})\//.exec(u.pathname);
  if (m) {
    const file = media.get(m[1]);
    if (!file) { res.writeHead(404); return res.end(); }
    return serveFile(req, res, file, MIME[path.extname(file).toLowerCase()]);
  }
  let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
  if (!STATIC_OK.test(rel)) { res.writeHead(404); return res.end(); }
  const type = MIME[path.extname(rel)];
  if (rel === 'index.html') res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  serveFile(req, res, path.join(ROOT, rel), type);
}
function listen() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    let port = PORT_BASE, tries = 0;
    server.on('error', e => {
      if (e.code === 'EADDRINUSE' && tries++ < 20) server.listen(++port, '127.0.0.1');
      else reject(e);
    });
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

/* ------------------------------------------------------------------ media registry */
const hashOf = p => crypto.createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 16);
async function register(p) {
  try {
    const abs = path.resolve(String(p));
    if (!MEDIA_EXT.test(abs)) return null;
    const st = await fsp.stat(abs);
    if (!st.isFile()) return null;
    const h = hashOf(abs);
    media.set(h, abs);
    return { url: `${ORIGIN}/media/${h}/${encodeURIComponent(path.basename(abs))}`, lrc: await siblingLyrics(abs) };
  } catch { return null; }
}
async function siblingLyrics(abs) {
  const base = abs.slice(0, -path.extname(abs).length);
  for (const ext of ['.lrc', '.LRC', '.txt']) {
    try {
      const st = await fsp.stat(base + ext);
      if (st.isFile() && st.size < 1_000_000) {
        const text = await fsp.readFile(base + ext, 'utf8');
        if (ext !== '.txt' || /\[\d+:\d+/.test(text)) return text;
      }
    } catch {}
  }
  return null;
}
const fromApp = e => { try { return new URL(e.senderFrame.url).origin === ORIGIN; } catch { return false; } };

ipcMain.handle('media:register', async (e, paths) => {
  if (!fromApp(e) || !Array.isArray(paths)) return [];
  return Promise.all(paths.slice(0, 5000).map(register));
});
ipcMain.handle('media:pick', async e => {
  if (!fromApp(e)) return [];
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Add music or videos', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Music and video', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'flac', 'wma', 'mp4', 'm4v', 'webm', 'mkv', 'mov'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) {
    const reg = await register(p);
    if (reg) out.push({ name: path.basename(p), path: path.resolve(p), src: reg.url, lrc: reg.lrc });
  }
  return out;
});
ipcMain.handle('lyrics:read', async (e, p) => {
  if (!fromApp(e) || !media.has(hashOf(p))) return null;
  return siblingLyrics(path.resolve(p));
});
ipcMain.handle('lyrics:save', async (e, p, text) => {
  if (!fromApp(e) || !media.has(hashOf(p)) || typeof text !== 'string' || text.length > 1_000_000) return false;
  const abs = path.resolve(p);
  const target = abs.slice(0, -path.extname(abs).length) + '.lrc';
  try { await fsp.writeFile(target, text, 'utf8'); return true; } catch { return false; }
});
ipcMain.handle('rec:save', async (e, name, data) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showSaveDialog(mainWin, {
    title: 'Save recording', defaultPath: path.join(app.getPath('music'), String(name).replace(/[\\/:*?"<>|]+/g, '-')),
    filters: [{ name: 'Audio', extensions: [path.extname(name).slice(1) || 'webm'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});
ipcMain.on('adblock:set', (e, on) => { if (fromApp(e)) { prefs.adBlock = !!on; savePrefs(); } });
ipcMain.on('adblock:get', e => { e.returnValue = !!prefs.adBlock; });

/* ------------------------------------------------------------------ YouTube search window */
ipcMain.on('yt:search', (e, q) => { if (fromApp(e)) openYouTube(String(q).slice(0, 200)); });
ipcMain.on('yt:pick', async (e, { id, title } = {}) => {
  if (!ytWin || e.sender !== ytWin.webContents || !/^[\w-]{11}$/.test(id || '')) return;
  // YouTube's oEmbed title is authoritative; the clicked card's text is only a fallback.
  title = (await oembedTitle(id)) || title;
  mainWin && mainWin.webContents.send('yt:picked', { id, title: String(title || '').slice(0, 200) });
});
async function oembedTitle(id) {
  try {
    const r = await net.fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
    return r.ok ? (await r.json()).title : '';
  } catch { return ''; }
}
function openYouTube(q) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  if (ytWin && !ytWin.isDestroyed()) { ytWin.loadURL(url); ytWin.focus(); return; }
  ytWin = new BrowserWindow({
    width: 1100, height: 820, parent: mainWin, title: 'Find on YouTube — click a video to add it',
    backgroundColor: '#0f0f0f', autoHideMenuBar: true, icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { partition: 'persist:youtube', preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  ytWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ytWin.webContents.on('dom-ready', () => { if (prefs.adBlock) ytWin.webContents.insertCSS(COSMETIC_CSS).catch(() => {}); });
  ytWin.webContents.on('will-navigate', (ev, u) => {
    // Full page navigations to a watch page become picks instead.
    const id = videoId(u);
    if (id) { ev.preventDefault(); ytWin.webContents.send('yt:intercepted', id); }
  });
  ytWin.webContents.on('did-navigate-in-page', (ev, u) => {
    const id = videoId(u);
    if (id && ytWin.webContents.navigationHistory.canGoBack()) {
      ytWin.webContents.navigationHistory.goBack();
      ytWin.webContents.send('yt:intercepted', id);
    }
  });
  ytWin.on('closed', () => (ytWin = null));
  ytWin.loadURL(url);
}
const videoId = u => { const m = /youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)([\w-]{11})/.exec(u || ''); return m && m[1]; };

/* ------------------------------------------------------------------ YouTube page player */
// Some uploaders switch off embedding, which blocks YouTube's embedded player on other sites.
// Those videos still play on YouTube's own watch page, so for them we show the real watch page
// inside the app, over the stage area (or filling the stage screen), trimmed down to just the
// picture and driven by the app's own controls. Nothing is downloaded.
const ytPage = { view: null, host: null, init: null, onResize: null };
const stageWindow = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== mainWin && w.webContents.getURL().includes('stage=1'));
function ytPageAttach(which) {
  const v = ytPage.view;
  if (!v) return;
  const next = which === 'stage' ? (stageWindow() || mainWin) : mainWin;
  if (ytPage.host && ytPage.host !== next && !ytPage.host.isDestroyed()) {
    ytPage.host.contentView.removeChildView(v);
    if (ytPage.onResize) ytPage.host.off('resize', ytPage.onResize);
  }
  ytPage.host = next;
  next.contentView.addChildView(v);
  ytPage.onResize = null;
  if (next !== mainWin) {
    // On the stage screen the video fills the whole window.
    ytPage.onResize = () => { const [w, h] = next.getContentSize(); v.setBounds({ x: 0, y: 0, width: w, height: h }); };
    next.on('resize', ytPage.onResize); ytPage.onResize();
  }
}
function ytPageClose() {
  const v = ytPage.view;
  if (!v) return;
  ytPage.view = null;
  try { if (ytPage.host && !ytPage.host.isDestroyed()) { ytPage.host.contentView.removeChildView(v); if (ytPage.onResize) ytPage.host.off('resize', ytPage.onResize); } } catch {}
  ytPage.host = null;
  try { v.webContents.close(); } catch {}
}
ipcMain.handle('ytpage:open', (e, o = {}) => {
  if (!fromApp(e) || !/^[\w-]{11}$/.test(o.id || '')) return false;
  ytPageClose();
  const v = new WebContentsView({
    webPreferences: { partition: 'persist:youtube', preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  v.setBackgroundColor('#000000');
  ytPage.view = v;
  ytPage.init = { id: o.id, at: Math.max(0, +o.at || 0), vol: Math.min(100, Math.max(0, +o.vol || 0)), rate: +o.rate || 1, ended: false };
  const wc = v.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  const otherVideo = u => { const m = /[?&]v=([\w-]{11})/.exec(u || ''); return !m || m[1] !== ytPage.init.id; };
  // Stay on this one video: if YouTube tries to move on (autoplay, end screen), treat it as the end.
  wc.on('will-navigate', (ev, u) => { if (otherVideo(u)) { ev.preventDefault(); ytPageEnded(); } });
  wc.on('did-navigate-in-page', (ev, u) => { if (otherVideo(u)) { wc.stop(); ytPageEnded(); } });
  ytPageAttach(o.host);
  if (o.bounds) v.setBounds(roundBounds(o.bounds));
  // KAMIOKE_TEST_WATCH_URL lets the automated tests point this at a local mock page.
  const base = process.env.KAMIOKE_TEST_WATCH_URL || 'https://www.youtube.com/watch';
  wc.loadURL(`${base}?v=${o.id}${ytPage.init.at > 1 ? `&t=${Math.floor(ytPage.init.at)}s` : ''}`);
  return true;
});
function ytPageEnded() {
  if (!ytPage.init || ytPage.init.ended) return;
  ytPage.init.ended = true;
  mainWin && mainWin.webContents.send('ytpage:state', { ended: true, playing: false });
}
const roundBounds = b => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) });
ipcMain.on('ytpage:bounds', (e, b) => { if (fromApp(e) && ytPage.view && ytPage.host === mainWin && b) ytPage.view.setBounds(roundBounds(b)); });
ipcMain.on('ytpage:visible', (e, on) => { if (fromApp(e) && ytPage.view) ytPage.view.setVisible(!!on); });
ipcMain.on('ytpage:host', (e, which) => { if (fromApp(e)) ytPageAttach(which); });
ipcMain.on('ytpage:close', e => { if (fromApp(e)) ytPageClose(); });
ipcMain.on('ytpage:cmd', (e, c) => { if (fromApp(e) && ytPage.view) ytPage.view.webContents.send('ytpage:cmd', c); });
// From the watch page itself.
ipcMain.on('ytpage:init', e => { e.returnValue = ytPage.view && e.sender === ytPage.view.webContents ? ytPage.init : null; });
ipcMain.on('ytpage:state', (e, st) => {
  if (!ytPage.view || e.sender !== ytPage.view.webContents || !st) return;
  if (st.ended) return ytPageEnded();
  mainWin && mainWin.webContents.send('ytpage:state', {
    t: +st.t || 0, d: +st.d || 0, playing: !!st.playing, ad: !!st.ad, title: String(st.title || '').slice(0, 200), blocked: st.blocked ? String(st.blocked).slice(0, 200) : null,
  });
});

/* ------------------------------------------------------------------ ad blocking */
function installAdBlock(ses) {
  ses.webRequest.onBeforeRequest({ urls: AD_URL_PATTERNS }, (d, cb) => cb({ cancel: !!prefs.adBlock }));
}

/* ------------------------------------------------------------------ windows */
function appOnly(ses) {
  const ok = new Set(['media', 'fullscreen', 'wake-lock', 'speaker-selection', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const u = details.requestingUrl || wc.getURL();
    const mine = u.startsWith(ORIGIN + '/');
    if (perm === 'media') return cb(mine && (details.mediaTypes || []).every(t => t === 'audio'));
    cb(mine && ok.has(perm));
  });
  ses.setPermissionCheckHandler((wc, perm, origin) => (origin === ORIGIN || origin === ORIGIN + '/') && (ok.has(perm) || perm === 'media'));
  ses.setDevicePermissionHandler(() => false);
}

function stageBounds() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const ext = displays.find(d => d.id !== primary.id);
  return ext ? { ...ext.bounds, fullscreen: true } : { width: 1280, height: 720, fullscreen: false };
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 720, minHeight: 540, show: false,
    backgroundColor: '#1c1222', title: 'Kami-oke', autoHideMenuBar: true,
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegrationInSubFrames: true, // lets the ad blocker run inside YouTube's player frame
      backgroundThrottling: false,
    },
  });
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN + '/') && url.includes('stage=1')) {
      const b = stageBounds();
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          x: b.x, y: b.y, width: b.width, height: b.height, fullscreen: b.fullscreen,
          backgroundColor: '#000000', autoHideMenuBar: true, title: 'Kami-oke — Stage',
          icon: path.join(ROOT, 'build', 'icon.png'),
          webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegrationInSubFrames: true, backgroundThrottling: false },
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { mainWin.setFullScreen(!mainWin.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { mainWin.webContents.toggleDevTools(); e.preventDefault(); }
  });
  mainWin.on('closed', () => { ytPageClose(); mainWin = null; if (ytWin && !ytWin.isDestroyed()) ytWin.close(); });
  mainWin.loadURL(ORIGIN + '/index.html');
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const port = await listen();
    ORIGIN = `http://127.0.0.1:${port}`;
    const yts = session.fromPartition('persist:youtube');
    for (const ses of [session.defaultSession, yts]) installAdBlock(ses);
    appOnly(session.defaultSession);
    yts.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'fullscreen'));
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
