CREATE TABLE "intent_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"month" date NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"who" text NOT NULL,
	"commercial_role" text NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_summary" text,
	"score_at_delivery" real,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intent_accounts_company_month_unique" UNIQUE("project_company_id","month")
);
--> statement-breakpoint
ALTER TABLE "intent_accounts" ADD CONSTRAINT "intent_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_accounts" ADD CONSTRAINT "intent_accounts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_accounts" ADD CONSTRAINT "intent_accounts_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intent_accounts" ADD CONSTRAINT "intent_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intent_accounts_organization_month_idx" ON "intent_accounts" USING btree ("organization_id","month");--> statement-breakpoint
CREATE INDEX "intent_accounts_project_month_idx" ON "intent_accounts" USING btree ("project_id","month");