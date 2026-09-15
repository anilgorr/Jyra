-- Signals that differ only in rule_version are the same observation recorded
-- twice. rule_version embeds the project pack selection's updatedAt, so a
-- project editing its pack configuration minted a new "identity" for every
-- signal it already had. Keep the newest row per observation — it carries the
-- current strength and the current rule version — and drop the rest.
-- signal_facts, signal_evidence and cluster memberships cascade.
DELETE FROM "signals" s
USING "signals" newer
WHERE s."project_id" = newer."project_id"
  AND s."company_id" = newer."company_id"
  AND s."signal_definition_id" = newer."signal_definition_id"
  AND s."effective_date" = newer."effective_date"
  AND (s."detected_at", s."id") < (newer."detected_at", newer."id");
--> statement-breakpoint
DROP INDEX "signals_observation_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "signals_observation_unique" ON "signals" USING btree ("project_id","company_id","signal_definition_id","effective_date");
