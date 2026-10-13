-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'SUPPER', 'SNACK', 'OTHER');

-- CreateEnum
CREATE TYPE "MealServiceStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MealTicketing" AS ENUM ('TICKETED', 'DONATION_ONLY');

-- CreateEnum
CREATE TYPE "MealPayer" AS ENUM ('ATTENDEE', 'CONFERENCE');

-- CreateEnum
CREATE TYPE "MealAgeGroup" AS ENUM ('ADULT', 'CHILD');

-- CreateEnum
CREATE TYPE "MealEntitlement" AS ENUM ('PAID', 'INCLUDED');

-- CreateEnum
CREATE TYPE "MealSelectionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MealSelectionSource" AS ENUM ('REGISTRATION_FORM', 'STAFF', 'WALK_UP', 'PLAN_ASSIGNMENT');

-- CreateEnum
CREATE TYPE "MealChangeType" AS ENUM ('CREATED', 'QUANTITY_CHANGED', 'PLAN_CHANGED', 'SUBSTITUTED', 'CANCELLED', 'SERVICE_CANCELLED');

-- CreateEnum
CREATE TYPE "MealServiceChangeType" AS ENUM ('CREATED', 'UPDATED', 'CANCELLED', 'REINSTATED');

-- CreateEnum
CREATE TYPE "MealLedgerKind" AS ENUM ('CHARGE', 'CREDIT');

-- CreateEnum
CREATE TYPE "MealSettlement" AS ENUM ('IN_REGISTRATION_PRICING', 'REGISTRATION_ADJUSTMENT', 'AT_COUNTER', 'REGISTRATION_NOT_LIVE');

-- AlterEnum
ALTER TYPE "RegistrationAdjustmentKind" ADD VALUE 'MEAL';

-- CreateTable
CREATE TABLE "EventMealService" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "serviceDate" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "location" TEXT,
    "ticketing" "MealTicketing" NOT NULL DEFAULT 'TICKETED',
    "capacity" INTEGER,
    "status" "MealServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMealService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealServiceChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "type" "MealServiceChangeType" NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealServiceChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealPlan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "payer" "MealPayer" NOT NULL DEFAULT 'ATTENDEE',
    "isDefaultTicketPlan" BOOLEAN NOT NULL DEFAULT false,
    "includesAllServices" BOOLEAN NOT NULL DEFAULT false,
    "defaultEntitlement" "MealEntitlement" NOT NULL DEFAULT 'PAID',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMealPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealPlanService" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "entitlement" "MealEntitlement" NOT NULL DEFAULT 'PAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealPlanService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealPrice" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "ageGroup" "MealAgeGroup",
    "attendeeTypeId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMealPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealSelection" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "serviceId" TEXT,
    "registrationId" TEXT,
    "registrationAttendeeId" TEXT,
    "ageGroup" "MealAgeGroup" NOT NULL,
    "attendeeTypeCode" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "MealSelectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "MealSelectionSource" NOT NULL,
    "payer" "MealPayer" NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "conferenceRateCents" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB NOT NULL,
    "sourceFormVersionId" TEXT,
    "sourceFieldKey" TEXT,
    "dietaryCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "orderLabel" TEXT,
    "clientRequestId" TEXT,
    "replacesSelectionId" TEXT,
    "createdByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventMealSelection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealSelectionChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "type" "MealChangeType" NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealSelectionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMealLedgerEntry" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "registrationId" TEXT,
    "serviceId" TEXT,
    "mealType" "MealType" NOT NULL,
    "ageGroup" "MealAgeGroup" NOT NULL,
    "kind" "MealLedgerKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "payer" "MealPayer" NOT NULL,
    "settlement" "MealSettlement" NOT NULL,
    "registrationAdjustmentId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventMealLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventMealService_eventId_serviceDate_startTime_idx" ON "EventMealService"("eventId", "serviceDate", "startTime");

-- CreateIndex
CREATE INDEX "EventMealService_eventId_status_idx" ON "EventMealService"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventMealService_eventId_serviceDate_name_key" ON "EventMealService"("eventId", "serviceDate", "name");

-- CreateIndex
CREATE INDEX "EventMealServiceChange_serviceId_createdAt_idx" ON "EventMealServiceChange"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "EventMealServiceChange_eventId_createdAt_idx" ON "EventMealServiceChange"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventMealPlan_eventId_isActive_position_idx" ON "EventMealPlan"("eventId", "isActive", "position");

-- CreateIndex
CREATE UNIQUE INDEX "EventMealPlan_eventId_code_key" ON "EventMealPlan"("eventId", "code");

