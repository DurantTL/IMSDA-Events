/**
 * The one email layout (#1443). Every email the site sends is wrapped here: a navy header bar with the gold mark and
 * the header name, a white message card, and a footer that says who sent it, why the person got it and how to get help.
 * Table-based with inline styles and a 600px maximum width, because mail clients strip stylesheets and Outlook lays
 * out with Word's engine. There are no remote images, no web fonts and no tracking of any kind.
 *
 * Colors are inline (the light scheme), so every client shows a correct email. A `<style>` block in the head adds a
 * `prefers-color-scheme: dark` palette through class names for the clients that read it (iPhone Mail, Apple Mail,
 * Outlook for Mac); Gmail and Outlook for Windows repaint colors themselves.
 *
 * The body is always an already-rendered fragment. This file never parses Markdown and never touches the escaping
 * rules in `email-html.ts`; it escapes every value it adds itself (header name, help line, why line, links).
 * Anything that builds a full email document goes through `renderEmailLayoutDocument`, and
 * `tests/email-layout-guard-1443.test.ts` fails if a second one appears.
 */

import type { MessageTemplateKey } from "@prisma/client";
import { escapeHtml, renderEmailBodyHtml, renderPreheaderHtml } from "@/modules/communications/email-html";
import {
  DEFAULT_EMAIL_LAYOUT_SETTINGS,
  EMAIL_HEADER_SUBLINE,
  EMAIL_SENDER_ORGANIZATION,
  emailHelpLine,
  type EmailLayoutSettings,
} from "@/modules/communications/email-layout-domain";

// ---------------------------------------------------------------------------------------------------------------
// Which header a template gets, and why the person got it.
// ---------------------------------------------------------------------------------------------------------------

export type EmailHeaderContext = "club" | "general";
/** "registration-dependent" is club when the registration belongs to a club, and event/general otherwise. */
export type EmailHeaderRule = EmailHeaderContext | "registration-dependent";

/**
 * Club context (Caleb, #1443): club roles and invites, the club director sign-in code, club forms, orders, monthly
 * records and year-end (no template of those exists yet; each gets "club" here when it does), and club registrations.
 * Exhaustive on purpose: TypeScript fails the build when a new template key is added without a decision here.
 */
export const EMAIL_HEADER_RULES: Record<MessageTemplateKey, EmailHeaderRule> = {
  REGISTRATION_CONFIRMATION_PAID: "registration-dependent",
  REGISTRATION_CONFIRMATION_UNPAID: "registration-dependent",
  WORKER_CONFIRMATION: "registration-dependent",
  INTERNAL_NEW_REGISTRATION: "registration-dependent",
  WAITLIST_JOINED: "registration-dependent",
  WAITLIST_PROMOTED: "registration-dependent",
  WAITLIST_REMOVED: "registration-dependent",
  REGISTRATION_CANCELLED: "registration-dependent",
  REGISTRATION_REACTIVATED: "registration-dependent",
  REGISTRATION_CONTACT_UPDATED: "registration-dependent",
  REGISTRATION_UPDATED: "registration-dependent",
  PAYMENT_RECEIPT: "registration-dependent",
  REFUND_NOTICE: "registration-dependent",
  BALANCE_REMINDER: "registration-dependent",
  REGISTRATION_TRANSFERRED_NEW_CONTACT: "registration-dependent",
  REGISTRATION_TRANSFERRED_PRIOR_CONTACT: "registration-dependent",
  ATTENDEE_SUBSTITUTED: "registration-dependent",
  SHIRT_SIZE_REQUEST: "registration-dependent",
  REGISTRATION_ACCESS_RECOVERY: "registration-dependent",
  EVENT_ANNOUNCEMENT: "registration-dependent",
  ACCOUNT_ACTIVATION: "general",
  ACCOUNT_PASSWORD_RESET: "general",
  ATTENDEE_EMAIL_VERIFICATION: "general",
  ATTENDEE_PASSWORD_RESET: "general",
  ATTENDEE_EDIT_VERIFICATION: "general",
  ATTENDEE_SIGN_IN_CODE: "club",
  SECURITY_CHECK_CODE: "general",
  REGISTRATION_CONFIRMATION_ORGANIZATION_BILLED: "registration-dependent",
  CLUB_INVITE: "club",
  CLUB_ASSIGNMENTS: "club",
  CUSTOM_MESSAGE: "registration-dependent",
  CLUB_TEAM_ROLE_NOTIFICATION: "club",
  ACCOUNT_LOCKOUT: "general",
  ATTENDEE_LOCKOUT: "general",
  LOCATION_WAITLIST_DIGEST: "general",
  DEADLINE_REMINDER: "club",
  TEAM_PERMISSION_REQUEST: "club",
  MEMBER_TRANSFER_STARTED: "club",
  MEMBER_TRANSFER_COMPLETED: "club",
  CLUB_FORM_LINK: "club",
  HEALTH_RECORD_LINK: "club",
  MODULE_REQUEST_SUBMITTED: "general",
  MODULE_REQUEST_DECIDED: "general",
  INVOICE_DELIVERY: "registration-dependent",
  LODGING_WAITLIST_OFFER: "registration-dependent",
  LODGING_ASSIGNMENT_NOTICE: "registration-dependent",
  NEW_CLUB_APPLICATION_SUBMITTED: "club",
  NEW_CLUB_APPLICATION_DECLINED: "club",
  NEW_CLUB_APPLICATION_INVITE: "club",
  HONOR_CLASS_WAITLIST_OFFER: "club",
  HONOR_CLASS_PICKS_NOT_RESTORED: "club",
  CLUB_TEAM_ADVANCEMENT_NOTICE: "club",
  CLUB_FORM_SUBMITTED: "club",
  INFORMATION_FORM_SUBMITTED: "general",
  CANCELLATION_REQUEST_RECEIVED: "registration-dependent",
  CANCELLATION_REQUEST_UPDATED: "registration-dependent",
  HONOR_INSTRUCTOR_CLASS_SUMMARY: "general",
  HONOR_INSTRUCTOR_CLASS_CHANGE: "general",
  HONOR_WATCH_SUMMARY: "general",
  SYSTEM_TEST_EMAIL: "general",
};

