// One declarative list of every adjustable value. The UI renders sliders/switches from it,
// the audio engine reads P, and P is saved to localStorage on every change.
import { store } from './util.js';

export const PARAMS = [
  // Backing track (Mix pane)
  { id: 'vocalCut', tab: 'mix', grp: 'Backing track', label: 'Remove lead vocal', min: 0, max: 100, step: 1, def: 0, unit: '%',
    help: 'Cancels whatever is panned dead centre — usually the singer. Works on most studio recordings, not on live or mono ones.' },
  { id: 'keepBass', tab: 'mix', grp: 'Backing track', label: 'Keep bass and kick below', min: 60, max: 400, step: 10, def: 160, unit: 'Hz' },
  { id: 'key', tab: 'mix', grp: 'Backing track', label: 'Key', min: -6, max: 6, step: 1, def: 0, unit: 'st', live: false },
  { id: 'speed', tab: 'mix', grp: 'Backing track', label: 'Tempo', min: 70, max: 130, step: 1, def: 100, unit: '%' },
  { id: 'duck', tab: 'mix', grp: 'Automatic music dip', label: 'Dip depth', min: 0, max: 70, step: 1, def: 25, unit: '%', dep: 'duckOn' },
  // Voice
  { id: 'trim', tab: 'voice', grp: 'Input', label: 'Input gain', min: -12, max: 24, step: .5, def: 6, unit: 'dB' },
  { id: 'hpf', tab: 'voice', grp: 'Input', label: 'Low cut', min: 40, max: 300, step: 5, def: 95, unit: 'Hz' },
  { id: 'gateThr', tab: 'voice', grp: 'Input', label: 'Gate threshold', min: -75, max: -20, step: 1, def: -52, unit: 'dB', dep: 'gateOn' },
  { id: 'compThr', tab: 'voice', grp: 'Shape', label: 'Compressor', min: -45, max: 0, step: 1, def: -22, unit: 'dB', dep: 'compOn' },
  { id: 'compRat', tab: 'voice', grp: 'Shape', label: 'Compressor ratio', min: 1, max: 12, step: .5, def: 3.5, unit: ':1', dep: 'compOn' },
  { id: 'eqLow', tab: 'voice', grp: 'Tone', label: 'Body (200 Hz)', min: -12, max: 12, step: .5, def: 0, unit: 'dB' },
  { id: 'eqMid', tab: 'voice', grp: 'Tone', label: 'Presence (2 kHz)', min: -12, max: 12, step: .5, def: 1.5, unit: 'dB' },
  { id: 'eqHigh', tab: 'voice', grp: 'Tone', label: 'Air (6 kHz)', min: -12, max: 12, step: .5, def: 2, unit: 'dB' },
  // Effects
  { id: 'verbMix', tab: 'fx', grp: 'Reverb', label: 'Amount', min: 0, max: 100, step: 1, def: 26, unit: '%' },
  { id: 'verbSize', tab: 'fx', grp: 'Reverb', label: 'Room size', min: .3, max: 6, step: .1, def: 1.8, unit: 's' },
  { id: 'verbTail', tab: 'fx', grp: 'Reverb', label: 'Tail shape', min: .6, max: 6, step: .1, def: 2.2, unit: '' },
  { id: 'verbDamp', tab: 'fx', grp: 'Reverb', label: 'Brightness', min: 900, max: 14000, step: 100, def: 5200, unit: 'Hz' },
  { id: 'verbPre', tab: 'fx', grp: 'Reverb', label: 'Pre-delay', min: 0, max: 140, step: 2, def: 22, unit: 'ms' },
  { id: 'dlyMix', tab: 'fx', grp: 'Echo', label: 'Amount', min: 0, max: 100, step: 1, def: 18, unit: '%' },
  { id: 'dlyTime', tab: 'fx', grp: 'Echo', label: 'Time', min: 40, max: 900, step: 5, def: 280, unit: 'ms' },
  { id: 'dlyFb', tab: 'fx', grp: 'Echo', label: 'Repeats', min: 0, max: 80, step: 1, def: 22, unit: '%' },
  { id: 'dlyTone', tab: 'fx', grp: 'Echo', label: 'Repeat brightness', min: 600, max: 12000, step: 100, def: 4200, unit: 'Hz' },
  { id: 'dblMix', tab: 'fx', grp: 'Thicken', label: 'Doubler', min: 0, max: 100, step: 1, def: 0, unit: '%' },
  { id: 'dblSpread', tab: 'fx', grp: 'Thicken', label: 'Doubler width', min: 5, max: 45, step: 1, def: 22, unit: 'ms' },
  // Lyrics display
  { id: 'lyricSize', tab: 'lyrics', grp: 'Display', label: 'Lyric size', min: 60, max: 200, step: 5, def: 100, unit: '%' },
  { id: 'lyricOffset', tab: 'lyrics', grp: 'Timing', label: 'Lyrics early / late', min: -3, max: 3, step: .05, def: 0, unit: 's', perSong: true,
    help: 'Negative shows words sooner. Saved for this song only.' },
  // Display & comfort
  { id: 'breakSecs', tab: 'settings', grp: 'Queue', label: 'Break between songs', min: 5, max: 90, step: 5, def: 20, unit: 's',
    help: 'Time for the next singer to grab the mic before their song starts.' },
  { id: 'uiScale', tab: 'settings', grp: 'Display', label: 'Interface size', min: 90, max: 150, step: 5, def: 100, unit: '%' },
  // Fixed header faders
  { id: 'musicVol', def: 80 },
  { id: 'vocalVol', def: 85 },
];

