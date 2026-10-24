import Link from "next/link";

/**
 * What a verified email means on the registration account (#1176), stated only as far as the code does it:
 * registrations are matched on the verified address (never on a name), nothing else is granted by it, and the
 * profile form below it saves only the account's own reusable details, never a submitted registration.
 */
export function VerifiedEmailExplainer({ email }: { email: string }) {
  return (
    <section className="attendee-verified" aria-labelledby="profile-verified-heading">
      <h3 id="profile-verified-heading">What your verified email means</h3>
      <ul>
        <li>
          You confirmed that you can read mail sent to <strong translate="no">{email}</strong>. It is the address you sign in with, and it
          cannot be changed here.
        </li>
        <li>
          Every registration whose contact email is this address appears under My registrations. Registrations are matched on the address,
          never on a name, so one made with a different address will not appear.
        </li>
        <li>
          It does not by itself give staff, club or admin access. Those need their own grant, or an invitation you accept.
        </li>
        <li>
          Changing your usual details below only prefills new registrations. It never changes a registration you already submitted. Contact
          details on a submitted registration are updated from My registrations, with an emailed code.
        </li>
      </ul>
      <p className="attendee-verified-links">
        <Link className="empty-state-link" href="/account/registrations">My registrations</Link>
        <a className="empty-state-link" href="#profile-security">Sign-in security on this page</a>
        <Link className="empty-state-link" href="/recover-registration">Find a registration made with another email</Link>
      </p>
    </section>
  );
}
