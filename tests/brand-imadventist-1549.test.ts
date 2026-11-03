// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/security/request-nonce", () => ({ getRequestNonce: vi.fn() }));
vi.mock("@/components/public-metrics-beacon", () => ({ PublicWebVitals: () => null }));
vi.mock("@/components/unsaved-changes-dialog-host", () => ({ UnsavedChangesDialogHost: () => null }));
vi.mock("@/components/sidebar-collapse", () => ({ sidebarCollapseInitScript: "" }));
vi.mock("@/modules/security/zod-jitless", () => ({ zodJitlessInitScript: "" }));

import { BrandLink, BRAND_LINK_HREF, BRAND_LINK_LABEL } from "@/components/brand-link";
import { BRAND_SYMBOL_PATH, PRODUCT_DESCRIPTOR, PRODUCT_NAME } from "@/lib/brand";
import { metadata } from "@/app/layout";
import { metadata as homeMetadata } from "@/app/page";

describe("IMAdventist brand link (#1549)", () => {
  it("draws the approved symbol by default, with the calendar destination and an accessible name", () => {
    const html = renderToStaticMarkup(createElement(BrandLink, { className: "auth-brand", wordmark: true }));
    expect(html).toContain(`href="${BRAND_LINK_HREF}"`);
    expect(BRAND_LINK_HREF).toBe("/calendar");
    expect(html).toContain(`aria-label="${BRAND_LINK_LABEL}"`);
    expect(BRAND_LINK_LABEL).toBe("IMAdventist calendar");
    expect(decodeURIComponent(html)).toContain("imadventist-symbol.png");
    expect(BRAND_SYMBOL_PATH).toBe("/brand/imadventist-symbol.png");
    expect(html).toContain('alt=""');
    expect(html).toContain(PRODUCT_NAME);
    expect(html).toContain(PRODUCT_DESCRIPTOR.replace("&", "&amp;"));
    expect(html).not.toContain("brand-flame");
  });

  it("lets a caller replace the label and the wordmark", () => {
    const html = renderToStaticMarkup(createElement(BrandLink, { label: "IMAdventist Club portal, calendar", wordmark: createElement("span", null, "Club portal") }));
    expect(html).toContain('aria-label="IMAdventist Club portal, calendar"');
    expect(html).toContain("Club portal");
  });
});

describe("public Home destination (#1561)", () => {
  it("links to / named IMAdventist home when asked, and keeps /calendar otherwise", () => {
    const home = renderToStaticMarkup(createElement(BrandLink, { destination: "home", wordmark: true }));
    expect(home).toContain('href="/"');
    expect(home).toContain('aria-label="IMAdventist home"');
    const calendar = renderToStaticMarkup(createElement(BrandLink, { wordmark: true }));
    expect(calendar).toContain('href="/calendar"');
    expect(calendar).toContain('aria-label="IMAdventist calendar"');
  });

  it("draws Home first in the public header nav and marks only the current page", async () => {
    const { PublicExploreNav } = await import("@/components/public-explore-nav");
    const onHome = renderToStaticMarkup(createElement(PublicExploreNav, { current: "home" }));
    expect(onHome).toMatch(/^<nav aria-label="Explore"[^>]*><a aria-current="page" href="\/">Home<\/a><a href="\/events">Events<\/a><a href="\/calendar">Calendar<\/a><a href="\/clubs">Club ministry<\/a><\/nav>$/);
    const onClubForms = renderToStaticMarkup(createElement(PublicExploreNav, { current: "clubs", currentKind: "location" }));
    expect(onClubForms).toContain('<a href="/">Home</a>');
    expect(onClubForms).toContain('<a href="/clubs" aria-current="location">Club ministry</a>');
    expect(renderToStaticMarkup(createElement(PublicExploreNav))).not.toContain("aria-current");
  });
});

describe("root metadata (#1549)", () => {
  it("names the product IMAdventist in the default title, template and application name", () => {
    expect(metadata.title).toEqual({ default: "IMAdventist", template: "%s | IMAdventist" });
    expect(metadata.applicationName).toBe("IMAdventist");
    expect(JSON.stringify(metadata.icons)).toContain("/brand/favicon.ico");
  });

  it("keeps the home title absolute so the template does not add a second suffix", () => {
    expect(homeMetadata.title).toEqual({ absolute: "IMAdventist | Events & Club Ministry" });
  });
});
