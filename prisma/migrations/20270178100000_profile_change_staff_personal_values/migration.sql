-- Staff correction of address and emergency contact keeps values (#1512). ADDITIVE-STYLE: no table, column or row changes.
-- It only replaces one check on "AttendeeProfileChange": values stay allowed for first name, last name, phone and shirt
-- size, and are now also allowed for the mailing address and emergency contact fields when the row is a STAFF_CORRECTION.
-- Rows from any other source keep the field name alone. The health-field check is unchanged. Existing rows already satisfy
-- the new check (it is looser than the old one). Applying it in production is a human step (back up first).

ALTER TABLE "AttendeeProfileChange" DROP CONSTRAINT "AttendeeProfileChange_value_retention_check";

ALTER TABLE "AttendeeProfileChange" ADD CONSTRAINT "AttendeeProfileChange_value_retention_check" CHECK (
  "field" IN ('firstName', 'lastName', 'phone', 'shirtSize')
  OR (
    "source" = 'STAFF_CORRECTION'
    AND "field" IN (
      'mailingLine1', 'mailingLine2', 'mailingCity', 'mailingRegion', 'mailingPostalCode', 'mailingCountry',
      'emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone'
    )
  )
  OR ("oldValue" IS NULL AND "newValue" IS NULL)
);