export const TOGGLES = [
  { id: 'duckOn', tab: 'mix', grp: 'Automatic music dip', label: 'Dip the music while someone sings', sub: 'Keeps the vocal on top without riding the fader.', def: false },
  { id: 'monitorOn', tab: 'voice', grp: 'Input', label: 'Play my voice through the speakers', sub: 'Turn off if your mixer or headphones already let you hear yourself.', def: true },
  { id: 'gateOn', tab: 'voice', grp: 'Input', label: 'Noise gate', sub: 'Silences the mic between lines. Also helps with feedback.', def: true },
  { id: 'compOn', tab: 'voice', grp: 'Shape', label: 'Compressor', sub: 'Evens out loud and quiet singers.', def: true },
  { id: 'howlGuard', tab: 'voice', grp: 'Feedback', label: 'Tame feedback automatically', sub: 'Dips the mic and notches out the howling frequency. The on-screen warning always shows.', def: true },
  { id: 'guideMelody', tab: 'lyrics', grp: 'Sing-alongs', label: 'Show the melody lane', sub: 'Notes to aim for and your pitch, on the built-in songs.', def: true },
  { id: 'nextLine', tab: 'lyrics', grp: 'Display', label: 'Show the next line', sub: 'Read ahead while you sing.', def: true },
  { id: 'readLyrics', tab: 'lyrics', grp: 'Display', label: 'Announce each line to screen readers', sub: 'For singers using a screen reader or braille display.', def: false },
  { id: 'autoNext', tab: 'settings', grp: 'Queue', label: 'Start the next song automatically', sub: 'After a short break with an "up next" card. Turn off to start each song yourself.', def: true },
  { id: 'awake', tab: 'settings', grp: 'Queue', label: 'Keep the screen on', sub: 'Stops the screen sleeping mid-song.', def: true },
  { id: 'adBlock', tab: 'settings', grp: 'YouTube', label: 'Block YouTube ads', sub: 'Desktop app only. Ads are blocked before they load; anything that slips through is skipped.', def: true, desktopOnly: true },
  { id: 'hyperFont', tab: 'settings', grp: 'Display', label: 'Extra-legible lettering', sub: 'Uses Atkinson Hyperlegible everywhere (on by default).', def: true },
  { id: 'reduceMotion', tab: 'settings', grp: 'Display', label: 'Reduce motion', sub: 'Lyrics change instantly instead of sliding and wiping.', def: false },
];

export const THEMES = [
  ['velvet', 'Back room'], ['daylight', 'Daylight'], ['contrast', 'High contrast'],
];

export const PRESETS = {
  'Dry': { verbMix: 4, dlyMix: 0, dblMix: 0, eqMid: 1, eqHigh: 1, verbSize: 1.0, dlyFb: 15 },
  'Slapback': { verbMix: 14, dlyMix: 26, dlyTime: 120, dlyFb: 8, dblMix: 0, verbSize: 1.1, eqHigh: 2.5 },
  'Pop vocal': { verbMix: 26, dlyMix: 18, dlyTime: 280, dlyFb: 22, dblMix: 28, eqLow: -1, eqMid: 2, eqHigh: 3, verbSize: 1.8 },
  'Ballad': { verbMix: 44, dlyMix: 22, dlyTime: 420, dlyFb: 30, dblMix: 12, verbSize: 3.2, verbTail: 2.6, eqHigh: 2, verbDamp: 4200 },
  'Stadium': { verbMix: 62, dlyMix: 34, dlyTime: 520, dlyFb: 44, dblMix: 20, verbSize: 5.0, verbTail: 1.8, verbDamp: 6800 },
  'Eighties': { verbMix: 52, dlyMix: 40, dlyTime: 375, dlyFb: 38, dblMix: 45, eqHigh: 4, eqLow: 1.5, verbSize: 2.8, verbDamp: 9000 },
};

const KEY = 'brk2-settings';
export const P = {};
export function resetSettings() {
  PARAMS.forEach(p => (P[p.id] = p.def));
  TOGGLES.forEach(t => (P[t.id] = t.def));
  P.theme = 'velvet';
  P.micDevice = '';
}
resetSettings();
Object.assign(P, store.get(KEY) || {});
// Per-song values never persist globally.
P.key = 0; P.lyricOffset = 0;
export const saveSettings = () => {
  const { key, lyricOffset, ...rest } = P;
  store.set(KEY, rest);
};
