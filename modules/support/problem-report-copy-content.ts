import { escapeHtml } from "@/modules/communications/email-html";

/**
 * The emailed copy of a problem report (#1715): our own short text, the reference, and the person's own words in ONE quoted
 * block. Nothing else: no page, no browser, no ids, no technical details.
 *
 * The person's words are untrusted. They are never run through the plain-text-to-HTML renderer (which would turn blank-line
 * paragraphs into our styled paragraphs, a short line over text into a note box, and `Label: <our address>` into a button),
 * so the HTML is built here: their text is escaped, line breaks become `<br>`, and it sits inside a single bordered quote
 * block with no link, button, note or heading processing. The plain-text part prefixes every line with "> " so it reads as
 * a quote too; delivery leaves that text part word for word.
 */
const INK = "#22333b";
const MUTED = "#4a5b63";
const PARAGRAPH = `margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};`;

function normalizeMessage(message: string) {
  return message.replace(/\r\n?/g, "\n").trim();
}

export function problemReportCopyEmailContent(input: { reference: string; message: string }) {
  const words = normalizeMessage(input.message);
  const intro = `Thank you for telling us about a problem. Your reference number is ${input.reference}. Keep it if you write to us about this.`;
  const outro = "The IT team has your report. If we need more, we will write to this address.";
  const bodyText = [
    "Hello,",
    "",
    intro,
    "",
    "What you wrote:",
    "",
    ...words.split("\n").map((line) => (line ? `> ${line}` : ">")),
    "",
    outro,
    "",
    "IMAdventist",
  ].join("\n");
  const bodyHtml = [
    `<p style="${PARAGRAPH}">Hello,</p>`,
    `<p style="${PARAGRAPH}">${escapeHtml(intro)}</p>`,
    `<p style="margin:0 0 6px;font-size:14px;line-height:1.4;color:${MUTED};">What you wrote:</p>`,
    `<blockquote style="margin:0 0 16px;padding:10px 14px;border:1px solid #c9d3d8;border-left:4px solid #8aa0ab;border-radius:6px;font-size:15px;line-height:1.5;color:${INK};white-space:normal;word-break:break-word;">${escapeHtml(words).replace(/\n/g, "<br>")}</blockquote>`,
    `<p style="${PARAGRAPH}">${escapeHtml(outro)}</p>`,
    `<p style="${PARAGRAPH}">IMAdventist</p>`,
  ].join("\n");
  return { subject: `Your problem report ${input.reference}`, bodyText, bodyHtml };
}
