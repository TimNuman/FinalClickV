import { createScene } from "./scene";
import { GameState } from "./state";
import { VFX } from "./vfx";
import { HUD } from "./hud";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;

const refs = createScene(canvas);
const state = new GameState();
const hud = new HUD();
hud.refresh(state);

// === Camera shake ===
let shakeIntensity = 0;
let shakeUntil = 0;
function cameraShake(intensity: number, duration: number) {
  shakeIntensity = Math.max(shakeIntensity, intensity);
  shakeUntil = Math.max(shakeUntil, performance.now() + duration * 1000);
}

const baseFOV = refs.camera.fov;
refs.scene.onBeforeRenderObservable.add(() => {
  const now = performance.now();
  if (now < shakeUntil) {
    const remaining = (shakeUntil - now) / 1000;
    const k = shakeIntensity * Math.min(1, remaining / 0.25);
    refs.camera.targetScreenOffset.x = (Math.random() - 0.5) * k * 30;
    refs.camera.targetScreenOffset.y = (Math.random() - 0.5) * k * 30;
  } else {
    refs.camera.targetScreenOffset.x *= 0.7;
    refs.camera.targetScreenOffset.y *= 0.7;
    if (Math.abs(refs.camera.targetScreenOffset.x) < 0.01) refs.camera.targetScreenOffset.x = 0;
    if (Math.abs(refs.camera.targetScreenOffset.y) < 0.01) refs.camera.targetScreenOffset.y = 0;
    shakeIntensity *= 0.92;
  }
  const targetFOV = baseFOV - shakeIntensity * 0.04;
  refs.camera.fov += (targetFOV - refs.camera.fov) * 0.15;
});

const vfx = new VFX({
  scene: refs.scene,
  buttonPos: () => refs.getButtonWorldPos(),
  fillLight: refs.fillLight,
  hudRoot,
  cameraShake,
  getIntensity: () => refs.intensity(),
});

// === Click handler ===
// Recovery + press flow:
//   - click input    → start recovery, kick the down/up press animation
//   - bottom of press → resolve hit, fire all VFX + HUD updates
//   - further clicks ignored until recovery completes
function tryClick(screenX: number, screenY: number) {
  if (!state.canClick()) return;
  state.startRecovery();
  hud.setRecovery(0);

  refs.pressButton(() => {
    // Effects line up with the visual impact at the bottom of the press
    const result = state.click();
    const intensity = refs.intensity();

    vfx.triggerHit(result);
    vfx.setStreakTier(state.streakTier);

    hud.showHit(result, screenX, screenY, intensity);
    hud.pulseStreak();
    hud.refresh(state);

    // Body-shake fallback for misses only at higher intensity
    if (result.category === "miss" && intensity > 0.3) {
      hud.shake();
    }

    if (result.leveledUp) {
      refs.applyVisualLevel(state.level);
      refs.cycleCameraAngle(1.4);
      const newIntensity = refs.intensity();
      hud.showLevelUp(result.newLevel, newIntensity);
      cameraShake(0.08 + newIntensity * 0.5, 0.4 + newIntensity * 0.5);
      if (newIntensity > 0.25) {
        // Celebratory burst on level-up
        vfx.triggerHit({ ...result, category: "legendary" });
      }
    }
  });
}

refs.onClick.add(() => {
  tryClick(refs.scene.pointerX, refs.scene.pointerY);
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    tryClick(window.innerWidth / 2, window.innerHeight / 2);
  }
});

// Drive the HUD recovery bar each frame
refs.scene.onBeforeRenderObservable.add(() => {
  hud.setRecovery(state.recoveryProgress());
});

// Show ready state at startup
hud.setRecovery(1);
