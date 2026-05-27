using System;
using UnityEngine;

namespace FinalClick.Runtime
{
    // Attach to the central 3D click target. Requires a Collider on the same
    // GameObject. Fires Clicked when the user mouse-downs / taps on it.
    [RequireComponent(typeof(Collider))]
    public class ClickButton : MonoBehaviour
    {
        public event Action Clicked;

        [Header("Squash & Stretch")]
        public float SquashScale = 0.85f;
        public float SquashDuration = 0.08f;
        public float RecoverDuration = 0.18f;

        private Vector3 _baseScale;
        private float _animT = -1f;
        private bool _squashing;

        private void Awake()
        {
            _baseScale = transform.localScale;
        }

        private void OnMouseDown()
        {
            Clicked?.Invoke();
            _squashing = true;
            _animT = 0f;
        }

        private void Update()
        {
            if (_animT < 0f) return;
            _animT += Time.deltaTime;
            if (_squashing)
            {
                float t = Mathf.Clamp01(_animT / SquashDuration);
                transform.localScale = Vector3.Lerp(_baseScale, _baseScale * SquashScale, t);
                if (t >= 1f) { _squashing = false; _animT = 0f; }
            }
            else
            {
                float t = Mathf.Clamp01(_animT / RecoverDuration);
                float ease = 1f - Mathf.Pow(1f - t, 3f);
                transform.localScale = Vector3.Lerp(_baseScale * SquashScale, _baseScale, ease);
                if (t >= 1f) _animT = -1f;
            }
        }
    }
}
