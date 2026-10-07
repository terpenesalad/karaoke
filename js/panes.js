// Mixer panes, rendered from the declarative settings list.
import { $, $$, h, toast, store } from './util.js';
import { PARAMS, TOGGLES, PRESETS, THEMES, P, resetSettings, saveSettings } from './settings.js';

const fmt = (p, v) => {
  const dec = p.step < 1 ? (p.step < .1 ? 2 : 1) : 0;
  const sign = v > 0 && (p.unit === 'dB' || p.unit === 'st') ? '+' : '';
  return sign + Number(v).toFixed(dec) + (p.unit ? (p.unit === '%' || p.unit === ':1' ? '' : ' ') + p.unit : '');
};
const spoken = (p, v) => fmt(p, v).replace(' dB', ' decibels').replace(' Hz', ' hertz').replace(' ms', ' milliseconds').replace(' st', ' semitones').replace(/%$/, ' percent').replace(' s', ' seconds');

function slider(app, p) {
  const id = 'p-' + p.id;
  const out = h('output', { for: id });
  const inp = h('input', { type: 'range', id, min: p.min, max: p.max, step: p.step, value: P[p.id] });
  const show = () => { out.textContent = fmt(p, P[p.id]); inp.setAttribute('aria-valuetext', spoken(p, P[p.id])); };
  inp.addEventListener('input', () => {
    P[p.id] = parseFloat(inp.value); show();
    if (p.id === 'speed') app.applyRate();
    if (p.id === 'lyricOffset') { const c = app.cur; if (c) store.set('brk2-offset:' + c.id, P.lyricOffset); return; }
    app.apply();
  });
  show();
  const kids = [h('div.head', null, h('label', { for: id }, p.label), out), inp];
  if (p.help) { const hid = id + '-help'; inp.setAttribute('aria-describedby', hid); kids.push(h('p.help', { id: hid }, p.help)); }
  return h('div.row', { dataset: { pid: p.id } }, ...kids);
}

function toggle(app, t) {
  const b = h('button.sw', { type: 'button', role: 'switch', 'aria-checked': String(!!P[t.id]) },
    h('span.t', null, t.label, t.sub ? h('small', null, t.sub) : null), h('span.pill', { 'aria-hidden': 'true' }));
  b.onclick = () => {
    P[t.id] = !P[t.id];
    b.setAttribute('aria-checked', String(P[t.id]));
    app.apply(); refreshDeps();
  };
  return b;
}

function refreshDeps() {
  $$('#pane .row[data-pid]').forEach(r => {
    const p = PARAMS.find(x => x.id === r.dataset.pid);
    if (p && p.dep) r.classList.toggle('off', !P[p.dep]);
  });
}

