using FinalClick.Core;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace FinalClick.Runtime
{
    // Wire up TextMeshPro fields and the XP/recovery sliders in the Inspector.
    // Mirror of src/hud.ts.
    public class HudController : MonoBehaviour
    {
        [Header("Stats")]
        public TMP_Text LevelText;
        public TMP_Text RankText;
        public TMP_Text ScoreText;
        public TMP_Text StreakText;
        public TMP_Text StreakTierText;

        [Header("Bars")]
        public Slider XpBar;
        public Slider RecoveryBar;
        public Slider StreakMeter;

        [Header("Elements (0..1)")]
        public Slider FireBar;
        public Slider LightningBar;
        public Slider MagicBar;

        public void Refresh(GameState s)
        {
            if (LevelText) LevelText.text = $"LVL {s.Level}";
            if (RankText) RankText.text = s.RankTitle();
            if (ScoreText) ScoreText.text = s.Score.ToString("N0");
            if (StreakText) StreakText.text = $"x{s.Streak}";
            if (StreakTierText) StreakTierText.text = s.StreakTierLabel();
            if (XpBar) XpBar.value = (float)s.Xp / s.XpForNext;
            if (StreakMeter) StreakMeter.value = s.StreakMeter;
            if (FireBar) FireBar.value = s.FireLevel;
            if (LightningBar) LightningBar.value = s.LightningLevel;
            if (MagicBar) MagicBar.value = s.MagicLevel;
        }

        public void OnHit(GameState s, HitResult result)
        {
            Refresh(s);
        }

        public void TickRecovery(float progress)
        {
            if (RecoveryBar) RecoveryBar.value = progress;
        }
    }
}
