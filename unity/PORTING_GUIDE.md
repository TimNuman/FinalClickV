# Final Click V — Unity Port Guide

This folder is a **partial Unity scaffold**. The pure game logic (state,
scoring, leveling, elements) has been ported from `src/state.ts` to C#
under `Assets/Scripts/Core/` and is engine-agnostic. The MonoBehaviour
layer under `Assets/Scripts/Runtime/` is a thin adapter that you wire up
in the Unity Editor.

**What's NOT in this folder:** the Unity project itself
(`ProjectSettings/`, `Packages/`, `Library/`, scenes, prefabs, materials,
shaders, assets). Those need to be created by Unity on your machine — they
are too brittle to hand-author from outside the Editor.

---

## 1. Setup (one-time, ~10 min)

1. Install **Unity Hub** from <https://unity.com/download>.
2. In Unity Hub → *Installs* → install the **latest LTS** of Unity 6 (any
   recent 6000.x LTS is fine). Include the **WebGL Build Support** module
   if you want to keep web deployment.
3. License: pick **Personal** when prompted. Free for individuals and
   companies under $200K/yr revenue.
4. In Unity Hub → *Projects* → *New project*:
   - Template: **Universal 3D (URP)**
   - Project name: `FinalClickV-Unity` (or anything)
   - Location: anywhere outside this repo, OR right here in the `unity/`
     folder (overwrite is fine — your `Assets/Scripts` will be merged in).
5. Once the project opens, copy `Assets/Scripts/` from this folder into
   the new project's `Assets/` folder. Unity will detect, compile, and
   generate `.meta` files automatically.
6. Install required packages via *Window → Package Manager*:
   - **TextMeshPro** (usually pre-installed; click *Import TMP Essentials*
     when prompted)
   - **Cinemachine** (recommended for camera shake / smooth camera moves)
   - **Universal RP** (already in if you used the URP template)

---

## 2. Build the scene

The original Babylon scene (`src/scene.ts`) has these pieces. Recreate
each in Unity. Suggested hierarchy:

```
─ Game (empty)                      ← attach GameController.cs
─ Main Camera                       ← position it like the ArcRotateCamera
─ Lights/
   ├ Directional Light (Key)        ← warm sun
   ├ Hemisphere not in Unity; use a Light Probe + skybox instead
   └ Point Light (Fill)
─ Environment/
   ├ Ground (plane, grass material)
   ├ Rocks (instances of a rock prefab)
   ├ Mountains (low-poly meshes around the edge)
   └ Sun (sphere with unlit emissive material + Bloom)
─ ClickTarget/                      ← the central button
   ├ ButtonCore (sphere, emissive)
   ├ ButtonTop  (cylinder, attach ClickButton.cs + Collider)
   └ ButtonHalo (flat disc, additive shader)
─ VFX/                              ← attach VfxController.cs
   ├ OkBurst, GoodBurst, ... (ParticleSystem each)
   ├ FireBump, LightningBump, MagicBump
   └ FloatingTextCanvas (Screen Space - Overlay)
─ Audio/                            ← attach AudioController.cs
   ├ SfxSource (AudioSource)
   └ MusicSource (AudioSource)
─ HUD (Canvas)                      ← attach HudController.cs
   ├ LevelText, RankText, ScoreText (TMP)
   ├ XpBar, RecoveryBar, StreakMeter (Slider)
   └ FireBar, LightningBar, MagicBar (Slider)
```

Then on the `Game` GameObject, drag the references (ClickButton, Hud,
Vfx, Audio) into the Inspector slots on `GameController`.

---

## 3. Babylon → Unity mapping cheat-sheet

| Babylon (`src/scene.ts`) | Unity equivalent |
|---|---|
| `ArcRotateCamera` | `Cinemachine FreeLook` or a parented Camera |
| `HemisphericLight` | Skybox + reflection probe + ambient SH |
| `DirectionalLight` | `Light` component, type **Directional** |
| `PointLight` | `Light` component, type **Point** |
| `MeshBuilder.CreateSphere/Box/Ground` | GameObject → 3D Object → Sphere/Cube/Plane |
| `StandardMaterial` | URP/Lit material |
| `ShaderMaterial` (custom GLSL) | Shader Graph asset, or hand-written HLSL |
| `GlowLayer` | URP **Bloom** post-process (Volume → Add Override → Bloom) |
| `ParticleSystem` | Unity's `ParticleSystem` (much richer) |
| `LensFlare` | URP **Lens Flare (SRP)** component |
| `Texture` procedural canvas | Pre-baked PNG, or generate at runtime with `Texture2D` |
| Babylon GUI / DOM HUD | Unity **Canvas** + TextMeshPro |
| WebAudio (procedural) | Pre-baked `AudioClip`s, or `AudioClip.Create` for procedural |
| Custom screen shake | Cinemachine **Impulse Source** + Impulse Listener |

---

## 4. Asset Store recommendations (free unless noted)

For the "prettier" half of your goal, these get you a long way:

- **Polybrush** (free, official) — quick low-poly terrain sculpting
- **POLYGON Starter Pack** (Synty, free sample) — low-poly art that looks
  great with bloom; full packs are paid but high quality
- **Kenney Game Assets** (kenney.nl) — CC0 low-poly + UI kits
- **Beautify 3** (paid) — drop-in post-processing that punches up colour
- **DOTween** (free) — easier than coroutines for the squash/stretch and
  hit feedback the original does in `vfx.ts`

---

## 5. What's left to port

Roughly in order of difficulty:

- [x] `state.ts` → `GameState.cs` (done, line-for-line)
- [ ] `hud.ts` — DOM HUD → Unity Canvas+TMP. Stub in `HudController.cs`,
      needs visual layout work in the Editor.
- [ ] `audio.ts` — most sounds are procedural WebAudio. Easiest: record
      one-shots from the running Babylon build and import as `.wav`. The
      music files (`public/*.mp3`) can be copied directly into `Assets/Audio/`.
- [ ] `vfx.ts` — recreate each effect as a ParticleSystem prefab. The
      lightning bolt mesh is procedural; for Unity, use a Line Renderer
      with a procedural zigzag, or Shuriken with a noisy trail.
- [ ] `scene.ts` — the environment (ground, rocks, mountains, sun, sky).
      This is the biggest art lift. Start with primitives, then swap in
      better meshes.
- [ ] `editmode.ts` — dev-only camera tweaking. Skip unless you want it.

---

## 6. Building for web

`File → Build Settings → Web → Build`. Note:

- First-time WebGL builds take 5–15 minutes.
- Output is ~10–30 MB compressed (vs. your current Babylon build which is
  smaller). Worth it for the visual upside if web isn't your primary
  target; reconsider if it is.
- For mobile browsers, expect to drop quality settings or use the WebGPU
  backend (Unity 6 preview).

---

## 7. Testing the core logic without Unity

`GameState.cs` is pure C# — no UnityEngine references. You can unit-test
it with NUnit or just a `dotnet` console project. The `Rng` field lets
you inject a deterministic RNG for repeatable tests:

```csharp
var s = new GameState { Rng = () => 0.0f }; // always rolls minimum
var r = s.Click();
// ...assert on r.Category, s.Xp, etc.
```