/** The header context for a template. An unknown key (a row from a newer version) is general, never an error. */
export function emailHeaderContext(
  templateKey: MessageTemplateKey | string,
  options: { clubRegistration?: boolean } = {},
): EmailHeaderContext {
  const rule = (EMAIL_HEADER_RULES as Record<string, EmailHeaderRule | undefined>)[templateKey];
  if (rule === "registration-dependent") return options.clubRegistration ? "club" : "general";
  return rule ?? "general";
}

/**
 * Whether a message is club mail beyond its template: a club registration, or an invoice sent to a club director (an
 * invoice row has no registration). Delivery and the staff previews both decide it here, so they cannot disagree.
 */
export function emailIsClubLinked(input: { clubRegistration?: boolean; recipientKind?: string | null }) {
  return Boolean(input.clubRegistration) || input.recipientKind === "CLUB_DIRECTOR";
}

/** The header name for a context from the platform settings. */
export function emailHeaderName(settings: EmailLayoutSettings, context: EmailHeaderContext) {
  return context === "club" ? settings.clubHeaderName : settings.headerName;
}

const WHO = "{recipient}";

/**
 * "Why you got this", one plain sentence per template. `{recipient}` becomes the address the message went to where
 * that helps ("someone asked to sign in with ..."). Exhaustive for the same reason as the header rules.
 */
