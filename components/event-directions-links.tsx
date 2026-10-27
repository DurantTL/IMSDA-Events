import { ExternalLink, Navigation } from "lucide-react";
import type { DirectionsTarget } from "@/modules/events/directions";

/** The "Get directions" links under the Where line (#1213): none when there is no usable place. */
export function EventDirectionsLinks({ targets }: { targets: readonly DirectionsTarget[] }) {
  if (targets.length === 0) return null;
  return (
    <ul aria-label="Directions" className="public-event-directions">
      {targets.map((target, index) => (
        <li key={`${index}-${target.href}`}>
          <a href={target.href} rel="noopener noreferrer" target="_blank">
            <Navigation size={16} aria-hidden="true" /> {target.label}
            <span className="sr-only"> (opens in a new tab)</span>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
