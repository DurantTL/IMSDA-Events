import { z } from "zod";
import { EMAIL_FIELD_MESSAGE } from "@/lib/field-validation";
import { honeypotFieldSchema } from "@/modules/security/honeypot";

/**
 * Problem reports from the Forms help popup (#1483): pure and client-safe. What a report may carry, how the page address is
 * cleaned, and the one list of technical details that is ever sent. The rule: nothing private from the form the person was
 * filling in leaves the browser. So the details are a fixed list of device and page facts, built field by field (never by
 * walking the page), and the server keeps only those fields again.
 */
export const PROBLEM_REPORT_MESSAGE_MAX = 2000;
export const PROBLEM_REPORT_MESSAGE_MIN = 5;
export const PROBLEM_REPORT_EMAIL_MAX = 254;

export const PROBLEM_REPORT_MESSAGE_REQUIRED_TEXT = "Tell us what happened, in a few words.";
export const PROBLEM_REPORT_FAILED_TEXT = "The report could not be sent. Try again, or email the help address above.";

/** "P-1234": the reference the person is given and the IT team searches for. */
export function problemReportReference(number: number) {
  return `P-${number}`;
}

/** The shared status words (rule B12): a report that was sent and waits is "Submitted"; one dealt with is "Completed". */
export const problemReportStatusLabel = { OPEN: "Submitted", RESOLVED: "Completed" } as const;

/** A long segment is kept only when it reads as a lowercase hyphenated slug ("womens-retreat-registration"); any other long run of letters, digits, "_" or "-" looks like a token. */
const TOKENISH_SEGMENT = /^[A-Za-z0-9_-]{20,}$/;
const READABLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const PRIVATE_PREFIX = /^(club-forms|manage|unsubscribe|staff-invite|staff-invitations)$/;

/**
 * The page path only: no origin, no query values (they can hold a name, an email or a code) and no hash. A path segment that
 * looks like a private link token (long and not a readable slug) is replaced, and everything after a private-link folder
 * (`/manage/`, `/club-forms/` and so on) is replaced, so a personal link is never sent.
 */
export function sanitizePagePath(value: string): string {
  let pathname = value.trim();
  try {
    pathname = new URL(pathname, "https://placeholder.invalid").pathname;
  } catch {
    pathname = pathname.split(/[?#]/, 1)[0] ?? "";
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  const segments = pathname.split("/");
  const kept: string[] = [];
  for (const [index, segment] of segments.entries()) {
    if (index > 0 && PRIVATE_PREFIX.test(segments[index - 1] ?? "")) {
      kept.push("[redacted]");
      break;
    }
    kept.push(index > 0 && TOKENISH_SEGMENT.test(segment) && !READABLE_SLUG.test(segment) ? "[redacted]" : segment);
  }
  return kept.join("/").slice(0, 300);
}

const shortText = (max: number) => z.string().trim().max(max).optional();

/** The technical details, field by field. Unknown fields are dropped, so nothing else can ride along. A field that is not valid is dropped too (never the whole report). */
export const problemReportDetailsSchema = z.object({
  path: z.string().max(2000).transform(sanitizePagePath).optional().catch(undefined),
  clientTime: z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value))).optional().catch(undefined),
  userAgent: shortText(300).catch(undefined),
  language: shortText(35).catch(undefined),
  translation: z.enum(["on", "not-detected"]).optional().catch(undefined),
  viewport: z.string().regex(/^[1-9]\d{1,4}x[1-9]\d{1,4}$/).optional().catch(undefined),
  securityCheckBlocked: z.boolean().optional().catch(undefined),
  squareBlocked: z.boolean().optional().catch(undefined),
});

export type ProblemReportDetails = z.infer<typeof problemReportDetailsSchema> & { appVersion?: string };

export const problemReportInputSchema = z.object({
  message: z.string().trim().min(PROBLEM_REPORT_MESSAGE_MIN, PROBLEM_REPORT_MESSAGE_REQUIRED_TEXT).max(PROBLEM_REPORT_MESSAGE_MAX, `Keep it under ${PROBLEM_REPORT_MESSAGE_MAX} characters.`),
  email: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(PROBLEM_REPORT_EMAIL_MAX).pipe(z.email(EMAIL_FIELD_MESSAGE)).optional(),
  ),
  /** Null or absent when the person turned "Include technical details" off. */
  details: problemReportDetailsSchema.nullish().catch(null),
  website: honeypotFieldSchema,
});

export type ProblemReportInput = z.infer<typeof problemReportInputSchema>;

/** The facts a browser can give, as plain values, so the collector can be tested without a real window. */
export type BrowserFacts = {
  href: string;
  userAgent: string;
  language: string;
  htmlClassName: string;
  innerWidth: number;
  innerHeight: number;
  /** True only after the Security check script reported a load error or gave up; never while it is still loading. */
  securityCheckLoadFailed: boolean;
  /** True only while the card form's own "could not load" notice is showing; never while it is still loading. */
  squareLoadFailed: boolean;
  now: Date;
};

/**
 * The details the popup sends. Built only from `BrowserFacts`: the page address (cleaned), the time, the browser, the
 * language, whether the browser's translation has rewritten the page, the window size, and whether the Security check or the card form reported
 * that it could not load. It never reads form fields, cookies, storage, headers or tokens.
 */
export function buildProblemReportDetails(facts: BrowserFacts): ProblemReportDetails {
  return {
    path: sanitizePagePath(facts.href),
    clientTime: facts.now.toISOString(),
    userAgent: facts.userAgent.slice(0, 300),
    language: facts.language.slice(0, 35),
    translation: /\btranslated-(ltr|rtl)\b/.test(facts.htmlClassName) ? "on" : "not-detected",
    viewport: `${Math.round(facts.innerWidth)}x${Math.round(facts.innerHeight)}`,
    securityCheckBlocked: facts.securityCheckLoadFailed,
    squareBlocked: facts.squareLoadFailed,
  };
}
