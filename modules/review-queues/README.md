# Review queues

The Registrations tab's Review queues page (#1574): the event's registration review pages as grouped cards.

- `review-queues-model.ts` is pure: which cards a viewer sees (each gated like its own page) and their status words.
- `review-queues-repository.ts` reads only the numbers of visible cards, each reusing the count the card's own page shows. A failed read is `null`, shown as "Unavailable".

This boundary only reads. It links to the queue pages; each page still checks its own permission and does its own work.
