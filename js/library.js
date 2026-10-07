// Song library + queue. Built-in sing-alongs are always present; YouTube songs persist
// everywhere; your own files persist in the desktop app (by path) and for the session on the web.
import { DEMOS } from './demos.js';
import { guessArtistTitle } from './lyrics.js';
import { store, uid, h } from './util.js';
import { ytThumb } from './youtube.js';

const LIB_KEY = 'brk2-library';
const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|ogv)$/i;
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|mp4|m4v|webm|mkv|mov|ogv)$/i;
export const isMedia = name => MEDIA_EXT.test(name);
export const isLyricsFile = name => /\.(lrc|txt)$/i.test(name);
export const baseName = n => String(n).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

export class Library {
  constructor(host) {
    this.host = host;
    this.songs = [];
    this.queue = [];      // [{ qid, songId, singer }]
    this.listeners = [];
    const saved = store.get(LIB_KEY, []);
    this.songs = saved.filter(s => s.kind === 'yt' || (s.kind === 'file' && s.path && host));
    this.queue = store.get('brk2-queue', []).filter(q => this.get(q.songId) || q.songId.startsWith('demo-'));
  }
  onChange(fn) { this.listeners.push(fn); }
  changed() {
    store.set(LIB_KEY, this.songs.filter(s => s.kind === 'yt' || (s.kind === 'file' && s.path)).map(({ src, missing, ...s }) => s));
    store.set('brk2-queue', this.queue);
    this.listeners.forEach(f => f());
  }
  all() { return [...this.songs, ...DEMOS.map(d => ({ id: d.id, kind: 'demo', title: d.title, artist: d.artist, demo: d }))]; }
  get(id) {
    const d = DEMOS.find(x => x.id === id);
    if (d) return { id: d.id, kind: 'demo', title: d.title, artist: d.artist, demo: d };
    return this.songs.find(s => s.id === id) || null;
  }

  /** Desktop: re-register saved paths with the app's media server on start-up. */
  async reconnect() {
    if (!this.host) return;
    const files = this.songs.filter(s => s.kind === 'file');
    if (!files.length) return;
    const res = await this.host.registerPaths(files.map(s => s.path));
    files.forEach((s, i) => { const r = res[i]; s.src = r && r.url; s.missing = !r; });
    this.listeners.forEach(f => f());
  }

  addFileSong({ name, src, path, lrc }) {
    const existing = path && this.songs.find(s => s.path === path);
    if (existing) { existing.src = src; existing.missing = false; if (lrc) store.set('brk2-lrc:' + existing.id, lrc); return existing; }
    const { artist, title } = guessArtistTitle(name);
    const s = { id: uid(), kind: 'file', title: title || baseName(name), artist, src, path: path || null, isVideo: VIDEO_EXT.test(name), name, addedAt: Date.now() };
    this.songs.unshift(s);
    if (lrc) store.set('brk2-lrc:' + s.id, lrc);
    return s;
  }
  addYouTube(id, title) {
    let s = this.songs.find(x => x.kind === 'yt' && x.ytId === id);
    if (s) { if (title && s.title === 'YouTube video') s.title = title; return s; }
    const g = title ? guessArtistTitle(title) : { artist: '', title: '' };
    s = { id: 'yt-' + id, kind: 'yt', ytId: id, title: g.title || title || 'YouTube video', artist: g.artist ? g.artist + ' · YouTube' : 'YouTube', addedAt: Date.now() };
    this.songs.unshift(s);
    return s;
  }
  rename(id, title) { const s = this.get(id); if (s && s.kind !== 'demo') { s.title = title; this.changed(); } }
  remove(id) {
    const i = this.songs.findIndex(s => s.id === id);
    if (i < 0) return;
    const [s] = this.songs.splice(i, 1);
    if (s.src && s.src.startsWith('blob:')) URL.revokeObjectURL(s.src);
    this.queue = this.queue.filter(q => q.songId !== id);
    store.del('brk2-lrc:' + id);
    this.changed();
  }
  enqueue(songId, singer) { this.queue.push({ qid: uid(), songId, singer: singer || '' }); this.changed(); }
  dequeue(qid) { this.queue = this.queue.filter(q => q.qid !== qid); this.changed(); }
  moveQueue(qid, dir) {
    const i = this.queue.findIndex(q => q.qid === qid), j = i + dir;
    if (i < 0 || j < 0 || j >= this.queue.length) return;
    [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    this.changed();
  }
  shift() { const q = this.queue.shift(); this.changed(); return q; }
}

const ICON = {
  queue: 'M3 6h12v2H3zm0 5h12v2H3zm0 5h8v2H3zm14-1v-3h2v3h3v2h-3v3h-2v-3h-3v-2z',
  lyrics: 'M4 4h16v2H4zm0 4h10v2H4zm0 4h16v2H4zm0 4h10v2H4zm13.5-1.5L21 18l-3.5 3.5V19H15v-2h2.5z',
  remove: 'M6 7h12l-1 13H7zm3-3h6l1 2H8z',
  up: 'M12 6l6 6h-4v6h-4v-6H6z', down: 'M12 18l-6-6h4V6h4v6h4z',
};
export const icon = (name) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICON[name]);
  s.append(p); return s;
};

