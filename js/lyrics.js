// Lyrics: LRC parsing (plain + enhanced word timings), serialising, timing lookup,
// and an optional online lookup against LRCLIB (a free, open synced-lyrics database).
// Pure module: no DOM access, so it can be unit-tested in Node.

const TS = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TS = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

const toSec = (m, s) => parseInt(m, 10) * 60 + parseFloat(String(s).replace(':', '.'));

export function fmtStamp(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
}

/**
 * Parse LRC text into { meta, lines }.
 * lines: [{ t, end, text, words: [{ t, end, text }] | null }] sorted by t.
 * Supports multiple stamps per line ([00:12.00][01:30.00]chorus), [offset:+/-ms],
 * and enhanced word stamps (<00:12.30>word). Plain text with no stamps returns
 * lines with t = NaN so the caller can offer the tap-to-sync tool.
 */
export function parseLRC(text) {
  const meta = {};
  const out = [];
  const plain = [];
  const rows = String(text || '').replace(/\r/g, '').split('\n');
  for (const raw of rows) {
    const row = raw.trim();
    if (!row) continue;
    const metaM = row.match(/^\[([a-z#]+):(.*)\]$/i);
    if (metaM && !/^\d/.test(metaM[1])) { meta[metaM[1].toLowerCase()] = metaM[2].trim(); continue; }
    TS.lastIndex = 0;
    const stamps = [];
    let m, lastEnd = 0;
    while ((m = TS.exec(row)) && m.index === lastEnd) { stamps.push(toSec(m[1], m[2])); lastEnd = TS.lastIndex; }
    if (!stamps.length) { plain.push(row); continue; }
    const body = row.slice(lastEnd);
    for (const t of stamps) out.push({ t, body });
  }
  const offset = meta.offset ? parseFloat(meta.offset) / 1000 : 0;
  if (!out.length) {
    return { meta, lines: plain.map(text => ({ t: NaN, end: NaN, text, words: null })), synced: false };
  }
  out.sort((a, b) => a.t - b.t);
  const lines = out.map(({ t, body }) => {
    // LRC offset: positive means lyrics appear sooner.
    const lt = Math.max(0, t - offset);
    WORD_TS.lastIndex = 0;
    if (!WORD_TS.test(body)) return { t: lt, end: NaN, text: body.trim(), words: null };
    WORD_TS.lastIndex = 0;
    const words = [];
    const parts = body.split(WORD_TS); // [pre, m, s, chunk, m, s, chunk ...]
    if (parts[0].trim()) words.push({ t: lt, end: NaN, text: parts[0] }); // text before the first word stamp
    for (let i = 1; i < parts.length; i += 3) {
      const wt = Math.max(0, toSec(parts[i], parts[i + 1]) - offset);
      const chunk = parts[i + 2] || '';
      if (chunk === '') { if (words.length) words[words.length - 1].end = wt; continue; }
      words.push({ t: wt, end: NaN, text: chunk });
    }
    const textOut = words.map(w => w.text).join('').replace(/\s+/g, ' ').trim();
    return { t: lt, end: NaN, text: textOut, words: words.length ? words : null };
  });
  // Fill in line and word end times.
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const L = lines[i];
    const nextT = next ? next.t : L.t + 6;
    if (L.words) {
      for (let j = 0; j < L.words.length; j++) {
        const w = L.words[j];
        if (!isFinite(w.end)) w.end = L.words[j + 1] ? L.words[j + 1].t : Math.min(nextT, w.t + 1.2);
      }
      L.end = Math.max(L.words[L.words.length - 1].end, L.t + 0.2);
    } else {
      // Don't let a line "last" across a long instrumental break.
      const guess = L.t + Math.max(1.5, Math.min(8, 0.36 * L.text.length));
      L.end = Math.min(nextT, guess);
    }
  }
  return { meta, lines: lines.filter(l => l.text !== '' || l.words), synced: true, all: lines };
}

/** Spread a line's duration across its words by character count (for line-only LRC). */
export function wordsFor(line) {
  if (line.words) return line.words;
  const toks = line.text.split(/(\s+)/).filter(s => s.length);
  const words = [];
  let buf = '';
  for (const tok of toks) {
    if (/^\s+$/.test(tok)) { buf += tok; continue; }
    if (buf && words.length) words[words.length - 1].text += buf;
    buf = '';
    words.push({ text: tok });
  }
  const weight = w => w.text.replace(/\s/g, '').length + 1.5;
  const total = words.reduce((a, w) => a + weight(w), 0) || 1;
  const dur = Math.max(0.2, line.end - line.t);
  let t = line.t;
  for (const w of words) {
    const d = dur * weight(w) / total;
    w.t = t; w.end = t + d; t += d;
  }
  line.words = words;
  line.estimated = true;
  return words;
}

/** Index of the line active at time t (last line with start <= t), or -1. Binary search. */
export function lineAt(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Progress 0..1 through a word at time t. */
export const wordProgress = (w, t) => t <= w.t ? 0 : t >= w.end ? 1 : (t - w.t) / (w.end - w.t);

/** Serialise lines back to LRC (line-level stamps; enhanced if every word has a real stamp). */
export function toLRC(lines, meta = {}) {
  const head = Object.entries(meta)
    .filter(([k, v]) => v !== undefined && v !== '' && k !== 'offset')
    .map(([k, v]) => `[${k}:${v}]`);
  const body = lines.filter(l => isFinite(l.t)).map(l => {
    if (l.words && !l.estimated) {
      return `[${fmtStamp(l.t)}]` + l.words.map(w => `<${fmtStamp(w.t)}>${w.text}`).join('');
    }
    return `[${fmtStamp(l.t)}]${l.text}`;
  });
  return head.concat(body).join('\n') + '\n';
}

// Text that YouTube's hover-preview player overlays on a search result card. If a title
// contains any of these, everything from that point on is page furniture, not the title.
const SCRAPE_MARKERS = /(tap to unmute|if playback doesn'?t begin|up next\b|watch later|include playlist|an error occurred|\b\d+(\.\d+)?x\b(?=[A-Z])|shopping\b|cancel\s*play now)/i;
export const looksScraped = t => SCRAPE_MARKERS.test(String(t || '')) || String(t || '').length > 110;

/** Make a song title short and readable: drop page junk, "(Karaoke Version)"-style tags and channel suffixes. */
export function cleanTitle(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = SCRAPE_MARKERS.exec(s);
  if (m) s = s.slice(0, m.index);
  s = s.replace(/[\[(][^\])]*(karaoke|instrumental|official|lyrics?|video|audio|hd|4k|remaster(ed)?|version|sing ?along)[^\])]*[\])]/gi, '');
  s = s.replace(/\s+[|•]\s+.*$/, '');                       // "Song | Channel"
  s = s.replace(/\b(karaoke( version)?|instrumental|with lyrics|lyrics|sing ?along)\b/gi, '');
  s = s.replace(/\s*[-–—:]\s*$/, '').replace(/^\s*[-–—:]\s*/, '').replace(/\s{2,}/g, ' ').trim();
  if (s.length > 70) s = s.slice(0, 70).replace(/\s+\S*$/, '') + '…';
  return s;
}

/**
 * Guess artist/title from a file name like "Artist - Title (Karaoke Version).mp3".
 */
export function guessArtistTitle(name) {
  const s = cleanTitle(String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' '));
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: s };
}

