import {
  Animation,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from "@babylonjs/core";
import type { HitCategory, HitResult } from "./state";
import { createRadialGradientTexture } from "./scene";

interface VFXRefs {
  scene: Scene;
  buttonPos: () => Vector3;
  fillLight: PointLight;
  hudRoot: HTMLElement;
  cameraShake: (intensity: number, duration: number) => void;
  getIntensity: () => number; // 0..1, scales effect strength
  getLevel: () => number;     // current player level, drives effect probability
}

const CATEGORY_COLOR: Record<HitCategory, [Color4, Color4]> = {
  miss:      [new Color4(0.5, 0.5, 0.5, 0.8), new Color4(0.3, 0.3, 0.3, 0.0)],
  ok:        [new Color4(0.7, 1.0, 0.4, 1.0), new Color4(0.2, 0.4, 0.1, 0.0)],
  good:      [new Color4(0.4, 0.8, 1.0, 1.0), new Color4(0.1, 0.3, 0.6, 0.0)],
  great:     [new Color4(1.0, 0.7, 0.2, 1.0), new Color4(0.8, 0.2, 0.0, 0.0)],
  perfect:   [new Color4(1.0, 0.5, 0.9, 1.0), new Color4(1.0, 0.3, 0.4, 0.0)],
  legendary: [new Color4(1.0, 0.95, 0.3, 1.0), new Color4(1.0, 0.6, 0.1, 0.0)],
};

const CATEGORY_INTENSITY: Record<HitCategory, number> = {
  miss: 0.0,
  ok: 0.35,
  good: 0.55,
  great: 0.8,
  perfect: 1.0,
  legendary: 1.4,
};

// Hit-quality boosts the probability of the elemental effects.
// A legendary at any level will almost always trigger all three; an ok at
// level 1 will almost never trigger anything.
const HIT_PROB_MULT: Record<HitCategory, number> = {
  miss: 0,
  ok: 0.55,
  good: 1.0,
  great: 1.6,
  perfect: 2.5,
  legendary: 4.0,
};

// Per-effect probability curve: chance = (base + level * perLevel) * hitMult,
// capped at 0.9. Each effect rolls independently, so high levels see
// combinations (fire+lightning, magic+fire, all three…) rather than every
// click looking identical.
const EFFECT_CHANCE = {
  fire:      { base: 0.02, perLevel: 0.025 },  // L1 great ≈ 7%,  L11 great ≈ 47%, L20 legendary capped
  lightning: { base: 0.01, perLevel: 0.020 },  // L1 great ≈ 5%,  L11 great ≈ 37%
  magic:     { base: 0.00, perLevel: 0.018 },  // L1 great ≈ 3%,  L11 great ≈ 32%
};

const SHOCKWAVE_THRESHOLD = 0.1;    // ~ level 3
const STREAK_FIRE_THRESHOLD = 0.2;  // ~ level 5

function rollChance(curve: { base: number; perLevel: number }, level: number, hitMult: number): boolean {
  const p = Math.min(0.9, (curve.base + level * curve.perLevel) * hitMult);
  return Math.random() < p;
}

export class VFX {
  private refs: VFXRefs;
  private dotTex: Texture;
  private streakFire?: ParticleSystem;
  private streakSmoke?: ParticleSystem;
  private streakTier = 0;

  constructor(refs: VFXRefs) {
    this.refs = refs;
    this.dotTex = createRadialGradientTexture(refs.scene, "vfxDot", 128, [
      { stop: 0, color: "rgba(255,255,255,1)" },
      { stop: 0.4, color: "rgba(255,255,255,0.7)" },
      { stop: 1, color: "rgba(255,255,255,0)" },
    ]);
    this.setupAmbientStreakFire();
  }

  triggerHit(result: HitResult) {
    const vis = this.refs.getIntensity();
    const level = this.refs.getLevel();
    const cat = result.category;

    if (cat === "miss") {
      this.spawnPuff(vis);
      if (vis > 0.1) this.refs.cameraShake(0.04 * vis, 0.18);
      return;
    }

    const catI = CATEGORY_INTENSITY[cat];
    const hitMult = HIT_PROB_MULT[cat];
    // Base effect scale for the always-on visuals (burst, shockwave, fill flash).
    const effect = catI * (0.25 + 0.75 * vis);

    // Always: small burst + a brief fill-light pulse + a soft shake
    this.spawnBurst(cat, effect);
    this.flashLight(cat, effect);
    this.refs.cameraShake(0.03 + effect * 0.15, 0.16 + effect * 0.15);

    // Shockwave fires on most hits but is now visually lighter
    if (vis > SHOCKWAVE_THRESHOLD) {
      this.spawnShockwave(cat, effect * 0.75);
    }

    // === Elemental effects — independent probability rolls per click ===
    // Each one scales with player level AND the hit category. The 0.95 cap
    // means even legendary-at-max-level still has a sliver of variance.
    if (rollChance(EFFECT_CHANCE.fire, level, hitMult)) {
      this.spawnFire(effect);
    }
    if (rollChance(EFFECT_CHANCE.lightning, level, hitMult)) {
      const bolts = cat === "legendary" ? 6 : cat === "perfect" ? 4 : 2 + Math.floor(Math.random() * 2);
      this.spawnLightning(bolts);
    }
    if (rollChance(EFFECT_CHANCE.magic, level, hitMult)) {
      this.spawnMagic(effect);
    }

    // Crits get a guaranteed sparkle of lightning/magic regardless of roll
    if (result.isCrit) {
      this.spawnLightning(2);
      this.spawnMagic(effect * 0.7);
    }

    // Legendary keeps the full-screen celebration
    if (cat === "legendary") {
      this.screenFlash(0.85);
      if (vis > 0.3) this.spawnRays();
    } else if (cat === "perfect" && Math.random() < 0.4) {
      this.screenFlash(0.45);
    }
  }

  setStreakTier(tier: number) {
    const vis = this.refs.getIntensity();
    const effectiveTier = vis > STREAK_FIRE_THRESHOLD ? tier : 0;
    if (effectiveTier === this.streakTier) return;
    this.streakTier = effectiveTier;
    if (!this.streakFire || !this.streakSmoke) return;

    if (effectiveTier <= 0) {
      this.streakFire.stop();
      this.streakSmoke.stop();
      return;
    }
    this.streakFire.emitRate = 30 * effectiveTier;
    this.streakSmoke.emitRate = 14 * effectiveTier;
    this.streakFire.minSize = 0.1 + effectiveTier * 0.03;
    this.streakFire.maxSize = 0.35 + effectiveTier * 0.08;
    this.streakFire.start();
    this.streakSmoke.start();
  }

  // === Implementations ===

  private setupAmbientStreakFire() {
    const { scene } = this.refs;
    const baseY = -0.55; // around the base of the arcade button

    const fire = new ParticleSystem("streakFire", 800, scene);
    fire.particleTexture = this.dotTex;
    fire.emitter = new Vector3(0, baseY, 0.2);
    fire.minEmitBox = new Vector3(-0.55, 0, -0.2);
    fire.maxEmitBox = new Vector3(0.55, 0.05, 0.2);
    fire.color1 = new Color4(1.0, 0.9, 0.3, 1);
    fire.color2 = new Color4(1.0, 0.4, 0.05, 1);
    fire.colorDead = new Color4(0.15, 0, 0, 0);
    fire.minSize = 0.12;
    fire.maxSize = 0.4;
    fire.minLifeTime = 0.4;
    fire.maxLifeTime = 1.0;
    fire.emitRate = 0;
    fire.gravity = new Vector3(0, 4.5, 0);
    fire.direction1 = new Vector3(-0.4, 1.2, -0.4);
    fire.direction2 = new Vector3(0.4, 2.0, 0.4);
    fire.minEmitPower = 0.5;
    fire.maxEmitPower = 1.5;
    fire.updateSpeed = 0.015;
    fire.blendMode = ParticleSystem.BLENDMODE_ADD;
    this.streakFire = fire;

    const smoke = new ParticleSystem("streakSmoke", 200, scene);
    smoke.particleTexture = this.dotTex;
    smoke.emitter = new Vector3(0, 0.8, 0);
    smoke.minEmitBox = new Vector3(-0.3, 0, -0.2);
    smoke.maxEmitBox = new Vector3(0.3, 0, 0.2);
    smoke.color1 = new Color4(0.5, 0.3, 0.4, 0.4);
    smoke.color2 = new Color4(0.2, 0.1, 0.3, 0.3);
    smoke.colorDead = new Color4(0, 0, 0, 0);
    smoke.minSize = 0.3;
    smoke.maxSize = 0.7;
    smoke.minLifeTime = 1.0;
    smoke.maxLifeTime = 2.0;
    smoke.emitRate = 0;
    smoke.gravity = new Vector3(0, 0.4, 0);
    smoke.direction1 = new Vector3(-0.3, 0.8, -0.3);
    smoke.direction2 = new Vector3(0.3, 1.2, 0.3);
    smoke.minEmitPower = 0.2;
    smoke.maxEmitPower = 0.5;
    smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.streakSmoke = smoke;
  }

  private spawnPuff(vis: number) {
    const { scene, buttonPos } = this.refs;
    const ps = new ParticleSystem("puff", 30, scene);
    ps.particleTexture = this.dotTex;
    ps.emitter = buttonPos();
    ps.color1 = new Color4(0.6, 0.6, 0.7, 0.55);
    ps.color2 = new Color4(0.4, 0.4, 0.5, 0.3);
    ps.colorDead = new Color4(0, 0, 0, 0);
    ps.minSize = 0.08;
    ps.maxSize = 0.18 + vis * 0.1;
    ps.minLifeTime = 0.25;
    ps.maxLifeTime = 0.55;
    ps.emitRate = 180;
    ps.gravity = new Vector3(0, 0.6, 0);
    ps.direction1 = new Vector3(-1, 0.4, -1);
    ps.direction2 = new Vector3(1, 1.2, 1);
    ps.minEmitPower = 0.4;
    ps.maxEmitPower = 1.0;
    ps.targetStopDuration = 0.1;
    ps.disposeOnStop = true;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
  }

  private spawnBurst(cat: HitCategory, effect: number) {
    const { scene, buttonPos } = this.refs;
    const [c1, c2] = CATEGORY_COLOR[cat];

    const count = Math.max(20, Math.round(40 + effect * 280));
    const ps = new ParticleSystem("burst", count, scene);
    ps.particleTexture = this.dotTex;
    ps.emitter = buttonPos();
    ps.color1 = c1;
    ps.color2 = c2;
    ps.colorDead = new Color4(c2.r * 0.2, c2.g * 0.2, c2.b * 0.2, 0);
    ps.minSize = 0.06 + effect * 0.06;
    ps.maxSize = 0.15 + effect * 0.3;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.8 + effect * 0.5;
    ps.emitRate = 2000;
    ps.gravity = new Vector3(0, -1.0, 0);
    ps.direction1 = new Vector3(-1, -1, -1);
    ps.direction2 = new Vector3(1, 1, 1);
    ps.minEmitPower = 1.2 + effect * 2.5;
    ps.maxEmitPower = 2.5 + effect * 5;
    ps.updateSpeed = 0.015;
    ps.targetStopDuration = 0.08;
    ps.disposeOnStop = true;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.createSphereEmitter(0.08);
    ps.start();
  }

  private spawnShockwave(cat: HitCategory, effect: number) {
    const { scene, buttonPos } = this.refs;
    const [c1] = CATEGORY_COLOR[cat];

    const ring = MeshBuilder.CreateDisc("shock", { radius: 0.6, tessellation: 64 }, scene);
    ring.position.copyFrom(buttonPos());
    ring.position.z += 0.05;
    ring.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const mat = new StandardMaterial("shockMat", scene);
    mat.emissiveColor = new Color3(c1.r, c1.g, c1.b);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.opacityTexture = createRadialGradientTexture(scene, `shockTex_${Date.now()}`, 128, [
      { stop: 0.0, color: "rgba(255,255,255,0)" },
      { stop: 0.78, color: "rgba(255,255,255,0)" },
      { stop: 0.88, color: "rgba(255,255,255,0.95)" },
      { stop: 1.0, color: "rgba(255,255,255,0)" },
    ]);
    mat.alpha = 1;
    ring.material = mat;

    const targetScale = 2 + effect * 7;
    const duration = 22 + Math.round(effect * 18);
    Animation.CreateAndStartAnimation(
      "shockScale", ring, "scaling", 60, duration,
      new Vector3(0.3, 0.3, 0.3),
      new Vector3(targetScale, targetScale, targetScale),
      0, undefined, () => ring.dispose(),
    );
    Animation.CreateAndStartAnimation("shockFade", mat, "alpha", 60, duration, 1, 0, 0);
  }

  private spawnFire(effect: number) {
    const { scene, buttonPos } = this.refs;
    const ps = new ParticleSystem("fire", 200, scene);
    ps.particleTexture = this.dotTex;
    ps.emitter = buttonPos().add(new Vector3(0, -0.4, 0));
    ps.minEmitBox = new Vector3(-0.4, 0, -0.3);
    ps.maxEmitBox = new Vector3(0.4, 0.1, 0.3);
    ps.color1 = new Color4(1.0, 0.95, 0.4, 1);
    ps.color2 = new Color4(1.0, 0.45, 0.1, 1);
    ps.colorDead = new Color4(0.2, 0, 0, 0);
    ps.minSize = 0.12 + effect * 0.1;
    ps.maxSize = 0.4 + effect * 0.25;
    ps.minLifeTime = 0.35;
    ps.maxLifeTime = 0.85;
    ps.emitRate = 600;
    ps.gravity = new Vector3(0, 6, 0);
    ps.direction1 = new Vector3(-0.5, 1.5, -0.5);
    ps.direction2 = new Vector3(0.5, 3.0, 0.5);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 2.4;
    ps.updateSpeed = 0.015;
    ps.targetStopDuration = 0.25;
    ps.disposeOnStop = true;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
  }

  private spawnLightning(count: number) {
    const { scene, buttonPos } = this.refs;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 1.6 + Math.random() * 1.8;
      const targetX = Math.cos(angle) * dist;
      const targetY = Math.sin(angle) * dist * 0.7;
      const bolt = createLightningBoltMesh(
        scene,
        buttonPos(),
        new Vector3(targetX + buttonPos().x, targetY + buttonPos().y, 0.3),
      );
      let alpha = 1;
      const interval = setInterval(() => {
        alpha -= 0.18;
        const mat = bolt.material as StandardMaterial;
        mat.alpha = Math.max(0, alpha);
        if (alpha <= 0) {
          clearInterval(interval);
          bolt.dispose();
          (mat.opacityTexture as Texture | null)?.dispose();
          mat.dispose();
        }
      }, 28);
    }
  }

  private spawnMagic(effect: number) {
    const { scene, buttonPos } = this.refs;
    const center = buttonPos();

    // Swirling violet plume — orbits the button axis as it rises
    const ribbon = new ParticleSystem("magicRibbon", 220, scene);
    ribbon.particleTexture = this.dotTex;
    ribbon.emitter = center;
    ribbon.minEmitBox = new Vector3(-0.05, -0.1, -0.05);
    ribbon.maxEmitBox = new Vector3(0.05, 0.1, 0.05);
    ribbon.color1 = new Color4(0.85, 0.45, 1.0, 1);
    ribbon.color2 = new Color4(0.55, 0.25, 0.95, 1);
    ribbon.colorDead = new Color4(0.25, 0.05, 0.55, 0);
    ribbon.minSize = 0.10 + effect * 0.05;
    ribbon.maxSize = 0.28 + effect * 0.18;
    ribbon.minLifeTime = 0.55;
    ribbon.maxLifeTime = 1.15;
    ribbon.emitRate = 600;
    ribbon.gravity = new Vector3(0, 3.5, 0);
    ribbon.direction1 = new Vector3(-1.6, 1.2, -1.6);
    ribbon.direction2 = new Vector3(1.6, 3.0, 1.6);
    ribbon.minEmitPower = 0.9;
    ribbon.maxEmitPower = 2.2;
    ribbon.minAngularSpeed = -Math.PI * 1.5;
    ribbon.maxAngularSpeed = Math.PI * 1.5;
    ribbon.updateSpeed = 0.015;
    ribbon.targetStopDuration = 0.12;
    ribbon.disposeOnStop = true;
    ribbon.blendMode = ParticleSystem.BLENDMODE_ADD;
    ribbon.createSphereEmitter(0.18);
    ribbon.start();

    // Bright pinpoint sparkles drifting upward — the "rune dust" on top
    const sparks = new ParticleSystem("magicSparks", 70, scene);
    sparks.particleTexture = this.dotTex;
    sparks.emitter = center;
    sparks.color1 = new Color4(1.0, 0.9, 1.0, 1);
    sparks.color2 = new Color4(0.85, 0.6, 1.0, 1);
    sparks.colorDead = new Color4(1, 1, 1, 0);
    sparks.minSize = 0.04;
    sparks.maxSize = 0.11 + effect * 0.05;
    sparks.minLifeTime = 0.9;
    sparks.maxLifeTime = 1.8;
    sparks.emitRate = 140;
    sparks.gravity = new Vector3(0, 1.8, 0);
    sparks.direction1 = new Vector3(-2.5, 1.5, -2.5);
    sparks.direction2 = new Vector3(2.5, 4, 2.5);
    sparks.minEmitPower = 1.5;
    sparks.maxEmitPower = 3.5;
    sparks.targetStopDuration = 0.18;
    sparks.disposeOnStop = true;
    sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
    sparks.start();
  }

  private spawnRays() {
    const { scene, buttonPos } = this.refs;
    const ps = new ParticleSystem("rays", 60, scene);
    ps.particleTexture = this.dotTex;
    ps.emitter = buttonPos();
    ps.color1 = new Color4(1, 0.95, 0.4, 1);
    ps.color2 = new Color4(1, 0.7, 0.2, 1);
    ps.colorDead = new Color4(1, 0.5, 0, 0);
    ps.minSize = 0.5;
    ps.maxSize = 1.2;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.8;
    ps.emitRate = 300;
    ps.direction1 = new Vector3(-1, -1, -0.2);
    ps.direction2 = new Vector3(1, 1, 0.2);
    ps.minEmitPower = 6;
    ps.maxEmitPower = 12;
    ps.targetStopDuration = 0.15;
    ps.disposeOnStop = true;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
  }

  private flashLight(cat: HitCategory, effect: number) {
    const { fillLight } = this.refs;
    const [c1] = CATEGORY_COLOR[cat];
    const targetIntensity = 1 + effect * 4;
    fillLight.diffuse = new Color3(c1.r, c1.g, c1.b);
    fillLight.intensity = targetIntensity;
    Animation.CreateAndStartAnimation(
      "lightFade", fillLight, "intensity", 60, 30,
      targetIntensity, fillLight.intensity, 0,
    );
  }

  private screenFlash(strength: number) {
    const overlay = this.refs.hudRoot.querySelector<HTMLElement>("#flashOverlay");
    if (!overlay) return;
    overlay.style.setProperty("--flash-strength", String(strength));
    overlay.classList.remove("flash");
    void overlay.offsetWidth;
    overlay.classList.add("flash");
  }
}

