import type { GameState, HitResult } from "./state";

export class HUD {
  private hitLayer = document.getElementById("hitTextLayer") as HTMLElement;
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

  pulseStreak() {
    this.streakNumber.classList.remove("pop");
    void this.streakNumber.offsetWidth;
    this.streakNumber.classList.add("pop");
    setTimeout(() => this.streakNumber.classList.remove("pop"), 280);
  }

  showLevelUp(level: number, intensity: number) {
    const banner = document.createElement("div");
    banner.className = "levelup-banner";
    if (intensity < 0.15) banner.classList.add("subtle");
    const baseFont = 48;
    const maxFont = 96;
    banner.style.fontSize = `${Math.round(baseFont + (maxFont - baseFont) * intensity)}px`;
    banner.innerHTML = `LEVEL ${level}<span class="sub">+POWER UNLOCKED</span>`;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
