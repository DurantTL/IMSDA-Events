-- Marks a health record that came from the 2026 Cognito form import (#878) until a director reviews it.
-- A plain timestamp: no health text. Additive and nullable, so existing rows are untouched.
ALTER TABLE "HealthRecord" ADD COLUMN "importedAt" TIMESTAMP(3);
