import type { Element, GameState, HitCategory, HitResult } from "./state";

export class HUD {
  private hitLayer = document.getElementById("hitTextLayer") as HTMLElement;
  private slashLayer = document.getElementById("slashLayer") as HTMLElement;
  private xpFill = document.getElementById("xpFill") as HTMLElement;
  private xpText = document.getElementById("xpText") as HTMLElement;
  private levelNumber = document.getElementById("levelNumber") as HTMLElement;
  private levelBadge = document.querySelector<HTMLElement>(".level-badge")!;
  private rankTitle = document.getElementById("rankTitle") as HTMLElement;
  private streakNumber = document.getElementById("streakNumber") as HTMLElement;
  private streakFill = document.getElementById("streakFill") as HTMLElement;
  private streakTier = document.getElementById("streakTier") as HTMLElement;
  private scoreText = document.getElementById("scoreText") as HTMLElement;
  private bestStreakText = document.getElementById("bestStreakText") as HTMLElement;
  private clicksText = document.getElementById("clicksText") as HTMLElement;
  private critText = document.getElementById("critText") as HTMLElement;
  private fireChanceText = document.getElementById("fireChanceText") as HTMLElement;
  private lightningChanceText = document.getElementById("lightningChanceText") as HTMLElement;
  private magicChanceText = document.getElementById("magicChanceText") as HTMLElement;
  private recoveryFill = document.getElementById("recoveryFill") as HTMLElement;
  private recoveryLabel = document.getElementById("recoveryLabel") as HTMLElement;
  private hud = document.getElementById("hud") as HTMLElement;

  private displayedScore = 0;
  private targetScore = 0;
  private rafId?: number;

  refresh(state: GameState) {
    this.targetScore = state.score;
    this.ensureScoreTicker();
    this.levelNumber.textContent = String(state.level);
    this.rankTitle.textContent = state.rankTitle();
    const pct = Math.max(0, Math.min(100, (state.xp / state.xpForNext) * 100));
    this.xpFill.style.width = `${pct}%`;
    this.xpText.textContent = `${state.xp} / ${state.xpForNext} XP`;
    this.streakNumber.textContent = String(state.streak);
    this.streakFill.style.width = `${Math.max(0, Math.min(100, state.streakMeter * 100))}%`;
    this.streakTier.textContent = state.streakTierLabel();
    this.bestStreakText.textContent = String(state.bestStreak);
    this.clicksText.textContent = String(state.clicks);
    this.critText.textContent = `${Math.round(state.critChance() * 100)}%`;
    this.fireChanceText.textContent = `${(state.fireBumpChance * 100).toFixed(1)}%`;
    this.lightningChanceText.textContent = `${(state.lightningBumpChance * 100).toFixed(1)}%`;
    this.magicChanceText.textContent = `${(state.magicBumpChance * 100).toFixed(1)}%`;
  }