/**
 * Ask LRCLIB for synced lyrics. Returns LRC text or null. Network failures resolve to null.
 * https://lrclib.net/docs — free, no key; we identify the app in the User-Agent where allowed.
 */
export async function findLyricsOnline({ artist, title, duration }, fetchImpl = globalThis.fetch) {
  if (!title) return null;
  const base = 'https://lrclib.net/api';
  const tryJson = async url => {
    try {
      const r = await fetchImpl(url, { headers: { 'Lrclib-Client': 'Kami-oke/2 (github.com/terpenesalad/karaoke)' } });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  };
  if (artist) {
    const q = new URLSearchParams({ artist_name: artist, track_name: title });
    if (duration && isFinite(duration)) q.set('duration', String(Math.round(duration)));
    const hit = await tryJson(`${base}/get?${q}`);
    if (hit && hit.syncedLyrics) return hit.syncedLyrics;
  }
  const q = new URLSearchParams({ q: [artist, title].filter(Boolean).join(' ') });
  const list = await tryJson(`${base}/search?${q}`);
  if (!Array.isArray(list)) return null;
  const synced = list.filter(x => x && x.syncedLyrics);
  if (!synced.length) return null;
  if (duration && isFinite(duration)) {
    synced.sort((a, b) => Math.abs((a.duration || 0) - duration) - Math.abs((b.duration || 0) - duration));
  }
  return synced[0].syncedLyrics;
}
