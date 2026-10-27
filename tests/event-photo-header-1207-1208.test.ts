import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const storage = vi.hoisted(() => ({ readAsset: vi.fn() }));
vi.mock("@/modules/events/asset-storage", () => ({ readAsset: storage.readAsset }));

import { EventCardTransition } from "@/components/event-card-transition";
import { EventHeroBanner } from "@/components/event-content-blocks";
import { ByteLruCache, createLimiter, eventAssetVariantResponse } from "@/modules/events/asset-image-variants";
import { parseVariantWidth, variantWidths } from "@/modules/events/asset-variant-widths";
import { eventSlugFromHref, eventTransitionNames, eventViewTransitionName } from "@/modules/events/view-transition";

const css = readFileSync("app/globals.css", "utf8");

describe("event view-transition names (#1208)", () => {
  it("names a card from its slug and sanitizes anything outside a-z, 0-9 and dash", () => {
    expect(eventViewTransitionName("fall-retreat-2026")).toBe("event-card-fall-retreat-2026");
    expect(eventViewTransitionName("a b/c.d")).toBe("event-card-a-b-c-d");
  });

  it("reads a slug only from an exact /events/<slug> path", () => {
    expect(eventSlugFromHref("/events/fall-retreat")).toBe("fall-retreat");
    expect(eventSlugFromHref("/events/fall%2Dretreat")).toBe("fall-retreat");
    expect(eventSlugFromHref("/events/x/register")).toBeNull();
    expect(eventSlugFromHref("/events/x?y=1")).toBeNull();
    expect(eventSlugFromHref("https://example.org/events/x")).toBeNull();
    expect(eventSlugFromHref("//evil.test/events/x")).toBeNull();
    expect(eventSlugFromHref("/events/%E0%A4%A")).toBeNull();
    expect(eventSlugFromHref("/events/Bad_Slug")).toBeNull();
    expect(eventSlugFromHref("/events/%2e%2e")).toBeNull();
    expect(eventSlugFromHref("/events/")).toBeNull();
    expect(eventSlugFromHref(null)).toBeNull();
  });

  it("names only the first card of each event and respects names already used", () => {
    const items = [
      { key: "a", href: "/events/one" },
      { key: "b", href: "/events/two" },
      { key: "c", href: "/events/one" },
      { key: "d", href: "https://example.org" },
      { key: "e", href: null },
    ];
    const used = new Set(["event-card-two"]);
    const names = eventTransitionNames(items, used);
    expect([...names.entries()]).toEqual([["a", "event-card-one"]]);
    expect(used.has("event-card-one")).toBe(true);
    expect(eventTransitionNames(items).size).toBe(2);
  });

  it("renders children unwrapped without a name or without ViewTransition in React", () => {
    expect(renderToStaticMarkup(createElement(EventCardTransition as never, { name: null }, createElement("p", null, "x")))).toBe("<p>x</p>");
    expect(renderToStaticMarkup(createElement(EventCardTransition as never, { name: "event-card-x" }, createElement("p", null, "x")))).toBe("<p>x</p>");
  });
});

