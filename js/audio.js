// Audio engine. Signal path:
//
//   music <audio> ─▶ vocal remover (mid/side, band-limited) ─▶ music gain ─┐
//   mic ─▶ trim ─▶ low cut ─▶ feedback notches ─▶ compressor ─▶ gate ─▶ EQ ┤
//        ├▶ dry / doubler / ping-pong delay / reverb ─▶ voice gain ─────────┤
//        └▶ analysers (meter, pitch, howl detector)                         ▼
//                                              master ─▶ limiter ─▶ speakers
//                                                      └▶ recorder tap

import { clamp, dbToGain } from './util.js';

export class AudioEngine {
  constructor(P) {
    this.P = P;
    this.ctx = null;
    this.N = {};
    this.micOn = false;
    this.muted = false;
    this.notches = [];      // learned feedback frequencies
    this.listeners = {};
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    const N = this.N;
    const G = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const F = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; };

    N.limiter = ctx.createDynamicsCompressor();
    N.limiter.threshold.value = -1.5; N.limiter.knee.value = 0; N.limiter.ratio.value = 20;
    N.limiter.attack.value = .002; N.limiter.release.value = .12;
    N.limiter.connect(ctx.destination);
    N.master = G(1); N.master.connect(N.limiter);
    N.recTap = ctx.createMediaStreamDestination();
    N.limiter.connect(N.recTap);

    /* ---------------- music: vocal remover ----------------
       mid = (L+R)/2, side = (L-R)/2.  out = mid*(1-a) + midKeep*a ± side,
       where midKeep is the centre below `keepBass` Hz and above ~9 kHz. With a=0 the
       output is bit-for-bit the input; with a=1 the centre vocal band is gone. */
    N.musicIn = G(1);
    N.split = ctx.createChannelSplitter(2);
    N.musicIn.connect(N.split);
    N.mid = G(1); N.side = G(1);
    const half = (ch, dest, sign) => { const g = G(.5 * sign); N.split.connect(g, ch); g.connect(dest); };
    half(0, N.mid, 1); half(1, N.mid, 1);
    half(0, N.side, 1); half(1, N.side, -1);
    N.midFull = G(1); N.mid.connect(N.midFull);
    // 4th-order (two cascaded biquads) splits for a clean band edge.
    N.keepLo1 = F('lowpass', 160, .7071); N.keepLo2 = F('lowpass', 160, .7071);
    N.keepHi1 = F('highpass', 9000, .7071); N.keepHi2 = F('highpass', 9000, .7071);
    N.mid.connect(N.keepLo1); N.keepLo1.connect(N.keepLo2);
    N.mid.connect(N.keepHi1); N.keepHi1.connect(N.keepHi2);
    N.midKeep = G(0); N.keepLo2.connect(N.midKeep); N.keepHi2.connect(N.midKeep);
    N.sideNeg = G(-1); N.side.connect(N.sideNeg);
    N.merge = ctx.createChannelMerger(2);
    for (const src of [N.midFull, N.midKeep]) { src.connect(N.merge, 0, 0); src.connect(N.merge, 0, 1); }
    N.side.connect(N.merge, 0, 0); N.sideNeg.connect(N.merge, 0, 1);
    // Mono safety: with the centre removed, left-only and right-only parts are in opposite
    // phase and would vanish on a mono speaker. Fold a slightly delayed copy of the side
    // signal into the centre (scaled by the cut amount) so they stay audible everywhere.
    N.sideFill = G(0); N.sideDelay = ctx.createDelay(.05); N.sideDelay.delayTime.value = .014;
    N.side.connect(N.sideDelay); N.sideDelay.connect(N.sideFill);
    N.sideFill.connect(N.merge, 0, 0); N.sideFill.connect(N.merge, 0, 1);
    N.music = G(.8); N.merge.connect(N.music); N.music.connect(N.master);
    N.musicAnaly = ctx.createAnalyser(); N.musicAnaly.fftSize = 512; N.music.connect(N.musicAnaly);

    /* ---------------- voice ---------------- */
    N.voice = G(1); N.voice.connect(N.master);
    N.trim = G(1);
    N.hpf = F('highpass', 95, .7);
    N.notchIn = G(1); N.notchOut = G(1);
    N.notchIn.connect(N.notchOut);
    N.comp = ctx.createDynamicsCompressor(); N.comp.knee.value = 6; N.comp.attack.value = .004; N.comp.release.value = .18;
    N.gate = G(1);
    N.eqL = F('lowshelf', 200); N.eqM = F('peaking', 2000, .9); N.eqH = F('highshelf', 6000);
    N.trim.connect(N.hpf); N.hpf.connect(N.notchIn);
    N.notchOut.connect(N.comp); N.comp.connect(N.gate);
    N.gate.connect(N.eqL); N.eqL.connect(N.eqM); N.eqM.connect(N.eqH);

