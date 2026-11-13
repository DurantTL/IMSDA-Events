import { vi } from "vitest";

// Route tests mock the database and sessions with only what their handler reads. `withRequestContext` classifies every
// request for the archived-event check (#159) and, for an event write path, loads the server half, which needs sessions
// and a database. By default these tests see no event write path, so the check never runs. The rule itself is tested in
// tests/archived-read-only-159.test.ts, which opts out with vi.unmock. (Mocking the classifier, which is imported
// statically, avoids a vitest quirk where two simultaneous first dynamic imports can load the real module.)
vi.mock("@/modules/events/archived-read-only", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/events/archived-read-only")>()),
  archivedWriteTarget: () => null,
}));