describe("photo header (#1207)", () => {
  const section = {
    id: "h", kind: "HERO" as const, title: "Fall Retreat", body: "", placement: "PUBLIC_PAGE" as const,
    data: { assetId: "asset_1", alt: "Pines at sunrise", subtitle: "", button: null, focalX: 50, focalY: 50, overlay: 0 },
  };

  it("draws a responsive described image with one h1", () => {
    const html = renderToStaticMarkup(createElement(EventHeroBanner, { section, assetUrl: (id: string) => `/api/public/events/e/assets/${id}` } as never));
    for (const width of variantWidths) expect(html).toContain(`/assets/asset_1?w=${width} ${width}w`);
    expect(html).toContain('sizes="(max-width: 1240px) 100vw, 1200px"');
    expect(html).toContain('src="/api/public/events/e/assets/asset_1?w=1280"');
    expect(html).toContain('alt="Pines at sunrise"');
    expect(html).toContain('fetchPriority="high"');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("keeps a 4.5:1 floor for white text on the navy fade over a white photo", () => {
    expect(css).toContain("linear-gradient(to bottom, rgba(0, 59, 92, 0) 0, rgba(0, 59, 92, 0.78) 56px, rgba(0, 59, 92, 0.78) 100%)");
    const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = (rgb: number[]) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    const background = [0, 59, 92].map((value) => value * 0.78 + 255 * 0.22);
    expect(1.05 / (luminance(background) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it("zooms once and only when motion is allowed; view transitions stop under reduced motion", () => {
    const zoomRules = css.match(/[^{}]*animation: event-hero-zoom[^;]*;/g) ?? [];
    expect(zoomRules).toHaveLength(1);
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  .event-hero-image"));
    expect(block.slice(0, 120)).toContain("event-hero-zoom 8s ease-out both");
    expect(css).not.toMatch(/event-hero-zoom[^;]*infinite/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\),\s*::view-transition-old\(\*\),\s*::view-transition-new\(\*\) \{ animation: none !important; \}/);
    expect(css.indexOf("::view-transition-group(.event-card)")).toBeLessThan(css.indexOf("/* Registration form builder editor shell (#1132)"));
  });
});

describe("asset image variants (#1207)", () => {
  it("accepts only the four listed widths", () => {
    expect(parseVariantWidth("640")).toBe(640);
    expect(parseVariantWidth("1920")).toBe(1920);
    for (const bad of ["", null, undefined, "0", "641", "2560", "640px", "-640", "1e3", " 640", "0640"]) expect(parseVariantWidth(bad)).toBeNull();
  });

  it("serves a non-raster file or an unlisted width as the original", async () => {
    storage.readAsset.mockResolvedValue(Buffer.from("<svg/>"));
    const svg = await eventAssetVariantResponse({ displayName: "a.svg", contentType: "image/svg+xml", storageKey: "k" }, "640");
    expect(svg.headers.get("Content-Type")).toBe("image/svg+xml");
    const odd = await eventAssetVariantResponse({ displayName: "a.png", contentType: "image/png", storageKey: "k" }, "700");
    expect(odd.headers.get("Content-Type")).toBe("image/png");
  });

  it("resizes a raster image to webp no wider than requested, with the security headers", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#003b5c" } }).png().toBuffer();
    storage.readAsset.mockResolvedValue(png);
    const response = await eventAssetVariantResponse({ displayName: "Banner.png", contentType: "image/png", storageKey: "k" }, "640");
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(640);

    const small = await sharp({ create: { width: 100, height: 50, channels: 3, background: "#fff" } }).png().toBuffer();
    storage.readAsset.mockResolvedValue(small);
    const kept = await eventAssetVariantResponse({ displayName: "s.png", contentType: "image/png", storageKey: "k" }, "1920");
    expect((await sharp(Buffer.from(await kept.arrayBuffer())).metadata()).width).toBe(100);
  });
});

describe("asset variant cache and limiter", () => {
  it("serves a repeated request from memory without reading or resizing again", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#003b5c" } }).png().toBuffer();
    storage.readAsset.mockClear();
    storage.readAsset.mockResolvedValue(png);
    const asset = { displayName: "c.png", contentType: "image/png", storageKey: "cache-key-1" };
    const first = Buffer.from(await (await eventAssetVariantResponse(asset, "640")).arrayBuffer());
    const second = Buffer.from(await (await eventAssetVariantResponse(asset, "640")).arrayBuffer());
    expect(storage.readAsset).toHaveBeenCalledTimes(1);
    expect(second.equals(first)).toBe(true);
  });

  it("does not cache a failed resize", async () => {
    storage.readAsset.mockClear();
    storage.readAsset.mockResolvedValue(Buffer.from("not an image"));
    const asset = { displayName: "bad.png", contentType: "image/png", storageKey: "cache-key-bad" };
    const response = await eventAssetVariantResponse(asset, "640");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    await eventAssetVariantResponse(asset, "640");
    // Each attempt reads once to resize (failing) and once to serve the original; a cached failure would skip the first.
    expect(storage.readAsset).toHaveBeenCalledTimes(4);
  });

  it("evicts the least recently used entry by bytes and by count", () => {
    const cache = new ByteLruCache(10, 3);
    cache.set("a", Buffer.alloc(4));
    cache.set("b", Buffer.alloc(4));
    cache.get("a");
    cache.set("c", Buffer.alloc(4));
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.totalBytes).toBe(8);
    cache.set("big", Buffer.alloc(11));
    expect(cache.get("big")).toBeUndefined();
    const small = new ByteLruCache(100, 2);
    small.set("x", Buffer.alloc(1)); small.set("y", Buffer.alloc(1)); small.set("z", Buffer.alloc(1));
    expect(small.size).toBe(2);
    expect(small.get("x")).toBeUndefined();
  });

  it("runs at most the limit of tasks at once", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active -= 1; };
    await Promise.all(Array.from({ length: 6 }, () => run(task)));
    expect(peak).toBe(2);
  });
});
