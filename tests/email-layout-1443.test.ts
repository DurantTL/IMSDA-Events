import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderEmailBodyHtml } from "@/modules/communications/email-html";
import {
  appendEmailPlainTextFooter,
  emailLayoutContent,
  emailPlainTextFooter,
  plainTextToEmailBodyHtml,
  renderEmailLayoutDocument,
} from "@/modules/communications/email-layout";
import {
  DEFAULT_EMAIL_LAYOUT_SETTINGS,
  emailHelpLine,
  emailLayoutSettingsFromRow,
} from "@/modules/communications/email-layout-domain";

const doc = (overrides: Partial<Parameters<typeof renderEmailLayoutDocument>[0]> = {}) =>
  renderEmailLayoutDocument({ title: "Hello", bodyHtml: "<p>Body</p>", ...overrides });

describe("the shared email layout (#1443)", () => {
  it("has the approved structure: navy bar with a gold border and mark, a white card, and the footer lines", () => {
    const html = doc({ headerName: "IMSDA Events", whyLine: "You got this because of a test.", helpLine: "Need help? Email support@imsda.org." });
    expect(html).toContain("border-bottom:4px solid #f0b323");
    expect(html).toContain('font-style:italic');
    expect(html).toContain(">i</td>");
    expect(html).toContain(">Iowa-Missouri Conference</div>");
    expect(html).toContain("Sent by <b");
    expect(html).toContain("for the Iowa-Missouri Conference of Seventh-day Adventists.");
    expect(html).toContain("You got this because of a test.");
    expect(html).toContain("Need help? Email support@imsda.org.");
    expect(html).toContain("<p>Body</p>");
  });

  it("is a 600px table layout with inline styles and a dark-mode block in the head", () => {
    const html = doc();
    expect(html).toContain("max-width:600px");
    expect(html).toContain('role="presentation"');
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark" />');
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    expect(head).toContain("@media (prefers-color-scheme: dark)");
    // The lighter dark-mode button (Caleb's decision 2).
    expect(head).toContain("#1f6b94");
    // The light colors are inline, so a client that ignores the block is still correct.
    expect(html).toContain('style="background:#003b5c;border-radius:12px 12px 0 0');
  });

  it("loads nothing from the network and tracks nothing", () => {
    const html = doc({ preheader: "Preview line", unsubscribeUrl: "https://events.example.org/unsubscribe/abc" });
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<link|<script|@import|@font-face|url\(/i);
    expect(html).not.toMatch(/src=/i);
    // The only links are the ones put there on purpose: no pixel, no redirect wrapper.
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])).toEqual(["https://events.example.org/unsubscribe/abc"]);
  });

  it("escapes the header name, the why line, the help line and the footer line", () => {
    const html = doc({
      headerName: "<script>alert(1)</script> & \"Club\"",
      whyLine: "<b>why</b>",
      helpLine: "Need help? <img src=x onerror=alert(1)>",
      footer: "<i>footer</i>",
      title: "<title>x</title>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>why</b>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<i>footer</i>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Club&quot;");
    expect(html).toContain("&lt;b&gt;why&lt;/b&gt;");
    expect(html).toContain("Need help? &lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("<title>&lt;title&gt;x&lt;/title&gt;</title>");
  });

  it("keeps the preview line right after the body tag and before the first table", () => {
    const html = doc({ preheader: "Doors open at four." });
    expect(html.indexOf("Doors open at four.")).toBeGreaterThan(html.indexOf("<body"));
    expect(html.indexOf("Doors open at four.")).toBeLessThan(html.indexOf("<table"));
  });

  it("links the announcement unsubscribe page in the footer, and only a web address", () => {
    expect(doc({ unsubscribeUrl: "https://events.example.org/unsubscribe/t0ken" })).toContain('href="https://events.example.org/unsubscribe/t0ken"');
    expect(doc({ unsubscribeUrl: "javascript:alert(1)" })).not.toContain("javascript:");
    expect(doc({ unsubscribeUrl: 'https://x.example/"onmouseover="x' })).not.toContain("onmouseover");
  });

  it("turns the body's button into the layout's button, with the paste-this-link fallback", () => {
    const body = renderEmailBodyHtml("[View your registration](https://events.example.org/r/WR27-4K8P?a=1&b=2){.button}");
    const html = doc({ bodyHtml: body });
    expect(html).toContain("Button not working? Paste this link into your browser:");
    expect(html).toContain('href="https://events.example.org/r/WR27-4K8P?a=1&amp;b=2"');
    expect(html).toContain(">View your registration</a>");
    expect(html).toContain('bgcolor="#003b5c"');
    expect(html).not.toContain("#0f6f8c\" style=\"background:#0f6f8c");
  });

  it("does not make a button out of anything a body could contain other than the renderer's own button", () => {
    const forged = '<table role="presentation"><tr><td bgcolor="#0f6f8c"><a href="https://evil.example">Pay now</a></td></tr></table>';
    // A forged fragment is wrapped as given by delivery only if it was already trusted; either way it is not rewritten.
    expect(doc({ bodyHtml: forged })).not.toContain("Button not working?");
    const escaped = renderEmailBodyHtml(forged);
    expect(escaped).not.toContain("<table");
    expect(doc({ body: forged })).not.toContain("Button not working?");
  });
});