-- CreateIndex
CREATE INDEX "EventMealPlanService_eventId_idx" ON "EventMealPlanService"("eventId");

-- CreateIndex
CREATE INDEX "EventMealPlanService_serviceId_idx" ON "EventMealPlanService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMealPlanService_planId_serviceId_key" ON "EventMealPlanService"("planId", "serviceId");

-- CreateIndex
CREATE INDEX "EventMealPrice_planId_mealType_idx" ON "EventMealPrice"("planId", "mealType");

-- CreateIndex
CREATE INDEX "EventMealPrice_eventId_idx" ON "EventMealPrice"("eventId");

-- CreateIndex
CREATE INDEX "EventMealPrice_attendeeTypeId_idx" ON "EventMealPrice"("attendeeTypeId");

-- CreateIndex
CREATE INDEX "EventMealSelection_eventId_status_mealType_idx" ON "EventMealSelection"("eventId", "status", "mealType");

-- CreateIndex
CREATE INDEX "EventMealSelection_registrationId_status_idx" ON "EventMealSelection"("registrationId", "status");

-- CreateIndex
CREATE INDEX "EventMealSelection_registrationAttendeeId_idx" ON "EventMealSelection"("registrationAttendeeId");

-- CreateIndex
CREATE INDEX "EventMealSelection_serviceId_status_idx" ON "EventMealSelection"("serviceId", "status");

-- CreateIndex
CREATE INDEX "EventMealSelection_planId_idx" ON "EventMealSelection"("planId");

-- CreateIndex
CREATE INDEX "EventMealSelectionChange_selectionId_createdAt_idx" ON "EventMealSelectionChange"("selectionId", "createdAt");

-- CreateIndex
CREATE INDEX "EventMealSelectionChange_eventId_createdAt_idx" ON "EventMealSelectionChange"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventMealLedgerEntry_registrationAdjustmentId_key" ON "EventMealLedgerEntry"("registrationAdjustmentId");

-- CreateIndex
CREATE INDEX "EventMealLedgerEntry_eventId_createdAt_idx" ON "EventMealLedgerEntry"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventMealLedgerEntry_registrationId_createdAt_idx" ON "EventMealLedgerEntry"("registrationId", "createdAt");

-- CreateIndex
CREATE INDEX "EventMealLedgerEntry_selectionId_idx" ON "EventMealLedgerEntry"("selectionId");

-- AddForeignKey
ALTER TABLE "EventMealService" ADD CONSTRAINT "EventMealService_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealServiceChange" ADD CONSTRAINT "EventMealServiceChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealServiceChange" ADD CONSTRAINT "EventMealServiceChange_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "EventMealService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPlan" ADD CONSTRAINT "EventMealPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPlanService" ADD CONSTRAINT "EventMealPlanService_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPlanService" ADD CONSTRAINT "EventMealPlanService_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EventMealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPlanService" ADD CONSTRAINT "EventMealPlanService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "EventMealService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPrice" ADD CONSTRAINT "EventMealPrice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPrice" ADD CONSTRAINT "EventMealPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EventMealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealPrice" ADD CONSTRAINT "EventMealPrice_attendeeTypeId_fkey" FOREIGN KEY ("attendeeTypeId") REFERENCES "EventAttendeeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelection" ADD CONSTRAINT "EventMealSelection_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelection" ADD CONSTRAINT "EventMealSelection_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EventMealPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelection" ADD CONSTRAINT "EventMealSelection_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "EventMealService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelection" ADD CONSTRAINT "EventMealSelection_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelection" ADD CONSTRAINT "EventMealSelection_registrationAttendeeId_fkey" FOREIGN KEY ("registrationAttendeeId") REFERENCES "RegistrationAttendee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelectionChange" ADD CONSTRAINT "EventMealSelectionChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealSelectionChange" ADD CONSTRAINT "EventMealSelectionChange_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "EventMealSelection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "EventMealSelection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "EventMealSelectionChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "EventMealService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_registrationAdjustmentId_fkey" FOREIGN KEY ("registrationAdjustmentId") REFERENCES "RegistrationAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints and triggers Prisma cannot express (#210). Additive only; no data is read, moved or changed.
-- Services, plans and prices are editable configuration. Selections are never deleted, and the three history tables
-- (service changes, selection changes, the ledger) are append-only. Rows go only with their event: the cascade once
-- the event is gone, or the event deletion service's own explicit deletes (it sets the transaction-local setting
-- `imsda.event_deletion` and removes these rows before the registrations they point at).
-- ---------------------------------------------------------------------------

