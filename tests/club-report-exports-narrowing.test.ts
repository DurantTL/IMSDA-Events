import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindUnique: vi.fn(),
  locationFindMany: vi.fn(),
  registrationFindFirst: vi.fn(),
  grantFindFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    event: { findUnique: mocks.eventFindUnique },
    eventLocation: { findMany: mocks.locationFindMany },
    clubEventRegistration: { findFirst: mocks.registrationFindFirst },
    clubsAdministratorGrant: { findFirst: mocks.grantFindFirst },
  }),
}));
vi.mock("@/modules/club-teams/settings-repository", () => ({ getTeamSettings: vi.fn().mockResolvedValue({}) }));
vi.mock("@/modules/registrations/amendments-repository", () => ({ currentRegistrationAnswers: vi.fn().mockResolvedValue({ responses: {} }) }));
vi.mock("@/modules/club-teams/team-form", () => ({ buildTeamForm: () => ({}) }));

import { ClubReportsConference } from "@/components/club-reports-conference";
import { loadFilledTeamForm } from "@/modules/club-teams/team-form-repository";
import { narrowCheckInBookStatuses } from "@/modules/reporting/check-in-book";
import { limitedToRegisteredClubs } from "@/modules/reporting/club-reports-access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eventFindUnique.mockResolvedValue({ name: "Camporee", startsAt: new Date("2026-06-01T12:00:00Z"), timezone: "America/Chicago", registrationClosesOn: null, isPublished: true, audience: "CLUB" });
  mocks.locationFindMany.mockResolvedValue([]);
});

describe("team form for a waitlisted team", () => {
  const row = (status: string) => ({
    teamName: "A", registrationId: "r1", createdAt: new Date("2026-01-01T00:00:00Z"),
    organization: { name: "Club", parentOrganization: null },
    registration: { confirmationCode: "X", status, location: null, attendees: [] },
  });
  const which = { eventId: "event-1", clubEventRegistrationId: "cer-1" };

  it("opens for staff with full report access", async () => {
    mocks.registrationFindFirst.mockResolvedValue(row("WAITLISTED"));
    await expect(loadFilledTeamForm(which)).resolves.not.toBeNull();
  });

  it("does not open for a viewer limited to registered clubs, but opens a confirmed team", async () => {
    mocks.registrationFindFirst.mockResolvedValue(row("WAITLISTED"));
    await expect(loadFilledTeamForm(which, { registeredOnly: true })).resolves.toBeNull();
    mocks.registrationFindFirst.mockResolvedValue(row("CONFIRMED"));
    await expect(loadFilledTeamForm(which, { registeredOnly: true })).resolves.not.toBeNull();
  });
});

describe("check-in book statuses for a limited viewer", () => {
  it("keeps only the chosen statuses that are submitted or confirmed", () => {
    expect(narrowCheckInBookStatuses(["CONFIRMED", "WAITLISTED", "CANCELLED"], true)).toEqual(["CONFIRMED"]);
  });
  it("falls back to both when none remain", () => {
    expect(narrowCheckInBookStatuses(["WAITLISTED", "CANCELLED"], true)).toEqual(["SUBMITTED", "CONFIRMED"]);
  });
  it("leaves everyone else's choice alone", () => {
    expect(narrowCheckInBookStatuses(["CONFIRMED", "WAITLISTED"], false)).toEqual(["CONFIRMED", "WAITLISTED"]);
  });
});

describe("a Clubs Administrator who is also a real event administrator", () => {
  it("is not narrowed (the grant is read directly)", async () => {
    mocks.grantFindFirst.mockResolvedValue({ id: "g1" });
    await expect(limitedToRegisteredClubs({ id: "u1", globalRole: "STAFF" }, { role: "EVENT_ADMIN" }, "event-1")).resolves.toBe(false);
  });
  it("is narrowed without a grant", async () => {
    mocks.grantFindFirst.mockResolvedValue(null);
    await expect(limitedToRegisteredClubs({ id: "u1", globalRole: "STAFF" }, { role: "EVENT_ADMIN" }, "event-1")).resolves.toBe(true);
  });
});

describe("club count wording", () => {
  const club = (id: string) => ({ id, name: id, church: "", registrationOnTime: false, eventPoints: 0, joinedOn: null, reports: {} });
  const render = (count: number, registeredOnly: boolean) =>
    renderToStaticMarkup(createElement(ClubReportsConference, { clubYear: "2026-27", initialClubs: Array.from({ length: count }, (_, i) => club(`c${i}`)) as never, now: "2026-10-01", registeredOnly } as never));

  it("says registered clubs, singular for one", () => {
    expect(render(1, true)).toContain("1 registered club ·");
    expect(render(2, true)).toContain("2 registered clubs ·");
    expect(render(1, false)).toContain("1 active club ·");
  });
});
