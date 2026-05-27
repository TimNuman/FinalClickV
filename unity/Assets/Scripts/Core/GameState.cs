using System;
using System.Collections.Generic;

namespace FinalClick.Core
{
    // Pure C# game logic, no UnityEngine dependency — easy to unit-test.
    // Ported from src/state.ts. Behaviour is intended to match exactly.
    public class GameState
    {
        public int Level = 1;
        public int Xp = 0;
        public int XpForNext = 100;
        public long Score = 0;
        public int Clicks = 0;
        public int Streak = 0;
        public int BestStreak = 0;
        public float StreakMeter = 0f;
        public int StreakTier = 0;

        public float FireLevel = 0f;
        public float LightningLevel = 0f;
        public float MagicLevel = 0f;
        public float FireBumpChance = 0.003f;
        public float LightningBumpChance = 0.003f;
        public float MagicBumpChance = 0.003f;

        // Caller injects an RNG so tests are deterministic.
        // Production wires this to UnityEngine.Random.value.
        public Func<float> Rng = SystemRandomFloat;

        private static readonly Random _sysRand = new Random();
        private static float SystemRandomFloat() => (float)_sysRand.NextDouble();

        public const float ElementBumpStep = 0.022f;
        public const float LevelUpChanceBoost = 0.012f;
        private const float MaxBumpChance = 0.30f;

        private static readonly string[] RankTitles = new[]
        {
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
        };

        private static readonly Dictionary<HitCategory, CategoryMeta> CategoryMetaMap =
            new Dictionary<HitCategory, CategoryMeta>
        {
            { HitCategory.Miss,      new CategoryMeta { Label = "MISS",      Sub = "...",          BaseXp = 0,   BaseScore = 0,    Color = "#9ca3af", FontSize = 56  } },
            { HitCategory.Ok,        new CategoryMeta { Label = "OK",        Sub = "decent",       BaseXp = 6,   BaseScore = 25,   Color = "#a3e635", FontSize = 68  } },
            { HitCategory.Good,      new CategoryMeta { Label = "GOOD",      Sub = "nice hit",     BaseXp = 14,  BaseScore = 80,   Color = "#38bdf8", FontSize = 82  } },
            { HitCategory.Great,     new CategoryMeta { Label = "GREAT!",    Sub = "on fire",      BaseXp = 28,  BaseScore = 200,  Color = "#f59e0b", FontSize = 100 } },
            { HitCategory.Perfect,   new CategoryMeta { Label = "PERFECT!!", Sub = "flawless",     BaseXp = 55,  BaseScore = 500,  Color = "#f472b6", FontSize = 118 } },
            { HitCategory.Legendary, new CategoryMeta { Label = "LEGENDARY", Sub = "transcendent", BaseXp = 120, BaseScore = 1500, Color = "#fde047", FontSize = 140 } },
        };

        private float _recoveryStartAt = 0f;
        private float _recoveryEndAt = 0f;

        // 0.5s at level 1, easing toward ~0.15s deep into the game.
        public float RecoveryDuration() => 0.15f + 0.35f / (1f + (Level - 1) * 0.08f);

        public bool CanClick(float nowSeconds) => nowSeconds >= _recoveryEndAt;

        public void StartRecovery(float nowSeconds)
        {
            _recoveryStartAt = nowSeconds;
            _recoveryEndAt = nowSeconds + RecoveryDuration();
        }

        public float RecoveryProgress(float nowSeconds)
        {
            float dur = _recoveryEndAt - _recoveryStartAt;
            if (dur <= 0f) return 1f;
            if (nowSeconds >= _recoveryEndAt) return 1f;
            return Math.Max(0f, (nowSeconds - _recoveryStartAt) / dur);
        }

        public HitChance ComputeHitChance()
        {
            int lvl = Level;
            float accuracy = 1f - 0.5f * (float)Math.Exp(-lvl / 12.0);
            float perfect = Math.Min(0.45f, 0.04f + lvl * 0.012f);
            float great = Math.Min(0.30f, 0.10f + lvl * 0.008f);
            float good = 0.30f;
            float ok = Math.Max(0.05f, 0.4f - lvl * 0.005f);
            float totalHit = perfect + great + good + ok;
            float scale = accuracy / totalHit;
            return new HitChance
            {
                Perfect = perfect * scale,
                Great = great * scale,
                Good = good * scale,
                Ok = ok * scale,
                Miss = 1f - accuracy,
            };
        }

        public float CritChance() => Math.Min(0.5f, 0.05f + Level * 0.006f);

        public string RankTitle()
        {
            int idx = Math.Min(RankTitles.Length - 1, (Level - 1) / 5);
            return RankTitles[Math.Max(0, idx)];
        }

        public string StreakTierLabel()
        {
            var labels = new[] { "—", "HEATING UP", "ON FIRE", "BLAZING", "INFERNO", "TRANSCENDENT" };
            return StreakTier >= 0 && StreakTier < labels.Length ? labels[StreakTier] : "TRANSCENDENT";
        }

