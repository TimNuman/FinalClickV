import { createScene } from "./scene";
import { ELEMENT_BUMP_STEP, GameState, LEVEL_UP_CHANCE_BOOST } from "./state";
import { VFX } from "./vfx";
import { HUD } from "./hud";
import { isEditModeRequested, mountEditPanel } from "./editmode";
import { AudioSystem } from "./audio";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;

const refs = createScene(canvas);
const state = new GameState();
const hud = new HUD();
hud.refresh(state);

const editMode = isEditModeRequested();
if (editMode) mountEditPanel(refs);

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
// AudioContext can only be created after a user gesture (browser autoplay
// policy). Music is a plain HTMLAudioElement that we try to autoplay on load
// and retry on the first user interaction; the Web-Audio AudioSystem (for
// SFX) is initialised on that same first interaction and the BGM element is
// then attached to its musicGain so the mute button controls everything.
const bgm = document.getElementById("bgmAudio") as HTMLAudioElement | null;
const muteButton = document.getElementById("muteButton") as HTMLButtonElement | null;
let audio: AudioSystem | null = null;
let muted = false;

if (bgm) bgm.loop = true; // belt-and-braces: also set via JS in case the HTML attr is ever removed
const tryPlayMusic = () => {
  if (!bgm) return;
  bgm.muted = muted;
  void bgm.play().catch(() => { /* blocked — will retry on first input */ });
};

const ensureAudioSystem = (): AudioSystem | null => {
  if (audio) return audio;
  try {
    audio = new AudioSystem();
    if (bgm) audio.attachMusic(bgm);
    audio.setMuted(muted);
  } catch (e) {
    console.warn("audio init failed", e);
  }
  return audio;
};

// 1. Best-effort: kick BGM the moment the page loads
tryPlayMusic();

// 2. First user input anywhere on the page → start music + init AudioSystem
const onFirstInput = () => {
  ensureAudioSystem();
  tryPlayMusic();
  document.removeEventListener("pointerdown", onFirstInput, true);
  document.removeEventListener("keydown", onFirstInput, true);
  document.removeEventListener("touchstart", onFirstInput, true);
};
document.addEventListener("pointerdown", onFirstInput, true);
document.addEventListener("keydown", onFirstInput, true);
document.addEventListener("touchstart", onFirstInput, true);

// 3. Mute button — toggles both the raw <audio>.muted and the SFX bus
const refreshMuteUi = () => {
  muteButton?.classList.toggle("muted", muted);
  muteButton?.setAttribute("aria-label", muted ? "Unmute audio" : "Mute audio");
};
const toggleMute = () => {
  muted = !muted;
  if (bgm) bgm.muted = muted;
  audio?.setMuted(muted);
  refreshMuteUi();
};
muteButton?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMute();
});
refreshMuteUi();

function beginGame() {
  if (gameStarted) return;
  gameStarted = true;
  ensureAudioSystem()?.playStartButton();
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

  audio?.playHit(result.category, result.isCrit);

  // Sync elemental scene state to gameplay state (skipped in edit mode so the
  // tweak sliders aren't overridden by the click that just happened). Also
  // surface a "+X% FIRE" badge per element bumped, stacked above the click.
  result.elementsTriggered.forEach((el, i) => {
    if (!editMode) {
      if (el === "fire") refs.setFireLevel(state.fireLevel);
      else if (el === "lightning") refs.setLightningLevel(state.lightningLevel);
      else if (el === "magic") refs.setMagicLevel(state.magicLevel);
    }
    hud.showElementBump(el, ELEMENT_BUMP_STEP * 100, pressX, pressY, i);
    audio?.playElement(el);
  });

  vfx.triggerHit(result);
  vfx.setStreakTier(state.streakTier);

  hud.showSlash(result.category);
  hud.showHit(result, pressX, pressY, intensity);
  hud.pulseStreak();
  hud.refresh(state);

  if (result.category === "miss" && intensity > 0.3) {
    hud.shake();
  }

  if (result.leveledUp) {
    // In edit mode the sliders own the visual params — don't snap them back
    // to level-derived defaults on every level-up.
    if (!editMode) refs.applyVisualLevel(state.level);
    refs.cycleCameraAngle(1.4);
    const newIntensity = refs.intensity();
    hud.showLevelUp(result.newLevel, newIntensity, result.levelUpElement, LEVEL_UP_CHANCE_BOOST * 100);
    audio?.playLevelUp();
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
// Pinch start during a hold — drop the press silently, no click commits
refs.onPressCancel.add(() => {
  if (!holding) return;
  holding = false;
  refs.setButtonHeld(false);
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
