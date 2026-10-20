CREATE TABLE "campaign_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_lead_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"sender_account_id" uuid,
	"status" text DEFAULT 'DRAFTING' NOT NULL,
	"target_post_id" text,
	"target_post_text" text,
	"target_post_url" text,
	"subject" text,
	"body" text,
	"draft_source" jsonb,
	"scheduled_for" timestamp with time zone,
	"done_at" timestamp with time zone,
	"provider_message_id" text,
	"provider_thread_id" text,
	"provider_chat_id" text,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"playbook" jsonb NOT NULL,
	"next_step_index" integer DEFAULT 0 NOT NULL,
	"next_action_at" timestamp with time zone,
	"connection" text DEFAULT 'NONE' NOT NULL,
	"connection_requested_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"booked_at" timestamp with time zone,
	"booked_by_user_id" text,
	"booking_note" text,
	"stop_reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"offer" jsonb NOT NULL,
	"audience" jsonb DEFAULT '{"kind":"MANUAL"}'::jsonb NOT NULL,
	"playbook" jsonb NOT NULL,
	"sender_accounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"master_prompt" text DEFAULT '' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"daily_caps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" text,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_id" uuid,
	"campaign_lead_id" uuid,
	"action_id" uuid,
	"sender_account_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"kind" text,
	"provider_message_id" text NOT NULL,
	"provider_thread_id" text,
	"provider_chat_id" text,
	"subject" text,
	"text" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"box" text,
	"box_reason" text,
	"read_at" timestamp with time zone,
	"sent_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"first_name" text,
	"title" text,
	"company_name" text,
	"company_domain" text,
	"company_website" text,
	"location" text,
	"linkedin_url" text,
	"linkedin_handle" text,
	"linkedin_provider_id" text,
	"email" text,
	"email_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"phone" text,
	"instagram_handle" text,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief" jsonb,
	"brief_at" timestamp with time zone,
	"brief_error" text,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"do_not_contact_reason" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_actions" ADD CONSTRAINT "campaign_actions_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("campaign_lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_actions" ADD CONSTRAINT "campaign_actions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_actions" ADD CONSTRAINT "campaign_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_actions" ADD CONSTRAINT "campaign_actions_sender_account_id_sender_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."sender_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("campaign_lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_action_id_campaign_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."campaign_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_sender_account_id_sender_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."sender_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_actions_lead_step_idx" ON "campaign_actions" USING btree ("campaign_lead_id","step_index");--> statement-breakpoint
CREATE INDEX "campaign_actions_due_idx" ON "campaign_actions" USING btree ("sender_account_id","status","scheduled_for");--> statement-breakpoint
CREATE INDEX "campaign_actions_done_idx" ON "campaign_actions" USING btree ("sender_account_id","done_at");--> statement-breakpoint
CREATE INDEX "campaign_actions_queue_idx" ON "campaign_actions" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_leads_campaign_lead_idx" ON "campaign_leads" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_status_idx" ON "campaign_leads" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_leads_due_idx" ON "campaign_leads" USING btree ("status","next_action_at");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_messages_provider_idx" ON "lead_messages" USING btree ("sender_account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "lead_messages_lead_idx" ON "lead_messages" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_messages_inbox_idx" ON "lead_messages" USING btree ("organization_id","direction","read_at");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_linkedin_handle_idx" ON "leads" USING btree ("organization_id","linkedin_handle");--> statement-breakpoint
CREATE INDEX "leads_org_email_idx" ON "leads" USING btree ("organization_id","email");