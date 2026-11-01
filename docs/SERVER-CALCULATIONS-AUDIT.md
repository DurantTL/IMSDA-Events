# Server-side calculations audit (#1445, rule P1)

Rule P1: every calculation that matters (prices, fees, discounts, deposits, balances, capacity, eligibility) is done on
the server from one shared function. The browser only shows a preview from that same function. The server never trusts a
total the browser sends, and if the browser's scripts fail or are blocked, the amount charged and recorded is still the
server's.

Audited on the build of Nov 1, 2026. Result: **no path trusted a client-sent amount.** Every public input is a strict
schema with no amount field (an extra key is refused, not ignored), every stored total comes from the shared function, and
every charge is derived on the server from the stored registration. One gap was in the page, not the server: when the
browser's own preview threw, the registration form crashed instead of saying the total is worked out on submit. That is
fixed (`PREVIEW_UNAVAILABLE_TEXT` in `components/public-registration-form.tsx`).

Tests: `tests/server-calculations-1445.test.ts` posts tampered totals, prices, discounts and quantities at each public
entry point and asserts the server's own number; `scripts/verify-privacy-browsers.ts` does the same end to end (real
database, three browsers) with the preview made to throw.

## The paths

| Path | Where the amount is decided | What a browser may send | Result | Guard |
| --- | --- | --- | --- | --- |
| Public registration (`POST /api/public/events/[eventSlug]/forms/[formSlug]/registrations`) | `preparePublicRegistration` (`modules/forms/public-domain.ts:465`) calls `calculateFormTotal` or `calculateRosterTotal` on the published form version's own prices; `submitPublicRegistration` (`modules/forms/public-repository.ts`) adds lodging, promo and fee and stores `totalAmount` and `pricingSnapshot` | Answers, attendee rows, lodging choice, idempotency key. `publicRegistrationInputSchema` is `.strict()` | Already safe | Test: extra amount keys refused at top level, attendee row and lodging; fake `total`/`price` answers change nothing; negative quantity cannot lower the total |
| Group registration (`.../group-registrations`), general link (`.../general-registrations`), club event registration (`/api/attendee/clubs/.../registration`) | The same `publicRegistrationInputSchema` and `submitPublicRegistration`; the routes strip only their own extras (`locationId`, `teamName`, honor picks) and pass the rest to the strict schema | Same as above | Already safe | Test: strict shapes for group edit and club edit; roster pricing ignores client numbers on a row |
| Promo codes (`POST .../promo-code` preview and the claim inside submit) | `evaluatePromoCode` and `applyPromoCodeToCalculation` (`modules/promo-codes/domain.ts`) from the stored rule and the server's subtotal; the preview route returns a quote built from the answers | A code and the answers. `publicPromoCodeQuoteInputSchema` is `.strict()` | Already safe | Test: discount is the rule's percentage of the server's subtotal; unknown code discounts nothing; amount keys refused |
| Card fee and deposits | `processingFeeForSubtotal` (`modules/forms/definition.ts`) from the form's own rate; the fee is deferred and added only when a card payment succeeds (`modules/payments/online-card-fee.ts`); the deposit amount is the form's `payment.deposit.amountCents` | `kind` ("BALANCE" or "DEPOSIT") only | Already safe | Test: fee follows the server's rate and only when card is chosen; payment schemas refuse any amount |
| Square card, Pay on Square link, payment choice (public `/api/public/manage/[token]/payment*` and attendee `/api/attendee/registrations/[id]/payment*`) | `getPublicSquareCheckout` and the payment repositories derive the amount from the stored balance (and deposit); the webhook and `provider.amountCents !== attempt.amountCents` checks reject a charge that does not match (`modules/payments/square-repository.ts`) | A card token, an idempotency key, the kind. `squarePaymentInputSchema`, `squarePaymentLinkInputSchema`, `paymentChoiceInputSchema` are strict | Already safe | Test: amount keys refused on all three |
| Amendments (staff `.../amendment` and registrant answers `.../manage/[token]/answers`, attendee answers) | `modules/registrations/amendments-repository.ts` re-runs `preparePublicRegistration` and promo and lodging on the saved definition; `finalTotalCents` is what is stored. The quote fingerprint is a hash that must match the server's own quote. Registrant self-service never edits a priced field (`registration-answer-policy.ts`) | Answers and the fingerprint. `registrationAmendmentInputSchema` is strict | Already safe | Test: amount keys refused; fingerprint must be 64 characters |
| Cancellations and refunds, registrant side (`.../cancellation`) | `previewCancellation` runs the policy on the server; `submitCancellationRequest` stores `result.money.refundCents`. The one number the page sends, `expectedRefundCents`, is only a staleness guard: if it differs from the server's recalculation nothing is saved and the new outcome is shown | The selection, a reason, and the refund they were shown. Strict | Already safe | Test: no other amount key accepted; `refundCents`, `retainedCents`, `proposedRefundCents` refused |
| Cancellations and refunds, staff side (`/api/events/[eventId]/payments/[paymentId]/refunds`, cancellation execution) | Staff enter a refund amount after the server checks it against what was paid; running a refund is a human-only gate | A staff member's amount (permission gated) | Staff-entered by design; **not changed** (refund execution gates are human-only) | Existing `tests/cancellation-execution-*.test.ts` |
| Club orders (the order helper list, `/api/attendee/clubs/[organizationId]/orders*`) | There is no money here: lines are quantities of catalog items that honors, uniforms and awards call for, and "nothing is ordered from here" | A bounded whole quantity (0 to 10,000) or null. Strict | Already safe; no amount to trust | Test: quantity bounds; price keys refused |
| Uniform orders (`/api/attendee/clubs/[organizationId]/uniforms*`) | Person ids and catalog item ids; stock and any price live in the staff catalog | Person ids, item ids. Strict | Already safe | Test: price keys refused |
| Lodging (public registration step and `/api/public/manage/[token]/lodging*`) | `planRegistrationLodging` (`modules/lodging/registration-form.ts`) prices from the event's rates and nights and checks capacity under the unit locks; later changes compute the charge delta on the server and never change the stored charge from the page | Category, nights, party size, flags, roommate requests. `registrationLodgingSchema` is strict | Already safe | Test: price keys refused on the lodging schema |
| Meals | Meal tickets are priced lines of the form (`pricedLineItem`) and meal plan prices are staff-managed; the meals staff routes are permission gated | Form answers (covered above) | Already safe | Covered by the registration tests |
| Honors | Class picks are class ids per person; capacity and prerequisites are checked on the server (`modules/honors/`); no price | Class ids, at most six per person | Already safe | Test: shape and cap; non-id values refused |
| Capacity and eligibility (choice limits, waitlist, club year, ages, responsible adult) | Decided in `submitPublicRegistration` under locks from the submitted answers and the stored data; `responsibleAdults` is checked "against the ages in the answers, never against what the browser decided" | Answers | Already safe | Existing capacity tests and `scripts/verify-public-registration-capacity.ts` |
| Check-in station payments (`recordStationPayment`, `modules/checkin-stations/service.ts:219`) | A station volunteer enters a cash or check amount; the server refuses an amount over the registration's balance (`PAYMENT_EXCEEDS_BALANCE`) and records it through the audited `recordManualPayment`. "Paid by card in Square app" is an audit note only and creates no payment | A staff or volunteer's amount, bounded by the balance | Staff-entered by design; bounded on the server; not changed | Existing station tests |
| Issued-asset deposits (`/api/events/[eventId]/assets/deposits`) | Staff record the deposit received against the asset type's configured deposit (`depositCents`); permission gated | A staff member's amount | Staff-entered by design; not a client total | Existing issued-asset tests |
| Scholarship funds (`modules/scholarship-funds/`) | Staff record fund receipts and awards; permission gated and bounded | A staff member's amount | Staff-entered by design | Existing scholarship tests |
| Honor class additional cost (`HonorOffering.additionalCostCents`) | Shown as a badge on the info card ("Additional cost (paid separately)") and never added to a registration total or charged | Nothing | Display only; **nothing is charged from it**, so no amount can be tampered with | n/a |
| Staff payments, adjustments, imports (`/api/events/[eventId]/registrations/.../payments`, `adjustments`, imports) | A staff member enters an amount on purpose; the server checks permission, bounds and idempotency | A staff member's amount | Staff-entered by design; not a client total | Existing payment and adjustment tests |