describe("the footer's help line (#1443)", () => {
  it("names the contact that is set, and says nothing it does not know", () => {
    expect(emailHelpLine({ email: "support@imsda.org", phone: "(515) 223-1197" })).toBe("Need help? Call (515) 223-1197 or email support@imsda.org.");
    expect(emailHelpLine({ email: "support@imsda.org", phone: null })).toBe("Need help? Email support@imsda.org.");
    expect(emailHelpLine({ email: null, phone: "(515) 555-0100" })).toBe("Need help? Call (515) 555-0100.");
  });

  it("with no contact says 'Reply to this email' only when a reply-to is set, and otherwise leaves the line out", () => {
    expect(emailHelpLine({ email: null, phone: null, replyToEmail: "reply@example.org" })).toBe("Reply to this email for help.");
    expect(emailHelpLine({ email: null, phone: null, replyToEmail: null })).toBeNull();
    expect(emailHelpLine({ email: " ", phone: "", replyToEmail: "  " })).toBeNull();
    const none = doc({ helpLine: null });
    expect(none).not.toContain("Need help?");
    expect(none).not.toContain("Reply to this email");
  });

  it("keeps an event's own contact for registration and event email, and falls back to the platform contact", () => {
    const event = emailLayoutContent({ templateKey: "REGISTRATION_CONFIRMATION_PAID", eventScoped: true, replyToEmail: "womensretreat@example.org" });
    expect(event.helpLine).toBe("Questions about this event? Email womensretreat@example.org.");
    const noReplyTo = emailLayoutContent({ templateKey: "REGISTRATION_CONFIRMATION_PAID", eventScoped: true, replyToEmail: null });
    expect(noReplyTo.helpLine).toBe("Need help? Call (515) 223-1197 or email support@imsda.org.");
    const system = emailLayoutContent({ templateKey: "ATTENDEE_SIGN_IN_CODE", replyToEmail: "reply@example.org" });
    expect(system.helpLine).toBe("Need help? Call (515) 223-1197 or email support@imsda.org.");
  });

  it("a cleared contact is left out; an absent column takes the default", () => {
    expect(emailLayoutSettingsFromRow({ emailHelpEmail: null, emailHelpPhone: null }).helpEmail).toBeNull();
    expect(emailLayoutSettingsFromRow({}).helpEmail).toBe("support@imsda.org");
    expect(emailLayoutSettingsFromRow(null)).toEqual(DEFAULT_EMAIL_LAYOUT_SETTINGS);
    expect(emailLayoutSettingsFromRow({ emailHeaderName: "  " }).headerName).toBe("IMSDA Events");
  });
});

describe("the plain-text part (#1443)", () => {
  const content = { headerName: "IMSDA Events", whyLine: "You got this because of a test.", helpLine: "Need help? Email support@imsda.org." };

  it("ends with the footer block", () => {
    expect(appendEmailPlainTextFooter("Hello.\n", content)).toBe([
      "Hello.",
      "",
      "--",
      "Sent by IMSDA Events for the Iowa-Missouri Conference of Seventh-day Adventists.",
      "You got this because of a test.",
      "Need help? Email support@imsda.org.",
      "",
    ].join("\n"));
  });

  it("continues an existing -- block instead of opening a second one, and drops an absent help line", () => {
    const text = appendEmailPlainTextFooter("Hello.\n\n--\nTo stop getting event announcements: https://x.example/u", { ...content, helpLine: null }, { separator: false });
    expect(text.match(/^--$/gm)).toHaveLength(1);
    expect(text).not.toContain("Need help?");
    expect(emailPlainTextFooter(content)).toMatch(/^--\nSent by/);
  });
});

describe("a body written as plain text (#1443)", () => {
  const origins = ["https://events.example.org"];

  it("never reads Markdown: a link or image a person typed stays text", () => {
    const html = plainTextToEmailBodyHtml("Hello [Morgan](https://evil.example), ![x](https://evil.example/p.png) <b>hi</b>\n\nSecond.", { buttonOrigins: origins });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain(">Morgan</a>");
    expect(html).toContain("[Morgan](");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("makes a button only for a labelled address on the site's own origin", () => {
    const own = plainTextToEmailBodyHtml("Hi.\n\nOpen Riverton Pathfinders: https://events.example.org/account/clubs/riverton", { buttonOrigins: origins });
    expect(own).toContain("Button not working?");
    expect(own).toContain(">Open Riverton Pathfinders</a>");
    const foreign = plainTextToEmailBodyHtml("Hi.\n\nOpen the thing: https://evil.example/login", { buttonOrigins: origins });
    expect(foreign).not.toContain("Button not working?");
    expect(foreign).toContain('href="https://evil.example/login"');
    expect(plainTextToEmailBodyHtml("Hi.\n\nOpen: https://events.example.org/x", { buttonOrigins: [] })).not.toContain("Button not working?");
  });

  it("draws the code box for the paragraph that is exactly the code, with the caption", () => {
    const html = plainTextToEmailBodyHtml("Enter this code to finish signing in:\n\n518 207\n\nIt works.", { codeBox: { code: "518 207", caption: "Works for 10 minutes" } });
    expect(html).toContain(">518 207</div>");
    expect(html).toContain("Works for 10 minutes");
    expect(html).toContain("letter-spacing:6px");
    expect(html).toContain("<h1");
  });

  it("refuses a code box whose code is not letters, digits and spaces", () => {
    const html = plainTextToEmailBodyHtml("Intro line.\n\n<b>1</b>\n\nEnd.", { codeBox: { code: "<b>1</b>", caption: "x" } });
    expect(html).not.toContain("letter-spacing:6px");
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;");
  });

  it("shows a short title over more text as a note box and drops the closing signature", () => {
    const html = plainTextToEmailBodyHtml("Intro.\n\nDidn't try to sign in?\nChange your password.\n\nIMSDA Events");
    expect(html).toContain("Didn&#39;t try to sign in?");
    expect(html).toContain('class="em-note"');
    expect(html).not.toContain(">IMSDA Events<");
  });
});
