-- Event recognitions (#1683): an EventTag can be marked as a recognition and record what it earns.
CREATE TYPE "RecognitionItem" AS ENUM ('PIN', 'PATCH', 'STAR');

ALTER TABLE "EventTag" ADD COLUMN "recognitionItem" "RecognitionItem";
