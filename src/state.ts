export type HitCategory =
  | "miss"
  | "ok"
  | "good"
  | "great"
  | "perfect"
  | "legendary";

export interface HitResult {
  category: HitCategory;
  label: string;
  sub: string;
  xpGained: number;
  scoreGained: number;
  color: string;
  rotation: number; // degrees, for floating text
  fontSize: number;
  streakBefore: number;
  streakAfter: number;
  isCrit: boolean;
  leveledUp: boolean;
  newLevel: number;
}

const RANK_TITLES = [
  "Apprentice Clicker",
  "Eager Tapper",
  "Skilled Striker",
  "Veteran Smasher",
  "Elite Pulverizer",
  "Heroic Annihilator",
  "Mythic Devastator",
  "Legendary Godhand",
  "Cosmic Overlord",
  "Ascended Clickmaster",
  "Transcendent Click-God",
];

const CATEGORY_META: Record<
  HitCategory,
  { label: string; sub: string; baseXp: number; baseScore: number; color: string; fontSize: number }
> = {
  miss:      { label: "MISS",      sub: "...",            baseXp: 0,   baseScore: 0,    color: "#9ca3af", fontSize: 56 },
  ok:        { label: "OK",        sub: "decent",         baseXp: 6,   baseScore: 25,   color: "#a3e635", fontSize: 68 },
  good:      { label: "GOOD",      sub: "nice hit",       baseXp: 14,  baseScore: 80,   color: "#38bdf8", fontSize: 82 },
  great:     { label: "GREAT!",    sub: "on fire",        baseXp: 28,  baseScore: 200,  color: "#f59e0b", fontSize: 100 },
  perfect:   { label: "PERFECT!!", sub: "flawless",       baseXp: 55,  baseScore: 500,  color: "#f472b6", fontSize: 118 },
  legendary: { label: "LEGENDARY", sub: "transcendent",   baseXp: 120, baseScore: 1500, color: "#fde047", fontSize: 140 },
};

export class GameState {
  level = 1;
  xp = 0;
  xpForNext = 100;
  score = 0;
  clicks = 0;
  streak = 0;
  bestStreak = 0;
  // streak meter fills 0..1; resets to 0 each time the bar fills (tier up)
  streakMeter = 0;
  streakTier = 0; // 0..5

  // Recovery: after a click the player can't click again until the recovery
  // window has elapsed. Duration shrinks gracefully with level.
  private recoveryStartAt = 0;
  private recoveryEndAt = 0;

  recoveryDuration(): number {
    // 0.5s at level 1, easing toward ~0.15s deep into the game.
    return 0.15 + 0.35 / (1 + (this.level - 1) * 0.08);
  }

  canClick(now: number = performance.now()): boolean {
    return now >= this.recoveryEndAt;
  }

  startRecovery(now: number = performance.now()): void {
    this.recoveryStartAt = now;
    this.recoveryEndAt = now + this.recoveryDuration() * 1000;
  }

  // 0 at click-time, 1 when recovery is complete (ready to click again).
  recoveryProgress(now: number = performance.now()): number {
    const dur = this.recoveryEndAt - this.recoveryStartAt;
    if (dur <= 0) return 1;
    if (now >= this.recoveryEndAt) return 1;
    return Math.max(0, (now - this.recoveryStartAt) / dur);
  }

  // Probabilities sum to ≤ 1; remainder is "miss". Better with level.
  // Indexed by category in order: ok, good, great, perfect.
  hitChance(): { ok: number; good: number; great: number; perfect: number; miss: number } {
    const lvl = this.level;
    // grows with level, levels off
    const accuracy = 1 - 0.5 * Math.exp(-lvl / 12); // 0.5 at lvl 1 → ~0.95 at lvl 40
    const perfect = Math.min(0.45, 0.04 + lvl * 0.012);
    const great   = Math.min(0.30, 0.10 + lvl * 0.008);
    const good    = 0.30;
    const ok      = Math.max(0.05, 0.4 - lvl * 0.005);
    const totalHit = perfect + great + good + ok;
    const scale = accuracy / totalHit;
    return {
      perfect: perfect * scale,
      great: great * scale,
      good: good * scale,
      ok: ok * scale,
      miss: 1 - accuracy,
    };
  }

  critChance(): number {
    return Math.min(0.5, 0.05 + this.level * 0.006);
  }

  rankTitle(): string {
    const idx = Math.min(RANK_TITLES.length - 1, Math.floor((this.level - 1) / 5));
    return RANK_TITLES[idx];
  }

  // Streak tier label, used to drive escalating VFX
  streakTierLabel(): string {
    return ["—", "HEATING UP", "ON FIRE", "BLAZING", "INFERNO", "TRANSCENDENT"][this.streakTier] ?? "TRANSCENDENT";
  }

  click(): HitResult {
    this.clicks++;
    const probs = this.hitChance();
    const r = Math.random();
    let category: HitCategory;
    if (r < probs.miss) category = "miss";
    else if (r < probs.miss + probs.ok) category = "ok";
    else if (r < probs.miss + probs.ok + probs.good) category = "good";
    else if (r < probs.miss + probs.ok + probs.good + probs.great) category = "great";
    else category = "perfect";

    const streakBefore = this.streak;

    if (category === "miss") {
      this.streak = 0;
      this.streakMeter = 0;
      this.streakTier = 0;
    } else {
      this.streak += 1;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    }

    // Streak meter logic: each tier requires more clicks
    let tierUpgraded = false;
    if (category !== "miss") {
      const perTierClicks = 6 + this.streakTier * 2; // 6, 8, 10, 12, 14
      this.streakMeter += 1 / perTierClicks;
      if (this.streakMeter >= 1) {
        this.streakMeter = 0;
        if (this.streakTier < 5) this.streakTier += 1;
        tierUpgraded = true;
      }
    }

    // Legendary upgrade: a perfect while at high streak tier promotes to legendary
    let finalCategory: HitCategory = category;
    if (category === "perfect" && this.streakTier >= 4 && Math.random() < 0.5) {
      finalCategory = "legendary";
    }

    // Crit roll on any hit
    const isCrit = category !== "miss" && Math.random() < this.critChance();

    const meta = CATEGORY_META[finalCategory];
    const streakMult = 1 + this.streak * 0.04;
    const levelMult = 1 + (this.level - 1) * 0.05;
    const critMult = isCrit ? 2 : 1;

    const xpGained = Math.round(meta.baseXp * streakMult * levelMult * critMult);
    const scoreGained = Math.round(meta.baseScore * streakMult * levelMult * critMult);

    this.xp += xpGained;
    this.score += scoreGained;

    let leveledUp = false;
    let newLevel = this.level;
    while (this.xp >= this.xpForNext) {
      this.xp -= this.xpForNext;
      this.level += 1;
      this.xpForNext = Math.round(100 * Math.pow(1.18, this.level - 1));
      leveledUp = true;
      newLevel = this.level;
    }

    // Slight rotation jitter for floating text
    const rot = (Math.random() - 0.5) * 10;

    return {
      category: finalCategory,
      label: isCrit && finalCategory !== "miss" ? `${meta.label} ✦CRIT` : meta.label,
      sub: isCrit ? "CRITICAL" : (tierUpgraded ? "TIER UP" : meta.sub),
      xpGained,
      scoreGained,
      color: meta.color,
      rotation: rot,
      fontSize: meta.fontSize * (isCrit ? 1.15 : 1),
      streakBefore,
      streakAfter: this.streak,
      isCrit,
      leveledUp,
      newLevel,
    };
  }
}
