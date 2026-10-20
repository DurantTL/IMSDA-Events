-- Registration form notifications (#1081): several notification emails per registration form, routed by one answer
-- (location, or a registration-level field) and limited to chosen sections of the registration PDF. Additive only: two
-- new tables. Applying this in production is a human step.

-- CreateTable
CREATE TABLE "RegistrationFormNotification" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "recipients" TEXT[],
    "conditionFieldKey" TEXT,
    "conditionOperator" TEXT,
    "conditionValue" TEXT,
    "sectionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationFormNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationNotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sectionSignature" TEXT NOT NULL,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationNotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationFormNotification_formId_position_idx" ON "RegistrationFormNotification"("formId", "position");

-- CreateIndex
CREATE INDEX "RegistrationNotificationDelivery_registrationId_idx" ON "RegistrationNotificationDelivery"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationNotificationDelivery_notificationId_registratio_key" ON "RegistrationNotificationDelivery"("notificationId", "registrationId");

-- AddForeignKey
ALTER TABLE "RegistrationFormNotification" ADD CONSTRAINT "RegistrationFormNotification_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationNotificationDelivery" ADD CONSTRAINT "RegistrationNotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "RegistrationFormNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationNotificationDelivery" ADD CONSTRAINT "RegistrationNotificationDelivery_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
