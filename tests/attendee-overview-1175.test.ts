import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** #1175: the attendee Overview (header tabs, registration cards, account and help column). Synthetic data only. */
const mocks = vi.hoisted(() => ({
  navItems: [] as Array<{ href: string; label: string }>,
  staffUser: null as null | { globalRole: string },
  clubs: [] as Array<{ organizationId: string; name: string; role: string }>,
  areaCoordinator: false,
  registrations: [] as unknown[],
  registrationsFail: false,
  mfaActive: false,
  acting: null as null | { role: string },
  secondStep: "OK",
  invites: [] as unknown[],
  instructorInvites: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@/components/account-section-nav", () => ({
  AccountSectionNav: (props: { items: Array<{ href: string; label: string }> }) => {
    mocks.navItems = props.items;
    return createElement("nav", null, props.items.map((item) => item.label).join("|"));
  },
}));
vi.mock("@/components/act-as-banner", () => ({ ActAsBanner: () => null }));
vi.mock("@/components/account-announcement-banner", () => ({ AccountAnnouncementBanner: () => null }));
vi.mock("@/modules/communications/account-banner", () => ({ listAccountBannerAnnouncements: async () => [] }));
vi.mock("@/components/attendee-sign-in-form", () => ({ AttendeeAuthReturn: () => null }));
vi.mock("@/components/attendee-sign-out-button", () => ({ AttendeeSignOutButton: () => createElement("button", null, "Sign out") }));
vi.mock("@/modules/access/current-session", () => ({ getCurrentSession: async () => ({ user: mocks.staffUser }) }));
vi.mock("@/modules/attendee-accounts/current-attendee", () => ({
  getCurrentAttendee: async () => ({
    account: { id: "att-1", verifiedEmail: "taylor@imsda-events.test", displayName: "Taylor Lane" },
    via: "attendee",
    sessionId: "a1",
  }),
}));
vi.mock("@/modules/attendee-accounts/sign-in-gate", () => ({ accountNeedsSecondStep: async () => mocks.secondStep }));
vi.mock("@/modules/attendee-accounts/portal-second-step", () => ({ requireAttendeeSecondStep: async () => undefined }));
vi.mock("@/modules/attendee-accounts/mfa-service", () => ({
  getAttendeeMfaStatus: async () => ({ status: mocks.mfaActive ? "ACTIVE" : "NONE" }),
}));
vi.mock("@/modules/attendee-accounts/registrations-repository", () => ({
  listRegistrationsForVerifiedEmail: async () => {
    if (mocks.registrationsFail) throw new Error("synthetic load failure");
    return mocks.registrations;
  },
}));
vi.mock("@/modules/club-imports/invites", () => ({ listInvitesForAccount: async () => mocks.invites }));
vi.mock("@/modules/honors/instructor-repository", () => ({
  accountIsInstructor: async () => false,
  listInstructorInvitesForAccount: async () => mocks.instructorInvites,
}));
vi.mock("@/modules/organizations/area-coordinators", () => ({
  isAreaCoordinator: async () => mocks.areaCoordinator,
  currentAreaCoordinator: async () => null,
}));
vi.mock("@/modules/organizations/director-access", () => ({ listDirectedClubs: async () => mocks.clubs }));
vi.mock("@/modules/organizations/staff-act-as", () => ({ currentStaffActingContext: async () => mocks.acting }));
vi.mock("@/components/area-coordinator-card", () => ({
  AreaCoordinatorCardSection: () => null,
  AreaCoordinatorCardSkeleton: () => null,
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import AccountPortalLayout from "@/app/(public)/account/(portal)/layout";
import AttendeeAccountOverviewPage from "@/app/(public)/account/(portal)/page";
import { AccountRegistrationCard, type AccountRegistrationCardData } from "@/components/account-registration-card";
import { eventCardDates, registrationMoneySummary, registrationStateLabel } from "@/modules/attendee-accounts/registration-card";

type Lifecycle = AccountRegistrationCardData["lifecycle"];

const STATUS: Record<Lifecycle, AccountRegistrationCardData["status"]> = {
  DRAFT: { label: "Not submitted", detail: "", tone: "neutral" },
  SUBMITTED: { label: "Submitted", detail: "", tone: "neutral" },
  CONFIRMED: { label: "Confirmed", detail: "", tone: "positive" },
  WAITLISTED: { label: "Waitlisted", detail: "", tone: "waiting" },
  CANCELLED: { label: "Cancelled", detail: "", tone: "cancelled" },
};

function registration(
  id: string,
  lifecycle: Lifecycle,
  overrides: Partial<AccountRegistrationCardData> & { eventName?: string; startsAt?: string; endsAt?: string } = {},
): AccountRegistrationCardData {
  const { eventName, startsAt, endsAt, ...rest } = overrides;
  const payable = lifecycle === "SUBMITTED" || lifecycle === "CONFIRMED";
  return {
    id,
    confirmationCode: `SYN-${id.toUpperCase()}`,
    lifecycle,
    status: STATUS[lifecycle],
    event: {
      name: eventName ?? `Synthetic Event ${id}`,
      slug: `synthetic-event-${id}`,
      startsAt: startsAt ?? "2027-04-23T15:00:00.000Z",
      endsAt: endsAt ?? "2027-04-25T15:00:00.000Z",
      timezone: "America/Chicago",
      location: "Synthetic Campground",
      attendeeEditPolicy: "TIERED",
      isDeferredOrganizationBilling: false,
    },
    attendeeNames: ["Taylor Lane", "Jordan Lane"],
    totalCents: 8000,
    paidCents: payable ? 4000 : 0,
    grossPaidCents: payable ? 4000 : 0,
    refundedCents: 0,
    balanceCents: payable ? 4000 : 0,
    payment: {
      state: payable ? "PARTIALLY_PAID" : "NOT_DUE",
      label: payable ? "Partially paid" : "No payment due",
      detail: "",
      paymentEligible: payable,
    },
    churchBilling: null,
    groupBilling: null,
    ...rest,
  };
}

const clubInvite = (id: string) => ({ id, role: "DIRECTOR", clubId: `club-${id}`, clubName: `Synthetic Club ${id}` });
const instructorInvite = (id: string) => ({ id, eventName: `Synthetic Honors ${id}`, classNames: ["Synthetic Class"] });

const renderCard = (value: AccountRegistrationCardData, primary = true) =>
  renderToStaticMarkup(createElement("ul", null, createElement(AccountRegistrationCard, { registration: value, primary })));

beforeEach(() => {
  mocks.navItems = [];
  mocks.staffUser = null;
  mocks.clubs = [];
  mocks.areaCoordinator = false;
  mocks.registrations = [];
  mocks.registrationsFail = false;
  mocks.mfaActive = false;
  mocks.acting = null;
  mocks.secondStep = "OK";
  mocks.invites = [];
  mocks.instructorInvites = [];
});

describe("registration state wording (#1175)", () => {
  it("reads a submitted registration as Registration received, never confirmed", () => {
    const label = registrationStateLabel(registration("a", "SUBMITTED"));
    expect(label).toBe("Registration received");
    expect(label).not.toMatch(/confirmed/i);
  });

  it("keeps the shared wording for the other states", () => {
    expect(registrationStateLabel(registration("a", "CONFIRMED"))).toBe("Confirmed");
    expect(registrationStateLabel(registration("a", "WAITLISTED"))).toBe("Waitlisted");
    expect(registrationStateLabel(registration("a", "CANCELLED"))).toBe("Cancelled");
  });
});

describe("registration money summary (#1175)", () => {
  it("shows the remaining balance of an attendee-pay submitted registration", () => {
    expect(registrationMoneySummary(registration("a", "SUBMITTED"))).toEqual({
      headline: "$40.00 remaining",
      detail: "$40.00 paid toward your $80.00 registration.",
      tone: "due",
    });
  });

  it("reads a fully paid confirmed registration as paid in full", () => {
    const paid = registration("a", "CONFIRMED", {
      paidCents: 8000, grossPaidCents: 8000, balanceCents: 0,
      payment: { state: "PAID", label: "Paid in full", detail: "", paymentEligible: false },
    });
    expect(registrationMoneySummary(paid)).toMatchObject({ headline: "Paid in full", tone: "calm" });
  });

  it("owes nothing while waitlisted, whatever the quoted total", () => {
    const summary = registrationMoneySummary(registration("a", "WAITLISTED", { totalCents: 25000 }));
    expect(summary.tone).toBe("calm");
    expect(summary.headline).toBe("No payment due while waitlisted");
    expect(`${summary.headline} ${summary.detail}`).not.toContain("$250");
  });

  it("says nothing is due now on a cancelled registration and keeps the refund history", () => {
    const cancelled = registration("a", "CANCELLED", { totalCents: 10000, grossPaidCents: 10000, refundedCents: 10000, balanceCents: 0 });
    expect(registrationMoneySummary(cancelled)).toEqual({
      headline: "Nothing due now",
      detail: "Original total $100.00 · $100.00 paid · $100.00 refunded. No payment is due on a cancelled registration.",
      tone: "calm",
    });
    expect(registrationMoneySummary(registration("b", "CANCELLED")).detail).toBe("Original total $80.00 · nothing paid. No payment is due on a cancelled registration.");
  });

  it("never makes the signed-in person the debtor for a church-billed registration", () => {
    const billed = registration("a", "SUBMITTED", {
      totalCents: null, paidCents: null, grossPaidCents: null, refundedCents: null, balanceCents: 0,
      churchBilling: { billed: true, perPerson: {} as never, label: "billed to your church after the event, not paid online" },
      payment: { state: "ORGANIZATION_BILLED", label: "Billed to your organization", detail: "", paymentEligible: false },
    });
    const summary = registrationMoneySummary(billed);
    expect(summary).toMatchObject({ headline: "Billed to your church", tone: "calm" });
    expect(`${summary.headline} ${summary.detail}`).not.toMatch(/remaining|\$/);
    const html = renderCard(billed);
    expect(html).not.toMatch(/remaining/);
  });

  it("states a group registration's estimate as billed later, not as money due now", () => {
    const group = registration("a", "CONFIRMED", {
      balanceCents: 0,
      payment: { state: "GROUP_BILLED", label: "Billed after the event", detail: "", paymentEligible: false },
      groupBilling: { billed: true, estimateCents: 30000, notice: "You'll be billed after the event.", label: "" },
    });
    expect(registrationMoneySummary(group)).toMatchObject({ headline: "Estimated total $300.00", tone: "calm" });
  });
});

describe("registration card (#1175)", () => {
  it("shows the event, dates, location, code, people, state and View registration into the existing hub", () => {
    const html = renderCard(registration("fr1", "SUBMITTED", { eventName: "Family Retreat 2027" }));
    expect(html).toContain("Family Retreat 2027");
    expect(html).toContain("April 23, 2027 – April 25, 2027");
    expect(html).toContain("Synthetic Campground");
    expect(html).toContain("#SYN-FR1");
    expect(html).toContain("2 people registered");
    expect(html).toContain("Registration received");
    expect(html).toContain("$40.00 remaining");
    expect(html).toContain('href="/account/events/synthetic-event-fr1"');
    expect(html).toContain("View registration");
  });

  it("fills the button only for the primary card", () => {
    expect(renderCard(registration("a", "CONFIRMED"), true)).toContain("primary-button");
    const secondary = renderCard(registration("a", "CONFIRMED"), false);
    expect(secondary).toContain("secondary-button");
    expect(secondary).not.toContain("primary-button");
  });

  it("offers no payment action for a waitlisted card and no amount due", () => {
    const html = renderCard(registration("w", "WAITLISTED", { totalCents: 25000, balanceCents: 0 }));
    expect(html).toContain("Waitlisted");
    expect(html).toContain("No payment due while waitlisted");
    expect(html).not.toMatch(/continue payment|remaining/i);
    expect(html).not.toContain("$250");
  });

  it("renders a cancelled card with nothing due and a past one as an ordinary read-only card", () => {
    const cancelled = renderCard(registration("c", "CANCELLED", { grossPaidCents: 5000, refundedCents: 5000 }));
    expect(cancelled).toContain("Nothing due now");
    expect(cancelled).not.toMatch(/continue payment|remaining/i);
    const past = renderCard(registration("p", "CONFIRMED", {
      startsAt: "2026-01-10T15:00:00.000Z", endsAt: "2026-01-11T15:00:00.000Z", balanceCents: 0, paidCents: 8000, grossPaidCents: 8000,
      payment: { state: "PAID", label: "Paid in full", detail: "", paymentEligible: false },
    }));
    expect(past).toContain("Paid in full");
    expect(past).toContain("January 10, 2026");
  });

  it("handles a long event name and a single person without clipping markup", () => {
    const long = "A".repeat(10) + " Synthetic Conference of Extraordinarily Long Event Names and Gatherings 2027";
    const html = renderCard(registration("l", "CONFIRMED", { eventName: long, attendeeNames: ["Taylor Lane"] }));
    expect(html).toContain(long);
    expect(html).toContain("1 person registered");
  });

  it("builds the date tile in the event's own time zone", () => {
    expect(eventCardDates({ startsAt: "2027-04-24T02:00:00.000Z", endsAt: "2027-04-24T04:00:00.000Z", timezone: "America/Chicago" }))
      .toEqual({ month: "Apr", day: "23", range: "April 23, 2027" });
  });
});

describe("account header and tabs (#1175)", () => {
  it("gives an ordinary attendee exactly Overview, My registrations, Profile and Help (#1259), with identity and sign-out", async () => {
    const html = renderToStaticMarkup(await AccountPortalLayout({ children: null }));
    expect(mocks.navItems.map((item) => item.label)).toEqual(["Overview", "My registrations", "Profile", "Help"]);
    expect(html).toContain("Taylor Lane");
    expect(html).toContain("Sign out");
    expect(html).not.toMatch(/Staff workspace|System management|My clubs?|Waitlists|\/admin|\/overview/);
  });

  it("adds only the existing workspace tab a real grant provides, after the attendee tabs", async () => {
    mocks.clubs = [{ organizationId: "club-1", name: "Synthetic Club", role: "DIRECTOR" }];
    renderToStaticMarkup(await AccountPortalLayout({ children: null }));
    expect(mocks.navItems.map((item) => item.label)).toEqual(["Overview", "My registrations", "Profile", "My club", "Help"]);
  });

  it("shows no attendee name while a staff member is acting as a club role, even with an attendee cookie present", async () => {
    mocks.acting = { role: "CLUB_DIRECTOR" };
    const html = renderToStaticMarkup(await AccountPortalLayout({ children: null }));
    expect(html).not.toContain("Taylor Lane");
    expect(html).not.toContain("account-header-identity");
  });

  it("shows no attendee name while a second step is still pending", async () => {
    mocks.secondStep = "REQUIRED";
    mocks.acting = { role: "CLUB_DIRECTOR" };
    const html = renderToStaticMarkup(await AccountPortalLayout({ children: null }));
    expect(html).not.toContain("Taylor Lane");
    expect(mocks.navItems.map((item) => item.label)).not.toContain("Overview");
  });

  it("shows the staff link only when the browser has a live staff session (today's rule)", async () => {
    mocks.staffUser = { globalRole: "EVENT_ADMIN" };
    const html = renderToStaticMarkup(await AccountPortalLayout({ children: null }));
    expect(html).toContain("Staff workspace");
    expect(html).not.toContain("System management");
  });
});

describe("Overview page (#1175)", () => {
  const render = async () => renderToStaticMarkup(await AttendeeAccountOverviewPage());

  it("leads with the greeting and upcoming cards, then the account and help column", async () => {
    mocks.registrations = [
      registration("later", "CONFIRMED", { eventName: "Later Event", startsAt: "2027-08-01T15:00:00.000Z", endsAt: "2027-08-02T15:00:00.000Z" }),
      registration("soon", "SUBMITTED", { eventName: "Soon Event", startsAt: "2027-02-01T15:00:00.000Z", endsAt: "2027-02-02T15:00:00.000Z" }),
    ];
    const html = await render();
    expect(html).toContain("Hello, <span translate=\"no\">Taylor Lane</span>");
    expect(html.indexOf("Soon Event")).toBeGreaterThan(-1);
    expect(html.indexOf("Soon Event")).toBeLessThan(html.indexOf("Later Event"));
    expect(html.indexOf("Later Event")).toBeLessThan(html.indexOf("Your registration account"));
    expect(html.match(/primary-button/g)).toHaveLength(1);
    expect(html.replace(/<[^>]*>/g, "")).toContain("taylor@imsda-events.test");
    expect(html).not.toMatch(/Staff workspace|\/admin|Your other roles/);
  });

  it("keeps waitlisted upcoming, drops cancelled and past from the cards, and links the full list", async () => {
    mocks.registrations = [
      registration("cancelled", "CANCELLED", { eventName: "Cancelled Early", startsAt: "2027-01-05T15:00:00.000Z", endsAt: "2027-01-06T15:00:00.000Z" }),
      registration("past", "CONFIRMED", {
        eventName: "Past Event", startsAt: "2026-01-05T15:00:00.000Z", endsAt: "2026-01-06T15:00:00.000Z",
        balanceCents: 0, paidCents: 8000, grossPaidCents: 8000, payment: { state: "PAID", label: "Paid in full", detail: "", paymentEligible: false },
      }),
      registration("wait", "WAITLISTED", { eventName: "Waitlisted Event" }),
    ];
    const html = await render();
    expect(html).toContain("Waitlisted Event");
    expect(html).toContain("No payment due while waitlisted");
    expect(html).not.toContain("Cancelled Early");
    expect(html).not.toContain("Past Event");
    expect(html).toContain("All my registrations (3), including past and cancelled");
    expect(html).not.toMatch(/still due|Continue payment/);
  });

  it("shows a calm no-registrations state with ways to find events or get help", async () => {
    const html = await render();
    expect(html).toContain("No registrations yet");
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/recover-registration"');
    expect(html).toContain("Find my registration");
  });

  it("says nothing is coming up when only past or cancelled registrations exist", async () => {
    mocks.registrations = [registration("c", "CANCELLED")];
    const html = await render();
    expect(html).toContain("Nothing coming up");
    expect(html).toContain("All my registrations");
  });

  it("shows an understandable load error with a retry instead of an empty state", async () => {
    mocks.registrationsFail = true;
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("We could not load your registrations");
    expect(html).toContain('href="/account"');
    expect(html).not.toContain("No registrations yet");
  });

  it("keeps the amount due visible with no cards, and links it when it counts a past registration", async () => {
    mocks.registrations = [
      registration("ended", "CONFIRMED", { eventName: "Ended Owed Event", startsAt: "2026-01-05T15:00:00.000Z", endsAt: "2026-01-06T15:00:00.000Z" }),
    ];
    const html = await render();
    expect(html).toContain("Nothing coming up");
    expect(html).toContain("$40.00");
    expect(html).toContain("still due for Ended Owed Event (a past registration)");
    expect(html).toContain('href="/account/registrations"');
  });

  it("words the due line as including past registrations when an ended one is owed beside an upcoming card", async () => {
    mocks.registrations = [
      registration("ended", "CONFIRMED", { eventName: "Ended Owed Event", startsAt: "2026-01-05T15:00:00.000Z", endsAt: "2026-01-06T15:00:00.000Z" }),
      registration("next", "CONFIRMED", { eventName: "Upcoming Event" }),
    ];
    const html = await render();
    expect(html).toContain("$80.00");
    expect(html).toContain("across 2 registrations, including past registrations");
    expect(html).toContain("See my registrations");
  });

  it("states the due line plainly when every registration it counts has a card", async () => {
    mocks.registrations = [registration("next", "CONFIRMED", { eventName: "Upcoming Event" })];
    const html = await render();
    expect(html).toContain("still due for Upcoming Event");
    expect(html).not.toContain("including past registrations");
  });

  it("keeps exactly one filled primary: an invite's Accept takes it from the first card", async () => {
    mocks.invites = [clubInvite("inv-1")];
    mocks.registrations = [registration("a", "CONFIRMED")];
    const html = await render();
    expect(html.match(/primary-button/g)).toHaveLength(1);
    expect(html).toContain("Accept");
    expect(html).toMatch(/secondary-button attendee-ov-action/);
  });

  it("fills only the first invite's Accept when there are several, and none of the instructor invites after a club invite", async () => {
    mocks.invites = [clubInvite("one"), clubInvite("two")];
    mocks.instructorInvites = [instructorInvite("teach")];
    mocks.registrations = [registration("a", "CONFIRMED")];
    const html = await render();
    expect(html.match(/primary-button/g)).toHaveLength(1);
    expect(html.match(/<button class="secondary-button"/g)).toHaveLength(2);
    mocks.invites = [];
    mocks.instructorInvites = [instructorInvite("a"), instructorInvite("b")];
    const instructorOnly = await render();
    expect(instructorOnly.match(/primary-button/g)).toHaveLength(1);
  });

  it("makes the retry link the one filled primary when registrations fail for a non-director", async () => {
    mocks.registrationsFail = true;
    const html = await render();
    expect(html).toMatch(/class="primary-button attendee-ov-retry"/);
    expect(html.match(/primary-button/g)).toHaveLength(1);
    mocks.invites = [clubInvite("one")];
    const withInvite = await render();
    expect(withInvite).toMatch(/class="secondary-button attendee-ov-retry"/);
    expect(withInvite.match(/primary-button/g)).toHaveLength(1);
  });

  it("names a lone owed registration without a card as a past registration, and keeps 'including' for mixed totals", async () => {
    mocks.registrations = [
      registration("ended", "CONFIRMED", { eventName: "Ended Owed Event", startsAt: "2026-01-05T15:00:00.000Z", endsAt: "2026-01-06T15:00:00.000Z" }),
    ];
    let html = await render();
    expect(html).toContain("still due for Ended Owed Event (a past registration).");
    expect(html).not.toContain("including past registrations");
    mocks.registrations = [
      registration("ended", "CONFIRMED", { eventName: "Ended Owed Event", startsAt: "2026-01-05T15:00:00.000Z", endsAt: "2026-01-06T15:00:00.000Z" }),
      registration("next", "CONFIRMED", { eventName: "Upcoming Event" }),
    ];
    html = await render();
    expect(html).toContain("including past registrations");
    expect(html).not.toContain("(a past registration)");
  });

  it("renders the Overview page with a staff act-as context active, with no attendee name in the header and one primary", async () => {
    mocks.acting = { role: "CLUB_DIRECTOR" };
    mocks.registrations = [registration("a", "CONFIRMED")];
    const layout = renderToStaticMarkup(await AccountPortalLayout({ children: null }));
    expect(layout).not.toContain("Taylor Lane");
    const html = await render();
    expect(html).toContain("Coming up for you");
    expect(html.match(/primary-button/g)).toHaveLength(1);
  });

  it("makes Find events the one filled primary in the empty state, and not while an invite is showing", async () => {
    let html = await render();
    expect(html.match(/primary-button/g)).toHaveLength(1);
    expect(html).toMatch(/class="primary-button"[^>]*href="\/events"/);
    mocks.invites = [clubInvite("inv-1")];
    html = await render();
    expect(html.match(/primary-button/g)).toHaveLength(1);
    expect(html).toMatch(/class="secondary-button"[^>]*href="\/events"/);
  });

  it("keeps the authenticator label for a director without one, filling it only when nothing else is primary", async () => {
    mocks.clubs = [{ organizationId: "club-1", name: "Synthetic Club", role: "DIRECTOR" }];
    mocks.registrations = [registration("a", "CONFIRMED")];
    let html = await render();
    expect(html).toContain("Set up an authenticator");
    expect(html.match(/primary-button/g)).toHaveLength(1);
    mocks.registrationsFail = true;
    html = await render();
    expect(html).toContain("Set up an authenticator");
    expect(html.match(/primary-button/g)).toHaveLength(1);
    expect(html).toMatch(/class="primary-button account-overview-link"/);
  });

  it("shows the email in a paragraph with break points before the at sign and dots", async () => {
    const html = await render();
    expect(html).toMatch(/<p class="attendee-ov-email"[^>]*>taylor<span><wbr\/>@imsda-events<\/span><span><wbr\/>\.test<\/span><\/p>/);
    expect(html).not.toMatch(/<h2[^>]*>taylor@/);
  });

  it("shows a club link only for a real director grant, never as a second filled primary", async () => {
    mocks.clubs = [{ organizationId: "club-1", name: "Synthetic Club", role: "DIRECTOR" }];
    mocks.registrations = [registration("a", "CONFIRMED")];
    const html = await render();
    expect(html).toContain("Your other roles");
    expect(html).toContain('href="/account/clubs/club-1"');
    expect(html.match(/primary-button/g)).toHaveLength(1);
  });
});
