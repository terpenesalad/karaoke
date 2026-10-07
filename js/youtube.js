// YouTube playback through the official IFrame Player API. Karaoke uploads on YouTube
// already have the lyrics burned in, so this is the quickest way to a huge catalogue.
// Audio from the embedded player can't be routed through the mixer (it's a separate
// origin), so the Music fader controls its volume directly.

let apiPromise = null;
function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; rej(new Error('Could not reach YouTube. Check the internet connection.')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function parseYouTube(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  if (m) return { id: m[1] };
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { id: s };
  const list = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (list) return { list: list[1] };
  return null;
}

export const ytThumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** Local player. Events: onState({playing, ended}), onReady(), onError(message), onTitle(title). */
export class YTPlayer {
  constructor(mount, ev = {}) {
    this.mount = mount; this.ev = ev; this.p = null; this.ready = false; this.pending = null;
  }
  async load(id, { autoplay = true, start = 0 } = {}) {
    this.pending = { id, autoplay, start };
    let YT;
    try { YT = await loadApi(); } catch (e) { this.ev.onError?.(e.message); return; }
    if (this.p && this.ready) {
      const { id: vid, autoplay: ap, start: st } = this.pending; this.pending = null;
      ap ? this.p.loadVideoById({ videoId: vid, startSeconds: st }) : this.p.cueVideoById({ videoId: vid, startSeconds: st });
      return;
    }
    if (this.p) return; // still booting; pending will be applied in onReady
    const host = document.createElement('div');
    this.mount.replaceChildren(host);
    this.p = new YT.Player(host, {
      width: '100%', height: '100%', videoId: id,
      playerVars: { playsinline: 1, rel: 0, iv_load_policy: 3, autoplay: autoplay ? 1 : 0, start: Math.floor(start), fs: 0, disablekb: 1, cc_load_policy: 0 },
      events: {
        onReady: e => {
          this.ready = true;
          if (this.volume != null) e.target.setVolume(this.volume);
          const p = this.pending; this.pending = null;
          if (p && p.id !== id) this.load(p.id, p);
          else if (autoplay) e.target.playVideo();
          this.ev.onReady?.();
        },
        onStateChange: e => {
          const S = YT.PlayerState;
          if (e.data === S.PLAYING) { const t = this.title; if (t) this.ev.onTitle?.(t); }
          this.ev.onState?.({ playing: e.data === S.PLAYING || e.data === S.BUFFERING, ended: e.data === S.ENDED });
        },
        onError: e => {
          const why = { 2: 'That link isn’t a valid video.', 5: 'That video can’t play here.', 100: 'That video was removed or made private.', 101: 'The uploader doesn’t allow this video to play outside YouTube. Try another version.', 150: 'The uploader doesn’t allow this video to play outside YouTube. Try another version.', 153: 'YouTube refused to play the video here. Try another version.' }[e.data];
          this.ev.onError?.(why || 'YouTube couldn’t play that video.', e.data);
        },
      },
    });
  }
  get title() { try { return this.p.getVideoData().title || ''; } catch { return ''; } }
  get time() { try { return this.p.getCurrentTime() || 0; } catch { return 0; } }
  get duration() { try { return this.p.getDuration() || 0; } catch { return 0; } }
  get playing() { try { return this.p.getPlayerState() === 1; } catch { return false; } }
  play() { try { this.p.playVideo(); } catch {} }
  pause() { try { this.p.pauseVideo(); } catch {} }
  seek(t) { try { this.p.seekTo(t, true); } catch {} }
  setVolume(v) { this.volume = v; try { this.ready && this.p.setVolume(v); } catch {} }
  setRate(r) { try { this.p.setPlaybackRate(r); } catch {} }
  stop() { try { this.p && this.ready && this.p.stopVideo(); } catch {} }
}
