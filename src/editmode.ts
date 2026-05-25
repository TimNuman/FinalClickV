import type { SceneRefs } from "./scene";

type SliderSpec = {
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  set: (v: number) => void;
};

type Section = { title: string; sliders: SliderSpec[] };

export function isEditModeRequested(): boolean {
  return new URLSearchParams(window.location.search).has("editMode");
}

export function mountEditPanel(refs: SceneRefs): void {
  const sections = buildSections(refs);

  const panel = document.createElement("div");
  panel.id = "editPanel";
  panel.innerHTML = `
    <div class="edit-header">
      <strong>Edit Mode</strong>
      <button id="editPanelToggle" type="button">−</button>
    </div>
    <div class="edit-body"></div>
  `;
  document.body.appendChild(panel);

  const toggle = panel.querySelector<HTMLButtonElement>("#editPanelToggle")!;
  const body = panel.querySelector<HTMLElement>(".edit-body")!;
  toggle.addEventListener("click", () => {
    panel.classList.toggle("collapsed");
    toggle.textContent = panel.classList.contains("collapsed") ? "+" : "−";
  });

  for (const section of sections) {
    const sec = document.createElement("section");
    sec.className = "edit-section";
    sec.innerHTML = `<h3>${section.title}</h3>`;
    body.appendChild(sec);
    for (const s of section.sliders) {
      const row = document.createElement("div");
      row.className = "edit-row";
      const id = "edit-" + s.label.replace(/\W+/g, "");
      row.innerHTML = `
        <label for="${id}">${s.label}</label>
        <input id="${id}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.initial}" />
        <span class="edit-value">${formatValue(s.initial, s.step)}</span>
      `;
      sec.appendChild(row);
      const input = row.querySelector("input") as HTMLInputElement;
      const valEl = row.querySelector(".edit-value") as HTMLElement;
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        s.set(v);
        valEl.textContent = formatValue(v, s.step);
      });
    }
  }
}

function formatValue(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(decimals);
}

function buildSections(refs: SceneRefs): Section[] {
  const pp = refs.pipeline;
  const ip = pp.imageProcessing;

  return [
    {
      title: "Post processing",
      sliders: [
        { label: "Bloom weight",     min: 0,    max: 2,    step: 0.01, initial: pp.bloomWeight,                   set: (v) => (pp.bloomWeight = v) },
        { label: "Bloom threshold",  min: 0,    max: 1,    step: 0.01, initial: pp.bloomThreshold,                set: (v) => (pp.bloomThreshold = v) },
        { label: "Bloom scale",      min: 0.2,  max: 1.5,  step: 0.05, initial: pp.bloomScale,                    set: (v) => (pp.bloomScale = v) },
        { label: "Glow intensity",   min: 0,    max: 3,    step: 0.01, initial: refs.glowLayer.intensity,         set: (v) => (refs.glowLayer.intensity = v) },
        { label: "Vignette weight",  min: 0,    max: 8,    step: 0.05, initial: ip.vignetteWeight,                set: (v) => { ip.vignetteEnabled = v > 0; ip.vignetteWeight = v; } },
        { label: "Contrast",         min: 0.5,  max: 2.0,  step: 0.01, initial: ip.contrast,                      set: (v) => (ip.contrast = v) },
        { label: "Exposure",         min: 0.4,  max: 2.0,  step: 0.01, initial: ip.exposure,                      set: (v) => (ip.exposure = v) },
        { label: "Chromatic aberr.", min: 0,    max: 3,    step: 0.01, initial: pp.chromaticAberration.aberrationAmount, set: (v) => { pp.chromaticAberrationEnabled = v > 0; pp.chromaticAberration.aberrationAmount = v; } },
        { label: "Grain intensity",  min: 0,    max: 12,   step: 0.1,  initial: pp.grain.intensity,               set: (v) => { pp.grainEnabled = v > 0; pp.grain.intensity = v; } },
      ],
    },
    {
      title: "Grass / wind",
      sliders: [
        { label: "Ambient wind",     min: 0,    max: 1,    step: 0.01, initial: 0.22, set: (v) => refs.grassMaterial.setFloat("windStrength", v) },
        { label: "Button wind",      min: 0,    max: 3,    step: 0.01, initial: 0,    set: (v) => refs.grassMaterial.setFloat("buttonWindStrength", v) },
        { label: "Button wind r.",   min: 1,    max: 30,   step: 0.5,  initial: 10,   set: (v) => refs.grassMaterial.setFloat("buttonWindRadius", v) },
        { label: "Darkness factor",  min: 0.1,  max: 1.0,  step: 0.01, initial: 1, set: (v) => {
            refs.grassMaterial.setFloat("darknessFactor", v);
            refs.rockMaterial.setFloat("darknessFactor", v);
            refs.mountainMaterial.setFloat("darknessFactor", v);
          } },
      ],
    },
    {
      title: "Sun & lens flare",
      sliders: [
        { label: "Sun X",            min: -30,  max: 30,   step: 0.5,  initial: refs.sun.position.x, set: (v) => (refs.sun.position.x = v) },
        { label: "Sun Y",            min: 0,    max: 50,   step: 0.5,  initial: refs.sun.position.y, set: (v) => (refs.sun.position.y = v) },
        { label: "Sun Z",            min: 10,   max: 100,  step: 0.5,  initial: refs.sun.position.z, set: (v) => (refs.sun.position.z = v) },
        { label: "Sun visible",      min: 0,    max: 1,    step: 1,    initial: refs.sun.isEnabled() ? 1 : 0,                   set: (v) => refs.sun.setEnabled(v >= 1) },
        { label: "Flare on/off",     min: 0,    max: 1,    step: 1,    initial: refs.lensFlareSystem.isEnabled ? 1 : 0,         set: (v) => (refs.lensFlareSystem.isEnabled = v >= 1) },
      ],
    },
    {
      title: "Lights",
      sliders: [
        { label: "Hemi intensity",   min: 0,    max: 2,    step: 0.01, initial: refs.hemiLight.intensity, set: (v) => (refs.hemiLight.intensity = v) },
        { label: "Key intensity",    min: 0,    max: 3,    step: 0.01, initial: refs.keyLight.intensity,  set: (v) => (refs.keyLight.intensity = v) },
        { label: "Fill intensity",   min: 0,    max: 5,    step: 0.01, initial: refs.fillLight.intensity, set: (v) => (refs.fillLight.intensity = v) },
      ],
    },
    {
      title: "Camera",
      sliders: [
        { label: "FOV",              min: 0.4,  max: 1.6,  step: 0.01, initial: refs.camera.fov, set: (v) => (refs.camera.fov = v) },
      ],
    },
    {
      title: "Game preview",
      sliders: [
        // Drives applyVisualLevel — resets the post-processing sliders above
        // to their level-derived defaults. Useful to preview level snapshots.
        { label: "Force level",      min: 1,    max: 30,   step: 1, initial: Math.max(1, Math.round(refs.intensity() * 19 + 1)), set: (v) => refs.applyVisualLevel(Math.round(v)) },
      ],
    },
  ];
}
