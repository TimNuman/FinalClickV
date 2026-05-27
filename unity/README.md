# unity/

Unity port scaffold for Final Click V. See **PORTING_GUIDE.md** for full
setup instructions.

**TL;DR:** Install Unity 6 LTS via Unity Hub (Personal license — free
under $200K revenue), create a new URP 3D project, copy `Assets/Scripts/`
into it, build the scene per the guide.

## Layout

```
Assets/Scripts/
├── Core/           Engine-agnostic game logic (no UnityEngine deps)
│   ├── GameState.cs    1:1 port of src/state.ts
│   └── GameTypes.cs    HitCategory, Element, HitResult, etc.
└── Runtime/        MonoBehaviour adapters — wire up in the Editor
    ├── GameController.cs   Owns GameState, dispatches click events
    ├── ClickButton.cs      The clickable 3D target
    ├── HudController.cs    Canvas + TMP labels and bars
    ├── VfxController.cs    Particles, floating text, screen shake
    └── AudioController.cs  Sfx + music
```

## What's done

- Full port of the game's deterministic logic (probabilities, leveling,
  streaks, elements, recovery) — verified to match `src/state.ts`.
- MonoBehaviour skeletons that route click → state → vfx/audio/hud.

## What you do in the Editor

- Create the scene (camera, lights, ground, button, etc.) per
  PORTING_GUIDE.md §2.
- Make particle prefabs and assign them to `VfxController`.
- Lay out the HUD canvas and bind TMP/Slider references.
- Import or record audio clips and assign them to `AudioController`.
