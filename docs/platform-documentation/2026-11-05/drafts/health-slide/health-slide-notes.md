# Health information is confidential

Draft slide and presenter notes for the IMAdventist getting-started deck, not yet added to the deck. For club directors and deputies. Waiting on two decisions: whether health records will be on at launch, and whether to insert this after slide 11.

### Say

Health information about young people is confidential, so these pages work a little differently. The first time you open one, the app shows a short privacy notice. Read it, check the box and choose Continue. From then on, every time you open, enter, change or print health information, the app records your name and the time.

The Health tab is for club events. Choose an event and you see your own club's attendees only: the dietary notes as they were typed at registration, a yes or no flag for a medical or accessibility need, and emergency contacts. You can open a printable sheet, and each event stays open through its last day.

For one member's full health record, go to the Roster and choose Actions, then Health record. You can type it in from the paper form, or send the parent a private link that works once. The status tells you whether the record is missing, needs an update or is current for this club year. Health details are never emailed or exported, and they aren't printed in the check-in book.

### Point to

Point to each column in order. Only the director and deputy see health information. A club Registrar can enter a record when none exists yet, but cannot read it back. The full Health record appears only when the conference has turned health records on.

### On the slide

**Before you start**

- The first visit shows Before you work with health information.
- Read it, check I have read this and I agree, then Continue.
- Every open, entry, change or print is recorded with your name and the time.

**Health tab: club events**

- Choose an event to see your club's attendees only.
- Dietary notes as entered, a yes/no medical need flag and emergency contacts.
- Open printable sheet. Each event is open through its last day.

**One member's record**

- Roster → Actions → Health record.
- Enter it from the paper form, or Send link so a parent fills it in. The link works once.
- Status: No record yet, Needs update or Current for this club year.

### Key points

- The privacy notice comes first and is asked once (again only if its wording changes).
- The Health tab shows only your club's attendees for events your club registered for.
- The dietary note is free text typed at registration. It is not a full allergy record.
- If you need to withdraw a parent link, use Withdraw next to it. You can send a new one.

### Preparation references (not spoken)

- `app/(public)/account/(portal)/clubs/[organizationId]/health/page.tsx`: Health tab for club events
- `app/(public)/account/(portal)/clubs/[organizationId]/roster/[memberId]/health/page.tsx`: one member's Health record
- `components/health-record-actions.tsx`: Send link, Withdraw, Confirm for this club year
- `modules/health-records/acknowledgment-domain.ts`: privacy notice wording
- `modules/coordinator-health/domain.ts`: Health tab column labels
- `modules/health-records/flag.ts`: health records switch (`HEALTH_RECORDS_ENABLED`)