ALTER TABLE "EventMealService" ADD CONSTRAINT "EventMealService_shape" CHECK (
  length(btrim("name")) > 0
  AND "serviceDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND ("endTime" IS NULL OR ("endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endTime" > "startTime"))
  AND ("capacity" IS NULL OR "capacity" > 0)
  AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL))
);

ALTER TABLE "EventMealPlan" ADD CONSTRAINT "EventMealPlan_shape" CHECK (
  length(btrim("name")) > 0
  AND "code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  AND ("payer" <> 'CONFERENCE' OR "defaultEntitlement" = 'INCLUDED')
  AND (NOT "isDefaultTicketPlan" OR ("payer" = 'ATTENDEE' AND "isActive"))
);

-- At most one plan per event sells the registration form's tickets.
CREATE UNIQUE INDEX "EventMealPlan_one_default_ticket_plan" ON "EventMealPlan"("eventId") WHERE "isDefaultTicketPlan";

ALTER TABLE "EventMealPrice" ADD CONSTRAINT "EventMealPrice_shape" CHECK (
  ("ageGroup" IS NULL) <> ("attendeeTypeId" IS NULL)
  AND "amountCents" >= 0
  AND "amountCents" <= 1000000
);
CREATE UNIQUE INDEX "EventMealPrice_plan_type_age" ON "EventMealPrice"("planId", "mealType", "ageGroup") WHERE "ageGroup" IS NOT NULL;
CREATE UNIQUE INDEX "EventMealPrice_plan_type_attendee_type" ON "EventMealPrice"("planId", "mealType", "attendeeTypeId") WHERE "attendeeTypeId" IS NOT NULL;

ALTER TABLE "EventMealSelection" ADD CONSTRAINT "EventMealSelection_shape" CHECK (
  "quantity" >= 1 AND "quantity" <= 1000
  AND "unitPriceCents" >= 0
  AND "conferenceRateCents" >= 0
  AND ("payer" <> 'CONFERENCE' OR "unitPriceCents" = 0)
  AND (("source" = 'WALK_UP') = ("registrationId" IS NULL))
  AND (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL))
  AND ("orderLabel" IS NULL OR length("orderLabel") <= 60)
  -- A cancelled entitlement may lose its attendee (the attendee row was removed by an amendment, ON DELETE SET NULL).
  AND ("source" <> 'PLAN_ASSIGNMENT' OR "status" = 'CANCELLED' OR ("registrationAttendeeId" IS NOT NULL AND "serviceId" IS NOT NULL))
);

-- One active selection per registration, attendee (or none), meal type, service (or none), age group, payer and origin
-- (registration form or not), so a form ticket and a staff order never collide; a change
-- edits that row's quantity, never adds a second.
CREATE UNIQUE INDEX "EventMealSelection_one_active_slot" ON "EventMealSelection"(
  "registrationId", COALESCE("registrationAttendeeId", ''), "mealType", COALESCE("serviceId", ''), "ageGroup", "payer", ("source" = 'REGISTRATION_FORM')
) WHERE "status" = 'ACTIVE' AND "registrationId" IS NOT NULL;

-- A client request id makes a walk-up or staff order retry-safe.
CREATE UNIQUE INDEX "EventMealSelection_client_request" ON "EventMealSelection"("eventId", "clientRequestId") WHERE "clientRequestId" IS NOT NULL;

ALTER TABLE "EventMealLedgerEntry" ADD CONSTRAINT "EventMealLedgerEntry_shape" CHECK (
  "quantity" >= 1
  AND "unitPriceCents" >= 0
  AND (
    ("kind" = 'CHARGE' AND "amountCents" > 0 AND "amountCents" = "quantity" * "unitPriceCents")
    OR ("kind" = 'CREDIT' AND "amountCents" < 0 AND "amountCents" = -("quantity" * "unitPriceCents"))
  )
  AND (("settlement" = 'REGISTRATION_ADJUSTMENT') = ("registrationAdjustmentId" IS NOT NULL))
  AND (("settlement" = 'AT_COUNTER') = ("registrationId" IS NULL))
  AND ("payer" <> 'CONFERENCE' OR "registrationAdjustmentId" IS NULL)
);

-- Same-event integrity, checked when a row is made.
CREATE FUNCTION "EventMealPlanService_same_event"() RETURNS trigger AS $$
BEGIN
  IF (SELECT "eventId" FROM "EventMealPlan" WHERE "id" = NEW."planId") IS DISTINCT FROM NEW."eventId"
     OR (SELECT "eventId" FROM "EventMealService" WHERE "id" = NEW."serviceId") IS DISTINCT FROM NEW."eventId" THEN
    RAISE EXCEPTION 'A plan covers only services of its own event.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealPlanService_same_event" BEFORE INSERT OR UPDATE OF "planId", "serviceId", "eventId" ON "EventMealPlanService" FOR EACH ROW EXECUTE FUNCTION "EventMealPlanService_same_event"();

