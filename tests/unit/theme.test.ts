import { expect, test } from "bun:test";
import { contrastRatio, createStoreTheme } from "@table/ui/theme";

test("store themes keep button and text contrast across dark, bright and grayscale accents", () => {
  expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  for (let r = 0; r <= 255; r += 51) {
    for (let g = 0; g <= 255; g += 51) {
      for (let b = 0; b <= 255; b += 51) {
        const accent = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        const theme = createStoreTheme(accent);
        expect(theme["--primary"]).toBe(accent);
        expect(contrastRatio(theme["--on-primary"], theme["--primary"])).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(theme["--on-primary-hover"], theme["--primary-hover"]),
        ).toBeGreaterThanOrEqual(4.5);
        for (const text of ["--primary-text", "--brand-muted", "--muted"] as const)
          expect(contrastRatio(theme[text], theme["--tint-strong"])).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(theme["--primary-border"], "#ffffff")).toBeGreaterThanOrEqual(3);
      }
    }
  }
});

test("invalid cached accents fall back safely and mixed-case saved colors normalize", () => {
  for (const value of [undefined, null, "", "red", "#12345", "#12zz34", "url(example)"])
    expect(createStoreTheme(value)).toEqual(createStoreTheme("#087f78"));
  expect(createStoreTheme("#A855F7")).toEqual(createStoreTheme("#a855f7"));
});
