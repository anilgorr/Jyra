-- A person's verdict on what JYRA ranked. Precision@10 per organisation per week
-- is computed from this table and nothing else. See schema/signal-feedback.ts.
CREATE TYPE "public"."signal_feedback_reason" AS ENUM('WRONG_COMPANY', 'NOT_OUR_BUYER', 'TOO_OLD', 'ALREADY_CUSTOMER', 'WRONG_SIGNAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."signal_feedback_verdict" AS ENUM('RELEVANT', 'NOT_RELEVANT');--> statement-breakpoint
CREATE TABLE "signal_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"signal_id" uuid,
	"verdict" "signal_feedback_verdict" NOT NULL,
	"reason" "signal_feedback_reason",
	"note" text,
	"rank_at_feedback" integer,
	"score_at_feedback" real,
	"state_at_feedback" text,
	"week_start" date NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_feedback_company_user_week_unique" ON "signal_feedback" USING btree ("project_company_id","recorded_by","week_start");--> statement-breakpoint
CREATE INDEX "signal_feedback_org_week_idx" ON "signal_feedback" USING btree ("organization_id","week_start");--> statement-breakpoint
CREATE INDEX "signal_feedback_project_week_idx" ON "signal_feedback" USING btree ("project_id","week_start");--> statement-breakpoint
-- New table: RLS on, like every other table since 0018.
ALTER TABLE "signal_feedback" ENABLE ROW LEVEL SECURITY;
