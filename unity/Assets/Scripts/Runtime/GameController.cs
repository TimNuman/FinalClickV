using FinalClick.Core;
using UnityEngine;

namespace FinalClick.Runtime
{
    // Owns the pure-C# GameState and forwards click events to the
    // visual/audio/UI controllers. Drop this on a single empty GameObject
    // ("Game") in the scene and wire references in the Inspector.
    public class GameController : MonoBehaviour
    {
        [Header("Wiring")]
        public ClickButton ClickButton;
        public HudController Hud;
        public VfxController Vfx;
        public AudioController Audio;

        public GameState State { get; private set; }

        private void Awake()
        {
            State = new GameState
            {
                Rng = () => Random.value,
            };
        }

        private void Start()
        {
            if (ClickButton != null) ClickButton.Clicked += HandleClick;
            if (Hud != null) Hud.Refresh(State);
        }

        private void OnDestroy()
        {
            if (ClickButton != null) ClickButton.Clicked -= HandleClick;
        }

        private void HandleClick()
        {
            if (!State.CanClick(Time.time)) return;
            State.StartRecovery(Time.time);

            HitResult result = State.Click();

            if (Vfx != null) Vfx.PlayHit(result);
            if (Audio != null) Audio.PlayHit(result);
            if (Hud != null) Hud.OnHit(State, result);
        }

        private void Update()
        {
            if (Hud != null) Hud.TickRecovery(State.RecoveryProgress(Time.time));
        }
    }
}
