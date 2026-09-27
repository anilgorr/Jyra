-- One news search for a company's events: window, query set and outcome.
-- Lets the pipeline sweep the past year once and then only the last month,
-- weekly, instead of re-searching the whole year every cycle.
-- See schema/company-event-searches.ts.
CREATE TABLE "company_event_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window" text NOT NULL,
	"query_set" text NOT NULL,
	"trigger" text NOT NULL,
	"queries" integer NOT NULL,
	"hits" integer NOT NULL,
	"usable" integer NOT NULL,
	"skipped" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_event_searches" ADD CONSTRAINT "company_event_searches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_event_searches" ADD CONSTRAINT "company_event_searches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_event_searches_company_idx" ON "company_event_searches" USING btree ("company_id","searched_at");--> statement-breakpoint
-- New table: RLS on, like every other table since 0018.
ALTER TABLE "company_event_searches" ENABLE ROW LEVEL SECURITY;