export const EMAIL_WHY_LINES: Record<MessageTemplateKey, string> = {
  REGISTRATION_CONFIRMATION_PAID: "You got this because you registered for an event.",
  REGISTRATION_CONFIRMATION_UNPAID: "You got this because you registered for an event.",
  WORKER_CONFIRMATION: "You got this because you signed up to help at an event.",
  INTERNAL_NEW_REGISTRATION: "You got this because you are on the staff list for an event and someone registered.",
  WAITLIST_JOINED: "You got this because you joined an event waitlist.",
  WAITLIST_PROMOTED: "You got this because you joined an event waitlist.",
  WAITLIST_REMOVED: "You got this because you joined an event waitlist.",
  REGISTRATION_CANCELLED: "You got this because a registration you are part of was cancelled.",
  REGISTRATION_REACTIVATED: "You got this because a registration you are part of was reactivated.",
  REGISTRATION_CONTACT_UPDATED: "You got this because the contact details on a registration you are part of were changed.",
  REGISTRATION_UPDATED: "You got this because a registration you are part of was changed.",
  PAYMENT_RECEIPT: "You got this because a payment was recorded on your registration.",
  REFUND_NOTICE: "You got this because a refund was recorded on your registration.",
  BALANCE_REMINDER: "You got this because your registration still has a balance due.",
  REGISTRATION_TRANSFERRED_NEW_CONTACT: "You got this because a registration was transferred to you.",
  REGISTRATION_TRANSFERRED_PRIOR_CONTACT: "You got this because a registration you held was transferred to someone else.",
  ATTENDEE_SUBSTITUTED: "You got this because an attendee on your registration was substituted.",
  SHIRT_SIZE_REQUEST: "You got this because your registration needs a shirt size.",
  REGISTRATION_ACCESS_RECOVERY: `You got this because someone asked for a link to a registration using ${WHO}.`,
  EVENT_ANNOUNCEMENT: "You got this because you are registered for an event. Event staff send these updates to everyone registered.",
  ACCOUNT_ACTIVATION: "You got this because an account was set up for you on IMSDA Events.",
  ACCOUNT_PASSWORD_RESET: `You got this because someone asked to reset the password for ${WHO} on IMSDA Events.`,
  ATTENDEE_EMAIL_VERIFICATION: `You got this because someone asked to create an IMSDA Events account with ${WHO}.`,
  ATTENDEE_PASSWORD_RESET: `You got this because someone asked to reset the password for ${WHO} on IMSDA Events.`,
  ATTENDEE_EDIT_VERIFICATION: "You got this because someone asked to change a registration while signed in to your IMSDA Events account.",
  ATTENDEE_SIGN_IN_CODE: `You got this because someone asked to sign in to IMSDA Events with ${WHO}.`,
  SECURITY_CHECK_CODE: `You got this because someone asked for a security code on IMSDA Events using ${WHO}.`,
  REGISTRATION_CONFIRMATION_ORGANIZATION_BILLED: "You got this because you registered for an event and your church or organization is being billed.",
  CLUB_INVITE: "You got this because you were invited to a club role in IMSDA Events.",
  CLUB_ASSIGNMENTS: "You got this because you have a club role in IMSDA Events.",
  CUSTOM_MESSAGE: "You got this because event staff sent you a message through IMSDA Events.",
  CLUB_TEAM_ROLE_NOTIFICATION: "You got this because you were given a club role in IMSDA Events.",
  ACCOUNT_LOCKOUT: "You got this because sign-in to your IMSDA Events account was locked after too many failed tries.",
  ATTENDEE_LOCKOUT: "You got this because sign-in to your IMSDA Events account was locked after too many failed tries.",
  LOCATION_WAITLIST_DIGEST: "You got this because you coordinate or staff a location with a waitlist.",
  DEADLINE_REMINDER: "You got this because you are a club director or Area Coordinator and a conference deadline is coming up.",
  TEAM_PERMISSION_REQUEST: "You got this because you are the Area Coordinator, or event staff, for a team that needs permission.",
  MEMBER_TRANSFER_STARTED: "You got this because a member transfer involving your club was started.",
  MEMBER_TRANSFER_COMPLETED: "You got this because a member transfer involving your club was completed.",
  CLUB_FORM_LINK: "You got this because a club asked you to fill in a form.",
  HEALTH_RECORD_LINK: "You got this because a club asked you to fill in a health record.",
  MODULE_REQUEST_SUBMITTED: "You got this because you are on the list for event module requests.",
  MODULE_REQUEST_DECIDED: "You got this because you asked for an event module to be turned on.",
  INVOICE_DELIVERY: "You got this because you are the billing contact, or a club director, for an invoice.",
  LODGING_WAITLIST_OFFER: "You got this because your registration is on a lodging waitlist.",
  LODGING_ASSIGNMENT_NOTICE: "You got this because lodging was assigned on your registration.",
  NEW_CLUB_APPLICATION_SUBMITTED: "You got this because you are on the list for new club applications.",
  NEW_CLUB_APPLICATION_DECLINED: "You got this because you applied to start a new club.",
  NEW_CLUB_APPLICATION_INVITE: "You got this because you were invited to apply to start a new club.",
  HONOR_CLASS_WAITLIST_OFFER: "You got this because you are the director of a club with youth on an Honors class waitlist.",
  HONOR_CLASS_PICKS_NOT_RESTORED: "You got this because you are the director of a club whose registration came back without some Honors class picks.",
  CLUB_TEAM_ADVANCEMENT_NOTICE: "You got this because you are the director of a team in an event with levels.",
  CLUB_FORM_SUBMITTED: "You got this because you are on the alert list for a club form.",
  INFORMATION_FORM_SUBMITTED: "You got this because you are on the alert list for an information form.",
  CANCELLATION_REQUEST_RECEIVED: "You got this because a cancellation was requested on your registration.",
  CANCELLATION_REQUEST_UPDATED: "You got this because a cancellation request on your registration changed.",
  HONOR_INSTRUCTOR_CLASS_SUMMARY: "You got this because you teach an Honors class.",
  HONOR_INSTRUCTOR_CLASS_CHANGE: "You got this because you teach an Honors class and asked to hear about changes right away.",
  HONOR_WATCH_SUMMARY: "You got this because you are on the Honors watch list for an event.",
  SYSTEM_TEST_EMAIL: "You got this because a system administrator sent a test email to this address.",
};

