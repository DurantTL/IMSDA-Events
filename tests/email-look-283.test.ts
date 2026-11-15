import { describe, expect, it } from "vitest";
import { appendEmailPlainTextFooter, renderEmailLayoutDocument } from "@/modules/communications/email-layout";
import { resolveEmailLook, type EmailLookEvent } from "@/modules/registration-themes/email-look";
import { PLATFORM_DEFAULT_THEME } from "@/modules/registration-themes/tokens";

/** The event look in email (#283, slice 2 round B): the resolver and the layout. Synthetic values only. */

const tokens = { ...PLATFORM_DEFAULT_THEME, primary: "#1B4D3E", accent: "#C8102E", logoAlt: "Pine Lake Camp logo" };
const event: EmailLookEvent = { slug: "pine-lake", name: "Pine Lake  Camp", isPublished: true, archivedAt: null };
const origin = "https://events.example.test";
type LookInput = Parameters<typeof resolveEmailLook>[0];
const base: LookInput = { row: { status: "PUBLISHED", tokens, logoAssetId: "asset-1" }, event, logoAssetExists: true, appOrigin: origin };
const baseRow = base.row!;

describe("resolveEmailLook", () => {
  it("gives lowercase colors, the one-line event name and an absolute public logo address", () => {
    expect(resolveEmailLook(base)).toEqual({
      primary: "#1b4d3e",
      accent: "#c8102e",
      eventName: "Pine Lake Camp",
      logo: { src: "https://events.example.test/api/public/events/pine-lake/assets/asset-1?w=640", alt: "Pine Lake Camp logo" },
    });
  });

  it("accepts an archived version (immutable history) and refuses a draft", () => {
    expect(resolveEmailLook({ ...base, row: { ...baseRow, status: "ARCHIVED" } })).not.toBeNull();
    expect(resolveEmailLook({ ...base, row: { ...baseRow, status: "DRAFT" } })).toBeNull();
    expect(resolveEmailLook({ ...base, row: null })).toBeNull();
    expect(resolveEmailLook({ ...base, event: null })).toBeNull();
  });

  it("refuses tokens that fail the schema or the contrast check", () => {
    expect(resolveEmailLook({ ...base, row: { ...baseRow, tokens: { ...tokens, primary: "red" } } })).toBeNull();
    expect(resolveEmailLook({ ...base, row: { ...baseRow, tokens: { ...tokens, extra: "x" } } })).toBeNull();
    // Light yellow under white button text is below 4.5:1.
    expect(resolveEmailLook({ ...base, row: { ...baseRow, tokens: { ...tokens, primary: "#f5e663" } } })).toBeNull();
  });

  it("leaves the logo out (the event name shows) unless the event is published, the file exists, alt text exists and the address is known", () => {
    const noLogo = (patch: Partial<LookInput>) => resolveEmailLook({ ...base, ...patch })?.logo;
    expect(noLogo({})).toBeDefined();
    expect(noLogo({ event: { ...event, isPublished: false } })).toBeUndefined();
    expect(noLogo({ event: { ...event, archivedAt: new Date("2026-01-01T00:00:00Z") } })).toBeUndefined();
    expect(noLogo({ logoAssetExists: false })).toBeUndefined();
    expect(noLogo({ appOrigin: null })).toBeUndefined();
    expect(noLogo({ row: { ...baseRow, logoAssetId: null } })).toBeUndefined();
    expect(noLogo({ row: { ...baseRow, tokens: { ...tokens, logoAlt: undefined } } })).toBeUndefined();
    // The colors still apply when only the logo is dropped.
    expect(resolveEmailLook({ ...base, logoAssetExists: false })).toMatchObject({ primary: "#1b4d3e" });
  });
});

const input = {
  title: "Registration received",
  bodyHtml: '<p>Hello.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td align="center" bgcolor="#0f6f8c" style="background:#0f6f8c;"><a href="https://events.example.test/manage" target="_blank" style="color:#fff;">Manage</a></td></tr></table><p><a href="https://events.example.test/x" style="color:#0f6f8c;text-decoration:underline;">link</a></p>',
  headerName: "IMSDA Events",
  whyLine: "You got this because you registered for an event.",
  helpLine: "Questions about this event? Email help@example.test.",
  unsubscribeUrl: "https://events.example.test/unsubscribe/abc",
  calendarUrl: "https://events.example.test/calendar",
};
const look = resolveEmailLook(base)!;

