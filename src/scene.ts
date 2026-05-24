import {
  Animation,
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  GlowLayer,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Observable,
  ParticleSystem,
  PointerEventTypes,
  PointLight,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export interface SceneRefs {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  buttonAnchor: TransformNode;
  topGroup: TransformNode;
  buttonTop: Mesh;
  buttonHalo: Mesh;
  buttonCore: Mesh;
  shards: Mesh[];
  starfield: ParticleSystem;
  floor: Mesh;
  glowLayer: GlowLayer;
  pipeline: DefaultRenderingPipeline;
  fillLight: PointLight;
  hemiLight: HemisphericLight;
  onClick: Observable<void>;
  pressButton: () => void;
  getButtonWorldPos: () => Vector3;
  applyVisualLevel: (level: number) => void;
  intensity: () => number;
  cycleCameraAngle: (duration?: number) => void;
}

export function createScene(canvas: HTMLCanvasElement): SceneRefs {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
    powerPreference: "high-performance",
  });

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.75, 0.92, 1); // sky blue
  scene.ambientColor = new Color3(0.45, 0.5, 0.55);

  // Camera — locked, slight programmatic drift
  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.15,
    7.2,
    Vector3.Zero(),
    scene,
  );
  camera.minZ = 0.1;
  camera.fov = 0.85;
  camera.inputs.clear();

  // === Lights — outdoor daylight at start ===
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0.2), scene);
  hemi.intensity = 0.95;
  hemi.groundColor = new Color3(0.25, 0.35, 0.2); // greenish bounce off grass
  hemi.diffuse = new Color3(0.85, 0.92, 1.0);     // sky-blue tint

  const keyLight = new DirectionalLight("key", new Vector3(-0.4, -1, -0.3), scene);
  keyLight.intensity = 1.1;
  keyLight.diffuse = new Color3(1, 0.96, 0.85); // warm sunlight

  const fillLight = new PointLight("fill", new Vector3(0, 0.5, 3), scene);
  fillLight.intensity = 0.5;
  fillLight.diffuse = new Color3(1, 1, 1);
  fillLight.specular = new Color3(1, 1, 1);
  fillLight.range = 14;

  // === Starfield (starts at 0 emit rate) ===
  const starfield = createStarfield(scene);
  starfield.emitRate = 0;

  // === Landscape: grass ground, rocks, distant mountains ===
  const groundY = -0.55;
  const floor = MeshBuilder.CreateGround(
    "ground",
    { width: 220, height: 220, subdivisions: 1 },
    scene,
  );
  floor.position.y = groundY;
  const floorMat = new StandardMaterial("groundMat", scene);
  floorMat.diffuseTexture = createGrassTexture(scene);
  floorMat.specularColor = new Color3(0, 0, 0);
  floor.material = floorMat;

  // Rocks clustered around the base + scattered farther out
  const rocks: Mesh[] = [];
  // Close cluster — visually plants the tilted button on a rocky outcrop
  for (let i = 0; i < 7; i++) {
    const r = makeRock(scene, `rockClose${i}`, 0.32 + Math.random() * 0.35, groundY);
    const angle = (i / 7) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 0.75 + Math.random() * 0.6;
    r.position.x = Math.cos(angle) * dist;
    r.position.z = Math.sin(angle) * dist;
    rocks.push(r);
  }
  // Mid-distance scatter
  for (let i = 0; i < 14; i++) {
    const r = makeRock(scene, `rockMid${i}`, 0.18 + Math.random() * 0.55, groundY);
    const angle = Math.random() * Math.PI * 2;
    const dist = 2.5 + Math.random() * 9;
    r.position.x = Math.cos(angle) * dist;
    r.position.z = Math.sin(angle) * dist;
    rocks.push(r);
  }
  // Far boulders near the mountain ring
  for (let i = 0; i < 8; i++) {
    const r = makeRock(scene, `rockFar${i}`, 0.6 + Math.random() * 1.1, groundY);
    const angle = Math.random() * Math.PI * 2;
    const dist = 13 + Math.random() * 8;
    r.position.x = Math.cos(angle) * dist;
    r.position.z = Math.sin(angle) * dist;
    rocks.push(r);
  }

  // Mountain ring in the distance — low-poly cones
  const mountains: Mesh[] = [];
  const mountainCount = 14;
  for (let i = 0; i < mountainCount; i++) {
    const h = 5 + Math.random() * 9;
    const d = 7 + Math.random() * 8;
    const m = MeshBuilder.CreateCylinder(
      `mountain${i}`,
      {
        diameterTop: 0.15,
        diameterBottom: d,
        height: h,
        tessellation: 6 + Math.floor(Math.random() * 3),
      },
      scene,
    );
    const angle = (i / mountainCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const dist = 28 + Math.random() * 16;
    m.position.x = Math.cos(angle) * dist;
    m.position.z = Math.sin(angle) * dist;
    m.position.y = groundY + h / 2;
    m.rotation.y = Math.random() * Math.PI * 2;
    m.rotation.z = (Math.random() - 0.5) * 0.18;
    const mMat = new StandardMaterial(`mountainMat${i}`, scene);
    const shade = 0.32 + Math.random() * 0.15;
    mMat.diffuseColor = new Color3(shade * 0.9, shade * 0.88, shade);
    mMat.specularColor = new Color3(0.05, 0.05, 0.06);
    mMat.specularPower = 16;
    m.material = mMat;
    mountains.push(m);
  }

  // === Arcade button assembly ===
  const buttonAnchor = new TransformNode("buttonAnchor", scene);
  // Tilt the whole button 45° forward so the cap faces the camera
  buttonAnchor.rotation.x = -Math.PI / 4;
  // Lift the assembly to keep the cap centered in frame
  buttonAnchor.position.y = 0.25;

  // Base (tapered cylinder)
  const buttonBase = MeshBuilder.CreateCylinder(
    "buttonBase",
    { diameterTop: 1.7, diameterBottom: 1.95, height: 0.55, tessellation: 64 },
    scene,
  );
  buttonBase.parent = buttonAnchor;
  buttonBase.position.y = -0.6;
  const baseMat = new StandardMaterial("baseMat", scene);
  baseMat.diffuseColor = new Color3(0.13, 0.13, 0.15);
  baseMat.specularColor = new Color3(0.25, 0.25, 0.25);
  baseMat.specularPower = 32;
  buttonBase.material = baseMat;

  // Outer ring (lip)
  const buttonRing = MeshBuilder.CreateCylinder(
    "buttonRing",
    { diameterTop: 1.8, diameterBottom: 1.8, height: 0.1, tessellation: 64 },
    scene,
  );
  buttonRing.parent = buttonAnchor;
  buttonRing.position.y = -0.28;
  const ringMat = new StandardMaterial("ringMat", scene);
  ringMat.diffuseColor = new Color3(0.32, 0.32, 0.36);
  ringMat.specularColor = new Color3(0.6, 0.6, 0.65);
  ringMat.specularPower = 80;
  buttonRing.material = ringMat;

  // The pressable top group — animates down on click
  const topGroup = new TransformNode("topGroup", scene);
  topGroup.parent = buttonAnchor;
  topGroup.position.y = -0.22;

  // Red arcade cap — short wide chamfered cylinder with a dent on top
  const buttonTop = MeshBuilder.CreateLathe(
    "buttonTop",
    { shape: buildArcadeCapShape(), tessellation: 64, sideOrientation: Mesh.DEFAULTSIDE },
    scene,
  );
  buttonTop.parent = topGroup;
  const topMat = new StandardMaterial("topMat", scene);
  topMat.diffuseColor = new Color3(0.88, 0.08, 0.08);
  topMat.specularColor = new Color3(0.9, 0.7, 0.7);
  topMat.specularPower = 72;
  topMat.emissiveColor = new Color3(0, 0, 0);
  buttonTop.material = topMat;

  // === Halo + core (start invisible) ===
  const buttonHalo = MeshBuilder.CreateDisc("halo", { radius: 2.4, tessellation: 64 }, scene);
  buttonHalo.parent = buttonAnchor;
  buttonHalo.position.z = 0.3;
  buttonHalo.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const haloMat = new StandardMaterial("haloMat", scene);
  haloMat.emissiveColor = new Color3(1.0, 0.55, 0.15);
  haloMat.diffuseColor = new Color3(0, 0, 0);
  haloMat.specularColor = new Color3(0, 0, 0);
  haloMat.disableLighting = true;
  haloMat.opacityTexture = createRadialGradientTexture(scene, "haloTex", 256, [
    { stop: 0.0, color: "rgba(255,180,80,0.0)" },
    { stop: 0.55, color: "rgba(255,180,80,0.0)" },
    { stop: 0.85, color: "rgba(255,180,80,0.55)" },
    { stop: 1.0, color: "rgba(255,180,80,0.0)" },
  ]);
  haloMat.alpha = 0;
  buttonHalo.material = haloMat;
  buttonHalo.isVisible = false;

  const buttonCore = MeshBuilder.CreateDisc("core", { radius: 1.5, tessellation: 48 }, scene);
  buttonCore.parent = buttonAnchor;
  buttonCore.position.z = 0.25;
  buttonCore.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const coreMat = new StandardMaterial("coreMat", scene);
  coreMat.emissiveColor = new Color3(1.0, 0.9, 0.6);
  coreMat.diffuseColor = new Color3(0, 0, 0);
  coreMat.specularColor = new Color3(0, 0, 0);
  coreMat.disableLighting = true;
  coreMat.opacityTexture = createRadialGradientTexture(scene, "coreTex", 256, [
    { stop: 0.0, color: "rgba(255,240,200,0.95)" },
    { stop: 0.35, color: "rgba(255,180,80,0.55)" },
    { stop: 1.0, color: "rgba(255,80,20,0.0)" },
  ]);
  coreMat.alpha = 0;
  buttonCore.material = coreMat;
  buttonCore.isVisible = false;

  // === Orbiting shards (appear later) ===
  const shards: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const s = MeshBuilder.CreatePolyhedron(`shard${i}`, { type: 1, size: 0.16 }, scene);
    const m = new StandardMaterial(`shardMat${i}`, scene);
    m.emissiveColor = new Color3(0.4, 0.7, 1.0);
    m.diffuseColor = new Color3(0.1, 0.2, 0.6);
    m.specularColor = new Color3(1, 1, 1);
    s.material = m;
    s.parent = buttonAnchor;
    s.isVisible = false;
    shards.push(s);
  }

  // === Glow layer + post-processing pipeline (all off at start) ===
  const glowLayer = new GlowLayer("glow", scene, {
    mainTextureSamples: 2,
    blurKernelSize: 64,
  });
  glowLayer.intensity = 0;

  const pipeline = new DefaultRenderingPipeline("pipeline", true, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.95;
  pipeline.bloomWeight = 0;
  pipeline.bloomKernel = 96;
  pipeline.bloomScale = 0.7;
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.vignetteEnabled = false;
  pipeline.imageProcessing.vignetteWeight = 0;
  pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0.7);
  pipeline.imageProcessing.contrast = 1.0;
  pipeline.imageProcessing.exposure = 1.0;
  pipeline.chromaticAberrationEnabled = false;
  pipeline.chromaticAberration.aberrationAmount = 0;
  pipeline.grainEnabled = false;
  pipeline.grain.intensity = 0;
  pipeline.grain.animated = true;

  // === Idle motion / animation ===
  let t = 0;
  let currentLevel = 1;
  const baseTopY = -0.22;

  // Camera-move state — animated base alpha/beta/radius
  let cameraBaseAlpha = camera.alpha;
  let cameraBaseBeta = camera.beta;
  let cameraBaseRadius = camera.radius;
  let cameraMove: {
    startAlpha: number; targetAlpha: number;
    startBeta: number; targetBeta: number;
    startRadius: number; targetRadius: number;
    startTime: number; duration: number;
  } | null = null;
  let lastCameraAngleIdx = 0;

  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    t += dt;
    const vis = visualIntensity(currentLevel);

    // Resolve active camera move (ease-out cubic)
    if (cameraMove) {
      const elapsed = performance.now() - cameraMove.startTime;
      const p = Math.min(1, elapsed / cameraMove.duration);
      const e = 1 - Math.pow(1 - p, 3);
      cameraBaseAlpha = lerp(cameraMove.startAlpha, cameraMove.targetAlpha, e);
      cameraBaseBeta = lerp(cameraMove.startBeta, cameraMove.targetBeta, e);
      cameraBaseRadius = lerp(cameraMove.startRadius, cameraMove.targetRadius, e);
      if (p >= 1) cameraMove = null;
    }

    // Apply base + subtle drift on top (drift scales with visual intensity)
    camera.alpha = cameraBaseAlpha + Math.sin(t * 0.3) * 0.04 * vis;
    camera.beta = cameraBaseBeta + Math.sin(t * 0.22) * 0.03 * vis;
    camera.radius = cameraBaseRadius;

    // Top group subtle bob (only at higher level)
    if (vis > 0 && !pressActive) {
      topGroup.position.y = baseTopY + Math.sin(t * 1.2) * 0.025 * vis;
    }

    // Halo pulsing
    if (buttonHalo.isVisible) {
      const pulse = 1 + Math.sin(t * 1.8) * 0.04;
      buttonHalo.scaling.set(pulse, pulse, pulse);
    }
    if (buttonCore.isVisible) {
      const corePulse = 1 + Math.sin(t * 2.6) * 0.06;
      buttonCore.scaling.set(corePulse, corePulse, corePulse);
    }

    // Shards orbit
    if (shards.length > 0 && shards[0].isVisible) {
      shards.forEach((s, i) => {
        const angle = t * (0.6 + i * 0.12) + i * ((Math.PI * 2) / shards.length);
        const radius = 1.7 + Math.sin(t * 0.8 + i) * 0.15;
        s.position.x = Math.cos(angle) * radius;
        s.position.y = Math.sin(angle * 0.9) * 0.35 + Math.sin(t * 1.5 + i) * 0.15;
        s.position.z = Math.sin(angle) * radius * 0.35;
        s.rotation.x = t * (1 + i * 0.1);
        s.rotation.y = t * (1.2 + i * 0.07);
      });
    }
  });

  // === Click detection ===
  const onClick = new Observable<void>();
  const clickableMeshes = new Set<Mesh>([buttonTop, buttonBase, buttonRing, buttonHalo, buttonCore]);
  scene.onPointerObservable.add((info) => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      const pick = info.pickInfo;
      if (pick?.hit && pick.pickedMesh && clickableMeshes.has(pick.pickedMesh as Mesh)) {
        onClick.notifyObservers();
        return;
      }
      // Forgiving central hit area
      const px = scene.pointerX / engine.getRenderWidth();
      const py = scene.pointerY / engine.getRenderHeight();
      if (px > 0.3 && px < 0.7 && py > 0.3 && py < 0.85) {
        onClick.notifyObservers();
      }
    }
  });

  // === Press animation: dome dips down then springs back ===
  let pressActive = false;
  const pressButton = () => {
    pressActive = true;
    const anim = new Animation(
      "press",
      "position.y",
      60,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    anim.setKeys([
      { frame: 0, value: topGroup.position.y },
      { frame: 3, value: baseTopY - 0.06 },
      { frame: 14, value: baseTopY },
    ]);
    topGroup.animations = [anim];
    scene.beginAnimation(topGroup, 0, 14, false, 1, () => {
      pressActive = false;
    });
  };

  // === Camera move API ===
  const moveCamera = (alpha: number, beta: number, radius: number, duration = 1.4) => {
    cameraMove = {
      startAlpha: cameraBaseAlpha,
      targetAlpha: alpha,
      startBeta: cameraBaseBeta,
      targetBeta: beta,
      startRadius: cameraBaseRadius,
      targetRadius: radius,
      startTime: performance.now(),
      duration: duration * 1000,
    };
  };

  const cycleCameraAngle = (duration = 1.4) => {
    let idx = lastCameraAngleIdx;
    if (CAMERA_PRESETS.length > 1) {
      while (idx === lastCameraAngleIdx) {
        idx = Math.floor(Math.random() * CAMERA_PRESETS.length);
      }
    }
    lastCameraAngleIdx = idx;
    const a = CAMERA_PRESETS[idx];
    moveCamera(a.alpha, a.beta, a.radius, duration);
  };

  // === applyVisualLevel: maps level → all visual properties ===
  const applyVisualLevel = (level: number) => {
    currentLevel = level;
    const v = visualIntensity(level);

    // Pipeline progression
    pipeline.bloomThreshold = Math.max(0.3, 0.95 - v * 0.6);
    pipeline.bloomWeight = v * 0.9;
    pipeline.imageProcessing.vignetteEnabled = level >= 3;
    pipeline.imageProcessing.vignetteWeight = Math.max(0, (level - 2) / 18) * 6;
    pipeline.imageProcessing.contrast = 1.0 + v * 0.15;
    pipeline.imageProcessing.exposure = 1.0 + v * 0.08;
    pipeline.chromaticAberrationEnabled = level >= 8;
    pipeline.chromaticAberration.aberrationAmount = Math.max(0, (level - 8) / 12) * 1.4;
    pipeline.grainEnabled = level >= 6;
    pipeline.grain.intensity = Math.max(0, (level - 6) / 14) * 7;
    glowLayer.intensity = v * 1.4;

    // Halo + core fade in
    const haloT = clamp01((level - 2) / 6);
    buttonHalo.isVisible = level >= 2;
    haloMat.alpha = haloT;
    const coreT = clamp01((level - 3) / 7);
    buttonCore.isVisible = level >= 3;
    coreMat.alpha = coreT;

    // Shards
    shards.forEach((s) => (s.isVisible = level >= 6));

    // Starfield emit rate
    starfield.emitRate = v * 60;

    // Sky color: bright daytime blue → twilight purple → deep navy
    scene.clearColor = new Color4(
      lerp(0.55, 0.04, v),
      lerp(0.75, 0.05, v),
      lerp(0.92, 0.12, v),
      1,
    );
    scene.ambientColor = new Color3(
      lerp(0.45, 0.12, v),
      lerp(0.5, 0.12, v),
      lerp(0.55, 0.2, v),
    );

    // Grass dims with sky
    (floor.material as StandardMaterial).diffuseColor = new Color3(
      lerp(1, 0.35, v),
      lerp(1, 0.35, v),
      lerp(1, 0.4, v),
    );

    // Button red dome gets a subtle inner glow at higher levels
    topMat.emissiveColor = new Color3(0.6 * v * 0.5, 0.03 * v, 0.03 * v);

    // Hemispheric light: warm daylight → cool moonlight
    hemi.intensity = lerp(0.95, 0.3, v);
    hemi.diffuse = Color3.Lerp(new Color3(0.85, 0.92, 1.0), new Color3(0.55, 0.6, 0.95), v);
    hemi.groundColor = Color3.Lerp(new Color3(0.25, 0.35, 0.2), new Color3(0.08, 0.08, 0.15), v);

    // Sun dims, shifts cooler
    keyLight.intensity = lerp(1.1, 0.4, v);
    keyLight.diffuse = Color3.Lerp(new Color3(1, 0.96, 0.85), new Color3(0.7, 0.75, 0.95), v);

    // Fill light shifts to warm/orange and brighter
    fillLight.diffuse = Color3.Lerp(new Color3(1, 1, 1), new Color3(1, 0.6, 0.25), v);
    fillLight.intensity = lerp(0.5, 1.4, v);
  };

  // Initial state at level 1
  applyVisualLevel(1);

  window.addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => scene.render());

  const getButtonWorldPos = () => {
    const wp = buttonAnchor.getAbsolutePosition().clone();
    wp.y += topGroup.position.y + 0.2; // approximately dome center
    return wp;
  };

  return {
    engine,
    scene,
    camera,
    buttonAnchor,
    topGroup,
    buttonTop,
    buttonHalo,
    buttonCore,
    shards,
    starfield,
    floor,
    glowLayer,
    pipeline,
    fillLight,
    hemiLight: hemi,
    onClick,
    pressButton,
    getButtonWorldPos,
    applyVisualLevel,
    intensity: () => visualIntensity(currentLevel),
    cycleCameraAngle,
  };
}

