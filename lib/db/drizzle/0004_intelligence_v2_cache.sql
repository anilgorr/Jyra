CREATE TYPE "public"."intelligence_v2_cache_kind" AS ENUM('RESEARCH', 'PROFILE', 'ASSESSMENT');--> statement-breakpoint
CREATE TABLE "intelligence_v2_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "intelligence_v2_cache_kind" NOT NULL,
	"cache_key" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intelligence_v2_cache" ADD CONSTRAINT "intelligence_v2_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_cache" ADD CONSTRAINT "intelligence_v2_cache_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_v2_cache" ADD CONSTRAINT "intelligence_v2_cache_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_v2_cache_kind_key_idx" ON "intelligence_v2_cache" USING btree ("kind","cache_key");--> statement-breakpoint
CREATE INDEX "intelligence_v2_cache_company_idx" ON "intelligence_v2_cache" USING btree ("company_id","kind");