CREATE TABLE "outreach_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"person_id" uuid,
	"contact" jsonb NOT NULL,
	"sender_accounts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"basis" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFTING' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_action_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"stop_reason" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"credit_entry_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"enrollment_id" uuid,
	"step_id" uuid,
	"sender_account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"step_kind" text,
	"provider_message_id" text NOT NULL,
	"provider_thread_id" text,
	"provider_chat_id" text,
	"from_address" text,
	"to_address" text,
	"subject" text,
	"text" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"classification" text,
	"classification_reason" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"master_prompt" text DEFAULT '' NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"compliance_footer" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'DRAFTING' NOT NULL,
	"subject" text,
	"body" text,
	"draft_source" jsonb,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
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
CREATE TABLE "outreach_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "credits_per_outreach_contact" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_enrollments" ADD CONSTRAINT "outreach_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_enrollments" ADD CONSTRAINT "outreach_enrollments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_enrollments" ADD CONSTRAINT "outreach_enrollments_sequence_id_outreach_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."outreach_sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_enrollments" ADD CONSTRAINT "outreach_enrollments_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_enrollments" ADD CONSTRAINT "outreach_enrollments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_enrollments" ADD CONSTRAINT "outreach_enrollments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_enrollment_id_outreach_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."outreach_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_step_id_outreach_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."outreach_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_sender_account_id_sender_accounts_id_fk" FOREIGN KEY ("sender_account_id") REFERENCES "public"."sender_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_sequences" ADD CONSTRAINT "outreach_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_sequences" ADD CONSTRAINT "outreach_sequences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_steps" ADD CONSTRAINT "outreach_steps_enrollment_id_outreach_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."outreach_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_steps" ADD CONSTRAINT "outreach_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_suppressions" ADD CONSTRAINT "outreach_suppressions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_enrollments_project_status_idx" ON "outreach_enrollments" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "outreach_enrollments_organization_person_idx" ON "outreach_enrollments" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "outreach_enrollments_next_action_idx" ON "outreach_enrollments" USING btree ("status","next_action_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_messages_provider_idx" ON "outreach_messages" USING btree ("sender_account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "outreach_messages_enrollment_idx" ON "outreach_messages" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "outreach_messages_sender_occurred_idx" ON "outreach_messages" USING btree ("sender_account_id","direction","occurred_at");--> statement-breakpoint
CREATE INDEX "outreach_messages_project_direction_idx" ON "outreach_messages" USING btree ("project_id","direction","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_sequences_project_name_idx" ON "outreach_sequences" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_steps_enrollment_index_idx" ON "outreach_steps" USING btree ("enrollment_id","step_index");--> statement-breakpoint
CREATE INDEX "outreach_steps_status_scheduled_idx" ON "outreach_steps" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "outreach_steps_provider_thread_idx" ON "outreach_steps" USING btree ("provider_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_suppressions_org_kind_value_idx" ON "outreach_suppressions" USING btree ("organization_id","kind","value");