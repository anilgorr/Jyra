CREATE TYPE "public"."intelligence_v2_cycle_trigger" AS ENUM('MANUAL', 'SCHEDULED');--> statement-breakpoint
CREATE TABLE "intelligence_v2_changesets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"assessment_id" uuid,
	"trigger" "intelligence_v2_cycle_trigger" NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"previous_profile_fingerprint" text,
	"profile_fingerprint" text NOT NULL,
	"profile_changed" boolean NOT NULL,
	"evidence_added" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_removed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdict_before" jsonb,
	"verdict_after" jsonb NOT NULL,
	"verdict_changed" boolean NOT NULL,
	"facts_added" integer DEFAULT 0 NOT NULL,
	"signals_created" integer DEFAULT 0 NOT NULL,
	"score_before" jsonb,
	"score_after" jsonb,
	"score_changed" boolean NOT NULL,
	"has_changes" boolean NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"cost_total" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence_v2_changesets" ADD CONSTRAINT "intelligence_v2_changesets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_changesets" ADD CONSTRAINT "intelligence_v2_changesets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_changesets" ADD CONSTRAINT "intelligence_v2_changesets_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_changesets" ADD CONSTRAINT "intelligence_v2_changesets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_changesets" ADD CONSTRAINT "intelligence_v2_changesets_assessment_id_intelligence_v2_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."intelligence_v2_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_v2_changesets_project_observed_idx" ON "intelligence_v2_changesets" USING btree ("project_id","observed_at");--> statement-breakpoint
CREATE INDEX "intelligence_v2_changesets_project_company_observed_idx" ON "intelligence_v2_changesets" USING btree ("project_company_id","observed_at");--> statement-breakpoint
CREATE INDEX "intelligence_v2_changesets_project_changes_idx" ON "intelligence_v2_changesets" USING btree ("project_id","has_changes","observed_at");