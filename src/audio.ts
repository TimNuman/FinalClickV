import type { Element, HitCategory } from "./state";

// Procedural sound synthesis with the Web Audio API.
//
// Aesthetic: 2000s action-RPG (Diablo II / Sacred / Titan Quest era) —
// blacksmith hammers on hits, whip-swooshes on misses, lightning cracks +
// thunder rumble for the Lightning element, low-end explosions for Fire,
// dripping bell shimmer for Magic, brass-orchestra-hit chords on level-ups.
//
// No sample files; every sound is layered noise bursts + filtered oscillators
// scheduled on the AudioContext clock. Per-call frequency/duration jitter
// gives multiple "takes" of each sound from the same code.
//
// AudioContext can't be created on page load (browser autoplay policy), so
// instantiate AFTER the first user gesture (the Start button click).

export class AudioSystem {
  private ctx: AudioContext;
  private master: GainNode;
  private muted = false;
  private baseGain = 0.5;

  constructor() {
    const AC =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.baseGain;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : this.baseGain, this.ctx.currentTime, 0.02);
  }
  isMuted(): boolean { return this.muted; }
  resume(): void { if (this.ctx.state === "suspended") void this.ctx.resume(); }

  // === Hit sounds ============================================================
  // Each hit category layers different combinations of the physical primitives
  // (hammer, swoosh, metal ring, sub-thump). isCrit adds a high cymbal-ish
  // accent on top.
  playHit(category: HitCategory, isCrit = false): void {
    const r = (range: number) => (Math.random() - 0.5) * 2 * range;
    switch (category) {
      case "miss":
        // Light whip-swoosh — like the strike clearly missed
        this.swoosh(0.20, 1600 + r(200), 0.18);
        this.subThump(55 + r(8), 0.10, 0.07);
        break;
      case "ok":
        // Small chink — tip of the hammer
        this.hammer({ ringFreq: 2400 + r(180), strength: 0.55 });
        break;
      case "good":
        // Solid mid hammer hit
        this.hammer({ ringFreq: 1900 + r(160), strength: 0.85 });
        break;
      case "great":
        // Heavy hammer + a second metal layer (anvil-stacked ring)
        this.hammer({ ringFreq: 1500 + r(120), strength: 1.05 });
        this.metalRing(2200 + r(180), 0.32, 0.10);
        break;
      case "perfect":
        // Heavy hammer + bell-like ring + brass body
        this.hammer({ ringFreq: 1100 + r(70), strength: 1.25 });
        this.metalRing(1700 + r(120), 0.55, 0.14);
        this.metalRing(2550 + r(160), 0.45, 0.08);
        this.brassStab(220 + r(8), 0.30, 0.14);
        break;
      case "legendary":
        // Explosion + orchestra hit chord
        this.explosion(0.55, 0.32);
        this.orchestraHit({ root: 196, durationS: 0.55, peak: 0.22 });   // G3 chord
        break;
    }
    if (isCrit && category !== "miss") {
      // Bright cymbal accent
      this.noiseBurst({ duration: 0.18, freq: 7000, q: 1.2, peak: 0.10 });
      this.metalRing(3200 + r(200), 0.18, 0.08);
    }
  }

  // === Elemental bump sounds =================================================
  playElement(element: Element): void {
    const r = (range: number) => (Math.random() - 0.5) * 2 * range;
    if (element === "fire") {
      // Crackling explosion — short version of the legendary boom
      this.explosion(0.45, 0.28);
    } else if (element === "lightning") {
      // Sharp electric crack + rolling thunder tail
      this.lightningCrack(0.45 + Math.random() * 0.1);
    } else {
      // Magic shimmer — bell-like detuned harmonics + soft sparkle
      const base = 720 + r(40);
      this.metalRing(base,        0.7, 0.15);
      this.metalRing(base * 1.51, 0.6, 0.10);
      this.metalRing(base * 2.01, 0.5, 0.07);
      this.sparkle(2400, 4);
    }
  }

  // === Level up + start button ==============================================
  playLevelUp(): void {
    // Big orchestra hit + cymbal crash
    this.orchestraHit({ root: 261, durationS: 0.75, peak: 0.28 }); // C4 chord
    this.cymbalCrash(0.8);
  }

  playStartButton(): void {
    // Solid metal clang — like setting down a gauntlet
    this.hammer({ ringFreq: 1300, strength: 0.9 });
  }

  // === Synth primitives ======================================================

  // Blacksmith hammer: sharp metallic transient + tuned ring + low body thump.
  private hammer(opts: { ringFreq: number; strength: number }): void {
    const s = opts.strength;
    // Sharp metallic transient (filtered noise click)
    this.noiseBurst({ duration: 0.04, freq: 5500, q: 1.5, peak: 0.22 * s, attack: 0.001, decay: 0.04 });
    // Tuned metal ring — two slightly detuned sines for "real" metal beating
    this.metalRing(opts.ringFreq,         0.28, 0.18 * s);
    this.metalRing(opts.ringFreq * 1.005, 0.28, 0.12 * s);
    // Low-end body thump
    this.subThump(85, 0.18, 0.18 * s);
  }

  // Bell-like decay on a sine — used for hammer rings and magic shimmer
  private metalRing(freq: number, duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Sub-bass impulse with quick pitch slide — gives "body" to a hit
  private subThump(freq: number, duration: number, peak: number): void {
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
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Whip-swoosh: bandpass on noise, sweeping the centre freq up then down
  private swoosh(duration: number, peakFreq: number, peak: number): void {
    const now = this.ctx.currentTime;
    const noise = this.makeNoise(duration);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(peakFreq * 0.4, now);
    bp.frequency.exponentialRampToValueAtTime(peakFreq * 1.6, now + duration * 0.55);
    bp.frequency.exponentialRampToValueAtTime(peakFreq * 0.6, now + duration);
    bp.Q.value = 2.5;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + duration * 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(bp);
    bp.connect(env);
    env.connect(this.master);
    noise.start(now);
    noise.stop(now + duration);
  }

  // Lightning crack: extremely sharp transient + sustained crackle + thunder
  private lightningCrack(duration: number): void {
    const now = this.ctx.currentTime;
    // Sharp crack — wideband but bright, almost instant decay
    this.noiseBurst({ duration: 0.06, freq: 6500, q: 1.0, peak: 0.32, attack: 0.0008, decay: 0.06 });
    // Mid sustain (the "tsst" of the arc)
    this.noiseBurst({ duration: 0.18, freq: 2400, q: 3.0, peak: 0.18, attack: 0.005 });
    // Delayed low-end rumble (thunder)
    this.scheduleNoiseBurst({
      delay: 0.08, duration: duration, freq: 130, q: 1.4, peak: 0.20, attack: 0.04, decay: duration,
    });
  }

  // Sub-bass-dominated burst with low-pass-swept noise — explosion / fire
  private explosion(duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    // Rumble core: lowpass-swept noise
    const noise = this.makeNoise(duration);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2500, now);
    lp.frequency.exponentialRampToValueAtTime(110, now + duration);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(lp);
    lp.connect(env);
    env.connect(this.master);
    noise.start(now);
    noise.stop(now + duration);
    // Initial impact thump
    this.subThump(45, duration * 0.5, peak * 1.1);
    // Mid-range debris crackle
    this.noiseBurst({ duration: duration * 0.4, freq: 1800, q: 2, peak: peak * 0.5, attack: 0.005 });
  }

  // Orchestra hit: brass-stab chord + cymbal-like high noise + low pulse
  private orchestraHit(opts: { root: number; durationS: number; peak: number }): void {
    const { root, durationS, peak } = opts;
    // Brass-ish stack: sawtooth chord (root, 5th, octave, 12th)
    this.brassStab(root,         durationS, peak);
    this.brassStab(root * 1.498, durationS, peak * 0.75);
    this.brassStab(root * 2.0,   durationS, peak * 0.60);
    this.brassStab(root * 3.0,   durationS * 0.7, peak * 0.35);
    // Low impact thump
    this.subThump(root / 2, durationS * 0.4, peak * 1.0);
    // Slight crash on top
    this.noiseBurst({ duration: durationS, freq: 4500, q: 0.9, peak: peak * 0.35, attack: 0.005, decay: durationS });
  }

  // Sawtooth stab — single brass-like layer with quick attack and decay
  private brassStab(freq: number, duration: number, peak: number): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(freq * 5, now);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.8, now + duration);
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(lp);
    lp.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Cymbal crash: bright wide-band noise that decays over time
  private cymbalCrash(duration: number): void {
    const now = this.ctx.currentTime;
    const noise = this.makeNoise(duration);
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.18, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(hp);
    hp.connect(env);
    env.connect(this.master);
    noise.start(now);
    noise.stop(now + duration);
  }

  // Generic filtered noise burst
  private noiseBurst(opts: {
    duration: number;
    freq: number;
    q: number;
    peak: number;
    attack?: number;
    decay?: number;
  }): void {
    this.scheduleNoiseBurst({ delay: 0, ...opts });
  }
  private scheduleNoiseBurst(opts: {
    delay: number;
    duration: number;
    freq: number;
    q: number;
    peak: number;
    attack?: number;
    decay?: number;
  }): void {
    const now = this.ctx.currentTime + opts.delay;
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
    env.connect(this.master);
    noise.start(now);
    noise.stop(now + opts.duration + 0.02);
  }

  // Quick sequence of high-pitched sines — adds a magic sparkle tail
  private sparkle(baseFreq: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const f = baseFreq * (1 + Math.random() * 0.7);
      const now = this.ctx.currentTime + i * 0.045;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.08, now + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
      osc.connect(env);
      env.connect(this.master);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  }

  // White noise buffer source — building block for everything noise-based
  private makeNoise(duration: number): AudioBufferSourceNode {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
}
