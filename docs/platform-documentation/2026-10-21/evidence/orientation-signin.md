# Sign-in and first-use evidence for the end-user orientation

Reviewed October 21, 2026 against application source at `5e367b7c` (unchanged in the documentation merge `47cd5c00`). These instructions describe repository behavior. They do not establish the current production switch settings.

## What to teach on the slides

**Use the front door:** `https://events.imsda.org` → **Sign in**. A director can also start with **My club**. The public header sends the person to the currently available account sign-in page; do not teach everyone to type `/sign-in` or `/login`. A signed-in person sees **My account** instead. Staff-only entry is not the normal director/coordinator entry.

**Use your own account:** the address must match the invitation or the account with the assigned role. Signing in does not let someone choose any role. If someone already has an IMSDA Events account, sign in to it instead of creating a second account.

**New directors accept a club invite:** the invitation email gives account creation and existing-account sign-in choices. Use the invited address. On the account page, the card **You're invited to manage a club** shows the club and role; choose **Accept**. The club then becomes available under **My club**. Club-import invitations are not the same workflow as the public **Start a club** application. Do not tell an already-established club to apply again.

**Coordinators have an assigned role:** a conference administrator gives the account Area Coordinator access. There is no public “make me a coordinator” selector. A real coordinator who has signed in and completed the second step sees the **Area coordinator** card and its links, including **Clubs overview** and **Club event registrations**. If these do not appear, check the account address and ask the office to verify the assignment. Do not recommend creating another account.

## Exact first-use sequence

### 1. If you already have an account

1. Open `https://events.imsda.org` and choose **Sign in**.
2. Enter **Email address** and **Password**, then **Sign in**. A configured passkey can be used where **Sign in with a passkey** is offered. Google appears only if configured; do not make it a required training step.
3. Complete **Confirm it's you** if requested: **Continue with a passkey**, or enter the six-digit authenticator code (or an unused recovery code) and choose **Continue**.
4. Open **My club** / **My clubs** for a directed club, or the coordinator **Clubs overview** link. For coordinators, the account navigation uses **Clubs**; it is not an administrator dashboard.

### 2. If an invited director has no account yet

1. Open the account-creation link in the club invitation, or choose **Create an account** on account sign-in. Use the exact invited email address.
2. Enter **Your name**, **Email address** and a password meeting the shown checklist. Choose **Create account**.
3. Keep this browser/page open. Find the email's **Six-digit code**, enter it here, and choose **Verify and continue**. That email code works in this browser and expires after twenty minutes.
4. On the account page, choose **Accept** beside the correct club invitation. If the invitation is absent, verify the address and ask the office; do not create a new club application or duplicate account.
5. Follow **Set up two-step sign-in** if prompted before club information opens. One method is enough: an authenticator app, or a passkey when that option is available.
6. After setup, choose **Continue** and open the club. Confirm the club name and working year before changing anything.

### 3. Set up the extra sign-in protection

The explanation can be simple: **Club accounts can open information about young people. The extra step helps protect that information if someone learns your password.**

Authenticator path:

1. Choose **Set up an authenticator**. The linked **Which app should I use?** help names Google Authenticator, Microsoft Authenticator, Apple Passwords and 1Password.
2. Follow the displayed setup instructions to add the account in that app. The component shows a text setup key; the separate help page describes scanning a QR code or adding the text key. Do not promise that every screen has a QR image.
3. Enter the **Code from your authenticator**, then **Confirm and turn on**.
4. Save the one-time recovery codes somewhere safe, then **I've saved these codes**.
5. The completion message says **Two-step verification is on.** Choose **Continue** (or **Continue to Sign-in & security**, depending on where setup started).

Passkey path, when offered: **Add a passkey**, then follow the device's fingerprint, face or PIN prompt. A passkey or an authenticator satisfies the requirement; both are not required. Do not claim that a device option unavailable on a given site is mandatory.

