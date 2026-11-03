-- A workspace whose data was removed after the owner's deletion request keeps only a tombstone row;
-- `purgedAt` marks it.
ALTER TABLE "organizations" ADD COLUMN "purgedAt" TIMESTAMP(3);

-- The append-only tables still reject every UPDATE and every DELETE, with one exception: a purge
-- of a whole workspace sets the transaction-local setting `app.purge_org` to that organization's id
-- (SELECT set_config('app.purge_org', <id>, true)), and then only that organization's rows may be
-- deleted. The setting disappears when the transaction ends.
CREATE OR REPLACE FUNCTION "point_events_reject_change"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."organizationId"::text = current_setting('app.purge_org', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'point_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "consent_events_reject_change"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."organizationId"::text = current_setting('app.purge_org', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "contact_stage_changes_reject_change"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."organizationId"::text = current_setting('app.purge_org', true) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'contact_stage_changes is append-only';
END;
$$ LANGUAGE plpgsql;

-- Rollback (manual): ALTER TABLE "organizations" DROP COLUMN "purgedAt"; then re-create the three
-- functions with only `RAISE EXCEPTION '<table> is append-only';` as the body (see migrations
-- 20261029080000_engagement, 20261029120000_crm and 20261030100000_customer_journey).
