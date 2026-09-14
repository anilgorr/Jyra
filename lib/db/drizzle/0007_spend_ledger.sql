CREATE TYPE "public"."spend_kind" AS ENUM('PROVIDER', 'MODEL', 'GATE');--> statement-breakpoint
CREATE TYPE "public"."spend_outcome" AS ENUM('success', 'empty', 'failed');--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"project_id" uuid,
	"project_company_id" uuid,
	"company_id" uuid,
	"kind" "spend_kind" NOT NULL,
	"source" text NOT NULL,
	"capability" text,
	"outcome" "spend_outcome" NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"request_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_ledger_organization_occurred_idx" ON "spend_ledger" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_project_occurred_idx" ON "spend_ledger" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_company_occurred_idx" ON "spend_ledger" USING btree ("project_company_id","occurred_at");