const GENERIC_WHY = "You got this because of something you did on IMSDA Events.";

export function emailWhyLine(templateKey: MessageTemplateKey | string | null | undefined, recipientEmail?: string | null) {
  const line = templateKey ? (EMAIL_WHY_LINES as Record<string, string | undefined>)[templateKey] : undefined;
  if (!line) return GENERIC_WHY;
  return line.replace(WHO, recipientEmail?.trim() || "this address");
}

// ---------------------------------------------------------------------------------------------------------------
// Footer content, shared by the HTML and the plain-text part so the two cannot drift.
// ---------------------------------------------------------------------------------------------------------------

export type EmailFooterContent = {
  context: EmailHeaderContext;
  headerName: string;
  whyLine: string;
  /** Null when there is nothing honest to say (see `emailHelpLine`). */
  helpLine: string | null;
};

/**
 * Everything the footer and header need for one message. Registration and event email keep the event's own contact:
 * a message queued under an event with a reply-to address says "Questions about this event? Email ...", and falls
 * back to the platform help contact only when the event has none.
 */
export function emailLayoutContent(input: {
  templateKey?: MessageTemplateKey | string | null;
  settings?: EmailLayoutSettings;
  clubRegistration?: boolean;
  recipientEmail?: string | null;
  replyToEmail?: string | null;
  /** True when the message belongs to an event (an event outbox row), whose own contact is its reply-to address. */
  eventScoped?: boolean;
}): EmailFooterContent {
  const settings = input.settings ?? DEFAULT_EMAIL_LAYOUT_SETTINGS;
  const context = input.templateKey ? emailHeaderContext(input.templateKey, { clubRegistration: input.clubRegistration }) : "general";
  const replyTo = input.replyToEmail?.trim() || null;
  const helpLine = input.eventScoped && replyTo
    ? `Questions about this event? Email ${replyTo}.`
    : emailHelpLine({ email: settings.helpEmail, phone: settings.helpPhone, replyToEmail: replyTo });
  return {
    context,
    headerName: emailHeaderName(settings, context),
    whyLine: emailWhyLine(input.templateKey, input.recipientEmail),
    helpLine,
  };
}

/**
 * The header name, why line and help line for a staff preview, decided by the same functions delivery uses
 * (`emailIsClubLinked`, `emailLayoutContent`), so a preview shows the header that is sent.
 */
export function emailPreviewLayout(
  settings: EmailLayoutSettings,
  templateKey: string,
  replyToEmail: string | null,
  recipientEmail: string,
  clubLinked = false,
) {
  const layout = emailLayoutContent({ templateKey, settings, clubRegistration: clubLinked, replyToEmail, recipientEmail, eventScoped: true });
  return { headerName: layout.headerName, whyLine: layout.whyLine, helpLine: layout.helpLine };
}

/** `Sent by <name> for the Iowa-Missouri Conference of Seventh-day Adventists.` */
export function emailSentByLine(headerName: string) {
  return `Sent by ${headerName} for the ${EMAIL_SENDER_ORGANIZATION}.`;
}

/**
 * The block appended to the plain-text part: `--`, who sent it, why, and help. With `separator: false` the text already
 * ends in its own `--` block (an announcement's unsubscribe line), so the lines continue that one.
 */
export function emailPlainTextFooter(content: Pick<EmailFooterContent, "headerName" | "whyLine" | "helpLine">, options: { separator?: boolean } = {}) {
  return [
    ...(options.separator === false ? [] : ["--"]),
    emailSentByLine(content.headerName),
    content.whyLine,
    ...(content.helpLine ? [content.helpLine] : []),
  ].join("\n");
}