**Do not confuse the codes:** the email code proves the email address during account creation or password reset; the authenticator code is the extra sign-in step for a club/coordinator role. A code printed as an event registration confirmation is different again.

### 4. If sign-in is not working

- **Forgotten password:** use **Forgot password?**, enter the account email and choose **Send me a code**. In the same browser, enter the emailed six-digit code and **New password**, then **Set new password**. The code expires after twenty minutes. Resetting a password signs out other sessions.
- **Lost authenticator:** use a saved recovery code or configured passkey where offered. If neither is available, ask the office for account support. Do not teach bypassing the extra step or sharing another person's account.
- **Club/coordinator tools missing:** check **Signed in as** first. The office can verify the invitation/assignment. There is no role-picker fix and a second account usually makes the problem harder.
- **Finished, especially on a shared device:** choose **Sign out**. Closing the tab is not the same action.

## Six suggested orientation slides with spoken notes

### Slide A — Start at IMSDA Events

**Slide copy**

1. Open **events.imsda.org**.
2. Choose **Sign in**.
3. Use your own account email and password.
4. Follow the extra confirmation step if asked.

**Say:** “Everyone begins at the same website. Use the Sign in button on the page rather than hunting for a special director or coordinator login. After sign-in, the system shows the tools assigned to your account.”

**Show:** the public homepage's **Sign in**, **My account** and **My club** labels. Do not substitute an accepted dashboard mockup for a current sign-in screenshot.

### Slide B — New club leader? Accept the invitation

**Slide copy**

1. Use the email address that received your club invitation.
2. Already have an account? **Sign in**.
3. New here? **Create account** and verify the emailed code.
4. Choose **Accept** beside your club invitation.

**Say:** “An invitation connects your account to the club. Creating an account alone does not do that. Once your email is verified, look for the invitation on your account page and accept the correct club and role.”

**Demonstration checkpoint:** ask the participant to identify the club name and invited role before accepting. Do not accept a real invitation as a generic training exercise.

### Slide C — Why there is one extra sign-in step

**Slide copy**

- Your club tools can open information about young people.
- Use an authenticator app, or a passkey when offered.
- Save recovery codes when they are shown.
- Keep your password and codes to yourself.

**Say:** “The second step protects the club's information. You only need one supported method. An authenticator app makes a short code; a passkey uses your device's fingerprint, face or PIN. Save the backup codes now so losing a phone does not leave you stuck.”

### Slide D — Open the workspace for your job

**Slide copy**

- **Director/deputy:** open **My club** or **My clubs**, then the correct club.
- **Area Coordinator:** use **Clubs overview** on the **Area coordinator** card, or **Clubs** in account navigation.
- Confirm the club/year or year filter before reviewing records.

**Say:** “A director works inside a club. A coordinator reviews clubs and follows up. If you hold both responsibilities, the account can show both kinds of tools. The screen you need follows the job you are doing; it is not a different shared password.”

### Slide E — If you cannot get in

**Slide copy**

- Forgotten password? Choose **Forgot password?**.
- Missing club or coordinator tools? Check **Signed in as**.
- Missing invitation or access? Ask the conference office.
- Avoid making a duplicate account or new club application.

**Say:** “Start by checking the email shown on the account. Invitations and access are connected to that account. If the password is the problem, the reset process emails a code. If the account works but the club is missing, the office needs to check access rather than create another club.”

### Slide F — Finish safely and return next time

**Slide copy**

1. Confirm that your work saved.
2. Choose **Sign out** on a shared device.
3. Next time, return to **events.imsda.org → Sign in**.
4. Keep the authenticator/passkey available.

**Say:** “Saving your work and signing out are separate actions. When you come back, you do not need a new invitation for an already accepted club role. Sign in with your existing account and open the club or coordinator tools again.”

## Technical evidence for the preparer, outside audience slide text

