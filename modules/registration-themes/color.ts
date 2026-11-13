/** Small sRGB helpers for the theme checks and the derived tints. Inputs are always `#rrggbb` values that passed the token schema. */

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((part) => Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * `color-mix(in srgb, top <percent>%, bottom)` computed here, so the contrast check and the rendered tint are the same
 * color (the stylesheet receives this hex, not a mix function to evaluate).
 */
export function mixHex(top: string, percent: number, bottom: string): string {
  const a = hexToRgb(top);
  const b = hexToRgb(bottom);
  const weight = percent / 100;
  return rgbToHex([0, 1, 2].map((index) => a[index]! * weight + b[index]! * (1 - weight)) as unknown as Rgb);
}

function channel(value: number) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
