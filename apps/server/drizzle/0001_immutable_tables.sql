-- graph_versions are immutable snapshots and run_events is an append-only log:
-- reject any UPDATE at the database level, whatever client issues it.
CREATE FUNCTION "reject_row_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'table "%" is append-only: rows cannot be updated', TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "graph_versions_reject_update"
	BEFORE UPDATE ON "graph_versions"
	FOR EACH ROW EXECUTE FUNCTION "reject_row_update"();
--> statement-breakpoint
CREATE TRIGGER "run_events_reject_update"
	BEFORE UPDATE ON "run_events"
	FOR EACH ROW EXECUTE FUNCTION "reject_row_update"();
