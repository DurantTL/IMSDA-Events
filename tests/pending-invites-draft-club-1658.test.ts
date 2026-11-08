import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** #1658: a draft club invite shows "Not sent yet", points to Club invites, and offers no Resend or Copy link. Synthetic data only. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/use-confirm", () => ({ useConfirm: () => ({ confirm: vi.fn(), confirmDialog: null }) }));

import { PendingInvites } from "@/components/pending-invites";
import type { PendingInvite } from "@/modules/system-admin/pending-invites";

const draft: PendingInvite = { kind: "club", id: "c1", name: "Pat Example", email: "pat@example.test", what: "Director of Example Pathfinders", from: "From the club import", sentAt: "2026-10-01T00:00:00.000Z", expired: false, notSent: true };

describe("pending invites component, draft club invite", () => {
  for (const emailConfigured of [true, false]) {
    it(`has no Resend or Copy link and links to Club invites (email configured: ${emailConfigured})`, () => {
      const html = renderToStaticMarkup(createElement(PendingInvites, { emailConfigured, invites: [draft] }));
      expect(html).toContain("Not sent yet");
      expect(html).toContain('href="/admin/clubs/invites"');
      expect(html).not.toContain("Resend");
      expect(html).not.toContain("Copy sign-up link");
      expect(html).not.toMatch(/Sent \w{3} /);
      expect(html).toContain("Cancel invite");
      expect(html).toContain("From the club import");
    });
  }
});
