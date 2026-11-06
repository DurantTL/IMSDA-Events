-- Key rotation (#1516) must be able to re-seal a sealed health copy's value. The guard that
-- makes sealed copies immutable is replaced so that exactly one UPDATE is allowed: on a
-- HealthRecordSnapshotField row, inside a transaction that set `imsda.key_rotation` to 'on',
-- changing nothing but "sealedValue". Every other UPDATE (including any change to a
-- HealthRecordSnapshot row) is still refused, and the DELETE rules are unchanged.

CREATE OR REPLACE FUNCTION "HealthRecordSnapshot_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'HealthRecordSnapshotField'
       AND COALESCE(current_setting('imsda.key_rotation', true), '') = 'on'
       AND (to_jsonb(NEW) - 'sealedValue') = (to_jsonb(OLD) - 'sealedValue') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Sealed health snapshots are immutable.' USING ERRCODE = '23001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('imsda.health_snapshot_retention', true), '') = 'on'
       OR COALESCE(current_setting('imsda.event_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Sealed health snapshots are deleted only by the retention job or with their event.' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
