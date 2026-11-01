-- One branded email layout (#1443): the header names and the footer help contact. Additive only. The defaults give every
-- existing row the same values a new one gets, so nothing changes until an administrator edits them.
ALTER TABLE "PlatformSettings"
  ADD COLUMN "emailHeaderName" TEXT NOT NULL DEFAULT 'IMSDA Events',
  ADD COLUMN "emailClubHeaderName" TEXT NOT NULL DEFAULT 'IMSDA Events',
  ADD COLUMN "emailHelpEmail" TEXT DEFAULT 'support@imsda.org',
  ADD COLUMN "emailHelpPhone" TEXT DEFAULT '(515) 223-1197';
