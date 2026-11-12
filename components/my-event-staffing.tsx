import { PortalSectionHeading } from "@/components/portal-section-heading";
import type { OwnAssignment } from "@/modules/event-staffing/own-assignments";
import styles from "@/components/my-event-staffing.module.css";

/**
 * A person's own event staffing assignments (#1678), read only, on their own account front page. It lists their own
 * activities and roles and nothing else: no other person's name, no head count, no gap. Renders nothing when there are none,
 * so an account with no assignment sees no new section.
 */
export function MyEventStaffing({ assignments }: { assignments: OwnAssignment[] }) {
  if (assignments.length === 0) return null;
  return (
    <section aria-labelledby="attendee-ov-staffing" data-testid="my-event-staffing">
      <PortalSectionHeading eyebrow="Your events" id="attendee-ov-staffing" title="Your event jobs" />
      <ul className={styles.list}>
        {assignments.map((assignment) => (
          <li className={styles.item} key={assignment.id}>
            <p className={styles.title}><strong>{assignment.activityName}</strong> <span className={styles.role}>({assignment.roleLabel})</span></p>
            <p className={styles.event} translate="no">{assignment.eventName}</p>
            {(assignment.timeText || assignment.location) && <p className={styles.detail}>{[assignment.timeText, assignment.location].filter(Boolean).join(" · ")}</p>}
            {assignment.description && <p className={styles.detail}>{assignment.description}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