        public HitResult Click()
        {
            Clicks++;
            HitChance probs = ComputeHitChance();
            float r = Rng();
            HitCategory category;
            if (r < probs.Miss) category = HitCategory.Miss;
            else if (r < probs.Miss + probs.Ok) category = HitCategory.Ok;
            else if (r < probs.Miss + probs.Ok + probs.Good) category = HitCategory.Good;
            else if (r < probs.Miss + probs.Ok + probs.Good + probs.Great) category = HitCategory.Great;
            else category = HitCategory.Perfect;

            int streakBefore = Streak;

            if (category == HitCategory.Miss)
            {
                Streak = 0;
                StreakMeter = 0f;
                StreakTier = 0;
            }
            else
            {
                Streak += 1;
                if (Streak > BestStreak) BestStreak = Streak;
            }

            bool tierUpgraded = false;
            if (category != HitCategory.Miss)
            {
                int perTierClicks = 6 + StreakTier * 2;
                StreakMeter += 1f / perTierClicks;
                if (StreakMeter >= 1f)
                {
                    StreakMeter = 0f;
                    if (StreakTier < 5) StreakTier += 1;
                    tierUpgraded = true;
                }
            }

            HitCategory finalCategory = category;
            if (category == HitCategory.Perfect && StreakTier >= 4 && Rng() < 0.5f)
            {
                finalCategory = HitCategory.Legendary;
            }

            bool isCrit = category != HitCategory.Miss && Rng() < CritChance();

            CategoryMeta meta = CategoryMetaMap[finalCategory];
            float streakMult = 1f + Streak * 0.04f;
            float levelMult = 1f + (Level - 1) * 0.05f;
            float critMult = isCrit ? 2f : 1f;

            int xpGained = (int)Math.Round(meta.BaseXp * streakMult * levelMult * critMult);
            int scoreGained = (int)Math.Round(meta.BaseScore * streakMult * levelMult * critMult);

            Xp += xpGained;
            Score += scoreGained;

            bool leveledUp = false;
            int newLevel = Level;
            Element? levelUpElement = null;
            while (Xp >= XpForNext)
            {
                Xp -= XpForNext;
                Level += 1;
                XpForNext = (int)Math.Round(100 * Math.Pow(1.18, Level - 1));
                leveledUp = true;
                newLevel = Level;
                levelUpElement = BoostRandomElement();
            }

            var elementsTriggered = new List<Element>();
            if (category != HitCategory.Miss)
            {
                int rollCount = isCrit ? 2 : 1;
                if (FireLevel < 1f)
                {
                    for (int i = 0; i < rollCount; i++)
                    {
                        if (Rng() < FireBumpChance)
                        {
                            FireLevel = Math.Min(1f, FireLevel + ElementBumpStep);
                            elementsTriggered.Add(Element.Fire);
                            break;
                        }
                    }
                }
                if (LightningLevel < 1f)
                {
                    for (int i = 0; i < rollCount; i++)
                    {
                        if (Rng() < LightningBumpChance)
                        {
                            LightningLevel = Math.Min(1f, LightningLevel + ElementBumpStep);
                            elementsTriggered.Add(Element.Lightning);
                            break;
                        }
                    }
                }
                if (MagicLevel < 1f)
                {
                    for (int i = 0; i < rollCount; i++)
                    {
                        if (Rng() < MagicBumpChance)
                        {
                            MagicLevel = Math.Min(1f, MagicLevel + ElementBumpStep);
                            elementsTriggered.Add(Element.Magic);
                            break;
                        }
                    }
                }
            }

            float rot = (Rng() - 0.5f) * 10f;

            return new HitResult
            {
                Category = finalCategory,
                Label = isCrit && finalCategory != HitCategory.Miss ? $"{meta.Label} ✦CRIT" : meta.Label,
                Sub = isCrit ? "CRITICAL" : (tierUpgraded ? "TIER UP" : meta.Sub),
                XpGained = xpGained,
                ScoreGained = scoreGained,
                ColorHex = meta.Color,
                Rotation = rot,
                FontSize = meta.FontSize * (isCrit ? 1.15f : 1f),
                StreakBefore = streakBefore,
                StreakAfter = Streak,
                IsCrit = isCrit,
                LeveledUp = leveledUp,
                NewLevel = newLevel,
                ElementsTriggered = elementsTriggered,
                LevelUpElement = levelUpElement,
            };
        }

        private Element BoostRandomElement()
        {
            float r = Rng();
            if (r < 1f / 3f)
            {
                FireBumpChance = Math.Min(MaxBumpChance, FireBumpChance + LevelUpChanceBoost);
                return Element.Fire;
            }
            if (r < 2f / 3f)
            {
                LightningBumpChance = Math.Min(MaxBumpChance, LightningBumpChance + LevelUpChanceBoost);
                return Element.Lightning;
            }
            MagicBumpChance = Math.Min(MaxBumpChance, MagicBumpChance + LevelUpChanceBoost);
            return Element.Magic;
        }
    }
}
