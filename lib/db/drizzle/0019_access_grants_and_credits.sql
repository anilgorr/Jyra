-- Access grants (the invite-only door) and credits (the only cost a customer sees).
-- See lib/db/src/schema/access-grants.ts and credits.ts for the reasoning.

CREATE TYPE "public"."access_grant_status" AS ENUM('invited', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."credit_entry_kind" AS ENUM('allowance', 'grant', 'purchase', 'debit', 'adjustment');--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"organization_id" uuid,
	"organization_name" text,
	"plan_code" text NOT NULL,
	"initial_credits" integer DEFAULT 0 NOT NULL,
	"status" "access_grant_status" DEFAULT 'invited' NOT NULL,
	"note" text,
	"clerk_user_id" text,
	"invited_by_user_id" text,
	"first_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "credit_entry_kind" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"monthly_allowance" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_credits_organization_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "credits_per_month" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_grants_email_unique" ON "access_grants" USING btree ("email");--> statement-breakpoint
CREATE INDEX "access_grants_organization_idx" ON "access_grants" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "access_grants_clerk_user_idx" ON "access_grants" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_organization_created_idx" ON "credit_ledger" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_kind_idx" ON "credit_ledger" USING btree ("kind");
--> statement-breakpoint
-- A balance below zero is a debit that should have been refused.
ALTER TABLE "organization_credits" ADD CONSTRAINT "organization_credits_balance_nonnegative" CHECK ("balance" >= 0);--> statement-breakpoint
-- 0018 enabled RLS on the tables that existed then; these are new and must not be the exception.
ALTER TABLE "access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_credits" ENABLE ROW LEVEL SECURITY;