/** Render the library list. handlers: { play(song), queue(song), lyrics(song), remove(song) } */
export function renderLibrary(lib, el, filter, currentId, handlers) {
  const f = (filter || '').trim().toLowerCase();
  const match = s => !f || (s.title + ' ' + (s.artist || '')).toLowerCase().includes(f);
  const mine = lib.songs.filter(match);
  const demos = lib.all().filter(s => s.kind === 'demo' && match(s));
  const row = s => {
    const art = h('span.art', { 'aria-hidden': 'true', dataset: { kind: s.kind } });
    if (s.kind === 'yt') art.style.backgroundImage = `url(${ytThumb(s.ytId)})`;
    else art.textContent = s.kind === 'demo' ? '♪' : ((s.name || '').match(/\.([a-z0-9]{2,4})$/i)?.[1] || (s.isVideo ? 'vid' : 'mp3')).toUpperCase();
    const sub = s.missing ? 'File not found — it may have moved' : (s.artist || (s.kind === 'file' ? 'Your file' : ''));
    const li = h('div.song', { role: 'listitem', dataset: { current: String(s.id === currentId), id: s.id } },
      art,
      h('button.play-it', { type: 'button', onclick: () => handlers.play(s), 'aria-label': `Sing ${s.title}${s.artist ? ', ' + s.artist : ''}` },
        h('span.t', null, s.title), h('span.s', null, sub)),
      h('span.acts', null,
        h('button.icon-btn', { type: 'button', title: 'Add to up next', 'aria-label': `Add ${s.title} to up next`, onclick: () => handlers.queue(s) }, icon('queue')),
        s.kind === 'file' ? h('button.icon-btn', { type: 'button', title: 'Lyrics', 'aria-label': `Lyrics for ${s.title}`, onclick: () => handlers.lyrics(s) }, icon('lyrics')) : null,
        s.kind !== 'demo' ? h('button.icon-btn', { type: 'button', title: 'Remove', 'aria-label': `Remove ${s.title}`, onclick: () => handlers.remove(s) }, icon('remove')) : null));
    return li;
  };
  const kids = [];
  if (mine.length) kids.push(h('p.lib-group', { 'aria-hidden': 'true' }, 'Your songs'), ...mine.map(row));
  else if (!f) kids.push(h('p.lib-empty', null, 'Your songs will show here. Drop music or video files anywhere on this window, or use the buttons above.'));
  if (demos.length) kids.push(h('p.lib-group', { 'aria-hidden': 'true' }, 'Sing-alongs (built in)'), ...demos.map(row));
  if (!kids.length) kids.push(h('p.lib-empty', null, `Nothing matches “${filter}”.`));
  el.replaceChildren(...kids);
}

export function renderQueue(lib, el, handlers) {
  if (!lib.queue.length) {
    el.replaceChildren(h('li.empty', null, 'Nobody’s queued. Use the + button next to a song.'));
    return;
  }
  el.replaceChildren(...lib.queue.map((q, i) => {
    const s = lib.get(q.songId);
    if (!s) return null;
    return h('li', null,
      h('span', null, h('span.qt', { style: { display: 'block' } }, s.title), h('span.qs', null, q.singer || 'Anyone')),
      h('span.acts', { style: { display: 'flex' } },
        i > 0 ? h('button.icon-btn', { type: 'button', 'aria-label': `Move ${s.title} up`, onclick: () => handlers.move(q, -1) }, icon('up')) : null,
        h('button.icon-btn', { type: 'button', 'aria-label': `Remove ${s.title} from up next`, onclick: () => handlers.remove(q) }, icon('remove'))));
  }).filter(Boolean));
}
