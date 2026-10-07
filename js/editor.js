// Lyrics editor dialog: paste, open an .lrc, look up synced lyrics online, or sync plain
// lines yourself by tapping as each one starts.
import { $, toast, store, download, announce } from './util.js';
import { parseLRC, toLRC, fmtStamp, findLyricsOnline, guessArtistTitle } from './lyrics.js';

let song = null;
let sync = null; // { lines: [text], i, stamps: [] }

export function openLyricsEditor(app, s) {
  if (!s) { toast('Pick a song first'); return; }
  if (s.kind !== 'file') { toast(s.kind === 'yt' ? 'YouTube karaoke videos show their own lyrics.' : 'Sing-alongs have their lyrics built in.'); return; }
  song = s;
  $('#dlgLyrics .dl-song').textContent = s.title;
  $('#lyText').value = store.get('brk2-lrc:' + s.id, '') || '';
  $('#lyStatus').textContent = '';
  $('#lySave').hidden = false;
  stopSync();
  $('#dlgLyrics').showModal();
}

export function initLyricsEditor(app) {
  const status = msg => ($('#lyStatus').textContent = msg);
  $('#lyFind').onclick = async () => {
    if (!song) return;
    status('Searching…');
    const g = song.artist ? { artist: song.artist, title: song.title } : guessArtistTitle(song.name || song.title);
    const dur = app.cur === song ? app.duration() : null;
    const found = await findLyricsOnline({ ...g, duration: dur });
    if (found) { $('#lyText').value = found; status('Found synced lyrics. Check they match, then Save.'); }
    else status('Nothing found. Check the song’s title and artist are right (rename the file as “Artist - Title”), or paste lyrics and sync them by tapping.');
  };
  $('#lyFile').onclick = () => $('#lrcPick').click();
  $('#lrcPick').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) { $('#lyText').value = await f.text(); status(`Loaded ${f.name}. Save to keep it.`); }
  });
  $('#lySave').onclick = async () => {
    if (!song) return;
    const text = $('#lyText').value;
    const parsed = parseLRC(text);
    store.set('brk2-lrc:' + song.id, text);
    if (app.cur === song) app.setLyricsText(text);
    if (app.host && song.path && parsed.synced) await app.host.saveSiblingLyrics(song.path, text).catch(() => null);
    if (!parsed.synced && text.trim()) status('Saved. These lines have no timings yet — use “Sync by tapping” so they follow the music.');
    else { status('Saved.'); toast('Lyrics saved'); }
  };
  $('#lyExport').onclick = () => {
    if (!song) return;
    download(new Blob([$('#lyText').value], { type: 'text/plain' }), (song.name ? song.name.replace(/\.[^.]+$/, '') : song.title) + '.lrc');
  };

  // Tap-to-sync.
  $('#lySync').onclick = () => {
    if (!song) return;
    const parsed = parseLRC($('#lyText').value);
    const lines = parsed.lines.map(l => l.text).filter(Boolean);
    if (!lines.length) { status('Paste the words first, one line per lyric line.'); return; }
    if (app.cur !== song) { status('Play this song first, then sync.'); return; }
    sync = { lines, i: 0, stamps: [] };
    $('#syncBar').hidden = false;
    $('#lyText').readOnly = true;
    app.audio.currentTime = 0;
    app.audio.play();
    showSyncLine();
    $('#syncTap').focus();
  };
  const tap = () => {
    if (!sync) return;
    sync.stamps[sync.i] = Math.max(0, app.audio.currentTime + (app.P.lyricOffset || 0) - .15); // allow for reaction time
    sync.i++;
    if (sync.i >= sync.lines.length) return finishSync();
    showSyncLine();
  };
  $('#syncTap').onclick = tap;
  $('#syncStop').onclick = () => finishSync();
  $('#dlgLyrics').addEventListener('keydown', e => {
    if (!sync) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tap(); }
    else if (e.key === 'Backspace') { e.preventDefault(); if (sync.i > 0) { sync.i--; app.audio.currentTime = Math.max(0, (sync.stamps[sync.i] || 0) - 3); showSyncLine(); } }
  });
  $('#dlgLyrics').addEventListener('close', () => { if (sync) finishSync(true); });

  function showSyncLine() {
    $('#syncLine').textContent = `${sync.i + 1} of ${sync.lines.length}: ${sync.lines[sync.i]}`;
  }
  function finishSync(silent) {
    if (!sync) return;
    const done = sync.stamps.length;
    const lrc = sync.lines.map((t, i) => (sync.stamps[i] != null ? `[${fmtStamp(sync.stamps[i])}]` : '') + t).join('\n');
    $('#lyText').value = lrc;
    stopSync();
    app.audio.pause();
    if (!silent) { status(`Timed ${done} of ${lrc.split('\n').length} lines. Save to keep them.`); announce('Sync finished'); }
  }
}
function stopSync() {
  sync = null;
  $('#syncBar').hidden = true;
  $('#lyText').readOnly = false;
}
