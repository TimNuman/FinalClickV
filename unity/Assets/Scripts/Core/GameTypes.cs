using System.Collections.Generic;

namespace FinalClick.Core
{
    public enum HitCategory
    {
        Miss,
        Ok,
        Good,
        Great,
        Perfect,
        Legendary,
    }

    public enum Element
    {
        Fire,
        Lightning,
        Magic,
    }

    public struct HitResult
    {
        public HitCategory Category;
        public string Label;
        public string Sub;
        public int XpGained;
        public int ScoreGained;
        public string ColorHex;
        public float Rotation;
        public float FontSize;
        public int StreakBefore;
        public int StreakAfter;
        public bool IsCrit;
        public bool LeveledUp;
        public int NewLevel;
        public List<Element> ElementsTriggered;
        public Element? LevelUpElement;
    }

    internal struct CategoryMeta
    {
        public string Label;
        public string Sub;
        public int BaseXp;
        public int BaseScore;
        public string Color;
        public float FontSize;
    }

    internal struct HitChance
    {
        public float Ok;
        public float Good;
        public float Great;
        public float Perfect;
        public float Miss;
    }
}
