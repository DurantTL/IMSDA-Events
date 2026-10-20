import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StartAClubCallout } from "@/components/start-a-club-callout";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("StartAClubCallout (#1014)", () => {
  const markup = renderToStaticMarkup(createElement(StartAClubCallout));

  it("renders the heading, the one-line explanation and a primary button to /clubs/register", () => {
    expect(markup).toContain("Start a new club");
    expect(markup).toContain(
      "Apply to start a Pathfinder club. Applications are open all year; the conference youth department reviews each one.",
    );
    expect(markup).toMatch(/<a class="[^"]*\bprimary-button\b[^"]*" href="\/clubs\/register">Register a new club<\/a>/);
  });

  it("is a labelled region with a decorative icon", () => {
    expect(markup).toMatch(/<aside aria-labelledby="start-a-club-heading"/);
    expect(markup).toContain('id="start-a-club-heading"');
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("is hidden in print and uses only existing tokens", () => {
    const css = read("app/globals.css");
    const start = css.indexOf("/* Start a new club call to action (#1014)");
    const block = css.slice(start, css.indexOf(".home-more { margin: 0;", start));
    expect(block).toMatch(/@media print\s*{\s*\.start-a-club-callout { display: none; }/);
    expect(block).not.toMatch(/:[^;{]*#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("pages that show the callout (#1014)", () => {
  it("home renders it under the action tiles, before the agenda", () => {
    const source = read("app/page.tsx");
    expect(source).toContain('import { StartAClubCallout } from "@/components/start-a-club-callout"');
    const nav = source.indexOf("</nav>");
    const callout = source.indexOf("<StartAClubCallout />");
    expect(nav).toBeGreaterThan(-1);
    expect(callout).toBeGreaterThan(nav);
    expect(callout).toBeLessThan(source.indexOf('aria-labelledby="home-upcoming-heading"'));
    // Not a fifth tile, and not gated on sign-in.
    expect(source.slice(source.indexOf('className="home-actions"'), nav)).not.toContain("StartAClubCallout");
    expect(source.slice(source.indexOf("<StartAClubCallout />") - 80, callout)).not.toContain("session.user &&");
  });

  it("Find a club renders it above the club list and drops the old text link", () => {
    const source = read("app/(public)/clubs/page.tsx");
    expect(source).toContain('import { StartAClubCallout } from "@/components/start-a-club-callout"');
    expect(source.indexOf("<StartAClubCallout />")).toBeGreaterThan(-1);
    expect(source.indexOf("<StartAClubCallout />")).toBeLessThan(source.indexOf("<PublicClubDirectory"));
    expect(source).not.toContain("applications are open all year");
  });

  it("the home page still reaches /clubs by a full page load", () => {
    expect(read("app/page.tsx")).toMatch(/<a className="home-action" href="\/clubs">/);
  });
});