## The page's preview

The registration form shows a preview from the same shared function the server uses (`components/public-registration-form.tsx`
calls `calculateFormTotal`). The preview was the only place a failure showed. Now:

- If the preview throws (a script error, a blocked chunk), the summary says **"We couldn't show your total on this page.
  Your total will be calculated when you submit, and shown on your confirmation."** and no total is shown.
- Submit still works; the server recalculates from the answers and returns the recorded total.
- The confirmation shows the server's total, and the payment page shows the server's charge.
- A server promo quote is not shown while the preview is broken (its basis is the broken preview), so no stale number is
  displayed.

## What to look for in a review

A new money path is safe when: its input schema is strict and has no amount; the amount comes from `calculateFormTotal`,
`calculateRosterTotal`, `evaluatePromoCode`, `processingFeeForSubtotal` or a stored row; and a test posts a tampered number
and sees the server's. If a route must accept a number a person typed (a refund by staff, a payment by staff), it is
permission gated, bounded and audited, and it is listed above as staff-entered.

## Decision for Caleb: fractional quantities

A priced NUMBER field charges quantity x price. The form accepts a fractional quantity such as 2.5 shirts and the server
prices it (rounded to a whole cent). It is the server's number, not a tampered one, but 2.5 shirts is probably never
meant. Options: refuse non-whole quantities on priced NUMBER fields (a small validation change), or leave it. No test
locks the current behaviour in; the guard test only asserts the amount is a whole number of cents.
