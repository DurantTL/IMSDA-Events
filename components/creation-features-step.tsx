"use client";

import { useId } from "react";
import {
  clubFeaturesAfterCreation,
  creationFeatureItems,
  withFlag,
  withModule,
  type CreationAudience,
  type CreationFeatures,
} from "@/modules/event-features/creation";

/**
 * "Which features does this event use?" (#965): the skippable step of event
 * creation. The blank form, the template picker and the copy flow all render it,
 * each with its own starting choices (the audience's defaults, the template's
 * settings, or what the copy carries). Skipping it means exactly the choices
 * shown. Only a system administrator reaches event creation, and the server
 * writes the chosen modules and flags in the creating transaction.
 *
 * With `readOnly` (the copy flow) it only shows what the copy will carry.
 */
export function CreationFeaturesStep({
  audience,
  features,
  onChange,
  readOnly = false,
  intro,
  collapsible = false,
}: {
  audience: CreationAudience;
  features: CreationFeatures;
  onChange?: (next: CreationFeatures) => void;
  readOnly?: boolean;
  intro?: string;
  /** A closed `<details>` with a one-line summary, so the step is easy to pass over. */
  collapsible?: boolean;
}) {
  const headingId = useId();
  const items = creationFeatureItems(audience, features);
  const onCount = items.filter((item) => item.on).length;

  const body = (
    <>
      <p className="quiet-copy">
        {intro ?? "Optional. Leave this step as it is to use these defaults. Every switch can be changed later on the Event features page."}
      </p>
      <ul className="creation-feature-list" aria-label="Features for this event">
        {items.map((item) => {
          const id = `creation-feature-${item.kind}-${item.key}`;
          return (
            <li key={id}>
              <label className="checkbox-label" htmlFor={id}>
                <input
                  checked={item.on}
                  disabled={readOnly || item.locked}
                  id={id}
                  onChange={(event) => {
                    if (!onChange) return;
                    if (item.kind === "module") onChange(withModule(features, item.key, event.target.checked));
                    else if (item.kind === "flag") onChange(withFlag(features, item.key, event.target.checked));
                    else onChange({ ...features, showOnCalendar: event.target.checked });
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind === "module" && item.locked ? "On for every event. " : null}
                    {item.kind === "flag" && item.locked ? "Turn on the waitlist first. " : null}
                    {item.description}
                  </small>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {audience === "CLUB" && (
        <>
          <p className="quiet-copy"><strong>After the event exists</strong></p>
          <ul className="creation-feature-later">
            {clubFeaturesAfterCreation.map((entry) => (
              <li key={entry.key}><strong>{entry.title}.</strong> {entry.description}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );

  if (collapsible) {
    return (
      <details className="panel creation-features-step" data-creation-features>
        <summary>
          <h2 id={headingId}>Which features does this event use?</h2>
          <small>{onCount} on. Open to change them, or leave as is to use the defaults.</small>
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section aria-labelledby={headingId} className="panel form-stack event-settings-panel creation-features-step" data-creation-features>
      <h2 id={headingId}>Which features does this event use?</h2>
      {body}
    </section>
  );
}