    // Analysers: level + pitch after the compressor; howl detector right after the trim.
    N.analy = ctx.createAnalyser(); N.analy.fftSize = 2048; N.analy.smoothingTimeConstant = 0;
    N.comp.connect(N.analy);
    N.howl = ctx.createAnalyser(); N.howl.fftSize = 4096; N.howl.smoothingTimeConstant = .3;
    N.hpf.connect(N.howl);

    const bus = N.eqH;
    N.monitor = G(1); // "hear yourself" switch — everything below feeds the speakers
    N.dry = G(1); bus.connect(N.dry); N.dry.connect(N.monitor);
    N.dblSend = G(0); bus.connect(N.dblSend);
    N.dbl = [-1, 1].map((side, i) => {
      const d = ctx.createDelay(.2), pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), amt = G(.0025);
      d.delayTime.value = .02; pan.pan.value = side * .7; lfo.frequency.value = .18 + i * .11;
      lfo.connect(amt); amt.connect(d.delayTime); lfo.start();
      N.dblSend.connect(d); d.connect(pan); pan.connect(N.monitor);
      return { d };
    });
    N.dlySend = G(0); bus.connect(N.dlySend);
    N.dL = ctx.createDelay(2); N.dR = ctx.createDelay(2);
    N.fbL = G(0); N.fbR = G(0);
    N.toneL = F('lowpass', 4200); N.toneR = F('lowpass', 4200);
    N.panL = ctx.createStereoPanner(); N.panL.pan.value = -.75;
    N.panR = ctx.createStereoPanner(); N.panR.pan.value = .75;
    N.dlySend.connect(N.dL);
    N.dL.connect(N.panL); N.panL.connect(N.monitor);
    N.dR.connect(N.panR); N.panR.connect(N.monitor);
    N.dL.connect(N.toneL); N.toneL.connect(N.fbL); N.fbL.connect(N.dR);
    N.dR.connect(N.toneR); N.toneR.connect(N.fbR); N.fbR.connect(N.dL);
    N.verbSend = G(0); bus.connect(N.verbSend);
    N.pre = ctx.createDelay(.5); N.conv = ctx.createConvolver(); N.damp = F('lowpass', 5200);
    N.verbSend.connect(N.pre); N.pre.connect(N.conv); N.conv.connect(N.damp); N.damp.connect(N.monitor);
    N.monitor.connect(N.voice);
    // The recorder always gets the voice, even when monitoring is off (hardware monitoring users).
    N.voiceRec = G(0); bus.connect(N.voiceRec); N.voiceRec.connect(N.recTap);

    this.timeBuf = new Float32Array(N.analy.fftSize);
    this.specBuf = new Float32Array(N.howl.frequencyBinCount);
    this.lastIRKey = '';
    this.apply();
    return ctx;
  }

  set(param, v, t = .02) { if (param) param.setTargetAtTime(v, this.ctx.currentTime, t); }

  makeIR(seconds, tail) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.max(64, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, tail);
      const fi = Math.min(len, Math.floor(rate * .004));
      for (let i = 0; i < fi; i++) d[i] *= i / fi;
    }
    return buf;
  }

  musicBase() { return Math.pow(this.P.musicVol / 100, 1.5) * 1.15; }

  apply() {
    if (!this.ctx) return;
    const { P, N } = this, s = this.set.bind(this);
    // backing track
    const a = clamp(P.vocalCut / 100, 0, 1);
    s(N.midFull.gain, 1 - a, .05); s(N.midKeep.gain, a, .05); s(N.sideFill.gain, a * .6, .05);
    for (const f of [N.keepLo1, N.keepLo2]) s(f.frequency, P.keepBass, .05);
    if (!P.duckOn) s(N.music.gain, this.musicBase());
    // voice
    s(N.trim.gain, dbToGain(P.trim));
    s(N.hpf.frequency, P.hpf);
    s(N.comp.threshold, P.compOn ? P.compThr : 0);
    s(N.comp.ratio, P.compOn ? P.compRat : 1);
    s(N.eqL.gain, P.eqLow); s(N.eqM.gain, P.eqMid); s(N.eqH.gain, P.eqHigh);
    s(N.dblSend.gain, (P.dblMix / 100) * .9);
    N.dbl.forEach((o, i) => s(o.d.delayTime, (P.dblSpread + i * 5) / 1000, .05));
    s(N.dlySend.gain, P.dlyMix / 100);
    s(N.dL.delayTime, P.dlyTime / 1000, .05); s(N.dR.delayTime, P.dlyTime / 1000 * 1.5, .05);
    const fb = clamp(P.dlyFb / 100, 0, .8); s(N.fbL.gain, fb); s(N.fbR.gain, fb);
    s(N.toneL.frequency, P.dlyTone); s(N.toneR.frequency, P.dlyTone);
    s(N.verbSend.gain, (P.verbMix / 100) * 1.4);
    s(N.pre.delayTime, P.verbPre / 1000, .05);
    s(N.damp.frequency, P.verbDamp);
    const key = P.verbSize.toFixed(1) + '|' + P.verbTail.toFixed(1);
    if (key !== this.lastIRKey) { this.lastIRKey = key; N.conv.buffer = this.makeIR(P.verbSize, P.verbTail); }
    const vg = this.muted ? 0 : Math.pow(P.vocalVol / 100, 1.6) * 2.2;
    s(N.monitor.gain, P.monitorOn ? 1 : 0);
    s(N.voice.gain, vg * (this.howlDip || 1));
    s(N.voiceRec.gain, P.monitorOn ? 0 : vg);
  }

  /* ------------------------------------------------------------- music */
  attachMusic(el) {
    this.ensure();
    if (el._kSource) return;
    try { el._kSource = this.ctx.createMediaElementSource(el); el._kSource.connect(this.N.musicIn); }
    catch (e) { console.warn('Music cannot be routed through the mixer', e); this.musicDirect = true; }
  }

  /* --------------------------------------------------------------- mic */
  async listInputs() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); }
    catch { return []; }
  }
  async startMic(deviceId) {
    this.ensure();
    try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
    if (this.micStream) this.stopMic(true);
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, latency: 0 };
    if (deviceId) audio.deviceId = { exact: deviceId };
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    } catch (e) {
      if (deviceId) return this.startMic(null); // device vanished: fall back to default
      throw e;
    }
    this.N.mic = this.ctx.createMediaStreamSource(this.micStream);
    this.N.mic.connect(this.N.trim);
    await this.ctx.resume();
    this.micOn = true; this.muted = false;
    this.apply();
    this.emit('mic', true);
    return this.micStream.getAudioTracks()[0]?.label || 'Microphone';
  }
  stopMic(silent) {
    try { this.N.mic && this.N.mic.disconnect(); } catch {}
    (this.micStream?.getTracks() || []).forEach(t => t.stop());
    this.micStream = null; this.micOn = false;
    if (!silent) this.emit('mic', false);
  }
  setMuted(m) { this.muted = m; this.apply(); }

  /* ---------------------------------------------------- feedback notches */
  addNotch(hz) {
    if (!this.ctx || !hz) return false;
    if (this.notches.some(n => Math.abs(1200 * Math.log2(n.hz / hz)) < 60)) {
      // Already notched near here: deepen it instead.
      const n = this.notches.find(n => Math.abs(1200 * Math.log2(n.hz / hz)) < 60);
      n.node.gain.value = Math.max(-30, n.node.gain.value - 6);
      return true;
    }
    if (this.notches.length >= 6) return false;
    const f = this.ctx.createBiquadFilter();
    f.type = 'peaking'; f.frequency.value = hz; f.Q.value = 22; f.gain.value = -18;
    // Re-chain: notchIn → n1 → n2 … → notchOut
    const N = this.N;
    const chain = [N.notchIn, ...this.notches.map(n => n.node)];
    const last = chain[chain.length - 1];
    last.disconnect(); last.connect(f); f.connect(N.notchOut);
    this.notches.push({ hz, node: f });
    return true;
  }
  clearNotches() {
    const N = this.N;
    if (!this.ctx) return;
    N.notchIn.disconnect();
    this.notches.forEach(n => n.node.disconnect());
    this.notches = [];
    N.notchIn.connect(N.notchOut);
  }

  /* --------------------------------------------------------- recording */
  startRecording() {
    this.ensure();
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    this.recChunks = [];
    this.rec = new MediaRecorder(this.N.recTap.stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
    this.rec.ondataavailable = e => { if (e.data.size) this.recChunks.push(e.data); };
    this.rec.start(1000);
  }
  stopRecording() {
    return new Promise(res => {
      if (!this.rec) return res(null);
      this.rec.onstop = () => { res(new Blob(this.recChunks, { type: this.rec.mimeType })); this.rec = null; };
      this.rec.stop();
    });
  }
  get recording() { return !!(this.rec && this.rec.state === 'recording'); }

  latencyMs() {
    if (!this.ctx) return null;
    return Math.round(((this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)) * 1000);
  }
}
