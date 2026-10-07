# Kami-oke

Kami-oke (formerly Back Room Karaoke) is karaoke for your living room. Sing over your own music with the lead vocal removed, pull up karaoke videos from YouTube, put the lyrics on the TV, and let the app handle the mic.

**[Download for Windows](https://github.com/terpenesalad/karaoke/releases/latest)** · or use it in a browser at **[terpenesalad.github.io/karaoke](https://terpenesalad.github.io/karaoke/)**

## Getting backing tracks

| Source | How | What works |
| --- | --- | --- |
| **Your own music and videos** | Drop files on the window, or **Add music files**. MP3, M4A, WAV, OGG, FLAC, MP4, WebM, MKV, MOV. | Everything: vocal remover, key change, tempo, synced lyrics, recording. |
| **YouTube karaoke videos** | **Find on YouTube**, then click any video (desktop app), or paste a link. | Words are already on screen. Music fader and tempo apply. Ads are blocked in the desktop app. If an uploader blocks embedding, the desktop app plays that video on YouTube's own watch page inside the stage instead. **Key change** works on YouTube in the desktop app too (it switches the video to the watch page and shifts its audio live). |
| **Built-in sing-alongs** | Listed under *Sing-alongs*. Public-domain songs with original arrangements. | Melody lane and an on-key score. |

The app plays YouTube through YouTube's own player (embedded, or YouTube's watch page for videos that can't be embedded) and never downloads videos.

## Lyrics

- Put an `.lrc` file next to a song with the same name (`Artist - Title.mp3` + `Artist - Title.lrc`) and it's picked up automatically. Enhanced LRC word timings give a word-by-word wipe.
- Or open **Lyrics → Edit or find lyrics** to search [LRCLIB](https://lrclib.net), paste lyrics, or **Sync by tapping**: play the song and press Space as each line starts.
- `,` and `.` nudge the timing if the words run early or late (saved per song).

## Mic and sound

- **Voice**: input gain, low cut, noise gate, compressor, 3-band EQ, mic picker, and a switch to stop monitoring if your mixer already does it.
- **Effects**: reverb, echo, doubler and six presets.
- **Feedback**: if the mic starts howling, *MOVE MICROPHONE AWAY FROM SPEAKERS* breathes in the corner of the screen (and the TV) until it stops, while the app dips the mic and notches out the howling frequency.
- **Automatic music dip** lowers the backing while someone sings.
- **Record** saves the music and your voice together.
- Bluetooth adds 150–250 ms of delay. A cable or USB audio interface is the biggest upgrade you can make.

## Stage screen and parties

**Stage screen** (`S`) opens a lyrics-only window. In the desktop app it goes full screen on your second display automatically. Type a singer's name, add songs to **Up next** with the + button, and the stage shows who's next between songs. Names are remembered: pick one with a click, or use **Edit singers** to rename or delete names (renaming updates anyone already queued).

## Accessibility

- Every control works from the keyboard, with a visible focus ring. Press `?` for shortcuts.
- Screen-reader labels throughout, announcements for song changes and feedback, and an option to read each lyric line aloud as it comes up.
- Atkinson Hyperlegible lettering, adjustable interface and lyric size, and *Night*, *Daylight* and *High contrast* themes. Respects Windows high-contrast mode.
- Reduce motion: lyrics change instantly instead of wiping and sliding.
- Checked with axe-core (WCAG 2.1 AA) across every panel and theme.

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| Space | Play / pause | `[` `]` | Key down / up |
| ← → | Back / forward 5 s | `V` | Vocal remover on / off |
| `N` | Next in queue | `,` `.` | Lyrics earlier / later |
| `M` | Mute mic | `S` | Stage screen |
| `R` | Record | `F` / F11 | Fullscreen |
| `/` | Search songs | `?` | Shortcut list |

## How it works

- **Vocal remover**: cancels what's panned dead centre between 160 Hz and 9 kHz (adjustable), keeps centred bass and kick, and folds a delayed copy of the side signal back in so it still works on mono speakers.
- **Key change**: an offline phase vocoder with identity phase locking and a windowed-sinc resampler, running in a Web Worker at about 45× real time. It shares one phase rotation across both channels, so the vocal remover still works after a key change.
- **YouTube key change** (desktop): the watch page's audio runs through a real-time phase-vocoder pitch shifter (peak-locked, 4096-point frames, about 85 ms of delay) in an AudioWorklet inside that page.
- **Feedback detection**: watches for a narrow, sustained tone with weak harmonics that holds or grows — which a sung note doesn't — then adds a tight notch filter.
- **Desktop app**: Electron. Serves the app from a private `127.0.0.1` server that only streams files you've added (with seeking), grants only the microphone, shows YouTube's watch page over the stage for videos whose uploader blocks embedding, and blocks YouTube ads in three layers: network requests to ad servers, ad slots stripped from player data, and auto-skip for anything left.

## Building

```sh
npm install
npm start        # run the desktop app
npm test         # unit tests
npm run dist     # Windows installer + portable exe in dist/
```

Bump `version` in `package.json` and push to `main`: GitHub Actions tests, builds both `.exe` files on Windows and publishes a release for that version (pushing a `v*` tag works too). The web version needs no build: serve the folder (`python -m http.server`) and open `index.html`.

## Credits

Lettering: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) by the Braille Institute (SIL Open Font License, see `fonts/OFL.txt`). Synced lyrics lookups: [LRCLIB](https://lrclib.net).