  // intensity: 0..1 — drives drama of the floating hit text
  showHit(result: HitResult, screenX: number, screenY: number, intensity: number) {
    const el = document.createElement("div");
    const plain = intensity < 0.15;
    el.className = plain ? "hit-text plain" : "hit-text";

    // Font size: at intensity 0 → 22px plain, at intensity 1 → result.fontSize
    const fontSize = plain
      ? 22
      : Math.round(28 + (result.fontSize - 28) * intensity);

    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    el.style.color = plain ? "rgba(220,220,220,0.95)" : result.color;
    el.style.fontSize = `${fontSize}px`;
    el.style.setProperty("--rot", `${result.rotation * (0.3 + intensity * 0.7)}deg`);

    const xpLine =
      result.xpGained > 0
        ? `+${result.xpGained} XP · +${result.scoreGained} pts`
        : "no xp";

    if (plain) {
      // Minimal label, just text and small xp line
      el.innerHTML = `${escapeHtml(result.label)} <span class="sub">${xpLine}</span>`;
    } else {
      el.innerHTML = `${escapeHtml(result.label)}<span class="sub">${escapeHtml(result.sub)} · ${xpLine}</span>`;
    }

    this.hitLayer.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // progress: 0 just after click → 1 ready to click again
  setRecovery(progress: number) {
    const pct = Math.max(0, Math.min(1, progress)) * 100;
    this.recoveryFill.style.width = `${pct}%`;
    const ready = progress >= 1;
    this.recoveryFill.classList.toggle("ready", ready);
    this.recoveryLabel.classList.toggle("ready", ready);
    this.recoveryLabel.textContent = ready ? "READY" : "CHARGING";
  }

  // Diagonal slash flash overlaid on the scene. Size, glow and number of
  // stacked layers escalate with the hit category; angle is random within a
  // diagonal range each call so successive slashes don't look identical.
  showSlash(category: HitCategory): void {
    const spec = SLASH_SPECS[category];
    if (!spec) return;
    for (let i = 0; i < spec.layers; i++) {
      const slash = document.createElement("div");
      slash.className = "slash";
      // Angle: random magnitude in a diagonal range, random sign, slight
      // per-layer offset so stacked slashes form an X / fan instead of overlap.
      const sign = Math.random() < 0.5 ? -1 : 1;
      const mag = 32 + Math.random() * 28;        // 32°..60°
      const layerJitter = (i - (spec.layers - 1) / 2) * 14;
      const angle = sign * mag + layerJitter;
      slash.style.setProperty("--slash-angle", `${angle.toFixed(1)}deg`);
      slash.style.setProperty("--slash-w", `${spec.width}px`);
      slash.style.setProperty("--slash-h", `${spec.height}px`);
      slash.style.setProperty("--slash-blur", `${spec.blur}px`);
      slash.style.setProperty("--slash-glow", `${spec.glow}px`);
      slash.style.setProperty("--slash-color", spec.color);
      slash.style.setProperty("--slash-dur", `${spec.duration}ms`);
      slash.style.animationDelay = `${i * 55}ms`;
      this.slashLayer.appendChild(slash);
      setTimeout(() => slash.remove(), spec.duration + i * 55 + 80);
    }
  }

  // Floating "+X% FIRE" badge at the click point — one per element triggered.
  // index lets us stack multiple bumps from the same click vertically.
  showElementBump(element: Element, percentPct: number, screenX: number, screenY: number, index = 0) {
    const el = document.createElement("div");
    el.className = `element-bump ${element}`;
    el.textContent = `+${percentPct.toFixed(1)}% ${element.toUpperCase()}`;
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY - 70 - index * 32}px`;
    this.hitLayer.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  pulseStreak() {
    this.streakNumber.classList.remove("pop");
    void this.streakNumber.offsetWidth;
    this.streakNumber.classList.add("pop");
    setTimeout(() => this.streakNumber.classList.remove("pop"), 280);
  }

  showLevelUp(level: number, intensity: number, element: Element | null = null, chanceBoostPct = 0) {
    const banner = document.createElement("div");
    banner.className = "levelup-banner";
    if (intensity < 0.15) banner.classList.add("subtle");
    const baseFont = 48;
    const maxFont = 96;
    banner.style.fontSize = `${Math.round(baseFont + (maxFont - baseFont) * intensity)}px`;
    const sub = element
      ? `<span class="sub element ${element}">+${chanceBoostPct.toFixed(1)}% ${element} chance</span>`
      : `<span class="sub">+POWER UNLOCKED</span>`;
    banner.innerHTML = `<span class="label">Level</span><span class="num">${level}</span>${sub}`;
    this.hud.appendChild(banner);
    setTimeout(() => banner.remove(), 2300);

    this.levelBadge.classList.remove("bump");
    void (this.levelBadge as HTMLElement).offsetWidth;
    this.levelBadge.classList.add("bump");
    setTimeout(() => this.levelBadge.classList.remove("bump"), 600);
  }

  shake() {
    document.body.classList.remove("shake");
    void document.body.offsetWidth;
    document.body.classList.add("shake");
    setTimeout(() => document.body.classList.remove("shake"), 360);
  }

  private ensureScoreTicker() {
    if (this.rafId !== undefined) return;
    const tick = () => {
      const diff = this.targetScore - this.displayedScore;
      if (Math.abs(diff) < 0.5) {
        this.displayedScore = this.targetScore;
        this.scoreText.textContent = this.formatScore(this.displayedScore);
        this.rafId = undefined;
        return;
      }
      this.displayedScore += diff * 0.18;
      this.scoreText.textContent = this.formatScore(Math.round(this.displayedScore));
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private formatScore(n: number): string {
    return n.toLocaleString("en-US");
  }
}

type SlashSpec = {
  layers: number;
  width: number;
  height: number;
  blur: number;
  glow: number;
  color: string;
  duration: number;
};

const SLASH_SPECS: Partial<Record<HitCategory, SlashSpec>> = {
  ok:        { layers: 1, width: 720,  height: 8,  blur: 1.0, glow: 6,  color: "rgba(186, 230, 253, 0.9)", duration: 280 },
  good:      { layers: 1, width: 1100, height: 14, blur: 1.5, glow: 12, color: "#67e8f9",                  duration: 320 },
  great:     { layers: 1, width: 1500, height: 22, blur: 2.0, glow: 18, color: "#fb923c",                  duration: 360 },
  perfect:   { layers: 2, width: 1800, height: 30, blur: 2.5, glow: 22, color: "#f9a8d4",                  duration: 400 },
  legendary: { layers: 3, width: 2400, height: 46, blur: 3.0, glow: 32, color: "#fde047",                  duration: 460 },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
