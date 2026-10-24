import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1176: My registrations history, contextual card actions and the Profile verified-email meaning. Synthetic data only. */
const mocks = vi.hoisted(() => ({
  via: "attendee" as "attendee" | "staff",
  registrations: [] as unknown[],
  registrationsFail: false,
  cancellations: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT ${target}`);
  },
}));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({
  getCurrentAttendee: async () => ({
    account: { id: "att-1", verifiedEmail: "taylor@imsda-events.test", displayName: "Taylor Lane" },
    via: mocks.via,
    sessionId: "a1",
  }),
}));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ requireAttendeeSecondStep: async () => undefined }));
vi.mock("@/modules/attendee-accounts/registrations-repository", () => ({
  listRegistrationsForVerifiedEmail: async () => {
    if (mocks.registrationsFail) throw new Error("synthetic load failure");
    return mocks.registrations;
  },
}));
vi.mock("@/modules/cancellation-requests/repository", () => ({
  getRegistrantRequestViewById: async (id: string) => mocks.cancellations[id] ?? null,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("@/components/public-square-payment", () => ({ PublicSquarePayment: () => createElement("div", null, "SQUARE") }));
vi.mock("@/components/attendee-registration-contact-form", () => ({ AttendeeRegistrationContactForm: () => createElement("form") }));
vi.mock("@/components/attendee-registration-answers-form", () => ({ AttendeeRegistrationAnswersForm: () => createElement("form") }));
vi.mock("@/components/cancellation-request-panel", () => ({ CancellationRequestPanel: () => createElement("div", null, "CANCEL-PANEL") }));
vi.mock("@/components/attendee-account-settings", () => ({ AttendeeAccountSettings: () => createElement("div", { id: "settings" }) }));
vi.mock("@/components/attendee-sign-out-button", () => ({ AttendeeSignOutButton: () => createElement("button", null, "Sign out") }));
vi.mock("@/components/account-announcement-banner", () => ({ AccountAnnouncementBanner: () => null }));
vi.mock("@/components/mfa-manager", () => ({ MfaManager: () => null }));
vi.mock("@/components/session-manager", () => ({ SessionManager: () => null }));
vi.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));
vi.mock("@/components/staff-passkey-manager", () => ({ StaffPasskeyManager: () => null }));

import AttendeeRegistrationsPage from "@/app/(public)/account/(portal)/registrations/page";
import { ProfileView } from "@/components/profile-view";
import { RegistrationActionDisclosure } from "@/components/registration-action-disclosure";
import { VerifiedEmailExplainer } from "@/components/verified-email-explainer";
import { HUB_REGISTRATION_LIFECYCLES, registrationMoneySummary, registrationViewLink } from "@/modules/attendee-accounts/registration-card";
import { parseHistoryFilter, registrationActions, splitRegistrationHistory } from "@/modules/attendee-accounts/registration-history";
import type { AttendeeRegistrationSummary } from "@/modules/attendee-accounts/registrations-repository";

type Lifecycle = AttendeeRegistrationSummary["lifecycle"];

const STATUS: Record<Lifecycle, AttendeeRegistrationSummary["status"]> = {
  DRAFT: { label: "Not submitted", detail: "", tone: "neutral" },
  SUBMITTED: { label: "Submitted", detail: "", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", detail: "", tone: "positive" },
  WAITLISTED: { label: "Waitlisted", detail: "", tone: "waiting" },
  CANCELLED: { label: "Cancelled", detail: "", tone: "cancelled" },
};

const future = { startsAt: "2099-04-23T15:00:00.000Z", endsAt: "2099-04-25T15:00:00.000Z" };
const past = { startsAt: "2020-04-23T15:00:00.000Z", endsAt: "2020-04-25T15:00:00.000Z" };

function registration(id: string, lifecycle: Lifecycle, overrides: Partial<AttendeeRegistrationSummary> & { dates?: typeof future; eventName?: string } = {}): AttendeeRegistrationSummary {
  const { dates, eventName, ...rest } = overrides;
  const payable = lifecycle === "SUBMITTED" || lifecycle === "CONFIRMED";
  return {
    id,
    confirmationCode: `SYN-${id.toUpperCase()}`,
    status: STATUS[lifecycle],
    submittedAt: "2026-01-02T00:00:00.000Z",
    event: {
      name: eventName ?? `Synthetic Event ${id}`,
      slug: `synthetic-event-${id}`,
      ...(dates ?? future),
      timezone: "America/Chicago",
      location: "Synthetic Campground",
      attendeeEditPolicy: "TIERED",
      isDeferredOrganizationBilling: false,
    },
    churchBilling: null,
    groupBilling: null,
    contact: { firstName: "Taylor", lastName: "Lane", email: "taylor@imsda-events.test", phone: "555-0100" },
    attendeeNames: ["Taylor Lane", "Jordan Lane"],
    answerEditing: { enabled: false, reason: "", expectedUpdatedAt: "2026-01-02T00:00:00.000Z", fields: [], attendees: [] },
    totalCents: 8000,
    paidCents: payable ? 4000 : 0,
    grossPaidCents: payable ? 4000 : 0,
    refundedCents: 0,
    balanceCents: payable ? 4000 : 0,
    lifecycle,
    payment: {
      state: payable ? "PARTIALLY_PAID" : "NOT_DUE",
      label: payable ? "Partially paid" : "No payment due",
      detail: "",
      paymentEligible: payable,
    },
    ...rest,
  };
}

const openRequests = { available: true, unavailableReason: null, allowedScopes: ["FULL_REGISTRATION"], attendees: [], components: [], requests: [], hasOpenRequest: false };
const requestedOnly = { ...openRequests, available: false, requests: [{ id: "r1" }], hasOpenRequest: true };

async function render(show?: string) {
  return renderToStaticMarkup(await AttendeeRegistrationsPage({ searchParams: Promise.resolve(show ? { show } : {}) }));
}

beforeEach(() => {
  mocks.via = "attendee";
  mocks.registrations = [];
  mocks.registrationsFail = false;
  mocks.cancellations = {};
});

describe("history grouping (#1176)", () => {
  const all = [
    registration("sub", "SUBMITTED"),
    registration("conf", "CONFIRMED", { dates: { startsAt: "2099-01-01T15:00:00.000Z", endsAt: "2099-01-02T15:00:00.000Z" } }),
    registration("wait", "WAITLISTED"),
    registration("canc", "CANCELLED", { grossPaidCents: 8000, refundedCents: 8000 }),
    registration("gone", "CONFIRMED", { dates: past, balanceCents: 0 }),
    registration("draft", "DRAFT"),
  ];

  it("separates upcoming and active from past and cancelled, soonest first, drafts nowhere", () => {
    const groups = splitRegistrationHistory(all);
    expect(groups.upcoming.map((r) => r.id)).toEqual(["conf", "sub", "wait"]);
    expect(groups.past.map((r) => r.id)).toEqual(["gone"]);
    expect(groups.cancelled.map((r) => r.id)).toEqual(["canc"]);
  });

  it("never lets a cancelled future registration be upcoming (agrees with the Overview, #1100)", () => {
    expect(splitRegistrationHistory([registration("c", "CANCELLED")]).upcoming).toEqual([]);
  });

  it("reads an unknown filter as the full list", () => {
    expect(parseHistoryFilter("past")).toBe("past");
    expect(parseHistoryFilter(["cancelled", "x"])).toBe("cancelled");
    expect(parseHistoryFilter("<script>")).toBe("all");
    expect(parseHistoryFilter(undefined)).toBe("all");
  });
});

describe("contextual actions per lifecycle (#1176)", () => {
  const ask = (value: AttendeeRegistrationSummary, extra: Partial<Parameters<typeof registrationActions>[1]> = {}) =>
    registrationActions(value, { editable: true, cancellation: null, ...extra });

  it("a submitted registration with a balance can continue payment, edit contact and request cancellation", () => {
    expect(ask(registration("a", "SUBMITTED"), { cancellation: openRequests })).toMatchObject({
      view: true, continuePayment: true, editContact: true, cancellation: "request", readOnlyHistory: false,
    });
  });

  it("a confirmed, fully paid registration offers no payment", () => {
    const paid = registration("a", "CONFIRMED", { balanceCents: 0, payment: { state: "PAID", label: "Paid in full", detail: "", paymentEligible: false } });
    expect(ask(paid)).toMatchObject({ continuePayment: false, editContact: true });
  });

  it("a waitlisted registration never offers payment, whatever the quoted amount", () => {
    const waitlisted = registration("w", "WAITLISTED", { totalCents: 25000 });
    expect(ask(waitlisted)).toMatchObject({ continuePayment: false, editContact: true });
  });

  it("a cancelled registration is read-only history with only an existing request's status", () => {
    const cancelled = registration("c", "CANCELLED", { grossPaidCents: 8000, refundedCents: 8000 });
    expect(ask(cancelled, { cancellation: requestedOnly })).toMatchObject({
      continuePayment: false, editContact: false, cancellation: "status", readOnlyHistory: true,
    });
  });

  it("a past paid registration is read-only; a past one still owing keeps the existing payment action", () => {
    const paid = registration("p", "CONFIRMED", { dates: past, balanceCents: 0, payment: { state: "PAID", label: "Paid in full", detail: "", paymentEligible: false } });
    expect(ask(paid)).toMatchObject({ continuePayment: false, editContact: false, readOnlyHistory: true });
    expect(ask(registration("o", "CONFIRMED", { dates: past }))).toMatchObject({ continuePayment: true, editContact: false });
  });

  it("a staff member looking at the portal gets no editing, payment or cancellation", () => {
    expect(ask(registration("a", "SUBMITTED"), { editable: false, cancellation: openRequests })).toMatchObject({
      continuePayment: false, editContact: false, cancellation: null,
    });
  });

  it("offers no receipt action: no account receipt service exists", () => {
    expect(Object.keys(ask(registration("a", "CONFIRMED")))).not.toContain("receipt");
  });
});

describe("My registrations page (#1176)", () => {
  it("lists upcoming work first and folds past and cancelled history with counts showing", async () => {
    mocks.registrations = [
      registration("sub", "SUBMITTED", { eventName: "Family Retreat 2099" }),
      registration("gone", "CONFIRMED", { dates: past, balanceCents: 0, eventName: "Old Camp Meeting" }),
      registration("canc", "CANCELLED", { eventName: "Cancelled Camporee" }),
    ];
    const html = await render();
    expect(html).toContain("<h1>My registrations</h1>");
    expect(html).toContain("Upcoming and active");
    expect(html).toContain("Past and cancelled");
    expect(html).toContain("1 past · 1 cancelled");
    expect(html.indexOf("Family Retreat 2099")).toBeLessThan(html.indexOf("Old Camp Meeting"));
    // Folded by default while there is something upcoming; the summary (with its counts) is always visible.
    expect(html).toMatch(/<details class="attendee-reg-history">\s*<summary>/);
    expect(html).toContain("Registration received");
    expect(html).toContain("Jordan Lane");
  });

  it("opens history by itself when nothing is upcoming", async () => {
    mocks.registrations = [registration("gone", "CONFIRMED", { dates: past, balanceCents: 0 })];
    const html = await render();
    expect(html).toContain('<details class="attendee-reg-history" open="">');
    expect(html).toContain("Nothing coming up");
  });

  it("gives a submitted registration payment, contact and cancellation request actions, each labelled", async () => {
    mocks.registrations = [registration("sub", "SUBMITTED")];
    mocks.cancellations = { sub: openRequests };
    const html = await render();
    expect(html).toContain("View registration");
    expect(html).toContain('href="/account/events/synthetic-event-sub"');
    expect(html).toContain("Continue payment");
    expect(html).toContain("$40.00 remaining");
    expect(html).toContain("Update contact details");
    expect(html).toContain("Request cancellation");
  });

  it("offers no continue payment or contact edit on a waitlisted registration and keeps its wording", async () => {
    mocks.registrations = [registration("w", "WAITLISTED", { totalCents: 25000 })];
    const html = await render();
    expect(html).toContain("Waitlisted");
    expect(html).toContain("No payment due while waitlisted");
    expect(html).not.toContain("Continue payment");
    expect(html).not.toContain("$250");
  });

  it("shows a cancelled and refunded registration as history with its charges, refund and nothing due", async () => {
    mocks.registrations = [registration("c", "CANCELLED", { grossPaidCents: 10000, refundedCents: 10000, totalCents: 10000 })];
    mocks.cancellations = { c: requestedOnly };
    const html = await render();
    expect(html).toContain("Nothing due now");
    expect(html).toContain("Original total $100.00 · $100.00 paid · $100.00 refunded. No payment is due on a cancelled registration.");
    expect(html).toContain("Cancellation requests");
    expect(html).not.toMatch(/Continue payment|Update contact details|Request cancellation/);
  });

  it("keeps a past paid registration as read-only history with no editing actions", async () => {
    mocks.registrations = [registration("p", "CONFIRMED", { dates: past, balanceCents: 0, payment: { state: "PAID", label: "Paid in full", detail: "", paymentEligible: false } })];
    const html = await render();
    expect(html).toContain("Paid in full");
    expect(html).toContain("read-only history");
    expect(html).not.toMatch(/Continue payment|Update contact details|Receipt/);
  });

  it("never offers editing, payment or cancellation to a staff member viewing the account", async () => {
    mocks.via = "staff";
    mocks.registrations = [registration("sub", "SUBMITTED")];
    mocks.cancellations = { sub: openRequests };
    const html = await render();
    expect(html).toContain("View registration");
    expect(html).not.toMatch(/Continue payment|Update contact details|Request cancellation/);
  });

  it("fills exactly one primary button on a page of cards", async () => {
    mocks.registrations = [registration("a", "CONFIRMED"), registration("b", "SUBMITTED")];
    const html = await render();
    expect(html.match(/primary-button/g)?.length).toBe(1);
  });

  it("shows the empty state with Find events as the one primary, and no filters", async () => {
    const html = await render();
    expect(html).toContain("No registrations match this address");
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/recover-registration"');
    expect(html.match(/primary-button/g)?.length).toBe(1);
    expect(html).not.toContain("Show registrations");
  });

  it("shows a filtered-empty state with a way back to the full list", async () => {
    mocks.registrations = [registration("a", "CONFIRMED")];
    const html = await render("cancelled");
    expect(html).toContain("No cancelled registrations");
    expect(html).toContain("None of your 1 registration fit this view.");
    expect(html).toContain('href="/account/registrations"');
    expect(html).not.toContain("Past and cancelled");
  });

  it("filters to cancelled with the history open and the counts in the filter links", async () => {
    mocks.registrations = [registration("a", "CONFIRMED"), registration("c", "CANCELLED", { eventName: "Cancelled Camporee" })];
    const html = await render("cancelled");
    expect(html).toContain("Cancelled Camporee");
    expect(html).not.toContain("Upcoming and active");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("(1)");
    expect(html).toContain("All <span");
  });

  it("says plainly when the list could not load, with a retry, instead of claiming there is nothing", async () => {
    mocks.registrationsFail = true;
    const html = await render();
    expect(html).toContain("We could not load your registrations");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("No registrations match");
  });

  it("handles a long event name and several people without dropping any of them", async () => {
    const long = "Synthetic Conference of Extraordinarily Long Event Names and Gatherings 2099";
    mocks.registrations = [registration("l", "CONFIRMED", { eventName: long, attendeeNames: ["Taylor Lane", "Jordan Lane", "Casey Lane", "Riley Lane"] })];
    const html = await render();
    expect(html).toContain(long);
    expect(html).toContain("4 people registered");
    expect(html).toContain("Taylor Lane, Jordan Lane, Casey Lane, Riley Lane");
  });
});

describe("View link rule against the event hub (#1176)", () => {
  it("only links to the hub for the statuses the hub loads, and pins them to its filter", () => {
    const hub = readFileSync(path.join(process.cwd(), "modules/attendee-accounts/event-hub-repository.ts"), "utf8");
    const filter = hub.match(/status: \{ in: \[([^\]]*)\] \}/);
    expect(filter?.[1]?.split(",").map((value) => value.trim().replaceAll('"', ""))).toEqual([...HUB_REGISTRATION_LIFECYCLES]);
    for (const lifecycle of ["DRAFT", "SUBMITTED", "CONFIRMED", "WAITLISTED", "CANCELLED"] as const) {
      const link = registrationViewLink(registration("x", lifecycle));
      if ((HUB_REGISTRATION_LIFECYCLES as readonly string[]).includes(lifecycle)) expect(link?.href).toBe("/account/events/synthetic-event-x");
      else expect(link?.href ?? "").not.toContain("/account/events/");
    }
  });

  it("sends a waitlisted card to the waitlist page and gives a cancelled card no link", async () => {
    expect(registrationViewLink(registration("w", "WAITLISTED"))).toEqual({ href: "/account/waitlists", label: "View waitlist" });
    expect(registrationViewLink(registration("c", "CANCELLED"))).toBeNull();
    mocks.registrations = [registration("w", "WAITLISTED"), registration("c", "CANCELLED")];
    const html = await render();
    expect(html).toContain('href="/account/waitlists"');
    expect(html).not.toContain("/account/events/synthetic-event-w");
    expect(html).not.toContain("/account/events/synthetic-event-c");
    expect(html).not.toContain("Open it to see its details");
    expect(html).toContain("kept as read-only history");
  });

  it("keeps a cancelled registration's answers viewable inline, read-only", async () => {
    const fields = [{ key: "meal" }] as never;
    expect(registrationActions(registration("c", "CANCELLED", { answerEditing: { enabled: true, reason: "", expectedUpdatedAt: "x", fields, attendees: [] } }), { editable: true, cancellation: null }).details).toBe(true);
    mocks.registrations = [registration("c", "CANCELLED", { answerEditing: { enabled: true, reason: "", expectedUpdatedAt: "x", fields, attendees: [] } })];
    expect(await render()).toContain("Registration details");
  });
});

describe("cancelled card keeps its original charges (#1176)", () => {
  it("shows the original total with what was paid and refunded", () => {
    expect(registrationMoneySummary(registration("c", "CANCELLED", { totalCents: 12000, grossPaidCents: 7000, refundedCents: 2000 })).detail)
      .toBe("Original total $120.00 · $70.00 paid · $20.00 refunded. No payment is due on a cancelled registration.");
  });

  it("shows the original total when nothing was paid", async () => {
    mocks.registrations = [registration("c", "CANCELLED", { totalCents: 8000, grossPaidCents: 0, refundedCents: 0 })];
    const html = await render();
    expect(html).toContain("Original total $80.00 · nothing paid. No payment is due on a cancelled registration.");
    expect(html).toContain("Nothing due now");
  });
});

describe("action disclosure and keyboard access (#1176)", () => {
  it("names the event after each action for screen readers", async () => {
    mocks.registrations = [registration("sub", "SUBMITTED", { eventName: "Family Retreat 2099" })];
    mocks.cancellations = { sub: openRequests };
    const html = await render();
    for (const label of ["Continue payment", "Update contact details", "Request cancellation"]) {
      expect(html).toContain(`${label}<span class="sr-only"> for Family Retreat 2099</span>`);
    }
  });

  it("is a native details with a summary, so Enter and Space work and the state is announced", () => {
    const html = renderToStaticMarkup(createElement(RegistrationActionDisclosure, { label: "Continue payment", hint: "$5.00 remaining" } as never, createElement("p", null, "inside")));
    expect(html).toContain("<details");
    expect(html).toContain("<summary>");
    expect(html).toContain("Continue payment");
    expect(html).toContain("$5.00 remaining");
    // Collapsed: nothing inside is mounted until it is first opened.
    expect(html).not.toContain("inside");
  });

  it("the stylesheet gives the summaries and filter links 44px targets and visible focus", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const block = ownBlock(css);
    expect(block).toMatch(/\.attendee-reg-action > summary, \.attendee-reg-history > summary \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.attendee-reg-filters a \{[^}]*min-height: 44px/);
    expect(block).toMatch(/:focus-visible[^}]*outline: 3px solid/);
  });

  it("puts its CSS right after the Overview block and before the builder blocks, with no hover or small text", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const overview = css.indexOf("/* Attendee account Overview (#1175)");
    const mine = css.indexOf("/* Attendee account My registrations and Profile (#1176)");
    const builder = css.indexOf("/* Registration form builder editor shell (#1132)");
    expect(overview).toBeGreaterThan(0);
    expect(mine).toBeGreaterThan(overview);
    expect(builder).toBeGreaterThan(mine);
    const block = ownBlock(css);
    expect(block).not.toContain(":hover");
    expect(block).not.toMatch(/font-size:\s*0\.[0-7]\d*rem/);
  });
});

function ownBlock(css: string) {
  const start = css.indexOf("/* Attendee account My registrations and Profile (#1176)");
  return css.slice(start, css.indexOf("/* Registration form builder editor shell (#1132)"));
}

describe("Profile verified-email meaning (#1176)", () => {
  const data = {
    staff: null,
    attendeeAccount: { id: "att-1", verifiedEmail: "taylor@imsda-events.test" },
    secondStepPending: false,
    mfaStatus: null,
    passkeySettings: null,
    clubs: [],
    bannerAnnouncements: [],
    showTwoStepOn: false,
    sessionId: "a1",
  } as never;

  it("explains the verified email by what the code does, and no more", () => {
    const html = renderToStaticMarkup(createElement(VerifiedEmailExplainer, { email: "taylor@imsda-events.test" }));
    expect(html).toContain("What your verified email means");
    expect(html).toContain("taylor@imsda-events.test");
    expect(html).toContain("never on a name");
    expect(html).toContain("does not by itself give staff, club or admin access");
    expect(html).toContain("never changes a registration you already submitted");
    expect(html).toContain("details on an upcoming registration are updated from My registrations");
    expect(html).toContain('href="#profile-security"');
    expect(html).toContain('href="/account/registrations"');
  });

  it("shows the explanation and keeps the security entry point on the portal profile", () => {
    const html = renderToStaticMarkup(createElement(ProfileView, { data, variant: "portal" }));
    expect(html).toContain("What your verified email means");
    expect(html).toContain("Sign-in security on this page");
    expect(html).toContain('href="/account/registrations"');
  });

  it("shows nothing about the email while the second step is pending", () => {
    const html = renderToStaticMarkup(createElement(ProfileView, { data: { ...(data as object), secondStepPending: true } as never, variant: "portal" }));
    expect(html).not.toContain("What your verified email means");
  });

  it("gives the settings' security section the anchor the link points to", () => {
    expect(readFileSync(path.join(process.cwd(), "components/attendee-account-settings.tsx"), "utf8")).toContain('id="profile-security"');
  });

  it("a profile save writes only the account's own row, never a submitted registration", () => {
    const service = readFileSync(path.join(process.cwd(), "modules/attendee-accounts/profile-service.ts"), "utf8");
    expect(service).not.toMatch(/tx\.registration|prisma\.registration|\.registration\.(update|updateMany|upsert)|registrationAttendee/);
    expect(service).toContain("tx.attendeeAccount.update");
  });
});

describe("wording and compatibility (#1176)", () => {
  const files = [
    "app/(public)/account/(portal)/registrations/page.tsx",
    "components/verified-email-explainer.tsx",
    "components/registration-action-disclosure.tsx",
    "modules/attendee-accounts/registration-history.ts",
  ];

  it("does not use the forbidden phrase in the new files or their styles", () => {
    for (const file of files) expect(readFileSync(path.join(process.cwd(), file), "utf8").toLowerCase()).not.toContain("background check");
    expect(ownBlock(readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8")).toLowerCase()).not.toContain("background check");
  });

  it("leaves the account-free private management page alone", () => {
    const manage = readFileSync(path.join(process.cwd(), "app/(public)/manage/[token]/page.tsx"), "utf8");
    expect(manage).not.toContain("registration-history");
    expect(manage).not.toContain("registration-action-disclosure");
  });

  it("sends a cancellation request through the existing attendee endpoint, unchanged", () => {
    const page = readFileSync(path.join(process.cwd(), files[0]), "utf8");
    expect(page).toContain("/api/attendee/registrations/${encodeURIComponent(registration.id)}/cancellation");
    expect(page).toContain("manageEndpoint={`/api/attendee/registrations/${encodeURIComponent(registration.id)}`}");
  });
});
