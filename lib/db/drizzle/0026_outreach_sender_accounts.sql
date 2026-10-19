CREATE TABLE "outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unipile_event_id" text NOT NULL,
	"type" text NOT NULL,
	"unipile_account_id" text,
	"sender_account_id" uuid,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sender_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"sender_account_id" uuid,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"link_url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"provider" text NOT NULL,
	"unipile_account_id" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'CONNECTED' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_event_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_sender_account_id_sender_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."sender_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_account_links" ADD CONSTRAINT "sender_account_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_account_links" ADD CONSTRAINT "sender_account_links_sender_account_id_sender_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."sender_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_accounts" ADD CONSTRAINT "sender_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_events_unipile_event_id_idx" ON "outreach_events" USING btree ("unipile_event_id");--> statement-breakpoint
CREATE INDEX "outreach_events_sender_account_id_idx" ON "outreach_events" USING btree ("sender_account_id");--> statement-breakpoint
CREATE INDEX "outreach_events_type_idx" ON "outreach_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sender_account_links_organization_id_idx" ON "sender_account_links" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_accounts_unipile_account_id_idx" ON "sender_accounts" USING btree ("unipile_account_id");--> statement-breakpoint
CREATE INDEX "sender_accounts_organization_id_idx" ON "sender_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sender_accounts_user_id_idx" ON "sender_accounts" USING btree ("user_id");