/** The text part with the footer block under it. */
export function appendEmailPlainTextFooter(
  bodyText: string,
  content: Pick<EmailFooterContent, "headerName" | "whyLine" | "helpLine">,
  options: { separator?: boolean } = {},
) {
  // The closing "IMSDA Events" line of the account emails is the footer's job now, and would contradict a renamed header.
  const body = bodyText.replace(/\s+$/, "").replace(/(^|\n\n)IMSDA Events$/, "");
  return `${body.replace(/\s+$/, "")}\n\n${emailPlainTextFooter(content, options)}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// The HTML.
// ---------------------------------------------------------------------------------------------------------------

const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";

/** The two palettes from the approved mockup. Light is inline in the HTML; dark is the class block in the head. */
export const EMAIL_PALETTE = {
  light: {
    bg: "#f4f7f8", card: "#ffffff", line: "#dce6ea", ink: "#243640", muted: "#536872", head: "#003b5c",
    eyebrow: "#582c83", codeBg: "#e6f0f4", codeLine: "#b9cfda", codeInk: "#003b5c", btnBg: "#003b5c", btnInk: "#ffffff",
    link: "#003b5c", bar: "#003b5c", barInk: "#ffffff", barSub: "#c9dbe4", gold: "#f0b323", markInk: "#002c45",
    noteBg: "#f1eaf7", noteLine: "#d9c7ea",
  },
  dark: {
    bg: "#0d1418", card: "#172227", line: "#2b3a42", ink: "#e3eaed", muted: "#a3b4bc", head: "#ffffff",
    eyebrow: "#c9a6ec", codeBg: "#0f2a3a", codeLine: "#2d5168", codeInk: "#ffffff", btnBg: "#1f6b94", btnInk: "#ffffff",
    link: "#8cc8ea", bar: "#002c45", barInk: "#ffffff", barSub: "#9fb8c6", gold: "#f0b323", markInk: "#002c45",
    noteBg: "#241a33", noteLine: "#45335c",
  },
} as const;

const L = EMAIL_PALETTE.light;
const D = EMAIL_PALETTE.dark;

/** Dark colors for the clients that honor `prefers-color-scheme`. `!important` beats the inline light colors. */
const DARK_MODE_CSS = [
  ":root{color-scheme:light dark;supported-color-schemes:light dark;}",
  "@media (prefers-color-scheme: dark){",
  `.em-bg{background:${D.bg}!important;}`,
  `.em-card{background:${D.card}!important;border-color:${D.line}!important;}`,
  `.em-bar{background:${D.bar}!important;}`,
  `.em-bar-name{color:${D.barInk}!important;}`,
  `.em-bar-sub{color:${D.barSub}!important;}`,
  `.em-muted{color:${D.muted}!important;}`,
  `.em-ink{color:${D.ink}!important;}`,
  `.em-link{color:${D.link}!important;}`,
  `.em-body p,.em-body li,.em-body span{color:${D.ink}!important;}`,
  `.em-body h1,.em-body h2,.em-body h3{color:${D.head}!important;}`,
  `.em-body a{color:${D.link}!important;}`,
  `.em-body code{background:${D.codeBg}!important;color:${D.ink}!important;}`,
  `.em-body hr{border-top-color:${D.line}!important;}`,
  `.em-body td[bgcolor]{background:${D.btnBg}!important;}`,
  `.em-body a.em-btn-a{color:${D.btnInk}!important;}`,
  `.em-btn{background:${D.btnBg}!important;}`,
  `.em-code{background:${D.codeBg}!important;border-color:${D.codeLine}!important;}`,
  `.em-code-ink{color:${D.codeInk}!important;}`,
  `.em-note{background:${D.noteBg}!important;border-color:${D.noteLine}!important;}`,
  `.em-note-title{color:${D.head}!important;}`,
  "}",
].join("\n");

const BODY_PARAGRAPH_STYLE = `margin:0 0 14px;font-size:15px;line-height:1.6;color:#22333b;`;

function renderBulletproofButton(label: string, href: string) {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px;"><tr>`,
    `<td align="center" bgcolor="${L.btnBg}" class="em-btn" style="background:${L.btnBg};border-radius:10px;mso-padding-alt:14px 26px;">`,
    `<a href="${href}" target="_blank" class="em-btn-a" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:bold;color:${L.btnInk};text-decoration:none;border-radius:10px;">${label}</a>`,
    `</td></tr></table>`,
    `<p class="em-muted" style="margin:0 0 20px;font-family:${FONT};font-size:13px;line-height:1.5;color:${L.muted};">Button not working? Paste this link into your browser:<br><a href="${href}" class="em-link" style="color:${L.link};word-break:break-all;">${href}</a></p>`,
  ].join("");
}

/**
 * The button `renderEmailBodyHtml` makes, matched by its exact shape and rewritten into the layout's button with the
 * "Button not working?" fallback. Only that exact markup is touched, so nothing a body contains can match; the URL
 * and text are carried over exactly as the renderer escaped and validated them. Only web links get a fallback.
 */