function stepper(label, value, dec, inc, describe) {
  return h('div', null,
    h('div.head', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', { id: 'stp-' + label.replace(/\W/g, '') }, label)),
    h('div.stepper', { role: 'group', 'aria-labelledby': 'stp-' + label.replace(/\W/g, '') },
      h('button.btn', { type: 'button', onclick: dec, 'aria-label': `${label}: lower` }, '−'),
      h('span.val', { 'aria-live': 'polite' }, value),
      h('button.btn', { type: 'button', onclick: inc, 'aria-label': `${label}: higher` }, '+')),
    describe ? h('p.help', null, describe) : null);
}

export function renderPane(app, tab) {
  const pane = $('#pane');
  const scroll = pane.scrollTop;
  const groups = new Map();
  const frag = [];
  const group = name => {
    if (!groups.has(name)) {
      const g = h('section.group', null, h('h3', null, name));
      groups.set(name, g); frag.push(g);
    }
    return groups.get(name);
  };
  const cur = app.cur;

  if (tab === 'mix') {
    const g = group('Backing track');
    if (cur && cur.kind === 'yt') g.append(h('p.hint', null, 'This is a YouTube video, so only the Music fader and Tempo apply. The vocal remover and key change work on your own files and the sing-alongs.'));
  }
  if (tab === 'fx') {
    const g = group('Presets');
    const chips = h('div.chips', { role: 'group', 'aria-label': 'Effect presets' });
    for (const name of Object.keys(PRESETS)) {
      chips.append(h('button.chip', { type: 'button', 'aria-pressed': 'false', onclick: e => {
        Object.assign(P, PRESETS[name]); app.apply(); renderPane(app, 'fx');
        toast(`${name} preset`);
      } }, name));
    }
    g.append(chips);
  }

  // Declarative rows, in list order.
  const want = PARAMS.filter(p => p.tab === tab).map(p => ({ p })).concat(TOGGLES.filter(t => t.tab === tab && !t.hidden).map(t => ({ t })));
  const order = [...PARAMS, ...TOGGLES];
  want.sort((a, b) => order.indexOf(a.p || a.t) - order.indexOf(b.p || b.t));
  // Toggles first within their group reads better.
  for (const it of want) {
    if (it.t) {
      if (it.t.desktopOnly && !app.host) continue;
      group(it.t.grp).append(toggle(app, it.t));
    }
  }
  for (const it of want) {
    if (!it.p) continue;
    const p = it.p;
    if (p.id === 'key') {
      const v = P.key;
      group(p.grp).append(stepper('Key', v === 0 ? 'Original key' : (v > 0 ? '+' : '−') + Math.abs(v) + (Math.abs(v) === 1 ? ' semitone' : ' semitones'),
        () => app.setKey(P.key - 1), () => app.setKey(P.key + 1),
        'Move the song up or down to suit your voice. Changing key takes a few seconds the first time.'));
      continue;
    }
    if (p.id === 'lyricOffset') {
      const v = P.lyricOffset;
      group(p.grp).append(stepper('Lyrics timing', v === 0 ? 'On time' : `${Math.abs(v).toFixed(1)} s ${v > 0 ? 'earlier' : 'later'}`,
        () => app.nudgeOffset(-.1), () => app.nudgeOffset(.1), 'If the words are ahead of or behind the music. Saved for this song.'));
      continue;
    }
    group(p.grp).append(slider(app, p));
  }

  if (tab === 'voice') {
    const g = group('Input');
    const sel = h('select', { id: 'micSel', 'aria-label': 'Microphone' }, h('option', { value: '' }, 'Default microphone'));
    app.engine.listInputs().then(list => {
      for (const d of list) if (d.deviceId && d.deviceId !== 'default') sel.append(h('option', { value: d.deviceId, selected: d.deviceId === P.micDevice }, d.label || 'Microphone'));
    });
    sel.onchange = async () => { P.micDevice = sel.value; saveSettings(); if (app.engine.micOn) await app.startMic(); };
    g.querySelector('h3').after(h('label.block', { for: 'micSel', style: { marginTop: '.3rem' } }, 'Microphone'), sel);
    const f = group('Feedback');
    const n = app.engine.notches.length;
    f.append(h('p.hint', null, 'Howling means the mic can hear the speakers. Point the speakers away from the singer, step back from them, or lower the Voice fader a little.'));
    if (n) f.append(h('p.hint', null, `${n} feedback ${n === 1 ? 'filter is' : 'filters are'} active.`), h('button.btn.small', { type: 'button', onclick: () => { app.clearNotches(); renderPane(app, 'voice'); } }, 'Clear feedback filters'));
  }

  if (tab === 'lyrics') {
    const g = group('This song');
    if (!cur) g.append(h('p.hint', null, 'Pick a song to edit or find its lyrics.'));
    else if (cur.kind === 'yt') g.append(h('p.hint', null, 'YouTube karaoke videos show their own lyrics.'));
    else if (cur.kind === 'demo') g.append(h('p.hint', null, 'Sing-alongs come with their lyrics built in.'));
    else g.append(h('button.btn.primary', { type: 'button', onclick: () => app.openLyrics(cur), style: { width: '100%' } }, 'Edit or find lyrics'),
      h('p.hint', null, 'Add an .lrc file with the same name as the song (drop it on the window) and it’s picked up automatically.'));
  }

  if (tab === 'settings') {
    const look = group('Display');
    const chips = h('div.chips', { role: 'radiogroup', 'aria-label': 'Colour theme' });
    for (const [id, label] of THEMES) {
      chips.append(h('button.chip', { type: 'button', role: 'radio', 'aria-checked': String(P.theme === id), tabindex: P.theme === id ? 0 : -1, onclick: () => { P.theme = id; app.apply(); renderPane(app, 'settings'); } }, label));
    }
    chips.addEventListener('keydown', e => {
      const i = THEMES.findIndex(([id]) => id === P.theme);
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      P.theme = THEMES[(i + d + THEMES.length) % THEMES.length][0]; app.apply(); renderPane(app, 'settings');
      document.querySelector('#pane [role=radio][aria-checked=true]')?.focus();
    });
    look.querySelector('h3').after(h('p.help', null, 'Colour theme'), chips);

    const s = group('Session');
    s.append(h('div.stack', null,
      h('button.btn', { type: 'button', onclick: () => app.toggleRecord() }, app.engine.recording ? 'Stop and save the recording' : 'Record the performance'),
      h('button.btn', { type: 'button', onclick: () => {
        if (!confirm('Reset every slider and switch to how it was when you first opened the app? Your songs and lyrics stay.')) return;
        const theme = P.theme; resetSettings(); P.theme = theme; app.apply(); renderPane(app, 'settings'); toast('Settings reset');
      } }, 'Reset all settings')));
    const info = group('Sound check');
    const lat = app.engine.latencyMs();
    const dl = h('dl.spec');
    for (const [k, v] of [
      ['Audio delay', lat == null ? 'Start the mic to measure' : lat + ' ms'],
      ['Sample rate', app.engine.ctx ? (app.engine.ctx.sampleRate / 1000).toFixed(1) + ' kHz' : '—'],
      ['Microphone', app.engine.micOn ? (app.engine.muted ? 'muted' : 'on') : 'off'],
    ]) dl.append(h('div', null, h('dt', null, k), h('dd', null, v)));
    info.append(dl, h('p.hint', null, 'Bluetooth speakers and headphones add 150–250 ms of delay, which throws singers off. Use a cable or a USB audio interface if you can.'));
    const about = group('About');
    about.append(h('p.hint', null, 'Kami-oke 2. Your files and lyrics stay on this computer. Synced lyrics lookups use ', h('a', { href: 'https://lrclib.net', target: '_blank', rel: 'noopener' }, 'LRCLIB'), '. ',
      h('a', { href: 'https://github.com/terpenesalad/karaoke', target: '_blank', rel: 'noopener' }, 'Source code and updates'), '.'));
  }

  pane.replaceChildren(...frag);
  pane.scrollTop = scroll;
  refreshDeps();
}

export function setupTabs(app) {
  const tabs = $$('#console [role=tab]');
  let current = 'mix';
  const select = (b, focus) => {
    tabs.forEach(x => { const on = x === b; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    current = b.dataset.tab;
    $('#pane').setAttribute('aria-labelledby', b.id);
    renderPane(app, current);
    $('#pane').scrollTop = 0;
    if (focus) b.focus();
  };
  tabs.forEach((b, i) => {
    b.onclick = () => select(b);
    b.onkeydown = e => {
      const k = e.key;
      let j = null;
      if (k === 'ArrowRight') j = (i + 1) % tabs.length;
      else if (k === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      else if (k === 'Home') j = 0; else if (k === 'End') j = tabs.length - 1;
      if (j != null) { e.preventDefault(); select(tabs[j], true); }
    };
  });
  return () => current;
}
