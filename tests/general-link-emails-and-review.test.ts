import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  attachedDirectorEmail,
  EMAIL_TEAM_NAME_MAX,
  GENERAL_LINK_RECEIVED_MESSAGE,
  GENERAL_LINK_TOO_MANY_MESSAGE,
  matchedConfirmationNote,
  pendingDirectorEmail,
  pendingRetentionCutoff,
  PENDING_RETENTION_DAYS,
  PENDING_SUBMISSIONS_PER_HOUR,
  rejectedDirectorEmail,
  staffDigestWindow,
  staffPendingDigestNotice,
  STAFF_DIGEST_WINDOW_MS,
  teamNameForEmail,
} from "@/modules/general-link-registrations/domain";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { PendingTeamsReview } from "@/components/pending-teams-review";

describe("the words that reach the person who submitted", () => {
  it("cuts a team name at 60 characters in every email that names it, and carries nothing else they typed", () => {
    const long = `${"A".repeat(120)} <b>typed</b>`;
    expect(teamNameForEmail(long).length).toBeLessThanOrEqual(EMAIL_TEAM_NAME_MAX);
    expect(teamNameForEmail("  Bible   Bees ")).toBe("Bible Bees");
    const pending = pendingDirectorEmail({ eventName: "Synthetic Event", teamName: long, confirmationCode: "PBE-ABC" });
    expect(pending.bodyText).not.toContain("A".repeat(61));
    expect(pending.bodyText).not.toContain("typed");
    expect(pending.bodyText).toContain("PBE-ABC");
    const rejected = rejectedDirectorEmail({ eventName: "Synthetic Event", teamName: long, confirmationCode: "PBE-ABC", reason: "Not a conference club." });
    expect(rejected.bodyText).not.toContain("A".repeat(61));
    expect(attachedDirectorEmail({ eventName: "Synthetic Event", teamName: long, clubName: "Synthetic Club", confirmationCode: "PBE-ABC" }).bodyText).not.toContain("A".repeat(61));
  });

  it("tells a waiting submitter one thing: it waits for staff, and nothing about a director match", () => {
    const { subject, bodyText } = pendingDirectorEmail({ eventName: "Synthetic Event", teamName: "Bible Bees", confirmationCode: "PBE-ABC" });
    expect(subject).toContain("We have your team registration");
    expect(bodyText).toMatch(/event team will confirm which club/);
    expect(bodyText).not.toMatch(/match this email|director or deputy/);
  });

  it("puts the club on the first line of the matched director's one confirmation", () => {
    expect(matchedConfirmationNote({ teamName: "Bible Bees", clubName: "Synthetic Club", confirmationCode: "PBE-ABC" }))
      .toBe('Your team "Bible Bees" is attached to Synthetic Club. Reference: PBE-ABC.');
  });

  it("says waitlisted, never attached, when a confirmed team landed on the waitlist", () => {
    const waitlisted = attachedDirectorEmail({ eventName: "Synthetic Event", teamName: "Bible Bees", clubName: "Synthetic Club", confirmationCode: "PBE-ABC", waitlisted: true });
    expect(waitlisted.subject).toMatch(/waitlist/i);
    expect(`${waitlisted.subject} ${waitlisted.bodyText}`).not.toMatch(/is attached to/i);
    expect(waitlisted.bodyText).toMatch(/not a confirmed registration/);
    const attached = attachedDirectorEmail({ eventName: "Synthetic Event", teamName: "Bible Bees", clubName: "Synthetic Club", confirmationCode: "PBE-ABC" });
    expect(attached.subject).toBe("Your team is attached to Synthetic Club");
  });

  it("answers every accepted submission with the same words, naming no club", () => {
    expect(GENERAL_LINK_RECEIVED_MESSAGE).not.toMatch(/attached|director|deputy|match/i);
    expect(GENERAL_LINK_TOO_MANY_MESSAGE).toBe("Too many registrations right now; please try again later.");
  });
});

describe("the staff digest and the limits", () => {
  it("sends staff the count and the review link, never a submitter's words", () => {
    const one = staffPendingDigestNotice({ eventName: "Synthetic Event", waitingCount: 1, reviewUrl: "https://events.imsda.test/people/pending-teams?event=e1" });
    const many = staffPendingDigestNotice({ eventName: "Synthetic Event", waitingCount: 7, reviewUrl: "https://events.imsda.test/people/pending-teams?event=e1" });
    expect(one.bodyText).toContain("1 team is waiting");
    expect(many.bodyText).toContain("7 teams are waiting");
    expect(many.bodyText).toContain("https://events.imsda.test/people/pending-teams?event=e1");
    expect(many.bodyText).toMatch(/at most one of these emails every 15 minutes/);
  });

  it("puts moments in the same fixed 15-minute window or the next", () => {
    expect(STAFF_DIGEST_WINDOW_MS).toBe(15 * 60 * 1000);
    const start = new Date("2026-10-20T15:00:00Z");
    expect(staffDigestWindow(new Date(start.getTime() + 14 * 60 * 1000))).toBe(staffDigestWindow(start));
    expect(staffDigestWindow(new Date(start.getTime() + 15 * 60 * 1000))).toBe(staffDigestWindow(start) + 1);
  });

  it("caps waiting teams at 60 an hour and keeps their answers 30 days after the event", () => {
    expect(PENDING_SUBMISSIONS_PER_HOUR).toBe(60);
    expect(PENDING_RETENTION_DAYS).toBe(30);
    expect(pendingRetentionCutoff(new Date("2026-11-30T00:00:00Z")).toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
});

describe("the review page's team card", () => {
  const team = {
    id: "sub-1",
    confirmationCode: "PBE-ABC",
    createdAt: "2026-10-20T15:00:00.000Z",
    teamName: "Bible Bees",
    clubNameAsEntered: "Synthetic Club",
    suggestedClub: { id: "club-1", name: "Synthetic Club" },
    directorName: "Synthetic Director",
    directorEmail: "director@example.test",
    emailClubs: [],
    attendeeCount: 4,
    locationName: "Missouri",
    members: [
      { firstName: "Alex", lastName: "Alpha", role: "MEMBER" as const, alternate: false },
      { firstName: "Blake", lastName: "Bravo", role: "MEMBER" as const, alternate: true },
    ],
    coaches: [{ firstName: "Casey", lastName: "Charlie", role: "COACH" as const, alternate: false }],
  };

  it("shows the members' names (the alternate marked), the coaches, the club picked and the director's contact", () => {
    const html = renderToStaticMarkup(createElement(PendingTeamsReview, { eventId: "event-1", teams: [team], clubs: [{ id: "club-1", name: "Synthetic Club" }] }));
    expect(html).toContain("Members");
    expect(html).toContain("Alex Alpha");
    expect(html).toContain("Blake Bravo (alternate)");
    expect(html).toContain("Coaches (1)");
    expect(html).toContain("Casey Charlie");
    expect(html).toContain("Synthetic Club");
    expect(html).toContain("director@example.test");
    expect(html).not.toMatch(/\bage\b|years old/i);
  });
});
