using FinalClick.Core;
using TMPro;
using UnityEngine;

namespace FinalClick.Runtime
{
    // Spawns floating hit text and triggers particle systems based on hit
    // category. The Babylon original (src/vfx.ts) does shards, lightning
    // bolts, screen shake, and element-specific bursts — recreate those as
    // ParticleSystem prefabs and assign below.
    public class VfxController : MonoBehaviour
    {
        [Header("Floating Text")]
        public TMP_Text FloatingTextPrefab;
        public RectTransform FloatingTextParent;
        public float FloatingTextLifetime = 1.1f;
        public float FloatingTextRise = 120f;

        [Header("Particles (one per category, optional)")]
        public ParticleSystem OkBurst;
        public ParticleSystem GoodBurst;
        public ParticleSystem GreatBurst;
        public ParticleSystem PerfectBurst;
        public ParticleSystem LegendaryBurst;

        [Header("Elements (one-shot bumps)")]
        public ParticleSystem FireBump;
        public ParticleSystem LightningBump;
        public ParticleSystem MagicBump;

        [Header("Camera Shake")]
        public Transform ShakeTarget;
        public float ShakeAmplitude = 0.05f;
        public float ShakeDuration = 0.12f;

        private Vector3 _shakeOrigin;
        private float _shakeT;

        private void Awake()
        {
            if (ShakeTarget != null) _shakeOrigin = ShakeTarget.localPosition;
        }

        public void PlayHit(HitResult result)
        {
            SpawnFloatingText(result);
            BurstFor(result.Category);
            foreach (var el in result.ElementsTriggered)
            {
                var ps = el switch
                {
                    Element.Fire => FireBump,
                    Element.Lightning => LightningBump,
                    Element.Magic => MagicBump,
                    _ => null,
                };
                if (ps != null) ps.Play();
            }
            float intensity = result.Category switch
            {
                HitCategory.Legendary => 2f,
                HitCategory.Perfect => 1.4f,
                HitCategory.Great => 1f,
                HitCategory.Good => 0.6f,
                _ => 0.3f,
            };
            TriggerShake(intensity);
        }

        private void BurstFor(HitCategory category)
        {
            ParticleSystem ps = category switch
            {
                HitCategory.Ok => OkBurst,
                HitCategory.Good => GoodBurst,
                HitCategory.Great => GreatBurst,
                HitCategory.Perfect => PerfectBurst,
                HitCategory.Legendary => LegendaryBurst,
                _ => null,
            };
            if (ps != null) ps.Play();
        }

        private void SpawnFloatingText(HitResult result)
        {
            if (FloatingTextPrefab == null || FloatingTextParent == null) return;
            TMP_Text tx = Instantiate(FloatingTextPrefab, FloatingTextParent);
            tx.text = result.Label;
            tx.fontSize = result.FontSize * 0.5f;
            if (ColorUtility.TryParseHtmlString(result.ColorHex, out Color c)) tx.color = c;
            tx.transform.localRotation = Quaternion.Euler(0, 0, result.Rotation);
            StartCoroutine(AnimateFloatingText(tx));
        }

        private System.Collections.IEnumerator AnimateFloatingText(TMP_Text tx)
        {
            float t = 0f;
            Vector2 startPos = tx.rectTransform.anchoredPosition;
            Color startColor = tx.color;
            while (t < FloatingTextLifetime)
            {
                t += Time.deltaTime;
                float p = t / FloatingTextLifetime;
                tx.rectTransform.anchoredPosition = startPos + Vector2.up * FloatingTextRise * p;
                tx.color = new Color(startColor.r, startColor.g, startColor.b, 1f - p);
                yield return null;
            }
            Destroy(tx.gameObject);
        }

        private void TriggerShake(float intensity)
        {
            if (ShakeTarget == null) return;
            _shakeT = ShakeDuration * intensity;
        }

        private void LateUpdate()
        {
            if (ShakeTarget == null || _shakeT <= 0f) return;
            _shakeT -= Time.deltaTime;
            if (_shakeT <= 0f)
            {
                ShakeTarget.localPosition = _shakeOrigin;
                return;
            }
            float falloff = _shakeT / ShakeDuration;
            Vector3 offset = new Vector3(
                (Random.value - 0.5f) * ShakeAmplitude * falloff,
                (Random.value - 0.5f) * ShakeAmplitude * falloff,
                0f
            );
            ShakeTarget.localPosition = _shakeOrigin + offset;
        }
    }
}
