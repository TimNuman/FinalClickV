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
  getLevel: () => state.level,
});

// === Start screen: gate input until the player hits START ===
const startScreen = document.getElementById("startScreen") as HTMLElement;
const startButton = document.getElementById("startButton") as HTMLButtonElement;
let gameStarted = false;

function beginGame() {
  if (gameStarted) return;
  gameStarted = true;
  startScreen.classList.add("hidden");
}
startButton.addEventListener("click", beginGame);
// Also allow Enter/Space on the focused start button (default browser behaviour
// would trigger a click, but listen explicitly so Space doesn't also fire a
// game press through the keydown handler below).
startButton.addEventListener("keydown", (e) => {
  if (e.code === "Enter" || e.code === "Space") {
    e.preventDefault();
    e.stopPropagation();
    beginGame();
  }
});

// === Hold-to-press, release-to-commit flow ===
//   - press input on the red cap → if recovery is ready, hold the dome down
//   - release input → commit the click: state.click(), VFX, HUD, recovery starts
//   - presses during recovery are ignored
let holding = false;
let pressX = 0;
let pressY = 0;

function tryPress(screenX: number, screenY: number) {
  if (!gameStarted) return;
  if (holding) return;
  if (!state.canClick()) return;
  holding = true;
  pressX = screenX;
  pressY = screenY;
  refs.setButtonHeld(true);
}

function commitRelease() {
  if (!holding) return;
  holding = false;
  refs.setButtonHeld(false);

  state.startRecovery();
  hud.setRecovery(0);

  const result = state.click();
  const intensity = refs.intensity();

  vfx.triggerHit(result);
  vfx.setStreakTier(state.streakTier);

  hud.showHit(result, pressX, pressY, intensity);
  hud.pulseStreak();
  hud.refresh(state);

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
      vfx.triggerHit({ ...result, category: "legendary" });
    }
  }
}

refs.onPress.add(() => {
  tryPress(refs.scene.pointerX, refs.scene.pointerY);
});
refs.onRelease.add(() => {
  commitRelease();
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat) return;
  e.preventDefault();
  tryPress(window.innerWidth / 2, window.innerHeight / 2);
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  commitRelease();
});

// Drive the HUD recovery bar each frame
refs.scene.onBeforeRenderObservable.add(() => {
  hud.setRecovery(state.recoveryProgress());
});

// Show ready state at startup
hud.setRecovery(1);