// === helpers ===

export function visualIntensity(level: number): number {
  // 0 at level 1, ~1 by level 20+
  return clamp01((level - 1) / 19);
}

// Pool of "nice" camera presets — all show the button from top/front.
// alpha: rotation around Y (front of button is at alpha = -PI/2)
// beta:  polar angle from +Y; smaller = more top-down, ~PI/2 = horizontal
const CAMERA_PRESETS: { alpha: number; beta: number; radius: number }[] = [
  { alpha: -Math.PI / 2,         beta: Math.PI / 2.15, radius: 7.2 }, // dead front
  { alpha: -Math.PI / 2 + 0.55,  beta: Math.PI / 2.35, radius: 6.8 }, // upper-left
  { alpha: -Math.PI / 2 - 0.55,  beta: Math.PI / 2.35, radius: 6.8 }, // upper-right
  { alpha: -Math.PI / 2,         beta: Math.PI / 2.8,  radius: 7.6 }, // higher / more top-down
  { alpha: -Math.PI / 2,         beta: Math.PI / 1.95, radius: 6.4 }, // lower, looking up slightly
  { alpha: -Math.PI / 2 + 0.35,  beta: Math.PI / 2.5,  radius: 6.0 }, // close upper-left
  { alpha: -Math.PI / 2 - 0.35,  beta: Math.PI / 2.5,  radius: 6.0 }, // close upper-right
  { alpha: -Math.PI / 2 + 0.85,  beta: Math.PI / 2.25, radius: 7.0 }, // wider side-left
  { alpha: -Math.PI / 2 - 0.85,  beta: Math.PI / 2.25, radius: 7.0 }, // wider side-right
  { alpha: -Math.PI / 2,         beta: Math.PI / 3.2,  radius: 8.2 }, // pulled-back top view
];

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Lathe profile for the arcade cap (revolved around Y).
// Short wide cylinder, rounded top edge, smooth dish on top.
function buildArcadeCapShape(): Vector3[] {
  const R = 0.82;        // cap outer radius
  const H = 0.22;        // cap height
  const r = 0.085;       // top-edge chamfer radius
  const d = 0.038;       // dent depth
  const chamferSegs = 10;
  const dentSegs = 18;

  const pts: Vector3[] = [];

  // Bottom center → flat underside → side wall
  pts.push(new Vector3(0, 0, 0));
  pts.push(new Vector3(R, 0, 0));
  pts.push(new Vector3(R, H - r, 0));

  // Chamfer (quarter circle, center at (R-r, H-r))
  for (let i = 1; i <= chamferSegs; i++) {
    const theta = (i / chamferSegs) * (Math.PI / 2);
    pts.push(new Vector3((R - r) + r * Math.cos(theta), (H - r) + r * Math.sin(theta), 0));
  }
  // Last chamfer point lands at (R-r, H) — start of the dish

  // Dent: smooth cosine dish from rim (R-r, H) down to center (0, H-d)
  const rd = R - r;
  for (let i = 1; i <= dentSegs; i++) {
    const t = i / dentSegs;
    const x = rd * (1 - t);
    const y = H - d * (1 + Math.cos(Math.PI * (x / rd))) / 2;
    pts.push(new Vector3(x, y, 0));
  }
  // Final point is on the axis at the bottom of the dish, closing the lathe.

  return pts;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function createStarfield(scene: Scene): ParticleSystem {
  const ps = new ParticleSystem("stars", 800, scene);
  ps.particleTexture = createDotTexture(scene, "starTex");
  ps.emitter = new Vector3(0, 0, -8);
  ps.minEmitBox = new Vector3(-12, -6, -3);
  ps.maxEmitBox = new Vector3(12, 6, 3);
  ps.color1 = new Color4(0.6, 0.7, 1, 0.8);
  ps.color2 = new Color4(0.9, 0.7, 1, 1);
  ps.colorDead = new Color4(0, 0, 0.1, 0);
  ps.minSize = 0.02;
  ps.maxSize = 0.07;
  ps.minLifeTime = 8;
  ps.maxLifeTime = 16;
  ps.emitRate = 0;
  ps.direction1 = new Vector3(-0.02, -0.01, 0.02);
  ps.direction2 = new Vector3(0.02, 0.01, 0.05);
  ps.minEmitPower = 0.05;
  ps.maxEmitPower = 0.15;
  ps.updateSpeed = 0.02;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();
  return ps;
}

function createDotTexture(scene: Scene, name: string): Texture {
  const size = 64;
  const tex = new Texture(
    `data:${name}.png;base64,${createDotPng(size)}`,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tex.hasAlpha = true;
  return tex;
}

function createDotPng(size: number): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL("image/png").split(",")[1];
}

function createGrassTexture(scene: Scene): Texture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#4f7c33";
  ctx.fillRect(0, 0, size, size);
  // Color speckle
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random();
    if (r < 0.5) ctx.fillStyle = `rgba(105, 145, 65, ${0.35 + Math.random() * 0.5})`;
    else if (r < 0.85) ctx.fillStyle = `rgba(55, 85, 35, ${0.35 + Math.random() * 0.55})`;
    else ctx.fillStyle = `rgba(150, 180, 95, ${0.35 + Math.random() * 0.5})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // Short vertical strokes as grass blade hints
  for (let i = 0; i < 1200; i++) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    const h = 2 + Math.random() * 4;
    ctx.fillStyle = `rgba(${60 + Math.random() * 70}, ${110 + Math.random() * 80}, ${45 + Math.random() * 40}, 0.65)`;
    ctx.fillRect(x, y, 1, h);
  }
  const tex = new Texture(c.toDataURL("image/png"), scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.uScale = 22;
  tex.vScale = 22;
  return tex;
}

function makeRock(scene: Scene, name: string, size: number, groundY: number): Mesh {
  // Mix of polyhedron types for variety; CreatePolyhedron type 0..14, low-poly chunky shapes
  const type = [0, 1, 2, 3, 4][Math.floor(Math.random() * 5)];
  const m = MeshBuilder.CreatePolyhedron(name, { type, size }, scene);
  m.scaling.x = 0.7 + Math.random() * 0.8;
  m.scaling.y = 0.45 + Math.random() * 0.6;
  m.scaling.z = 0.7 + Math.random() * 0.8;
  m.rotation.x = Math.random() * Math.PI * 2;
  m.rotation.y = Math.random() * Math.PI * 2;
  m.rotation.z = Math.random() * Math.PI * 2;
  m.position.y = groundY + size * 0.25; // partly buried
  const mat = new StandardMaterial(`${name}Mat`, scene);
  const grey = 0.35 + Math.random() * 0.25;
  // Earthy grey-brown
  mat.diffuseColor = new Color3(grey, grey * 0.95, grey * 0.85);
  mat.specularColor = new Color3(0.08, 0.08, 0.08);
  mat.specularPower = 24;
  m.material = mat;
  return m;
}

export function createRadialGradientTexture(
  scene: Scene,
  name: string,
  size: number,
  stops: { stop: number; color: string }[],
): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const s of stops) g.addColorStop(s.stop, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new Texture(c.toDataURL("image/png"), scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  tex.hasAlpha = true;
  return tex;
}
