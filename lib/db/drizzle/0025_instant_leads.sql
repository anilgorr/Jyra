CREATE TABLE "credit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"requested_by_user_id" text NOT NULL,
	"credits" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"granted_entry_id" uuid,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instant_lead_run_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"score" real NOT NULL,
	"opportunity_state" text,
	"why" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_status" text DEFAULT 'NONE' NOT NULL,
	"contact_person_id" uuid,
	"contact_credits" integer DEFAULT 0 NOT NULL,
	"contact_entry_id" uuid,
	"contact_revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instant_lead_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested" integer NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"candidates_found" integer DEFAULT 0 NOT NULL,
	"candidates_accepted" integer DEFAULT 0 NOT NULL,
	"researched" integer DEFAULT 0 NOT NULL,
	"confirmed" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"eta_seconds" integer,
	"credits_per_lead" integer NOT NULL,
	"credits_held" integer NOT NULL,
	"credits_settled" integer DEFAULT 0 NOT NULL,
	"hold_entry_id" uuid,
	"settle_entry_id" uuid,
	"icp_version_id" uuid,
	"business_twin_version_id" uuid,
	"signal_pack_id" uuid,
	"signal_pack_version" text,
	"filters" jsonb,
	"widened" boolean DEFAULT false NOT NULL,
	"pending_project_company_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"touched_project_company_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_calls" integer DEFAULT 0 NOT NULL,
	"provider_cost_usd" real DEFAULT 0 NOT NULL,
	"research_cost_usd" real DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"outcome_note" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_packs" ADD COLUMN "buying_roles" jsonb DEFAULT '{"roles":[],"fallbackUnderHeadcount":50,"fallbackTitles":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "credits_per_instant_lead" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "credits_per_contact_verified" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "credits_per_contact_catch_all" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_requests" ADD CONSTRAINT "credit_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_run_leads" ADD CONSTRAINT "instant_lead_run_leads_run_id_instant_lead_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."instant_lead_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_run_leads" ADD CONSTRAINT "instant_lead_run_leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_run_leads" ADD CONSTRAINT "instant_lead_run_leads_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_run_leads" ADD CONSTRAINT "instant_lead_run_leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_run_leads" ADD CONSTRAINT "instant_lead_run_leads_contact_person_id_people_id_fk" FOREIGN KEY ("contact_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_runs" ADD CONSTRAINT "instant_lead_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_runs" ADD CONSTRAINT "instant_lead_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instant_lead_runs" ADD CONSTRAINT "instant_lead_runs_signal_pack_id_signal_packs_id_fk" FOREIGN KEY ("signal_pack_id") REFERENCES "public"."signal_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_requests_org_status_idx" ON "credit_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "instant_lead_run_leads_run_company_unique" ON "instant_lead_run_leads" USING btree ("run_id","project_company_id");--> statement-breakpoint
CREATE INDEX "instant_lead_run_leads_project_company_idx" ON "instant_lead_run_leads" USING btree ("project_id","project_company_id");--> statement-breakpoint
CREATE INDEX "instant_lead_runs_project_idx" ON "instant_lead_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "instant_lead_runs_status_idx" ON "instant_lead_runs" USING btree ("status");--> statement-breakpoint
-- Crustdata: the on-demand company and person data source behind Instant
-- Leads. Registered without capability rows on purpose: the router must not
-- pick it up as a fallback for the text-query discovery that Exa serves. The
-- instant-leads engine calls it directly and records spend itself. The row
-- exists so the admin providers page shows it and its key status.
INSERT INTO "data_providers" ("name", "provider_type", "enabled", "priority", "estimated_cost", "success_rate", "average_latency", "quality_score", "configuration")
VALUES (
  'Crustdata', 'crustdata', true, 20, 0.005, 0, 0, 0.9,
  '{"routingRole":"ON_DEMAND","onDemandCapabilities":["COMPANY_DISCOVERY","PERSON_LOOKUP"],"apiBaseUrl":"https://api.crustdata.com","apiVersion":"2025-11-01","usdPerCredit":0.1,"timeoutMs":30000,"searchCreditsPerResult":0.03,"personEnrichCreditsBase":1,"personEnrichCreditsBusinessEmail":0.5}'::jsonb
)
ON CONFLICT ("name") DO NOTHING;
