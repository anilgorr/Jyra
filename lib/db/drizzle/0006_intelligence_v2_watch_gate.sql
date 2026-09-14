CREATE TYPE "public"."project_company_watch_tier" AS ENUM('HOT', 'DAILY', 'COLD');--> statement-breakpoint
CREATE TYPE "public"."intelligence_v2_watch_decision" AS ENUM('UNCHANGED', 'CHANGED', 'REFRESH', 'BASELINE', 'UNGATED');--> statement-breakpoint
CREATE TABLE "intelligence_v2_watch_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"tier" "project_company_watch_tier" NOT NULL,
	"decision" "intelligence_v2_watch_decision" NOT NULL,
	"reason" text NOT NULL,
	"pages_checked" integer DEFAULT 0 NOT NULL,
	"pages_changed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_count_before" integer,
	"job_count_after" integer,
	"cost_total" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "page_fingerprints" jsonb;--> statement-breakpoint
ALTER TABLE "project_companies" ADD COLUMN "watch_tier" "project_company_watch_tier" DEFAULT 'COLD' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_companies" ADD COLUMN "last_watched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_companies" ADD COLUMN "last_change_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "intelligence_v2_watch_checks" ADD CONSTRAINT "intelligence_v2_watch_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_watch_checks" ADD CONSTRAINT "intelligence_v2_watch_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_watch_checks" ADD CONSTRAINT "intelligence_v2_watch_checks_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_watch_checks" ADD CONSTRAINT "intelligence_v2_watch_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_v2_watch_checks_project_observed_idx" ON "intelligence_v2_watch_checks" USING btree ("project_id","observed_at");--> statement-breakpoint
CREATE INDEX "intelligence_v2_watch_checks_project_company_observed_idx" ON "intelligence_v2_watch_checks" USING btree ("project_company_id","observed_at");--> statement-breakpoint
CREATE INDEX "project_companies_watch_idx" ON "project_companies" USING btree ("status","watch_tier","last_watched_at");