describe("email layout with an event look", () => {
  it("is byte-identical to the platform layout without a look, and for null or a malformed one", () => {
    const plain = renderEmailLayoutDocument(input);
    expect(renderEmailLayoutDocument({ ...input, eventLook: null })).toBe(plain);
    expect(renderEmailLayoutDocument({ ...input, eventLook: { ...look, primary: "red" } })).toBe(plain);
    expect(renderEmailLayoutDocument({ ...input, eventLook: { ...look, accent: "#12345" } })).toBe(plain);
    expect(renderEmailLayoutDocument({ ...input, eventLook: { ...look, primary: "#123456;background:url(x)" } })).toBe(plain);
    expect(plain).toContain("#f0b323");
  });

  it("paints the bar with the main color, the border with the accent, and the buttons and links with the main color", () => {
    const html = renderEmailLayoutDocument({ ...input, eventLook: look });
    expect(html).toContain('bgcolor="#1b4d3e" class="em-bar" style="background:#1b4d3e;border-radius:12px 12px 0 0;border-bottom:4px solid #c8102e;');
    expect(html).not.toContain("#f0b323");
    // The layout button, the fallback link, the body's own button and link and the unsubscribe link.
    expect(html).toContain('style="color:#1b4d3e;text-decoration:underline;">link');
    expect(html).toContain('style="color:#1b4d3e;text-decoration:underline;">Unsubscribe');
    expect(html).toContain('bgcolor="#1b4d3e" class="em-btn" style="background:#1b4d3e;');
    expect(html).toContain('class="em-link" style="color:#1b4d3e;word-break:break-all;"');
    expect(html).not.toContain("#0f6f8c");
  });

  it("keeps the bar and button backgrounds in dark mode but still darkens the card and text", () => {
    const html = renderEmailLayoutDocument({ ...input, eventLook: look });
    const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(css).not.toContain(".em-bar{");
    expect(css).not.toContain(".em-btn{");
    expect(css).not.toContain("td[bgcolor]");
    expect(css).toContain(".em-card{");
    expect(css).toContain(".em-body p,");
    expect(renderEmailLayoutDocument(input)).toContain(".em-bar{");
  });

  it("shows the logo with escaped alt text in place of the header name, and keeps the subline and the calendar link", () => {
    const html = renderEmailLayoutDocument({
      ...input,
      eventLook: { ...look, logo: { src: "https://events.example.test/a/b?w=640", alt: 'Camp "<b>" & friends' } },
    });
    // On a white tile, so a dark logo stays readable on any main color; the tile has no dark-mode rule, so it stays light.
    expect(html).toContain('<td bgcolor="#ffffff" style="background:#ffffff;border-radius:8px;padding:6px 10px;"><img src="https://events.example.test/a/b?w=640" height="48" alt="Camp &quot;&lt;b&gt;&quot; &amp; friends" style="display:block;height:48px;width:auto;max-width:480px;border:0;');
    expect(html).not.toContain('class="em-bar-name"');
    expect(html).toContain("em-bar-sub");
    expect(html).toContain('href="https://events.example.test/calendar"');
  });

  it("shows the escaped event name when there is no logo, and drops a logo address that is not a plain web address", () => {
    const named = renderEmailLayoutDocument({ ...input, eventLook: { ...look, logo: undefined, eventName: "Camp <script>alert(1)</script>" } });
    expect(named).toContain('class="em-bar-name"');
    expect(named).toContain("Camp &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(named).not.toContain("<script>");
    const bad = renderEmailLayoutDocument({ ...input, eventLook: { ...look, logo: { src: 'javascript:alert(1)', alt: "x" } } });
    expect(bad).not.toContain("<img src=\"javascript");
    expect(bad).toContain("Pine Lake Camp");
    const quote = renderEmailLayoutDocument({ ...input, eventLook: { ...look, logo: { src: 'https://x.test/a"onerror="1', alt: "x" } } });
    expect(quote).not.toContain("onerror");
  });

  it("keeps the footer lines and the Sent by line, and the plain-text part is the same with and without a look", () => {
    const html = renderEmailLayoutDocument({ ...input, eventLook: look });
    expect(html).toContain("Questions about this event? Email help@example.test.");
    expect(html).toContain("Sent by <b");
    expect(html).toContain("IMSDA Events");
    const content = { headerName: "IMSDA Events", whyLine: input.whyLine, helpLine: input.helpLine };
    // The text part is written from the same footer content whether or not a look applies; the look is not an input to it.
    expect(appendEmailPlainTextFooter("Hello.", content)).toBe(
      "Hello.\n\n--\nSent by IMSDA Events for the Iowa-Missouri Conference of Seventh-day Adventists.\nYou got this because you registered for an event.\nQuestions about this event? Email help@example.test.\n",
    );
  });
});
