using FinalClick.Core;
using UnityEngine;

namespace FinalClick.Runtime
{
    // The Babylon original (src/audio.ts) procedurally generates many of its
    // sounds via WebAudio. For the Unity port the simplest path is to assign
    // pre-baked AudioClips here. If you want to keep the procedural feel,
    // port the WebAudio code to AudioClip.Create with a callback later.
    public class AudioController : MonoBehaviour
    {
        [Header("Sources")]
        public AudioSource SfxSource;
        public AudioSource MusicSource;

        [Header("Clips")]
        public AudioClip MissClip;
        public AudioClip OkClip;
        public AudioClip GoodClip;
        public AudioClip GreatClip;
        public AudioClip PerfectClip;
        public AudioClip LegendaryClip;
        public AudioClip LevelUpClip;
        public AudioClip CritClip;

        [Header("Music")]
        public AudioClip BackgroundMusic;
        public bool PlayMusicOnStart = true;

        private void Start()
        {
            if (PlayMusicOnStart && MusicSource != null && BackgroundMusic != null)
            {
                MusicSource.clip = BackgroundMusic;
                MusicSource.loop = true;
                MusicSource.Play();
            }
        }

        public void PlayHit(HitResult result)
        {
            AudioClip clip = result.Category switch
            {
                HitCategory.Miss => MissClip,
                HitCategory.Ok => OkClip,
                HitCategory.Good => GoodClip,
                HitCategory.Great => GreatClip,
                HitCategory.Perfect => PerfectClip,
                HitCategory.Legendary => LegendaryClip,
                _ => null,
            };
            if (clip != null && SfxSource != null)
            {
                float pitch = 1f + (result.StreakAfter * 0.005f);
                SfxSource.pitch = Mathf.Min(1.6f, pitch);
                SfxSource.PlayOneShot(clip);
            }
            if (result.IsCrit && CritClip != null && SfxSource != null)
            {
                SfxSource.PlayOneShot(CritClip, 0.7f);
            }
            if (result.LeveledUp && LevelUpClip != null && SfxSource != null)
            {
                SfxSource.PlayOneShot(LevelUpClip);
            }
        }
    }
}
