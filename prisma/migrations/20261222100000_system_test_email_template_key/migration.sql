-- Additive: one new message kind for the System report's test email (#1383). No existing row changes.
ALTER TYPE "MessageTemplateKey" ADD VALUE 'SYSTEM_TEST_EMAIL';
