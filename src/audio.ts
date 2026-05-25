import type { Element, HitCategory } from "./state";

// Procedural sound synthesis with the Web Audio API.
// No samples — every sound is built from oscillators + envelopes scheduled on
// the audio clock, with per-call frequency/duration jitter for variation.
//
// AudioContext can't be created on page load (browser autoplay policy), so
// instantiate this AFTER the first user gesture (the Start button click).

export class AudioSystem {
  private ctx: AudioContext;
  private master: GainNode;
  private muted = false;

  constructor() {
    const AC =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : 0.35, this.ctx.currentTime, 0.02);
  }
  isMuted(): boolean { return this.muted; }
  resume(): void { if (this.ctx.state === "suspended") void this.ctx.resume(); }

  // === Hit sounds ============================================================
  // Each category has its own signature; per-call jitter gives the "couple of
  // similar but different sounds" feel without needing multiple samples.
  playHit(category: HitCategory, isCrit = false): void {
    const r = (range: number) => (Math.random() - 0.5) * 2 * range;
    switch (category) {
      case "miss":
        this.thud(80 + r(15));
        break;
      case "ok":
        this.click(420 + r(40), 0.10, "triangle", 0.18);
        break;
      case "good":
        this.click(560 + r(45), 0.12, "triangle", 0.20);
        this.click(840 + r(60), 0.10, "sine", 0.10);
        break;
      case "great":
        this.sweepUp(660 + r(60), 880 + r(80), 0.16, 0.22);
        this.click(1320 + r(80), 0.14, "sine", 0.10);
        break;
      case "perfect":
        // Bright triad chime
        this.click(880 + r(30),  0.32, "sine",     0.20);
        this.click(1320 + r(40), 0.32, "sine",     0.14);
        this.click(1760 + r(50), 0.24, "sine",     0.08);
        break;
      case "legendary":
        // C-E-G chord + high shimmer
        this.click(523 + r(8),  0.45, "sine",     0.20);
        this.click(659 + r(8),  0.45, "sine",     0.17);
        this.click(784 + r(10), 0.45, "sine",     0.15);
        this.click(1568 + r(20), 0.35, "sine",    0.10);
        this.sparkle(2400, 4);
        break;
    }
    if (isCrit && category !== "miss") {
      this.click(2200 + r(180), 0.10, "sine", 0.10);
      this.click(3200 + r(220), 0.12, "sine", 0.06);
    }
  }

  // === Elemental bump sounds =================================================
  playElement(element: Element): void {
    const r = (range: number) => (Math.random() - 0.5) * 2 * range;
    if (element === "fire") {
      // Crackle: short noise burst with bandpass + low thump
      this.noiseBurst({ duration: 0.18, freq: 1100, q: 6, peak: 0.18 });
      this.click(95 + r(10), 0.18, "sawtooth", 0.10);
    } else if (element === "lightning") {
      // Zap: rapid frequency sweep down + bright noise tail
      this.sweepDown(2400 + r(200), 600 + r(50), 0.14, 0.18);
      this.noiseBurst({ duration: 0.10, freq: 5500, q: 8, peak: 0.10 });
    } else {
      // Magic: detuned shimmering sines
      const base = 880 + r(30);
      this.click(base,         0.45, "sine", 0.16);
      this.click(base * 1.5,   0.40, "sine", 0.10);
      this.click(base * 2.005, 0.35, "sine", 0.07);
      this.sparkle(2200, 3);
    }
  }

  // === Level up + start button ==============================================
  playLevelUp(): void {
    // Rising arpeggio
    const notes = [392, 523, 659, 784, 1047]; // G4 C5 E5 G5 C6
    notes.forEach((f, i) => this.scheduleClick(f, 0.30, "triangle", 0.18, i * 0.07));
  }

  playStartButton(): void {
    this.click(660, 0.10, "triangle", 0.20);
    this.click(990, 0.18, "sine",     0.12);
  }

  // === Synth primitives ======================================================
  // A single tone with attack-decay envelope.
  private click(freq: number, duration: number, type: OscillatorType, peak: number): void {
    this.scheduleClick(freq, duration, type, peak, 0);
  }
  private scheduleClick(freq: number, duration: number, type: OscillatorType, peak: number, delay: number): void {
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Low thud with quick decay — used for misses
  private thud(freq: number): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 2, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, now + 0.15);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // Frequency sweep from f0→f1 over `duration`
  private sweepUp(f0: number, f1: number, duration: number, peak: number): void {
    this.sweep(f0, f1, duration, peak, "triangle");
  }
  private sweepDown(f0: number, f1: number, duration: number, peak: number): void {
    this.sweep(f0, f1, duration, peak, "sawtooth");
  }
  private sweep(f0: number, f1: number, duration: number, peak: number, type: OscillatorType): void {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + duration);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // Noise burst through a bandpass filter — used for crackle/zap textures
  private noiseBurst(opts: { duration: number; freq: number; q: number; peak: number }): void {
    const now = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * opts.duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = opts.freq;
    filt.Q.value = opts.q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(opts.peak, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
    src.connect(filt);
    filt.connect(env);
    env.connect(this.master);
    src.start(now);
    src.stop(now + opts.duration + 0.02);
  }

  // Rapid sequence of tiny high sines — adds a "magic sparkle" tail
  private sparkle(baseFreq: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const f = baseFreq * (1 + Math.random() * 0.8);
      this.scheduleClick(f, 0.18, "sine", 0.08, i * 0.04);
    }
  }
}