| Source | Facts verified |
|---|---|
| `app/page.tsx:47`–`app/page.tsx:93` | Public header and front-door action names: My account, My club, Conference calendar, Find a club. |
| `components/public-header-links.tsx:8`–`components/public-header-links.tsx:18` | Signed-out header route is selected by the sign-in switch: `/sign-in` when enabled, otherwise `/account/sign-in`; `/login` is the separate legacy staff entry. |
| `app/sign-in/page.tsx:40`–`app/sign-in/page.tsx:48` | Typing `/sign-in` while the switch is off redirects to `/login`; therefore do not teach this fixed path as the universal club login. |
| `components/attendee-sign-in-form.tsx:81`–`components/attendee-sign-in-form.tsx:132` | Email/password labels; Forgot password?; Sign in; Create an account; Manage my registration without an account. |
| `components/attendee-sign-up-form.tsx:108`–`components/attendee-sign-up-form.tsx:135` | Same-browser emailed six-digit verification code, twenty-minute expiry, Verify and continue. |
| `modules/club-imports/invites.ts:27`–`modules/club-imports/invites.ts:34`, `modules/club-imports/invites.ts:120`–`modules/club-imports/invites.ts:143` | Invitation is accepted only by the account whose verified address matches; email wording explicitly says new account OR existing sign-in, then Accept on the account page. |
| `components/club-invite-accept.tsx:46`–`components/club-invite-accept.tsx:63` | Invitation card and exact Accept button. |
| `app/(public)/account/(portal)/page.tsx:79`–`app/(public)/account/(portal)/page.tsx:82` | Club invitation card appears on account overview. |
| `modules/attendee-accounts/sign-in-gate.ts:29`–`modules/attendee-accounts/sign-in-gate.ts:53` | Current club grants and active coordinator grants trigger the second-step gate; new/expired verification states are distinguished. |
| `app/(public)/account/two-step/page.tsx:72`–`app/(public)/account/two-step/page.tsx:103` | User-facing reason, Confirm it's you, Continue with a passkey, authenticator/recovery-code options. |
| `components/two-step-setup.tsx:16`–`components/two-step-setup.tsx:23`, `components/two-step-setup.tsx:79` | Completion label and one method being enough. |
| `components/mfa-manager.tsx:134`–`components/mfa-manager.tsx:182` | Recovery code save action, setup key, Code from your authenticator, Confirm and turn on, Set up an authenticator. |
| `app/(public)/account/help/authenticator/page.tsx:35`–`app/(public)/account/help/authenticator/page.tsx:70` | Plain-language authenticator explanation and named apps; online static help page. |
| `modules/club-reports/area-card-domain.ts:14`–`modules/club-reports/area-card-domain.ts:20` | Coordinator quick-link labels: Clubs overview, Club event registrations; health entry is separate and gated. |
| `app/(public)/account/(portal)/layout.tsx:72`–`app/(public)/account/(portal)/layout.tsx:81` | Account navigation: coordinator Clubs versus director My club/My clubs; options follow actual roles. |
| `components/attendee-password-reset-form.tsx:80`–`components/attendee-password-reset-form.tsx:120`, `components/attendee-password-reset-form.tsx:134`–`components/attendee-password-reset-form.tsx:144` | Same-browser email code/reset flow, Send me a code, Set new password and other-session sign-out. |
| `components/attendee-sign-out-button.tsx:14`–`components/attendee-sign-out-button.tsx:41` | Actual Sign out action. |
| `docs/DEPLOY-DOCKER.md:585`, `docs/DEPLOY-DOCKER.md:675` | Real intended public domain `https://events.imsda.org`; live serving state is still not inspected here. |

### Guardrails for the final deck

- No universal role-picker or new administrator menu is proposed.
- Do not use the new accepted role mockups as if they are current shipped screens.
- Keep source/architecture, vendor discovery, CI counts and future roadmap in the separate reports rather than these basic how-to slides.
- Do not claim the coordinator has a ministry/area filter today. Explain available clubs and the role's oversight task in plain language.
- Do not put example passwords, usable invitation links, MFA setup secrets, recovery codes or private registration links into slides or screenshots.
