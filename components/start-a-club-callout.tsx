import Link from "next/link";
import { CirclePlus } from "lucide-react";

/**
 * The call to action for the public new-club application (#1014). One shared
 * component so the home page and Find a club say exactly the same thing.
 * The button is a client-side <Link>: it only goes to /clubs/register. `variant="line"` is the home page's
 * one-line version with the same destination.
 */
export function StartAClubCallout({ headingId = "start-a-club-heading", variant = "card" }: { headingId?: string; variant?: "card" | "line" }) {
  // The home page's quiet version (#1204): one line and a link, at the bottom, going to the same place.
  if (variant === "line") {
    return (
      <aside aria-label="Start a new club" className="start-a-club-line">
        <span>Want to start a Pathfinder club?</span>
        <Link href="/clubs/register">Start a new club</Link>
      </aside>
    );
  }
  return (
    <aside aria-labelledby={headingId} className="start-a-club-callout">
      <CirclePlus aria-hidden="true" className="start-a-club-icon" size={28} />
      <div className="start-a-club-body">
        <h2 id={headingId}>Start a new club</h2>
        <p>
          Apply to start a Pathfinder club. Applications are open all year; the conference youth
          department reviews each one.
        </p>
      </div>
      <Link className="primary-button start-a-club-button" href="/clubs/register">
        Register a new club
      </Link>
    </aside>
  );
}