const RENDERED_BUTTON_PATTERN = /<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr><td align="center" bgcolor="#0f6f8c" style="[^"]*"><a href="([^"]*)" target="_blank" style="[^"]*">([^<]*)<\/a><\/td><\/tr><\/table>/g;

function restyleRenderedButtons(bodyHtml: string) {
  return bodyHtml.replace(RENDERED_BUTTON_PATTERN, (match, href: string, label: string) => (
    /^https?:\/\//i.test(href) ? renderBulletproofButton(label, href) : match
  ));
}

export type EmailLayoutInput = {
  /** Shown in the client's tab and read by screen readers. */
  title: string;
  /** A Markdown body, rendered by `renderEmailBodyHtml`. */
  body?: string;
  /** An already-rendered body fragment (what delivery uses), wrapped as it is. */
  bodyHtml?: string;
  /** Extra plain line at the end of the footer. Escaped, never parsed. */
  footer?: string | null;
  /** The inbox preview line (#836), hidden in the opened email. */
  preheader?: string | null;
  /** The name in the header bar and the "Sent by" line. Defaults to the platform default. */
  headerName?: string;
  /** "Why you got this". Defaults to a generic line. */
  whyLine?: string | null;
  /** The help sentence. Undefined takes the platform default contact; null leaves the line out. */
  helpLine?: string | null;
  /** An announcement's unsubscribe page, as a link in the footer. Only a web address is used. */
  unsubscribeUrl?: string | null;
  /** The site's public calendar, as an absolute address (`${APP_BASE_URL}/calendar`, #1496). The header mark and name link to it. Only a web address is used. */
  calendarUrl?: string | null;
};

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function footerParagraph(text: string, last = false) {
  return `<p class="em-muted" style="margin:0 0 ${last ? "0" : "6px"};">${escapeHtml(text)}</p>`;
}

/** The complete email document. The only function in the codebase that writes `<!DOCTYPE html>` for an email. */
export function renderEmailLayoutDocument(input: EmailLayoutInput) {
  const title = escapeHtml(input.title.trim());
  const headerName = oneLine(input.headerName ?? "") || DEFAULT_EMAIL_LAYOUT_SETTINGS.headerName;
  const whyLine = input.whyLine === undefined || input.whyLine === null ? GENERIC_WHY : oneLine(input.whyLine);
  const helpLine = input.helpLine === undefined
    ? emailHelpLine({ email: DEFAULT_EMAIL_LAYOUT_SETTINGS.helpEmail, phone: DEFAULT_EMAIL_LAYOUT_SETTINGS.helpPhone })
    : input.helpLine;
  const unsubscribe = input.unsubscribeUrl && /^https?:\/\/[^\s<>"']+$/i.test(input.unsubscribeUrl.trim())
    ? input.unsubscribeUrl.trim()
    : null;
  const calendar = input.calendarUrl && /^https?:\/\/[^\s<>"']+$/i.test(input.calendarUrl.trim())
    ? escapeHtml(input.calendarUrl.trim())
    : null;
  // An explicit colour beside `inherit`, so Outlook does not paint the anchor link-blue.
  const brandLink = (inner: string, ink: string, label?: string) =>
    calendar
      ? `<a href="${calendar}"${label ? ` aria-label="${label}"` : ""} style="color:${ink};color:inherit;text-decoration:none;">${inner}</a>`
      : inner;
  const preheaderHtml = renderPreheaderHtml(input.preheader);
  const bodyHtml = restyleRenderedButtons(input.bodyHtml ?? renderEmailBodyHtml(input.body ?? ""));
  const footerLines = [
    `<p class="em-muted" style="margin:0 0 6px;">Sent by <b class="em-ink" style="color:${L.ink};">${escapeHtml(headerName)}</b> for the ${escapeHtml(EMAIL_SENDER_ORGANIZATION)}.</p>`,
    ...(whyLine ? [footerParagraph(whyLine)] : []),
    ...(helpLine ? [footerParagraph(helpLine, !unsubscribe && !input.footer?.trim())] : []),
    ...(unsubscribe
      ? [`<p class="em-muted" style="margin:6px 0 0;"><a href="${escapeHtml(unsubscribe)}" class="em-link" style="color:${L.link};text-decoration:underline;">Unsubscribe or change your email preferences</a></p>`]
      : []),
    ...(input.footer?.trim() ? [`<p class="em-muted" style="margin:6px 0 0;">${escapeHtml(oneLine(input.footer))}</p>`] : []),
  ];
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light dark" />',
    '<meta name="supported-color-schemes" content="light dark" />',
    `<title>${title}</title>`,
    `<style>${DARK_MODE_CSS}</style>`,
    "</head>",
    `<body class="em-bg" style="margin:0;padding:0;background:${L.bg};-webkit-font-smoothing:antialiased;">`,
    ...(preheaderHtml ? [preheaderHtml] : []),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${L.bg}" class="em-bg" style="background:${L.bg};">`,
    '<tr><td align="center" style="padding:28px 12px 36px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">',
    `<tr><td bgcolor="${L.bar}" class="em-bar" style="background:${L.bar};border-radius:12px 12px 0 0;border-bottom:4px solid ${L.gold};padding:16px 24px;">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td width="34" height="34" align="center" valign="middle" bgcolor="${L.gold}" style="background:${L.gold};border-radius:8px;width:34px;height:34px;font-family:Georgia,'Times New Roman',serif;font-size:21px;font-style:italic;font-weight:bold;line-height:34px;color:${L.markInk};">${brandLink("i", L.markInk, "IMSDA Events calendar")}</td>`,
    `<td style="padding-left:12px;font-family:${FONT};">`,
    ...(calendar ? [`<a href="${calendar}" style="color:${L.barInk};color:inherit;text-decoration:none;display:block;">`] : []),
    `<div class="em-bar-name" style="font-size:18px;line-height:20px;font-weight:bold;color:${L.barInk};">${escapeHtml(headerName)}</div>`,
    `<div class="em-bar-sub" style="font-size:12px;line-height:16px;color:${L.barSub};">${escapeHtml(EMAIL_HEADER_SUBLINE)}</div>`,
    ...(calendar ? ["</a>"] : []),
    "</td></tr></table>",
    "</td></tr>",
    `<tr><td bgcolor="${L.card}" class="em-card em-body" style="background:${L.card};border:1px solid ${L.line};border-top:0;border-radius:0 0 12px 12px;padding:28px 28px 16px;font-family:${FONT};">`,
    bodyHtml,
    "</td></tr>",
    `<tr><td style="padding:20px 8px 0;font-family:${FONT};font-size:13px;line-height:1.55;color:${L.muted};">`,
    ...footerLines,
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body>",
    "</html>",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// A body for messages that have only text (account email and other server-written messages).
// ---------------------------------------------------------------------------------------------------------------

export type PlainBodyOptions = {
  /**
   * A server-generated block shown large in a box in place of the paragraph that is exactly `code` (the sign-in code).
   * `code` must be letters, digits and spaces only; anything else is shown as an ordinary paragraph.
   */
  codeBox?: { code: string; caption: string } | null;
  /** A line `Label: https://...` becomes a button only when its address is on one of these origins (the site's own). */
  buttonOrigins?: readonly string[];
};

const CODE_BOX_PATTERN = /^[0-9A-Za-z ]{1,16}$/;
const URL_PATTERN = /https?:\/\/[^\s<>"'()]+/gi;
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/;
const LABELLED_URL_LINE = /^(.{1,80}?):\s+(https?:\/\/[^\s<>"']+)$/i;
const SIGNATURE_LINES = new Set(["IMSDA Events"]);

/** A line with the site's own web addresses turned into links. Plain text only: no Markdown, nothing else is linked. */
function linkifyLine(line: string, origins: readonly string[] = []) {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    const trimmed = match[0].replace(TRAILING_URL_PUNCTUATION, "");
    const start = match.index ?? 0;
    // Only the site's own addresses are links; any other address stays plain text.
    const href = ownUrl(trimmed, origins);
    if (!href) continue;
    html += escapeHtml(line.slice(last, start));
    html += `<a href="${escapeHtml(href)}" class="em-link" style="color:#0f6f8c;text-decoration:underline;">${escapeHtml(href)}</a>`;
    last = start + trimmed.length;
  }
  return html + escapeHtml(line.slice(last));
}

/**
 * The normalized address when `raw` is an http(s) address on exactly one of the site's origins, else null. The address is
 * parsed once and the parsed `href` is what is written, so what is checked is what is linked. A backslash (which the URL
 * parser reads as a slash), a user name or a password (`https://site@evil/`) is refused.
 */
function ownUrl(raw: string, origins: readonly string[]) {
  if (raw.includes("\\")) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return origins.includes(url.origin) ? url.href : null;
  } catch {
    return null;
  }
}

function isNoteTitle(line: string) {
  if (line.length > 70 || !/^[A-Z]/.test(line)) return false;
  const bare = line.replace(/:$/, "");
  if (/[.,;:!]$/.test(bare) || bare.includes(":") || bare.split(/\s+/).length > 12) return false;
  return true;
}

/**
 * The HTML body for a message that was written as plain text. It never reads Markdown: each paragraph is escaped as
 * text, so a name or club title typed by a person cannot become a link, an image or markup. The first short line is the
 * heading, a short title line over more text becomes a note box, and a `Label: address` line on the site's own origin
 * becomes a button. The paragraph holding the sign-in code becomes the code box.
 */
export function plainTextToEmailBodyHtml(text: string, options: PlainBodyOptions = {}) {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
  while (paragraphs.length > 1) {
    const lastParagraph = paragraphs[paragraphs.length - 1];
    if (lastParagraph.length === 1 && SIGNATURE_LINES.has(lastParagraph[0])) paragraphs.pop();
    else break;
  }
  // "Open your private link:" with the address on the next line or in the next paragraph is one labelled address.
  for (let i = 0; i < paragraphs.length; i += 1) {
    const lines = paragraphs[i];
    const next = paragraphs[i + 1];
    const last = lines[lines.length - 1];
    if (last.endsWith(":") && next && /^https?:\/\/\S+$/.test(next[0])) {
      const merged = `${last} ${next[0]}`;
      const rest = next.slice(1);
      const replacement = [...(lines.length > 1 ? [lines.slice(0, -1)] : []), [merged], ...(rest.length ? [rest] : [])];
      paragraphs.splice(i, 2, ...replacement);
    } else if (lines.length > 1) {
      const at = lines.findIndex((line, j) => line.endsWith(":") && /^https?:\/\/\S+$/.test(lines[j + 1] ?? ""));
      if (at >= 0) {
        const replacement = [...(at > 0 ? [lines.slice(0, at)] : []), [`${lines[at]} ${lines[at + 1]}`], ...(lines.length > at + 2 ? [lines.slice(at + 2)] : [])];
        paragraphs.splice(i, 1, ...replacement);
      }
    }
  }
  const codeBox = options.codeBox && CODE_BOX_PATTERN.test(options.codeBox.code) ? options.codeBox : null;
  const origins = options.buttonOrigins ?? [];
  return paragraphs.map((lines, index) => {
    const joined = lines.join(" ");
    if (codeBox && joined === codeBox.code) {
      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr>`,
        `<td align="center" class="em-code" style="background:${L.codeBg};border:1px solid ${L.codeLine};border-radius:12px;padding:20px 12px;">`,
        `<div class="em-code-ink" style="font-family:Consolas,'Courier New',monospace;font-size:36px;line-height:1.1;font-weight:bold;letter-spacing:6px;color:${L.codeInk};">${escapeHtml(codeBox.code)}</div>`,
        `<div class="em-muted" style="margin-top:8px;font-family:${FONT};font-size:14px;line-height:1.4;color:${L.muted};">${escapeHtml(codeBox.caption)}</div>`,
        `</td></tr></table>`,
      ].join("");
    }
    if (lines.length === 1) {
      const labelled = LABELLED_URL_LINE.exec(lines[0]);
      const href = labelled ? ownUrl(labelled[2].replace(TRAILING_URL_PUNCTUATION, ""), origins) : null;
      if (labelled && href) return renderBulletproofButton(escapeHtml(labelled[1]), escapeHtml(href));
      const first = index === 0 && paragraphs.length > 1;
      if (first && lines[0].length <= 80 && !/[.,;!]$/.test(lines[0]) && !lines[0].includes("http")) {
        return `<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#0b2b3a;font-weight:700;">${escapeHtml(lines[0].replace(/:$/, ""))}</h1>`;
      }
    }
    if (lines.length >= 2 && lines.every((line) => /^[-*•]\s+/.test(line))) {
      const items = lines.map((line) => `<li style="margin:0 0 4px;">${linkifyLine(line.replace(/^[-*•]\s+/, ""), origins)}</li>`).join("");
      return `<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.6;color:#22333b;">${items}</ul>`;
    }
    if (lines.length >= 2 && isNoteTitle(lines[0])) {
      return [
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>`,
        `<td class="em-note" style="background:${L.noteBg};border:1px solid ${L.noteLine};border-radius:10px;padding:14px 16px;font-size:15px;line-height:1.5;color:${L.ink};">`,
        `<b class="em-note-title" style="color:${L.head};">${escapeHtml(lines[0])}</b><br>`,
        `<span style="color:${L.ink};">${lines.slice(1).map((line) => linkifyLine(line, origins)).join("<br>")}</span>`,
        `</td></tr></table>`,
      ].join("");
    }
    return `<p style="${BODY_PARAGRAPH_STYLE}">${lines.map((line) => linkifyLine(line, origins)).join("<br />")}</p>`;
  }).join("\n");
}