// === Helpers ===

export function createLightningBoltMesh(scene: Scene, start: Vector3, end: Vector3): Mesh {
  const tex = createLightningTexture(scene);
  const length = Vector3.Distance(start, end);
  const plane = MeshBuilder.CreatePlane("bolt", { width: length, height: 0.45 }, scene);
  plane.position = Vector3.Center(start, end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  plane.rotation.z = Math.atan2(dy, dx);
  plane.billboardMode = Mesh.BILLBOARDMODE_NONE;
  const mat = new StandardMaterial("boltMat", scene);
  mat.emissiveColor = new Color3(0.9, 0.9, 1.0);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.opacityTexture = tex;
  mat.disableLighting = true;
  mat.alpha = 1;
  plane.material = mat;
  return plane;
}

function createLightningTexture(scene: Scene): Texture {
  const w = 512, h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const drawPath = (lineWidth: number, color: string, blur: number, jitter: number) => {
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    const segs = 14;
    for (let i = 1; i <= segs; i++) {
      const x = (i / segs) * w;
      const baseY = h / 2;
      const y = baseY + (Math.random() - 0.5) * jitter;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.shadowBlur = blur;
    ctx.shadowColor = color;
    ctx.stroke();
  };

  drawPath(22, "rgba(180,200,255,0.4)", 30, h * 0.5);
  drawPath(8, "rgba(220,230,255,0.85)", 18, h * 0.5);
  drawPath(3, "rgba(255,255,255,1)", 6, h * 0.4);

  for (let b = 0; b < 3; b++) {
    ctx.beginPath();
    const startX = Math.random() * w * 0.8;
    const startY = h / 2;
    ctx.moveTo(startX, startY);
    const angle = (Math.random() - 0.5) * 1.4;
    const len = 60 + Math.random() * 100;
    const endX = startX + Math.cos(angle) * len;
    const endY = startY + Math.sin(angle) * len * 0.6;
    const midX = (startX + endX) / 2 + (Math.random() - 0.5) * 30;
    const midY = (startY + endY) / 2 + (Math.random() - 0.5) * 30;
    ctx.lineTo(midX, midY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = "rgba(220,230,255,0.9)";
    ctx.lineWidth = 4;
    ctx.shadowBlur = 12;
    ctx.shadowColor = "rgba(180,200,255,1)";
    ctx.stroke();
  }

  const tex = new Texture(c.toDataURL("image/png"), scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;
  return tex;
}
