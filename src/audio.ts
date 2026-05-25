import type { Element, HitCategory } from "./state";

// Procedural sound synthesis with the Web Audio API.
//
// Aesthetic: high-def 2010s action-RPG / fighter (think Soul Calibur V) —
// every hit is multiple noise + tonal layers stacked, slightly detuned and
// stereo-spread, fed through a shared convolution reverb send and a master
// bus compressor so the whole mix sits forward and polished.
//
// No sample files. AudioContext must be created from a user gesture, so we
// instantiate from the Start button click.

export class AudioSystem {
  private ctx: AudioContext;
  private master: GainNode;
  private dryBus: GainNode;
  private wetBus: GainNode;
  private muted = false;
  private baseGain = 0.6;

  constructor() {
    const AC =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();

    // Output: bus → compressor → low-shelf body boost → master → destination.
    // The compressor keeps stacked layers from clipping and "glues" the mix.
    this.master = this.ctx.createGain();
    this.master.gain.value = this.baseGain;
    this.master.connect(this.ctx.destination);

    const lowShelf = this.ctx.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 180;
    lowShelf.gain.value = 3.5;
    lowShelf.connect(this.master);

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    comp.connect(lowShelf);

    // Dry bus — most signal goes here.
    this.dryBus = this.ctx.createGain();
    this.dryBus.gain.value = 1.0;
    this.dryBus.connect(comp);

    // Convolution reverb (procedural IR — exponentially decaying stereo noise).
    const conv = this.ctx.createConvolver();
    conv.buffer = this.makeReverbIR(1.6, 2.4);
    conv.connect(comp);
    // Wet bus controls how much of each layer is sent to the reverb.
    this.wetBus = this.ctx.createGain();
    this.wetBus.gain.value = 0.55;
    this.wetBus.connect(conv);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : this.baseGain, this.ctx.currentTime, 0.02);
  }
  isMuted(): boolean { return this.muted; }
  resume(): void { if (this.ctx.state === "suspended") void this.ctx.resume(); }

  // === HIGH-LEVEL SOUNDS =====================================================
  playHit(category: HitCategory, isCrit = false): void {
    const r = (range: number) => (Math.random() - 0.5) * 2 * range;
    switch (category) {
      case "miss":
        // Stereo whip-swoosh + soft body thud — feels like a wide miss
        this.swoosh({ duration: 0.22, peakFreq: 1700 + r(180), peak: 0.18, pan: r(0.4) });
        this.subThump(55 + r(8), 0.12, 0.06, 0);
        break;

      case "ok": {
        // Light strike: short metal tap + tiny body
        this.impactCrack(0.020, 6800 + r(400), 0.20);
        this.fatRing(2500 + r(160), 0.32, 0.10, 0.012);
        this.subThump(85, 0.10, 0.10, 0);
        break;
      }

      case "good": {
        // Solid hammer: triple-layer noise crack + tuned ring + body
        this.impactCrack(0.025, 6200 + r(400), 0.26);
        this.noiseBurst({ duration: 0.05, freq: 1800, q: 1.0, peak: 0.14, attack: 0.0015 });
        this.fatRing(1900 + r(140), 0.45, 0.16, 0.018);
        this.subThump(80, 0.18, 0.15, 0);
        break;
      }

      case "great": {
        // Heavier hammer + a second ring layer + brass body undercurrent
        this.impactCrack(0.028, 5800 + r(360), 0.30);
        this.noiseBurst({ duration: 0.06, freq: 1400, q: 1.1, peak: 0.18, attack: 0.0015 });
        this.fatRing(1500 + r(100), 0.55, 0.20, 0.020);
        this.fatRing(2350 + r(160), 0.45, 0.11, 0.014);
        this.brassStab(140, 0.30, 0.10);
        this.subThump(70, 0.24, 0.20, 0);
        break;
      }

      case "perfect": {
        // Bell-tang impact: long detuned bell-ring stack + brass body
        this.impactCrack(0.032, 5500 + r(320), 0.34);
        this.noiseBurst({ duration: 0.08, freq: 1200, q: 1.1, peak: 0.20, attack: 0.002 });
        this.fatRing(1100 + r(60), 0.85, 0.24, 0.025);
        this.fatRing(1660 + r(80), 0.75, 0.15, 0.018);
        this.fatRing(2400 + r(100), 0.60, 0.10, 0.014);
        this.brassStab(196, 0.40, 0.16); // G3
        this.subThump(62, 0.30, 0.22, 0);
        break;
      }

      case "legendary": {
        // Sword-clash + boom + orchestra hit + cymbal — full screen
        this.impactCrack(0.040, 5200 + r(300), 0.38);
        this.noiseBurst({ duration: 0.10, freq: 1000, q: 1.2, peak: 0.22, attack: 0.002 });
        this.fatRing(800 + r(40), 1.10, 0.20, 0.030);
        this.fatRing(1240 + r(60), 0.90, 0.16, 0.022);
        this.explosion(0.70, 0.30);
        this.orchestraHit({ root: 196, durationS: 0.85, peak: 0.24 });
        break;
      }
    }
    if (isCrit && category !== "miss") {
      // Bright zing on top — like a sword skimming the parry
      this.cymbalCrash(0.45, 0.10);
      this.fatRing(3200 + r(220), 0.30, 0.08, 0.018);
    }
  }

  playElement(element: Element): void {
    const r = (range: number) => (Math.random() - 0.5) * 2 * range;
    if (element === "fire") {
      // Deep explosion with debris crackle
      this.explosion(0.60, 0.34);
      this.noiseBurst({ duration: 0.18, freq: 900, q: 1.5, peak: 0.10, attack: 0.005 });
    } else if (element === "lightning") {
      // Sharp arc crack + rolling thunder
      this.lightningCrack(0.55);
    } else {
      // Magic bell shimmer — heavy reverb, vibrato-modulated bells
      const base = 660 + r(40);
      this.bell(base,         1.10, 0.18);
      this.bell(base * 1.51,  0.95, 0.12);
      this.bell(base * 2.01,  0.85, 0.09);
      this.bell(base * 3.005, 0.65, 0.06);
      this.shimmer(2400, 6);
    }
  }

  playLevelUp(): void {
    // Full orchestral stinger
    this.orchestraHit({ root: 261, durationS: 0.95, peak: 0.30 }); // C4
    this.cymbalCrash(1.0, 0.20);
    this.subThump(50, 0.40, 0.25, 0);
  }

  playStartButton(): void {
    // Heavy metallic clang — confident "armour-on"
    this.impactCrack(0.030, 5800, 0.30);
    this.fatRing(1500, 0.55, 0.18, 0.022);
    this.subThump(80, 0.25, 0.20, 0);
  }

  // === PRIMITIVES ============================================================

  // Tightest noise transient — the "click" of a metal-on-metal impact.
  private impactCrack(duration: number, freq: number, peak: number): void {
    this.noiseBurst({ duration, freq, q: 0.9, peak, attack: 0.0005, wet: 0.25 });
  }

  // Stereo-spread, slightly detuned sine ring — the "tang" sustain after a
  // hit. Three layers with vibrato to avoid the dry computer-sine feel.
  private fatRing(freq: number, duration: number, peak: number, detune: number): void {
    this.sineLayer(freq * (1 - detune), duration, peak * 0.78, -0.35, 4);
    this.sineLayer(freq,                duration, peak,         0.0,  3);
    this.sineLayer(freq * (1 + detune), duration, peak * 0.78,  0.35, 5);
  }

  // Sine with vibrato (LFO on frequency) + stereo pan + reverb send.
  private sineLayer(freq: number, duration: number, peak: number, pan: number, vibratoHz: number): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    // Slight downward pitch envelope makes the ring feel "settled"
    osc.frequency.exponentialRampToValueAtTime(freq * 0.997, now + duration);
    // Vibrato
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = vibratoHz;
    lfoGain.gain.value = freq * 0.0025;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(now);
    lfo.stop(now + duration + 0.02);
    // Envelope + pan + send
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    this.routeStereo(env, pan, 0.55);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Bell — like sineLayer but with an inharmonic FM partial for the bell tang.
  private bell(freq: number, duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    carrier.type = "sine";
    carrier.frequency.value = freq;
    mod.type = "sine";
    mod.frequency.value = freq * 2.76; // inharmonic — bell-like
    modGain.gain.setValueAtTime(freq * 0.9, now);
    modGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.6);
    mod.connect(modGain).connect(carrier.frequency);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    carrier.connect(env);
    this.routeStereo(env, (Math.random() - 0.5) * 0.6, 0.7);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + duration + 0.02);
    mod.stop(now + duration + 0.02);
  }

  // Sub-bass impulse with pitch slide — the "body" of every hit.
  private subThump(freq: number, duration: number, peak: number, wet = 0.1): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 2.4, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), now + duration * 0.6);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    this.routeStereo(env, 0, wet);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Whip swoosh — bandpass noise with swept centre + slight pan.
  private swoosh(opts: { duration: number; peakFreq: number; peak: number; pan: number }): void {
    const now = this.ctx.currentTime;
    const noise = this.makeNoise(opts.duration);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(opts.peakFreq * 0.4, now);
    bp.frequency.exponentialRampToValueAtTime(opts.peakFreq * 1.7, now + opts.duration * 0.5);
    bp.frequency.exponentialRampToValueAtTime(opts.peakFreq * 0.5, now + opts.duration);
    bp.Q.value = 2.5;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(opts.peak, now + opts.duration * 0.3);
    env.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
    noise.connect(bp);
    bp.connect(env);
    this.routeStereo(env, opts.pan, 0.30);
    noise.start(now);
    noise.stop(now + opts.duration);
  }

  // Lightning crack: instant transient + mid sustain + delayed thunder rumble.
  private lightningCrack(duration: number): void {
    this.noiseBurst({ duration: 0.06, freq: 6800, q: 1.0, peak: 0.34, attack: 0.0006, wet: 0.40 });
    this.noiseBurst({ duration: 0.20, freq: 2400, q: 3.0, peak: 0.18, attack: 0.004, wet: 0.45 });
    // Thunder rumble fires a touch later — feels like the sound catching up
    setTimeout(() => {
      this.noiseBurst({ duration: duration, freq: 100, q: 1.0, peak: 0.22, attack: 0.04, wet: 0.55 });
      this.subThump(45, duration * 0.6, 0.20, 0.30);
    }, 70);
  }

  // Lowpass-swept noise + sub thump + mid debris crackle — explosion / fire.
  private explosion(duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    const noise = this.makeNoise(duration);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2800, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + duration);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(lp);
    lp.connect(env);
    this.routeStereo(env, 0, 0.50);
    noise.start(now);
    noise.stop(now + duration);
    // Initial impact thump
    this.subThump(45, duration * 0.55, peak * 1.05, 0.25);
    // Mid-range debris crackle (stereo-widened)
    this.noiseBurst({ duration: duration * 0.4, freq: 1700, q: 1.8, peak: peak * 0.45, attack: 0.005, pan: -0.3, wet: 0.40 });
    this.noiseBurst({ duration: duration * 0.4, freq: 2400, q: 1.8, peak: peak * 0.35, attack: 0.005, pan: 0.3, wet: 0.40 });
  }

  // Brass-stab chord + cymbal-ish HP-noise + low pulse = orchestra hit.
  private orchestraHit(opts: { root: number; durationS: number; peak: number }): void {
    const { root, durationS, peak } = opts;
    this.brassStab(root,         durationS, peak);
    this.brassStab(root * 1.498, durationS, peak * 0.75);
    this.brassStab(root * 2.0,   durationS, peak * 0.60);
    this.brassStab(root * 2.997, durationS * 0.75, peak * 0.40);
    this.brassStab(root * 4.0,   durationS * 0.55, peak * 0.25);
    this.subThump(root / 2, durationS * 0.45, peak * 1.05, 0.20);
    // Cymbal-like splash on top
    this.cymbalCrash(durationS, peak * 0.55);
  }

  // Sawtooth stab through a lowpass envelope — single brass-like layer.
  private brassStab(freq: number, duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(freq * 6, now);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.6, now + duration);
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(lp);
    lp.connect(env);
    this.routeStereo(env, (Math.random() - 0.5) * 0.5, 0.45);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Bright wide-band noise that decays — cymbal / hi-hat crash.
  private cymbalCrash(duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    const noise = this.makeNoise(duration);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(hp);
    hp.connect(env);
    this.routeStereo(env, 0, 0.55);
    noise.start(now);
    noise.stop(now + duration);
  }

  // Quick sequence of high sines for magic sparkle tail.
  private shimmer(baseFreq: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const f = baseFreq * (1 + Math.random() * 0.8);
      const now = this.ctx.currentTime + i * 0.05;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.08, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(env);
      this.routeStereo(env, (Math.random() - 0.5) * 0.8, 0.6);
      osc.start(now);
      osc.stop(now + 0.30);
    }
  }

  // Generic filtered noise burst with optional pan + reverb send.
  private noiseBurst(opts: {
    duration: number;
    freq: number;
    q: number;
    peak: number;
    attack?: number;
    decay?: number;
    pan?: number;
    wet?: number;
  }): void {
    const now = this.ctx.currentTime;
    const attack = opts.attack ?? 0.005;
    const decay = opts.decay ?? opts.duration;
    const noise = this.makeNoise(opts.duration);
    const filt = this.ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = opts.freq;
    filt.Q.value = opts.q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(opts.peak, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    noise.connect(filt);
    filt.connect(env);
    this.routeStereo(env, opts.pan ?? 0, opts.wet ?? 0.30);
    noise.start(now);
    noise.stop(now + opts.duration + 0.02);
  }

  // === Routing helpers =======================================================

  // Connect a source node to dry bus + reverb send with stereo pan.
  private routeStereo(node: AudioNode, pan: number, wet: number): void {
    const pn = this.ctx.createStereoPanner();
    pn.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(pn);
    pn.connect(this.dryBus);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      pn.connect(send);
      send.connect(this.wetBus);
    }
  }

  // White noise → AudioBufferSourceNode
  private makeNoise(duration: number): AudioBufferSourceNode {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // Synthetic impulse response for the reverb — exponentially decaying stereo
  // noise. Cheap, sounds like a small-medium hall.
  private makeReverbIR(seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return ir;
  }
}