CREATE FUNCTION "EventMealPrice_same_event"() RETURNS trigger AS $$
BEGIN
  IF (SELECT "eventId" FROM "EventMealPlan" WHERE "id" = NEW."planId") IS DISTINCT FROM NEW."eventId"
     OR (NEW."attendeeTypeId" IS NOT NULL AND (SELECT "eventId" FROM "EventAttendeeType" WHERE "id" = NEW."attendeeTypeId") IS DISTINCT FROM NEW."eventId") THEN
    RAISE EXCEPTION 'A meal price belongs to a plan and an attendee type of the same event.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealPrice_same_event" BEFORE INSERT OR UPDATE OF "planId", "attendeeTypeId", "eventId" ON "EventMealPrice" FOR EACH ROW EXECUTE FUNCTION "EventMealPrice_same_event"();

CREATE FUNCTION "EventMealSelection_same_event"() RETURNS trigger AS $$
BEGIN
  IF (SELECT "eventId" FROM "EventMealPlan" WHERE "id" = NEW."planId") IS DISTINCT FROM NEW."eventId"
     OR (NEW."serviceId" IS NOT NULL AND (SELECT "eventId" FROM "EventMealService" WHERE "id" = NEW."serviceId") IS DISTINCT FROM NEW."eventId")
     OR (NEW."registrationId" IS NOT NULL AND (SELECT "eventId" FROM "Registration" WHERE "id" = NEW."registrationId") IS DISTINCT FROM NEW."eventId")
     OR (NEW."registrationAttendeeId" IS NOT NULL AND (SELECT "registrationId" FROM "RegistrationAttendee" WHERE "id" = NEW."registrationAttendeeId") IS DISTINCT FROM NEW."registrationId") THEN
    RAISE EXCEPTION 'A meal selection stays inside one event, registration and attendee.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."registrationId" IS DISTINCT FROM OLD."registrationId"
    OR NEW."mealType" IS DISTINCT FROM OLD."mealType"
    OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId"
    OR NEW."source" IS DISTINCT FROM OLD."source"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'A meal selection keeps its event, registration, meal, service and source; a substitution is a new selection.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'CANCELLED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'A cancelled meal selection stays cancelled; order again instead.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealSelection_same_event" BEFORE INSERT OR UPDATE ON "EventMealSelection" FOR EACH ROW EXECUTE FUNCTION "EventMealSelection_same_event"();

CREATE FUNCTION "EventMealLedgerEntry_same_selection"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "EventMealSelectionChange" c
    JOIN "EventMealSelection" s ON s."id" = c."selectionId"
    WHERE c."id" = NEW."changeId" AND c."selectionId" = NEW."selectionId" AND s."eventId" = NEW."eventId"
      AND s."registrationId" IS NOT DISTINCT FROM NEW."registrationId"
  ) THEN
    RAISE EXCEPTION 'A meal ledger entry belongs to a change of its own selection.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealLedgerEntry_same_selection" BEFORE INSERT ON "EventMealLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "EventMealLedgerEntry_same_selection"();

-- Append-only history: never updated; deleted only with the event.
CREATE FUNCTION "EventMealHistory_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
    current_setting('imsda.event_deletion', true) = 'on'
    OR (pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM "Event" WHERE "id" = OLD."eventId"))
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Meal history and ledger rows are append-only.' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealServiceChange_append_only" BEFORE UPDATE OR DELETE ON "EventMealServiceChange" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();
CREATE TRIGGER "EventMealSelectionChange_append_only" BEFORE UPDATE OR DELETE ON "EventMealSelectionChange" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();
CREATE TRIGGER "EventMealLedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "EventMealLedgerEntry" FOR EACH ROW EXECUTE FUNCTION "EventMealHistory_append_only"();

-- Selections are never deleted while their event exists.
CREATE FUNCTION "EventMealSelection_refuse_delete"() RETURNS trigger AS $$
BEGIN
  IF current_setting('imsda.event_deletion', true) = 'on'
     OR (pg_trigger_depth() > 1 AND NOT EXISTS (SELECT 1 FROM "Event" WHERE "id" = OLD."eventId")) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Meal selections are never deleted; cancel them instead.' USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "EventMealSelection_no_delete" BEFORE DELETE ON "EventMealSelection" FOR EACH ROW EXECUTE FUNCTION "EventMealSelection_refuse_delete"();
