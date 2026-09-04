CREATE TYPE "public"."intelligence_v2_commercial_role" AS ENUM('POTENTIAL_BUYER', 'SELLER_COMPETITOR', 'ADJACENT_VENDOR', 'PARTNER_POSSIBLE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."intelligence_v2_identity_status" AS ENUM('RESOLVED', 'IDENTITY_UNCERTAIN');--> statement-breakpoint
CREATE TYPE "public"."intelligence_v2_who_value" AS ENUM('LIKELY_FIT', 'POSSIBLE_FIT', 'LIKELY_NOT_FIT', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TABLE "intelligence_v2_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"icp_version_id" uuid,
	"intelligence_version" text NOT NULL,
	"identity_status" "intelligence_v2_identity_status" NOT NULL,
	"identity_confidence" real NOT NULL,
	"commercial_role" "intelligence_v2_commercial_role" NOT NULL,
	"commercial_role_confidence" real NOT NULL,
	"commercial_role_reason" text NOT NULL,
	"who_value" "intelligence_v2_who_value" NOT NULL,
	"who_confidence" real NOT NULL,
	"who_reason" text NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assessment_confidence" real NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"research_provider_calls" integer DEFAULT 0 NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"cost_total" real DEFAULT 0 NOT NULL,
	"profile_fingerprint" text NOT NULL,
	"assessment_fingerprint" text NOT NULL,
	"run_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intelligence_v2_assessments_identity_confidence_unit" CHECK ("intelligence_v2_assessments"."identity_confidence" >= 0 and "intelligence_v2_assessments"."identity_confidence" <= 1),
	CONSTRAINT "intelligence_v2_assessments_role_confidence_unit" CHECK ("intelligence_v2_assessments"."commercial_role_confidence" >= 0 and "intelligence_v2_assessments"."commercial_role_confidence" <= 1),
	CONSTRAINT "intelligence_v2_assessments_who_confidence_unit" CHECK ("intelligence_v2_assessments"."who_confidence" >= 0 and "intelligence_v2_assessments"."who_confidence" <= 1),
	CONSTRAINT "intelligence_v2_assessments_assessment_confidence_unit" CHECK ("intelligence_v2_assessments"."assessment_confidence" >= 0 and "intelligence_v2_assessments"."assessment_confidence" <= 1),
	CONSTRAINT "intelligence_v2_assessments_counts_nonnegative" CHECK ("intelligence_v2_assessments"."evidence_count" >= 0 and "intelligence_v2_assessments"."research_provider_calls" >= 0 and "intelligence_v2_assessments"."model_calls" >= 0 and "intelligence_v2_assessments"."cost_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "intelligence_v2_assessments" ADD CONSTRAINT "intelligence_v2_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_assessments" ADD CONSTRAINT "intelligence_v2_assessments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_assessments" ADD CONSTRAINT "intelligence_v2_assessments_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_assessments" ADD CONSTRAINT "intelligence_v2_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_assessments" ADD CONSTRAINT "intelligence_v2_assessments_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intelligence_v2_assessments_project_company_created_idx" ON "intelligence_v2_assessments" USING btree ("project_company_id","created_at");--> statement-breakpoint
CREATE INDEX "intelligence_v2_assessments_project_idx" ON "intelligence_v2_assessments" USING btree ("project_id");