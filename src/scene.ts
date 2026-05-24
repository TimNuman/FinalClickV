import {
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Effect,
  Engine,
  GlowLayer,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Observable,
  ParticleSystem,
  PointerEventTypes,
  PointLight,
  Quaternion,
  Scene,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
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
  onPress: Observable<void>;
  onRelease: Observable<void>;
  setButtonHeld: (held: boolean) => void;
  getButtonWorldPos: () => Vector3;
  applyVisualLevel: (level: number) => void;
  intensity: () => number;
  cycleCameraAngle: (duration?: number) => void;
}

export function createScene(canvas: HTMLCanvasElement): SceneRefs {
  registerLandscapeShaders();

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

  // Shared rock shader material — all rocks use it (one bind, many draws)
  const rockMat = createRockMaterial(scene);

  // Rocks clustered around the base + scattered farther out
  const rocks: Mesh[] = [];

  // Close cluster — hand-placed so the tilted button looks nestled in a rock pile.
  // Button cap faces -Z (toward camera); base tilts into +Z. So we cluster larger
  // rocks behind (+Z) and on the sides, with low/small rocks in front (-Z) so the
  // cap stays fully visible.
  // Button footprint (after the -π/4 tilt) reaches roughly z ≈ +1.3 at the
  // base back rim and ±0.85 on the sides. Keep rocks clear of that volume.
  const closeRockSpecs: { x: number; z: number; size: number; sx: number; sy: number; sz: number }[] = [
    // Tall mountain shards BEHIND the button — jut up to frame the cap
    { x: -1.65, z:  2.30, size: 0.60, sx: 1.1, sy: 1.9, sz: 1.2 },
    { x:  0.10, z:  2.65, size: 0.72, sx: 1.3, sy: 2.1, sz: 1.3 },
    { x:  1.75, z:  2.15, size: 0.58, sx: 1.1, sy: 1.8, sz: 1.3 },
    // Mid rocks tucked into the corners behind the base
    { x: -1.10, z:  1.85, size: 0.42, sx: 1.0, sy: 1.3, sz: 1.0 },
    { x:  1.20, z:  1.75, size: 0.45, sx: 1.0, sy: 1.4, sz: 1.0 },
    // Angular side shards flanking the base (well clear of x≈±0.85 footprint)
    { x: -2.15, z:  0.55, size: 0.55, sx: 1.1, sy: 1.5, sz: 1.2 },
    { x:  2.15, z:  0.45, size: 0.55, sx: 1.1, sy: 1.5, sz: 1.2 },
    { x: -1.85, z: -0.30, size: 0.40, sx: 1.0, sy: 1.0, sz: 1.0 },
    { x:  1.85, z: -0.25, size: 0.40, sx: 1.0, sy: 1.0, sz: 1.0 },
    // Low rocks in FRONT — kept short so the cap stays fully visible
    { x: -1.15, z: -1.10, size: 0.30, sx: 1.0, sy: 0.6,  sz: 0.95 },
    { x:  0.00, z: -1.35, size: 0.32, sx: 1.1, sy: 0.55, sz: 0.9 },
    { x:  1.15, z: -1.10, size: 0.30, sx: 1.0, sy: 0.6,  sz: 0.95 },
  ];
  closeRockSpecs.forEach((spec, i) => {
    rocks.push(makeShaderRock(scene, `rockClose${i}`, spec, groundY, rockMat));
  });

  // Mid-distance scatter
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 2.6 + Math.random() * 9;
    const size = 0.22 + Math.random() * 0.55;
    rocks.push(
      makeShaderRock(
        scene,
        `rockMid${i}`,
        {
          x: Math.cos(angle) * dist,
          z: Math.sin(angle) * dist,
          size,
          sx: 0.7 + Math.random() * 0.7,
          sy: 0.5 + Math.random() * 0.6,
          sz: 0.7 + Math.random() * 0.7,
        },
        groundY,
        rockMat,
      ),
    );
  }
  // Far boulders near the mountain ring
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 13 + Math.random() * 8;
    const size = 0.65 + Math.random() * 1.1;
    rocks.push(
      makeShaderRock(
        scene,
        `rockFar${i}`,
        {
          x: Math.cos(angle) * dist,
          z: Math.sin(angle) * dist,
          size,
          sx: 0.8 + Math.random() * 0.6,
          sy: 0.6 + Math.random() * 0.5,
          sz: 0.8 + Math.random() * 0.6,
        },
        groundY,
        rockMat,
      ),
    );
  }

  // Tall grass blades — thin-instanced field with wind shader
  const grass = createGrassField(scene, groundY, 2.05);

  // Mountain ring in the distance — wide, overlapping snow-capped peaks
  const mountainMat = createMountainMaterial(scene);
  const mountains: Mesh[] = [];
  // Two layers: a front range of stockier hills, a back range of bigger peaks.
  // Counts are chosen so neighbours overlap and the silhouette reads as a range.
  const frontCount = 22;
  for (let i = 0; i < frontCount; i++) {
    const h = 4 + Math.random() * 6;
    const baseR = 6 + Math.random() * 4;
    const angle = (i / frontCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const dist = 22 + Math.random() * 6;
    mountains.push(
      makeMountain(
        scene,
        `mountainFront${i}`,
        {
          x: Math.cos(angle) * dist,
          z: Math.sin(angle) * dist,
          baseRadius: baseR,
          height: h,
          groundY,
        },
        mountainMat,
      ),
    );
  }
  const backCount = 18;
  for (let i = 0; i < backCount; i++) {
    const h = 9 + Math.random() * 8;
    const baseR = 8 + Math.random() * 5;
    const angle = (i / backCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    const dist = 32 + Math.random() * 10;
    mountains.push(
      makeMountain(
        scene,
        `mountainBack${i}`,
        {
          x: Math.cos(angle) * dist,
          z: Math.sin(angle) * dist,
          baseRadius: baseR,
          height: h,
          groundY,
        },
        mountainMat,
      ),
    );
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

  // Light direction shared with shader materials (matches keyLight)
  const sceneLightDir = keyLight.direction.normalizeToNew();

  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    t += dt;
    const vis = visualIntensity(currentLevel);

    // Drive shader-based grass + rocks + mountains
    grass.material.setFloat("time", t);
    grass.material.setVector3("cameraPosition", camera.position);
    rockMat.setVector3("cameraPosition", camera.position);
    mountainMat.setVector3("cameraPosition", camera.position);
    // Light direction softly rotates with day→night to keep things lively
    const ld = sceneLightDir;
    grass.material.setVector3("lightDir", ld);
    rockMat.setVector3("lightDir", ld);
    mountainMat.setVector3("lightDir", ld);

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

    // Dome height: glide toward the target (held=down, released=base + idle bob)
    const bob = vis > 0 ? Math.sin(t * 1.2) * 0.025 * vis : 0;
    const targetY = buttonHeld ? (baseTopY - PRESS_DEPTH) : (baseTopY + bob);
    const cur = topGroup.position.y;
    const dist = targetY - cur;
    if (Math.abs(dist) > 0.0005) {
      // Fast dive on press, springier rise on release
      const rate = (targetY < cur ? PRESS_DEPTH / PRESS_DOWN_SECONDS : PRESS_DEPTH / PRESS_UP_SECONDS);
      const step = Math.sign(dist) * Math.min(rate * dt, Math.abs(dist));
      topGroup.position.y = cur + step;
    } else {
      topGroup.position.y = targetY;
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

  // === Press / release detection (only the red cap is clickable) ===
  // A press starts when the pointer goes down on buttonTop. A release fires
  // when the pointer is released anywhere — even if the pointer drifted off
  // the cap during the hold.
  const onPress = new Observable<void>();
  const onRelease = new Observable<void>();
  let pointerPressing = false;
  scene.onPointerObservable.add((info) => {
    if (info.type === PointerEventTypes.POINTERDOWN) {
      const pick = info.pickInfo;
      if (pick?.hit && pick.pickedMesh === buttonTop) {
        pointerPressing = true;
        onPress.notifyObservers();
      }
    } else if (info.type === PointerEventTypes.POINTERUP) {
      if (pointerPressing) {
        pointerPressing = false;
        onRelease.notifyObservers();
      }
    }
  });

  // === Dome held-state animation ===
  // Hold = dome dives down and stays there. Release = dome eases back up.
  // PRESS_DOWN_SECONDS is fast for snap, PRESS_UP_SECONDS slower for a soft return.
  let buttonHeld = false;
  const PRESS_DEPTH = 0.14;
  const PRESS_DOWN_SECONDS = 0.10;
  const PRESS_UP_SECONDS = 0.30;
  const setButtonHeld = (held: boolean) => {
    buttonHeld = held;
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

    // Shader grass + rocks + mountains dim with sky
    const dark = lerp(1.0, 0.42, v);
    grass.material.setFloat("darknessFactor", dark);
    rockMat.setFloat("darknessFactor", dark);
    mountainMat.setFloat("darknessFactor", dark);
    // Light color shifts cool at night, warm in day (matches keyLight tint)
    const lc = Color3.Lerp(new Color3(1, 0.96, 0.85), new Color3(0.55, 0.62, 0.95), v);
    const ac = Color3.Lerp(new Color3(0.42, 0.46, 0.52), new Color3(0.18, 0.2, 0.32), v);
    grass.material.setColor3("lightColor", lc);
    grass.material.setColor3("ambientColor", ac);
    rockMat.setColor3("lightColor", lc);
    rockMat.setColor3("ambientColor", ac);
    mountainMat.setColor3("lightColor", lc);
    mountainMat.setColor3("ambientColor", ac);
    // Wind picks up slightly with intensity (more dramatic late game)
    grass.material.setFloat("windStrength", 0.22 + v * 0.18);

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
    onPress,
    onRelease,
    setButtonHeld,
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

// ===========================================================================
// Shader-based rocks: displaced icosphere with fbm-noise procedural texturing.
// ===========================================================================

type RockSpec = { x: number; z: number; size: number; sx: number; sy: number; sz: number };

function makeShaderRock(
  scene: Scene,
  name: string,
  spec: RockSpec,
  groundY: number,
  mat: ShaderMaterial,
): Mesh {
  // Very low subdivision = big triangular facets, like mountain shale shards.
  // subdivisions=1 gives 20 triangles (icosahedron); 2 gives 80 (still chunky).
  const subdivisions = spec.size > 0.7 ? 2 : 1;
  const mesh = MeshBuilder.CreateIcoSphere(
    name,
    { radius: spec.size, subdivisions, flat: false },
    scene,
  );
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
  const seed = (spec.x * 13.37 + spec.z * 7.91) % 100;
  const seedI = Math.floor((spec.x * 91.7 + spec.z * 53.1) * 1000) | 0;
  // Anisotropic stretch axis — gives the rock an obvious "long" dimension
  const stretchA = Math.random() * Math.PI * 2;
  const sax = Math.cos(stretchA), saz = Math.sin(stretchA);
  // CreateIcoSphere duplicates vertices at the UV seam, so per-vertex-INDEX
  // jitter would split the mesh open. Hash from the integer-quantized position
  // instead — coincident vertices always get identical displacement, so the
  // shell stays welded.
  const inv = 1 / Math.max(spec.size, 0.001);
  const posJitter = (px: number, py: number, pz: number, salt: number) => {
    const qx = Math.round(px * 4096) | 0;
    const qy = Math.round(py * 4096) | 0;
    const qz = Math.round(pz * 4096) | 0;
    let h = (qx * 374761393) ^ (qy * 668265263) ^ (qz * 1274126177) ^ seedI ^ salt;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (((h ^ (h >>> 16)) >>> 0) / 4294967295);
  };
  const vCount = positions.length / 3;
  for (let vi = 0; vi < vCount; vi++) {
    const i = vi * 3;
    const px = positions[i],     py = positions[i + 1], pz = positions[i + 2];
    // Use the position direction (== sphere normal) so duplicate vertices share
    // the same displacement vector.
    const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
    const dx = px / len, dy = py / len, dz = pz / len;
    // Sharp jitter, position-keyed
    const jitter = (posJitter(px, py, pz, 0) - 0.5) * 0.45;
    const lpx = px * inv, lpy = py * inv, lpz = pz * inv;
    const macro = (valueNoise3(lpx * 1.6 + seed, lpy * 1.6, lpz * 1.6) - 0.5) * 0.30;
    const d = (jitter + macro) * spec.size;
    // Anisotropic squeeze along stretchA axis (also position-keyed)
    const along = dx * sax + dz * saz;
    const aniso = along * 0.25 * spec.size * (posJitter(px, py, pz, 991) * 0.4 + 0.7);
    positions[i]     = px + dx * d + sax * aniso;
    positions[i + 1] = py + dy * d;
    positions[i + 2] = pz + dz * d + saz * aniso;
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  // Recompute smooth normals, then flatten so every triangle reads as a hard facet.
  const smoothNormals: number[] = [];
  VertexData.ComputeNormals(positions, mesh.getIndices() as number[], smoothNormals);
  mesh.updateVerticesData(VertexBuffer.NormalKind, smoothNormals);
  // Flat shading: duplicates vertices and snaps normals to face normals,
  // giving the rock visible polygonal facets like mountain shale.
  mesh.convertToFlatShadedMesh();

  mesh.scaling.set(spec.sx, spec.sy, spec.sz);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.rotation.x = (Math.random() - 0.5) * 0.5;
  mesh.rotation.z = (Math.random() - 0.5) * 0.5;
  mesh.position.x = spec.x;
  mesh.position.z = spec.z;
  // Partially bury so the rock looks set into the ground
  mesh.position.y = groundY + spec.size * spec.sy * 0.3;
  mesh.material = mat;
  return mesh;
}

const ROCK_SHADER_UNIFORMS = [
  "world", "worldView", "worldViewProjection", "view", "viewProjection", "projection",
  "lightDir", "lightColor", "ambientColor", "cameraPosition",
  "baseColor", "darkColor", "mossColor",
  "snowColor", "snowLine", "snowBand",
  "darknessFactor",
];

function createRockMaterial(scene: Scene): ShaderMaterial {
  const mat = new ShaderMaterial(
    "rockMat",
    scene,
    { vertex: "rock", fragment: "rock" },
    { attributes: ["position", "normal"], uniforms: ROCK_SHADER_UNIFORMS },
  );
  mat.setColor3("baseColor", new Color3(0.48, 0.48, 0.5));
  mat.setColor3("darkColor", new Color3(0.16, 0.17, 0.2));
  mat.setColor3("mossColor", new Color3(0.32, 0.42, 0.24));
  mat.setColor3("snowColor", new Color3(0.92, 0.94, 1.0));
  mat.setFloat("snowLine", 999);  // off
  mat.setFloat("snowBand", 1.0);
  mat.setVector3("lightDir", new Vector3(-0.4, -1, -0.3).normalize());
  mat.setColor3("lightColor", new Color3(1, 0.96, 0.85));
  mat.setColor3("ambientColor", new Color3(0.42, 0.46, 0.52));
  mat.setVector3("cameraPosition", new Vector3(0, 1, -7));
  mat.setFloat("darknessFactor", 1.0);
  return mat;
}

function createMountainMaterial(scene: Scene): ShaderMaterial {
  const mat = new ShaderMaterial(
    "mountainMat",
    scene,
    { vertex: "rock", fragment: "rock" },
    { attributes: ["position", "normal"], uniforms: ROCK_SHADER_UNIFORMS },
  );
  // Slightly cooler/darker than close rocks — atmospheric distance
  mat.setColor3("baseColor", new Color3(0.36, 0.39, 0.46));
  mat.setColor3("darkColor", new Color3(0.12, 0.14, 0.20));
  mat.setColor3("mossColor", new Color3(0.22, 0.30, 0.18));
  mat.setColor3("snowColor", new Color3(0.95, 0.97, 1.0));
  // Snow starts a bit below the average peak (5..15) so most mountains get a cap
  mat.setFloat("snowLine", 4.5);
  mat.setFloat("snowBand", 2.5);
  mat.setVector3("lightDir", new Vector3(-0.4, -1, -0.3).normalize());
  mat.setColor3("lightColor", new Color3(1, 0.96, 0.85));
  mat.setColor3("ambientColor", new Color3(0.42, 0.46, 0.52));
  mat.setVector3("cameraPosition", new Vector3(0, 1, -7));
  mat.setFloat("darknessFactor", 1.0);
  return mat;
}

// ===========================================================================
// Mountains: ring-stacked jagged cone with welded vertices + flat shading.
// ===========================================================================

type MountainSpec = {
  x: number;
  z: number;
  baseRadius: number;
  height: number;
  groundY: number;
};

function makeMountain(scene: Scene, name: string, spec: MountainSpec, mat: ShaderMaterial): Mesh {
  // K sides per ring — keep low for a chunky/low-poly silhouette.
  const K = 9 + Math.floor(Math.random() * 3);
  const RINGS = 5; // ring count below the summit ring
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Position-keyed deterministic jitter so all geometry stays welded after
  // we duplicate vertices via convertToFlatShadedMesh.
  const seedI = Math.floor((spec.x * 91.7 + spec.z * 53.1) * 1000) | 0;
  const jr = (a: number, b: number) => {
    let h = (a * 374761393) ^ (b * 668265263) ^ seedI;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  // Cone profile: wider exponent (<1) keeps the silhouette stocky instead of
  // tapering to a sharp point. Each ring carries a noticeable radius all the
  // way up; the summit is a small jagged ring + apex, not a single spike.
  for (let r = 0; r < RINGS; r++) {
    const t = r / RINGS;                       // 0 at base, → 1 at top ring
    const baseY = Math.pow(t, 0.85) * spec.height;
    const baseRad = Math.pow(1 - t, 0.6) * spec.baseRadius;
    for (let k = 0; k < K; k++) {
      const angle = (k / K) * Math.PI * 2;
      const rJ = (jr(r * 1009 + k, 17) - 0.5) * 0.4;
      const yJ = (jr(r * 1009 + k, 31) - 0.5) * 0.12 * spec.height;
      const radius = baseRad * (1 + rJ);
      positions.push(Math.cos(angle) * radius, baseY + yJ, Math.sin(angle) * radius);
      uvs.push(k / K, t);
    }
  }
  // Summit ring — small jagged ring just below the apex so the peak reads as
  // a chunky ridge rather than a sharp cone tip.
  const summitRad = 0.16 * spec.baseRadius;
  const summitY = spec.height * 0.92;
  for (let k = 0; k < K; k++) {
    const angle = (k / K) * Math.PI * 2;
    const rJ = (jr(700 + k, 23) - 0.5) * 0.7;
    const yJ = (jr(700 + k, 41) - 0.5) * 0.18 * spec.height;
    positions.push(Math.cos(angle) * summitRad * (1 + rJ), summitY + yJ, Math.sin(angle) * summitRad * (1 + rJ));
    uvs.push(k / K, 0.95);
  }
  // Apex — well off-center so each peak leans differently
  const apexX = (jr(99, 1) - 0.5) * 0.3 * spec.baseRadius;
  const apexZ = (jr(99, 2) - 0.5) * 0.3 * spec.baseRadius;
  const summitStart = RINGS * K;
  const apexIdx = summitStart + K;
  positions.push(apexX, spec.height, apexZ);
  uvs.push(0.5, 1);

  // Quads between adjacent rings
  for (let r = 0; r < RINGS - 1; r++) {
    for (let k = 0; k < K; k++) {
      const k1 = (k + 1) % K;
      const a = r * K + k;
      const b = r * K + k1;
      const c = (r + 1) * K + k;
      const d = (r + 1) * K + k1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Connect last main ring to the summit ring
  const lastMain = (RINGS - 1) * K;
  for (let k = 0; k < K; k++) {
    const k1 = (k + 1) % K;
    const a = lastMain + k;
    const b = lastMain + k1;
    const c = summitStart + k;
    const d = summitStart + k1;
    indices.push(a, c, b, b, c, d);
  }
  // Apex fan from the summit ring
  for (let k = 0; k < K; k++) {
    const k1 = (k + 1) % K;
    indices.push(summitStart + k, apexIdx, summitStart + k1);
  }

  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);
  // Hard facets — each triangle gets its own face normal
  mesh.convertToFlatShadedMesh();

  mesh.position.set(spec.x, spec.groundY - 0.2, spec.z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.material = mat;
  return mesh;
}

// ===========================================================================
// Wind-driven grass field — single tapered blade mesh, thin-instanced.
// ===========================================================================

function createGrassField(
  scene: Scene,
  groundY: number,
  exclusionRadius: number,
): { mesh: Mesh; material: ShaderMaterial } {
  const blade = buildGrassBladeMesh(scene);
  const mat = new ShaderMaterial(
    "grassMat",
    scene,
    { vertex: "grass", fragment: "grass" },
    {
      attributes: ["position", "normal", "uv", "world0", "world1", "world2", "world3"],
      uniforms: [
        "view", "viewProjection", "projection",
        "time", "windDir", "windStrength",
        "baseColor", "tipColor", "lightDir", "lightColor", "ambientColor",
        "cameraPosition", "darknessFactor",
      ],
    },
  );
  mat.backFaceCulling = false;
  mat.setColor3("baseColor", new Color3(0.15, 0.32, 0.10));
  mat.setColor3("tipColor", new Color3(0.62, 0.78, 0.34));
  mat.setVector3("windDir", new Vector3(0.85, 0, 0.52));
  mat.setFloat("windStrength", 0.22);
  mat.setVector3("lightDir", new Vector3(-0.4, -1, -0.3).normalize());
  mat.setColor3("lightColor", new Color3(1, 0.96, 0.85));
  mat.setColor3("ambientColor", new Color3(0.42, 0.46, 0.52));
  mat.setVector3("cameraPosition", new Vector3(0, 1, -7));
  mat.setFloat("darknessFactor", 1.0);
  mat.setFloat("time", 0);
  blade.material = mat;

  // Generate thin-instance world matrices on a jittered grid.
  const radius = 14;
  const target = 16000;
  const excl2 = exclusionRadius * exclusionRadius;
  const buf = new Float32Array(target * 16);
  const tmpScale = new Vector3();
  const tmpQuat = new Quaternion();
  const tmpPos = new Vector3();
  const upAxis = new Vector3(0, 1, 0);
  const m = new Matrix();
  let placed = 0;
  let tries = 0;
  while (placed < target && tries < target * 4) {
    tries++;
    // Uniform-in-disk sampling
    const r = Math.sqrt(Math.random()) * radius;
    const theta = Math.random() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    if (x * x + z * z < excl2) continue;
    // Density falloff with distance — sparser further out
    const falloff = 1 - r / radius;
    if (Math.random() > 0.25 + 0.75 * falloff) continue;

    const heightJitter = 0.65 + Math.random() * 0.7;
    const widthJitter = 0.7 + Math.random() * 0.6;
    tmpScale.set(widthJitter, heightJitter, widthJitter);
    Quaternion.RotationAxisToRef(upAxis, Math.random() * Math.PI * 2, tmpQuat);
    tmpPos.set(x, groundY + 0.001, z);
    Matrix.ComposeToRef(tmpScale, tmpQuat, tmpPos, m);
    m.copyToArray(buf, placed * 16);
    placed++;
  }
  // Trim to actual count
  const final = placed === target ? buf : buf.slice(0, placed * 16);
  blade.thinInstanceSetBuffer("matrix", final, 16, true);
  // Ensure bounding info covers the entire field so frustum culling doesn't drop blades.
  blade.alwaysSelectAsActiveMesh = true;

  return { mesh: blade, material: mat };
}

function buildGrassBladeMesh(scene: Scene): Mesh {
  const vd = new VertexData();
  // Tapered blade pointing up (y+), base at y=0.
  const W = 0.022;
  const H = 0.34;
  vd.positions = [
    -W,      0.00, 0,
     W,      0.00, 0,
    -W * 0.85, H * 0.45, 0,
     W * 0.85, H * 0.45, 0,
    -W * 0.55, H * 0.75, 0,
     W * 0.55, H * 0.75, 0,
     0.0,    H,    0,
  ];
  vd.uvs = [
    0, 0,
    1, 0,
    0, 0.45,
    1, 0.45,
    0, 0.75,
    1, 0.75,
    0.5, 1,
  ];
  // Normal: blade is flat — facing +Z; we draw double-sided so this is OK.
  vd.normals = [
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, 1,
  ];
  vd.indices = [
    0, 2, 1,   1, 2, 3,   // bottom segment
    2, 4, 3,   3, 4, 5,   // middle segment
    4, 6, 5,             // tip triangle
  ];
  const m = new Mesh("grassBlade", scene);
  vd.applyToMesh(m);
  return m;
}

// === GLSL shaders ===

let shadersRegistered = false;
function registerLandscapeShaders(): void {
  if (shadersRegistered) return;
  shadersRegistered = true;

  Effect.ShadersStore["grassVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    attribute vec4 world0;
    attribute vec4 world1;
    attribute vec4 world2;
    attribute vec4 world3;

    uniform mat4 viewProjection;
    uniform float time;
    uniform vec3 windDir;
    uniform float windStrength;

    varying float vHeight;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vBladeId;

    void main() {
      mat4 instWorld = mat4(world0, world1, world2, world3);
      vec4 wp = instWorld * vec4(position, 1.0);

      float h = clamp(uv.y, 0.0, 1.0);
      float bend = h * h;

      // Spatial wind: smooth gusts traveling across the field
      float pid = wp.x * 0.42 + wp.z * 0.55;
      float gust = sin(pid + time * 1.6) * 0.6
                 + sin(pid * 0.31 + time * 0.7 + 2.1) * 0.4;
      // Per-blade flutter
      float flutter = sin(time * 3.4 + wp.x * 11.0 + wp.z * 13.0) * 0.18;
      float sway = (gust + flutter) * windStrength * bend;

      wp.x += windDir.x * sway;
      wp.z += windDir.z * sway;
      // Sink slightly when bent so the tip arcs instead of stretching
      wp.y -= bend * abs(sway) * 0.25;

      vHeight = h;
      vWorldPos = wp.xyz;
      vNormal = normalize((instWorld * vec4(normal, 0.0)).xyz);
      vBladeId = floor(instWorld[3].x * 3.7 + instWorld[3].z * 2.3);

      gl_Position = viewProjection * wp;
    }
  `;

  Effect.ShadersStore["grassFragmentShader"] = `
    precision highp float;
    varying float vHeight;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vBladeId;

    uniform vec3 baseColor;
    uniform vec3 tipColor;
    uniform vec3 lightDir;
    uniform vec3 lightColor;
    uniform vec3 ambientColor;
    uniform float darknessFactor;

    float hash11(float p) { return fract(sin(p * 91.345) * 47453.5); }

    void main() {
      // Vertical gradient base→tip
      vec3 col = mix(baseColor, tipColor, vHeight);
      // Per-blade tint variation
      float v = hash11(vBladeId);
      col *= 0.78 + 0.42 * v;
      // Fake ambient occlusion at the base
      col *= 0.35 + 0.75 * vHeight;

      // Soft lambert — clamp floor so back-facing blades aren't pitch black
      vec3 n = normalize(vNormal);
      vec3 ldir = normalize(-lightDir);
      float ndotl = max(0.25, abs(dot(n, ldir)));
      col *= (ambientColor + lightColor * ndotl);

      col *= darknessFactor;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  Effect.ShadersStore["rockVertexShader"] = `
    precision highp float;
    attribute vec3 position;
    attribute vec3 normal;

    uniform mat4 world;
    uniform mat4 viewProjection;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vLocalPos;

    void main() {
      vec4 wp = world * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormal = normalize(mat3(world) * normal);
      vLocalPos = position;
      gl_Position = viewProjection * wp;
    }
  `;

  Effect.ShadersStore["rockFragmentShader"] = `
    precision highp float;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vLocalPos;

    uniform vec3 lightDir;
    uniform vec3 lightColor;
    uniform vec3 ambientColor;
    uniform vec3 cameraPosition;
    uniform vec3 baseColor;
    uniform vec3 darkColor;
    uniform vec3 mossColor;
    uniform vec3 snowColor;
    uniform float snowLine;
    uniform float snowBand;
    uniform float darknessFactor;

    float hash13(vec3 p) {
      p = fract(p * vec3(443.897, 441.423, 437.195));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    float vnoise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash13(i);
      float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
      float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
      float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
      float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
      float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
      float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
      float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
      float nx00 = mix(n000, n100, f.x);
      float nx10 = mix(n010, n110, f.x);
      float nx01 = mix(n001, n101, f.x);
      float nx11 = mix(n011, n111, f.x);
      float nxy0 = mix(nx00, nx10, f.y);
      float nxy1 = mix(nx01, nx11, f.y);
      return mix(nxy0, nxy1, f.z);
    }

    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 n = normalize(vNormal);

      // Procedural rock color from local-space fbm so the pattern stays put.
      float macro = fbm(vLocalPos * 2.2);
      float crev = fbm(vLocalPos * 8.5 + 11.3);
      vec3 base = mix(darkColor, baseColor, smoothstep(0.25, 0.85, macro));
      // Darker noise streaks for crevices
      base *= 0.6 + 0.7 * crev;

      // Sparse moss only on the most upward-facing facets — mountain rock, not riverbed.
      float up = clamp(n.y, 0.0, 1.0);
      float mossPattern = fbm(vLocalPos * 3.7 + 7.0);
      float mossMask = smoothstep(0.78, 0.98, up) * smoothstep(0.55, 0.85, mossPattern);
      base = mix(base, mossColor, mossMask * 0.4);

      // Slight cool tint in shadowed crevices (slate-blue undertone)
      base = mix(base, base * vec3(0.85, 0.9, 1.05), (1.0 - up) * 0.35);

      // Snow on high, upward-facing surfaces. snowLine=999 disables it.
      float snowAlt = smoothstep(snowLine, snowLine + snowBand, vWorldPos.y);
      float snowSlope = smoothstep(0.25, 0.7, up);
      float snowEdge = smoothstep(0.45, 0.75, fbm(vLocalPos * 2.1 + 4.0));
      float snowMask = snowAlt * snowSlope * (0.55 + 0.45 * snowEdge);
      base = mix(base, snowColor, snowMask);

      // Lambert + ambient
      vec3 ldir = normalize(-lightDir);
      float ndotl = max(0.0, dot(n, ldir));
      vec3 col = base * (ambientColor + lightColor * ndotl);

      // Rim light — picks out silhouette against background
      vec3 vdir = normalize(cameraPosition - vWorldPos);
      float rim = pow(1.0 - max(0.0, dot(n, vdir)), 2.5);
      col += rim * lightColor * 0.18;

      col *= darknessFactor;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
}

// 3D value noise (CPU) — matches the GLSL implementation closely enough for
// generating organic vertex displacements on rocks.
function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const r = (ix: number, iy: number, iz: number) => {
    let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (iz | 0) * 2147483647;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const c000 = r(xi, yi, zi),     c100 = r(xi + 1, yi, zi);
  const c010 = r(xi, yi + 1, zi), c110 = r(xi + 1, yi + 1, zi);
  const c001 = r(xi, yi, zi + 1), c101 = r(xi + 1, yi, zi + 1);
  const c011 = r(xi, yi + 1, zi + 1), c111 = r(xi + 1, yi + 1, zi + 1);
  const x00 = c000 * (1 - u) + c100 * u;
  const x10 = c010 * (1 - u) + c110 * u;
  const x01 = c001 * (1 - u) + c101 * u;
  const x11 = c011 * (1 - u) + c111 * u;
  const y0 = x00 * (1 - v) + x10 * v;
  const y1 = x01 * (1 - v) + x11 * v;
  return y0 * (1 - w) + y1 * w;
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
