import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { reconcileImageAlt, themeImageProblem, tokensAfterImagePick, THEME_IMAGE_LIMITS } from "@/modules/registration-themes/assets";
import { registrationThemeStyle, resolveRegistrationBranding, resolveRegistrationTheme } from "@/modules/registration-themes/resolve";
import { PLATFORM_DEFAULT_THEME, isPlatformDefaultTheme, registrationThemeTokensSchema } from "@/modules/registration-themes/tokens";
import { RegistrationBannerStrip, RegistrationBrandingProvider, RegistrationLogoTile } from "@/components/registration-branding";
import { publicRegistrationBrandingImages } from "@/components/registration-branding-urls";

/** The logo and banner on a registration look (#283, slice 2 round A): tokens, pure image checks, resolver and rendering. Synthetic values only. */

const good = { ...PLATFORM_DEFAULT_THEME, primary: "#1b4d3e" };
const png = { eventId: "event-1", contentType: "image/png", byteSize: 50_000 };
const bytes = async () => new Uint8Array([1, 2, 3]);
const reader = (width: number, height: number) => vi.fn(async () => ({ width, height }));

describe("tokens with the new optional fields", () => {
  it("still accepts a slice 1 row that has none of them", () => {
    expect(registrationThemeTokensSchema.safeParse(good).success).toBe(true);
  });

  it("accepts descriptions and a focus, trims descriptions, and refuses empty, long and unknown values", () => {
    const parsed = registrationThemeTokensSchema.parse({ ...good, logoAlt: "  Camp logo  ", heroAlt: "Lake", heroFocus: "bottom" });
    expect(parsed).toMatchObject({ logoAlt: "Camp logo", heroAlt: "Lake", heroFocus: "bottom" });
    for (const bad of [{ logoAlt: "   " }, { heroAlt: "a".repeat(151) }, { heroFocus: "left" }, { heroOverlay: 0.5 }]) {
      expect(registrationThemeTokensSchema.safeParse({ ...good, ...bad }).success).toBe(false);
    }
  });

  it("keeps the platform default recognizable with or without descriptions, so it adds no wrapper style", () => {
    expect(isPlatformDefaultTheme(PLATFORM_DEFAULT_THEME)).toBe(true);
    expect(isPlatformDefaultTheme({ ...PLATFORM_DEFAULT_THEME, logoAlt: "Logo", heroFocus: "top" })).toBe(true);
    expect(registrationThemeStyle({ ...PLATFORM_DEFAULT_THEME, logoAlt: "Logo" })).toBeUndefined();
  });
});

describe("logo and banner checks", () => {
  it("accepts a good logo and banner", async () => {
    expect(await themeImageProblem("logo", png, "event-1", bytes, reader(240, 96))).toBeNull();
    expect(await themeImageProblem("hero", { ...png, contentType: "image/webp", byteSize: 9 * 1024 * 1024 }, "event-1", bytes, reader(1600, 400))).toBeNull();
  });

  it("refuses a missing upload and another event's with the same words", async () => {
    const missing = await themeImageProblem("logo", null, "event-1", bytes, reader(240, 96));
    const other = await themeImageProblem("logo", { ...png, eventId: "event-2" }, "event-1", bytes, reader(240, 96));
    expect(missing).toContain("isn't one of this event's uploads");
    expect(other).toBe(missing);
  });

  it.each(["application/pdf", "image/svg+xml", "image/gif"])("refuses %s", async (contentType) => {
    const read = vi.fn(bytes);
    expect(await themeImageProblem("logo", { ...png, contentType }, "event-1", read, reader(240, 96))).toContain("PNG, JPEG or WebP");
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses files over the size limits before reading them", async () => {
    const read = vi.fn(bytes);
    expect(await themeImageProblem("logo", { ...png, byteSize: THEME_IMAGE_LIMITS.logo.maxBytes + 1 }, "event-1", read, reader(240, 96))).toContain("2 MB or smaller");
    expect(await themeImageProblem("hero", { ...png, byteSize: THEME_IMAGE_LIMITS.hero.maxBytes + 1 }, "event-1", read, reader(1600, 400))).toContain("10 MB or smaller");
    expect(read).not.toHaveBeenCalled();
  });

  it("applies the minimum sizes at the edge and the wider-than-tall rule", async () => {
    expect(await themeImageProblem("logo", png, "event-1", bytes, reader(120, 48))).toBeNull();
    expect(await themeImageProblem("logo", png, "event-1", bytes, reader(119, 48))).toContain("at least 120 by 48");
    expect(await themeImageProblem("logo", png, "event-1", bytes, reader(120, 47))).toContain("at least 120 by 48");
    expect(await themeImageProblem("hero", png, "event-1", bytes, reader(1200, 300))).toBeNull();
    expect(await themeImageProblem("hero", png, "event-1", bytes, reader(1199, 300))).toContain("at least 1200 by 300");
    expect(await themeImageProblem("hero", png, "event-1", bytes, reader(1200, 299))).toContain("at least 1200 by 300");
    expect(await themeImageProblem("hero", png, "event-1", bytes, reader(1300, 1300))).toContain("wider than it is tall");
  });

  it("refuses an unreadable image and an unreadable file", async () => {
    expect(await themeImageProblem("logo", png, "event-1", bytes, async () => null)).toContain("couldn't be read as a picture");
    expect(await themeImageProblem("logo", png, "event-1", async () => { throw new Error("gone"); }, reader(240, 96))).toContain("couldn't be read");
  });
});

