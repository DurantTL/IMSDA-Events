"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, UsersRound } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ClubLocationPicker, locationUnavailableLabel } from "@/components/club-location-picker";
import { PublicRegistrationForm, type FormResponses } from "@/components/public-registration-form";
import { TEAM_NAME_MAX } from "@/modules/club-teams/domain";
import type { GeneralLinkExperience } from "@/modules/general-link-registrations/repository";

type Ready = GeneralLinkExperience & { experience: NonNullable<GeneralLinkExperience["experience"]> };

/**
 * The event's general registration link (#931): a club director with no account registers a team. Pick the site and name the
 * team, then fill in the form (the club from the directory list, the people typed in). The server matches the team to the
 * club, enforces the team rules and answers with the same words whether the team is attached at once or waits for staff; this only guides.
 */
export function GeneralLinkRegistrationFlow({ eventSlug, ready, topContent }: { eventSlug: string; ready: Ready; topContent?: ReactNode }) {
  const { experience, locations, team } = ready;
  const pickableLocations = locations.filter((location) => locationUnavailableLabel({ ...location, phase: location.phase }, null, location.id, true) === null);
  const [locationId, setLocationId] = useState<string | null>(() => (pickableLocations.length === 1 ? pickableLocations[0]!.id : null));
  const [teamName, setTeamName] = useState("");
  const [started, setStarted] = useState(false);
  const chosenLocation = locations.find((location) => location.id === locationId) ?? null;
  const needsLocation = locations.length > 0;
  const canContinue = (!needsLocation || chosenLocation !== null) && (!team.named || teamName.trim().length > 0);

  const blockedReason = useMemo(() => {
    if (needsLocation && !chosenLocation) return "Choose a location first.";
    if (team.named && !teamName.trim()) return "Name your team first.";
    return null;
  }, [needsLocation, chosenLocation, team.named, teamName]);

  if (!started) {
    return (
      <main className="public-registration-page">
        <header className="public-registration-header">
          <div className="public-registration-header-inner">
            <Link className="public-registration-brand public-event-brand-link" href={`/events/${encodeURIComponent(eventSlug)}`}>
              <BrandMark /><span><strong>IMSDA</strong><small>Events</small></span>
            </Link>
          </div>
        </header>
        <section className="public-manage-card public-group-flow-card">
          <p className="public-registration-eyebrow">Team registration · {ready.event.name}</p>
          <h1><UsersRound aria-hidden="true" size={22} /> Register a team without an account</h1>
          <p>
            Club directors can register a team here without signing in. Choose your club from the list on the form and use the email
            address your club has on file for its director or deputy, so the team can be attached to your club. If it cannot be matched,
            the event team confirms the club for you. Either way you get an email with the details. There is no fee.
          </p>
          <ClubLocationPicker allowWaitlist locations={locations} noun="club" onChange={setLocationId} value={locationId} />
          {team.named && (
            <div className="field-group">
              <label htmlFor="general-link-team-name">Team name</label>
              <input
                id="general-link-team-name"
                maxLength={TEAM_NAME_MAX}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="For example, Bible Bees"
                type="text"
                value={teamName}
              />
              <p className="field-help">Each team has its own name, different from every other team in the event. A club can register more than one team.</p>
            </div>
          )}
          <div className="club-registration-toolbar">
            <button className="primary-button" disabled={!canContinue} onClick={() => setStarted(true)} type="button">
              Continue <ArrowRight aria-hidden="true" size={15} />
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <PublicRegistrationForm
      choiceUsage={experience.choiceUsage}
      event={experience.event}
      // Drafts are kept apart from the ordinary form of the same event.
      form={{ ...experience.form, slug: `${experience.form.slug}:general` }}
      group={{
        submitUrl: `/api/public/events/${encodeURIComponent(eventSlug)}/general-registrations`,
        locationId,
        honorSelections: {},
        billingNotice: "There is no fee for this event.",
        noCost: true,
        teamName: team.named ? teamName.trim() : null,
        submitLabel: "Submit team registration",
        blockedReason,
        locationName: chosenLocation?.name ?? null,
        onChangeLocation: () => setStarted(false),
        waitlistNote: chosenLocation?.full ? "This location is full, so your team will join its waitlist if the event has one." : null,
      }}
      initialResponses={{} as FormResponses}
      lifecycle={experience.lifecycle}
      pricingDate={experience.pricingDate}
      topContent={topContent}
    />
  );
}
