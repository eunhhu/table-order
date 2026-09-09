const DEFAULT_ACCENT = "#087f78";
const STORAGE_KEY = "ongi:store-accent";

function channels(hex: string) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function mix(color: string, target: string, amount: number) {
  const destination = channels(target);
  return `#${channels(color)
    .map((value, index) =>
      Math.round(value + (destination[index] - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(color: string) {
  const linear = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function readableOnLight(color: string, background: string) {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, "#000000", step / 100);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return "#000000";
}

/** Shared by both apps and the raster/PDF poster: keep the chosen hue, derive each role. */
export function createStoreTheme(value?: string | null) {
  const accent = value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;
  const hover = mix(accent, "#000000", 0.14);
  const strongTint = mix(accent, "#ffffff", 0.84);
  const primaryText = readableOnLight(accent, strongTint);
  const deep = mix(accent, "#000000", 0.75);
  const onColor = (color: string) =>
    contrastRatio("#ffffff", color) >= 4.5 ? "#ffffff" : "#000000";
  return {
    "--accent": accent,
    "--primary": accent,
    "--primary-hover": hover,
    "--on-primary": onColor(accent),
    "--on-primary-hover": onColor(hover),
    "--primary-text": primaryText,
    "--primary-border": contrastRatio(accent, "#ffffff") >= 3 ? accent : primaryText,
    "--tint": mix(accent, "#ffffff", 0.93),
    "--tint-strong": strongTint,
    "--tint-subtle": mix(accent, "#ffffff", 0.975),
    "--canvas": mix(accent, "#ffffff", 0.97),
    "--brand-border": mix(accent, "#ffffff", 0.68),
    "--brand-decor": mix(accent, "#ffffff", 0.55),
    "--brand-ink": deep,
    "--brand-muted": readableOnLight(mix(accent, "#61676c", 0.6), strongTint),
    "--ink": mix(accent, "#20252b", 0.9),
    "--muted": readableOnLight(mix(accent, "#63717a", 0.85), strongTint),
    "--line": mix(accent, "#ffffff", 0.89),
    "--surface": "#ffffff",
    "--shadow-color": `${deep}14`,
    "--scrim": `${deep}65`,
    "--shadow": `0 12px 40px ${deep}0c`,
  };
}

let appliedAccent: string | undefined;

/** Apply at the document root so body-mounted dialogs, toasts and the page canvas inherit it. */
export function applyStoreTheme(accent?: string | null) {
  if (accent && accent.toLowerCase() === appliedAccent) return;
  const theme = createStoreTheme(accent);
  for (const [name, value] of Object.entries(theme))
    document.documentElement.style.setProperty(name, value);
  appliedAccent = theme["--accent"];
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = appliedAccent;
  try {
    localStorage.setItem(STORAGE_KEY, appliedAccent);
  } catch {
    // Storage can be unavailable; the live settings still theme the entire page.
  }
}

export function initializeStoreTheme() {
  let accent: string | null = null;
  try {
    accent = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Use the default until the store snapshot arrives.
  }
  applyStoreTheme(accent);
}