describe("descriptions follow the chosen images", () => {
  it("requires one per chosen image and drops them for an image that is not chosen", () => {
    expect(reconcileImageAlt({ ...good }, { logoAssetId: "a", heroAssetId: null }).problem).toContain("Describe the logo");
    expect(reconcileImageAlt({ ...good, logoAlt: "Logo" }, { logoAssetId: "a", heroAssetId: "b" }).problem).toContain("Describe the banner");
    const dropped = reconcileImageAlt({ ...good, logoAlt: "Logo", heroAlt: "Lake", heroFocus: "top" as const }, { logoAssetId: null, heroAssetId: null });
    expect(dropped.problem).toBeNull();
    expect(dropped.tokens).toEqual(good);
  });
});

describe("published branding", () => {
  const tokens = { ...good, logoAlt: "Camp logo", heroAlt: "Lake at dawn" };
  const row = { status: "PUBLISHED", tokens, logoAssetId: "logo-1", heroAssetId: "banner-1" };

  it("returns the logo and banner of a published row, with the focus defaulting to center", () => {
    expect(resolveRegistrationBranding(row)).toEqual({ logo: { assetId: "logo-1", alt: "Camp logo" }, hero: { assetId: "banner-1", alt: "Lake at dawn", focus: "center" } });
    expect(resolveRegistrationBranding({ ...row, tokens: { ...tokens, heroFocus: "top" } }).hero?.focus).toBe("top");
  });

  it("is empty for anything that would fall back to the platform look", () => {
    expect(resolveRegistrationBranding(null)).toEqual({});
    expect(resolveRegistrationBranding({ ...row, status: "DRAFT" })).toEqual({});
    expect(resolveRegistrationBranding({ ...row, status: "ARCHIVED" })).toEqual({});
    expect(resolveRegistrationBranding({ ...row, tokens: { ...tokens, primary: "red" } })).toEqual({});
    expect(resolveRegistrationBranding({ ...row, tokens: { ...tokens, primary: "#f0b323", muted: "#bbbbbb" } })).toEqual({});
  });

  it("leaves out an image whose upload was deleted, or that has no description, and is the same every time", () => {
    const partial = { ...row, logoAssetId: null, tokens: { ...tokens, heroAlt: undefined } };
    expect(resolveRegistrationBranding(partial)).toEqual({});
    expect(resolveRegistrationBranding({ ...row, heroAssetId: null })).toEqual(resolveRegistrationBranding({ ...row, heroAssetId: null }));
    expect(resolveRegistrationBranding({ ...row, heroAssetId: null })).toEqual({ logo: { assetId: "logo-1", alt: "Camp logo" } });
  });

  it("does not change the colors the resolver returns", () => {
    expect(resolveRegistrationTheme(row)).toMatchObject({ primary: "#1b4d3e", logoAlt: "Camp logo" });
  });
});

describe("rendering the logo and banner", () => {
  const strips = () => renderToStaticMarkup(createElement(RegistrationBannerStrip)) + renderToStaticMarkup(createElement(RegistrationLogoTile));

  it("renders nothing at all without branding, with or without a provider", () => {
    expect(strips()).toBe("");
    const wrapped = (images: Parameters<typeof RegistrationBrandingProvider>[0]["images"]) => renderToStaticMarkup(createElement(RegistrationBrandingProvider, { images }, createElement(RegistrationBannerStrip), createElement(RegistrationLogoTile)));
    expect(wrapped(undefined)).toBe("");
    expect(wrapped({})).toBe("");
  });

  it("renders the logo and banner as images with their real alt text, the banner as its own strip with its crop point", () => {
    const images = publicRegistrationBrandingImages({ logo: { assetId: "logo-1", alt: "Camp logo" }, hero: { assetId: "banner-1", alt: "Lake at dawn", focus: "bottom" } }, "synthetic-camp")!;
    const html = renderToStaticMarkup(createElement(RegistrationBrandingProvider, { images }, createElement(RegistrationBannerStrip), createElement(RegistrationLogoTile)));
    expect(html).toContain('alt="Camp logo"');
    expect(html).toContain('alt="Lake at dawn"');
    expect(html).toContain("/api/public/events/synthetic-camp/assets/logo-1?w=640");
    expect(html).toContain("/api/public/events/synthetic-camp/assets/banner-1?w=1280");
    expect(html).toContain("object-position:center bottom");
    expect(html).toContain('width="1200"');
    expect(html).toContain('height="300"');
  });

  it("builds no images when there is no branding", () => {
    expect(publicRegistrationBrandingImages({}, "synthetic-camp")).toBeUndefined();
  });
});

describe("changing a picture clears its description", () => {
  it("drops the description of the old picture (and the banner focus with no banner), leaving other tokens", () => {
    const set = { ...good, logoAlt: "Old logo", heroAlt: "Old banner", heroFocus: "top" as const };
    expect(tokensAfterImagePick(set, "logo", "other")).toEqual({ ...good, heroAlt: "Old banner", heroFocus: "top" });
    expect(tokensAfterImagePick(set, "hero", "other")).toEqual({ ...good, logoAlt: "Old logo", heroFocus: "top" });
    expect(tokensAfterImagePick(set, "hero", null)).toEqual({ ...good, logoAlt: "Old logo" });
  });

  it("is what the panel uses and clears its typed box in the same step", () => {
    const panel = readFileSync("components/registration-theme-panel.tsx", "utf8");
    expect(panel).toContain("tokensAfterImagePick(current, kind, assetId)");
    expect(panel).toMatch(/setAltText\(\(current\) => \(\{ \.\.\.current, \[kind\]: "" \}\)\)/);
  });
});

describe("client bundles stay free of sharp", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("keeps the client-safe checks module and the staff panel's local imports free of sharp and Node modules", () => {
    const imports = (file: string) => read(file).split("\n").filter((line) => /^\s*(import|export) .* from |import\(/.test(line)).join("\n");
    expect(imports("modules/registration-themes/assets.ts")).toBe("");
    expect(read("modules/registration-themes/assets.ts")).not.toMatch(/import\(|require\(|from\s+"|^\s*import\s/m);
    expect(imports("components/registration-theme-panel.tsx")).not.toMatch(/sharp|assets-server|node:|registration-themes\/repository"$/m);
    expect(imports("components/registration-theme-panel.tsx")).not.toMatch(/^import (?!type)[^\n]*registration-themes\/repository"/m);
    // The sharp reader exists only in the server-only module.
    expect(read("modules/registration-themes/assets-server.ts")).toContain('import "server-only"');
  });

  it("lets no client component import the server-only reader or sharp", () => {
    const client = ["components/registration-theme-panel.tsx", "components/registration-branding.tsx", "components/public-registration-form.tsx"];
    for (const file of client) {
      expect(read(file).startsWith('"use client"')).toBe(true);
      expect(read(file)).not.toMatch(/from "sharp"|import\("sharp"\)|from "[^"]*assets-server"/);
    }
  });
});
