CREATE TYPE "public"."organization_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."business_maturity_stage" AS ENUM('PRE_LAUNCH', 'LAUNCHED_NO_CUSTOMERS', 'EARLY_CUSTOMERS', 'REPEATABLE_SALES', 'ESTABLISHED');--> statement-breakpoint
CREATE TYPE "public"."business_twin_version_status" AS ENUM('ready', 'manual');--> statement-breakpoint
CREATE TYPE "public"."evidence_provenance" AS ENUM('FOUNDER_HYPOTHESIS', 'CUSTOMER_INTERVIEW', 'DESIGN_PARTNER', 'PILOT', 'CUSTOMER', 'CRM_HISTORY', 'SALES_OUTCOME', 'USER_CONFIRMED', 'AI_INFERRED');--> statement-breakpoint
CREATE TYPE "public"."icp_criterion_evaluability" AS ENUM('scorable', 'advisory');--> statement-breakpoint
CREATE TYPE "public"."icp_criterion_operator" AS ENUM('EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'CONTAINS', 'EXISTS', 'BOOLEAN');--> statement-breakpoint
CREATE TYPE "public"."icp_criterion_source" AS ENUM('business_twin', 'manual');--> statement-breakpoint
CREATE TYPE "public"."icp_criterion_type" AS ENUM('MUST_HAVE', 'PREFERRED', 'DISQUALIFIER', 'ADVISORY');--> statement-breakpoint
CREATE TYPE "public"."icp_mode" AS ENUM('HYPOTHESIS_ICP', 'EARLY_EVIDENCE_ICP', 'VALIDATED_ICP');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('UNTESTED', 'PARTIALLY_VALIDATED', 'VALIDATED', 'CONTRADICTED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."project_company_buyer_role" AS ENUM('POTENTIAL_BUYER', 'SELLER_COMPETITOR', 'ADJACENT_VENDOR', 'PARTNER_POSSIBLE', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."project_company_opportunity_state" AS ENUM('none', 'potential', 'active', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."project_company_relationship_status" AS ENUM('NONE', 'PREVIOUS_CONTACT', 'MEETING_HELD', 'KNOWN_CHAMPION', 'EXISTING_CUSTOMER', 'PAST_CUSTOMER', 'OPEN_OPPORTUNITY', 'LOST_OPPORTUNITY');--> statement-breakpoint
CREATE TYPE "public"."project_company_research_status" AS ENUM('not_started', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."project_company_status" AS ENUM('candidate', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."company_discovery_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'EMPTY', 'FAILED', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."provider_capability" AS ENUM('COMPANY_DISCOVERY', 'COMPANY_LOOKUP', 'COMPANY_FIRMOGRAPHICS', 'WEB_SEARCH', 'WEBSITE_CRAWL', 'JOB_SEARCH', 'NEWS_SEARCH', 'TECH_STACK', 'LEADERSHIP_SEARCH', 'PUBLIC_SOCIAL_SEARCH', 'PERSON_LOOKUP', 'EMAIL_LOOKUP', 'PHONE_LOOKUP');--> statement-breakpoint
CREATE TYPE "public"."provider_usage_status" AS ENUM('success', 'empty', 'failed', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."evidence_source_type" AS ENUM('company_website', 'careers_page', 'job_posting', 'press_release', 'news', 'blog', 'trust_security_compliance', 'technology', 'public_social', 'other');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('RAW', 'EXTRACTED', 'VERIFIED', 'CONFLICTING', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."fact_type" AS ENUM('LEADERSHIP_CHANGE', 'JOB_OPENING', 'HIRING_COUNT', 'COMPANY_EXPANSION', 'FUNDING_EVENT', 'ACQUISITION', 'CERTIFICATION', 'COMPLIANCE_MENTION', 'TECHNOLOGY_MENTION', 'NEW_MARKET', 'ENTERPRISE_CUSTOMER', 'SECURITY_INCIDENT', 'EMPLOYEE_GROWTH', 'TRUST_CENTER_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."job_open_status" AS ENUM('OPEN', 'CLOSED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."research_fact_proposal_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."research_job_status" AS ENUM('PLANNED', 'RUNNING', 'SUCCEEDED', 'EMPTY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."research_question_status" AS ENUM('OPEN', 'IN_PROGRESS', 'ANSWERED', 'BLOCKED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."research_question_type" AS ENUM('QUALIFICATION', 'NEED', 'TIMING', 'HIRING', 'SECURITY', 'EXPANSION', 'TECHNOLOGY', 'LEADERSHIP', 'NEWS');--> statement-breakpoint
CREATE TYPE "public"."research_request_status" AS ENUM('success', 'empty', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."signal_decay_rule" AS ENUM('LINEAR', 'STEP', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."signal_polarity" AS ENUM('POSITIVE', 'NEGATIVE');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('ACTIVE', 'STALE');--> statement-breakpoint
CREATE TYPE "public"."opportunity_assessment_state" AS ENUM('DORMANT', 'WATCH', 'EMERGING', 'RISING', 'SURGING', 'ACTIVE', 'COOLING');--> statement-breakpoint
CREATE TYPE "public"."opportunity_assessment_status" AS ENUM('COMPLETE', 'NEEDS_MORE_RESEARCH', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "public"."opportunity_dimension" AS ENUM('FIT', 'NEED', 'TIMING', 'RELATIONSHIP', 'CONFIDENCE');--> statement-breakpoint
CREATE TYPE "public"."why_explanation_status" AS ENUM('SUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."why_traceability_status" AS ENUM('TRACED', 'UNTRACED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."buying_role" AS ENUM('ECONOMIC_BUYER', 'CHAMPION', 'TECHNICAL_EVALUATOR', 'INFLUENCER', 'USER', 'PROCUREMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."contact_enrichment_status" AS ENUM('SUCCEEDED', 'EMPTY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."contact_status" AS ENUM('UNKNOWN', 'FOUND', 'VERIFIED', 'UNVERIFIED', 'INVALID');--> statement-breakpoint
CREATE TYPE "public"."person_priority" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."person_source" AS ENUM('EXTERNAL', 'CUSTOMER_PROVIDED');--> statement-breakpoint
CREATE TYPE "public"."person_visibility" AS ENUM('PUBLIC', 'PRIVATE');--> statement-breakpoint
CREATE TYPE "public"."buyer_discovery_run_status" AS ENUM('RUNNING', 'SUCCEEDED', 'EMPTY', 'FAILED', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."buyer_discovery_trigger" AS ENUM('MANUAL', 'OPPORTUNITY_THRESHOLD');--> statement-breakpoint
CREATE TYPE "public"."learning_metric_dimension" AS ENUM('SIGNAL', 'SIGNAL_COMBINATION', 'CLUSTER', 'OPPORTUNITY_STATE', 'RECOMMENDED_ACTION', 'PROVIDER', 'RESEARCH_SOURCE');--> statement-breakpoint
CREATE TYPE "public"."learning_proposal_status" AS ENUM('PROPOSED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."learning_proposal_type" AS ENUM('INCREASE_SIGNAL_IMPORTANCE', 'DECREASE_SIGNAL_IMPORTANCE', 'CHANGE_CLUSTER', 'CHANGE_ICP_ASSUMPTION', 'CHANGE_RESEARCH_PRIORITY');--> statement-breakpoint
CREATE TYPE "public"."learning_scope" AS ENUM('GLOBAL', 'MARKET', 'PROJECT');--> statement-breakpoint
CREATE TYPE "public"."recommendation_outcome_reason" AS ENUM('WRONG_COMPANY_SIZE', 'WRONG_GEOGRAPHY', 'NO_BUDGET', 'EXISTING_VENDOR', 'WRONG_BUYER', 'BAD_TIMING', 'BAD_DATA', 'NOT_RELEVANT', 'COMPETITOR', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."recommendation_outcome_type" AS ENUM('USEFUL', 'NOT_USEFUL', 'CONTACTED', 'POSITIVE_REPLY', 'NEGATIVE_REPLY', 'MEETING', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST', 'VIEWED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."market_readiness_attempt_state" AS ENUM('PENDING', 'LEASED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."market_readiness_campaign_state" AS ENUM('PLANNED', 'DISCOVERING', 'REVIEWING', 'FROZEN', 'RUNNING', 'PARTIAL', 'COMPLETED', 'BLOCKED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."market_readiness_cohort_source" AS ENUM('DISCOVERY', 'MANUAL', 'IMPORT');--> statement-breakpoint
CREATE TYPE "public"."market_readiness_experiment_state" AS ENUM('DRAFT', 'ASSIGNED', 'RUNNING', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."market_readiness_outcome_type" AS ENUM('MEETING', 'OPPORTUNITY', 'BAD_FIT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."market_readiness_rollout_state" AS ENUM('DRAFT', 'APPROVED', 'REJECTED', 'PROMOTED');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "organization_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_twin_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_twin_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"business_maturity_stage" "business_maturity_stage",
	"version" integer NOT NULL,
	"raw_answers" jsonb NOT NULL,
	"ai_interpretation" jsonb,
	"manual_interpretation" jsonb,
	"evidence_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_used" text,
	"prompt_version" text,
	"status" "business_twin_version_status" DEFAULT 'ready' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_twins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icp_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icp_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"operator" "icp_criterion_operator" NOT NULL,
	"value" jsonb NOT NULL,
	"weight" real,
	"criterion_type" "icp_criterion_type" NOT NULL,
	"description" text NOT NULL,
	"source" "icp_criterion_source" NOT NULL,
	"evaluability" "icp_criterion_evaluability" NOT NULL,
	"provenance" "evidence_provenance",
	"validation_status" "validation_status",
	"accepted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icp_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icp_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_business_twin_version_id" uuid,
	"icp_mode" "icp_mode",
	"mode_explanation" text,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"domain" text,
	"website" text,
	"linkedin_url" text,
	"profile_urls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"country" text,
	"industry" text,
	"employee_count" integer,
	"employee_range" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"alias_name" text,
	"alias_domain" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"status" "project_company_status" DEFAULT 'candidate' NOT NULL,
	"research_status" "project_company_research_status" DEFAULT 'not_started' NOT NULL,
	"fit_score" real,
	"need_score" real,
	"timing_score" real,
	"relationship_score" real,
	"confidence_score" real,
	"opportunity_state" "project_company_opportunity_state",
	"relationship_status" "project_company_relationship_status" DEFAULT 'NONE' NOT NULL,
	"buyer_role" "project_company_buyer_role" DEFAULT 'UNKNOWN' NOT NULL,
	"buyer_role_assessment" jsonb,
	"opportunity_score" real,
	"opportunity_assessment_state" text,
	"latest_research_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_companies_project_company_unique" UNIQUE("project_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "company_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_label" text,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" text DEFAULT 'PRIVATE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"provider_id" uuid,
	"business_twin_version_id" uuid,
	"icp_version_id" uuid,
	"status" "company_discovery_run_status" DEFAULT 'RUNNING' NOT NULL,
	"strategy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_provider_calls" integer DEFAULT 5 NOT NULL,
	"max_candidates" integer DEFAULT 20 NOT NULL,
	"provider_calls" integer DEFAULT 0 NOT NULL,
	"raw_result_count" integer DEFAULT 0 NOT NULL,
	"accepted_candidate_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"actual_cost" real,
	"error_code" text,
	"error_message" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider_type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"success_rate" real DEFAULT 0 NOT NULL,
	"average_latency" integer DEFAULT 0 NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"capability" "provider_capability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"capability" "provider_capability" NOT NULL,
	"request_id" text NOT NULL,
	"status" "provider_usage_status" NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"runtime_ms" integer,
	"result_count" integer,
	"estimated_cost" real,
	"actual_cost" real,
	"error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"crawl_page_id" uuid NOT NULL,
	"created_by_organization_id" uuid,
	"source_url" text NOT NULL,
	"source_domain" text NOT NULL,
	"source_type" "evidence_source_type" NOT NULL,
	"provider" text NOT NULL,
	"publisher" text,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"raw_content_reference" text,
	"extracted_claim" text NOT NULL,
	"authority_score" real NOT NULL,
	"directness_score" real NOT NULL,
	"freshness_score" real NOT NULL,
	"corroboration_score" real NOT NULL,
	"confidence" real NOT NULL,
	"status" "evidence_status" DEFAULT 'RAW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_evidence_id_company_unique" UNIQUE("id","company_id")
);
--> statement-breakpoint
CREATE TABLE "crawl_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"source_domain" text NOT NULL,
	"source_type" "evidence_source_type" NOT NULL,
	"provider" text NOT NULL,
	"publisher" text,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_content" text NOT NULL,
	"raw_content_reference" text,
	"normalized_content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_pages_id_company_unique" UNIQUE("id","company_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_attribution_reviews" (
	"crawl_page_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"reviewed_by_organization_id" uuid,
	"source_classification" text NOT NULL,
	"entity_status" text NOT NULL,
	"entity_confidence" real NOT NULL,
	"entity_reason" text NOT NULL,
	"source_reliability_score" real NOT NULL,
	"quality_reason" text NOT NULL,
	"accepted_as_evidence" boolean DEFAULT false NOT NULL,
	"duplicate_of_crawl_page_id" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"fact_type" "fact_type" NOT NULL,
	"structured_value" jsonb NOT NULL,
	"effective_date" date NOT NULL,
	"confidence" real NOT NULL,
	"supporting_excerpt" text NOT NULL,
	"extractor_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_fact_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_job_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"fact_type" "fact_type" NOT NULL,
	"structured_value" jsonb NOT NULL,
	"effective_date" text NOT NULL,
	"confidence" real NOT NULL,
	"supporting_excerpt" text NOT NULL,
	"extractor_version" text NOT NULL,
	"status" "research_fact_proposal_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_job_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"research_job_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"provider_id" uuid,
	"external_job_id" text,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"description" text,
	"location" text,
	"source_url" text NOT NULL,
	"published_at" timestamp with time zone,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"open_status" "job_open_status" DEFAULT 'UNKNOWN' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"provider_id" uuid,
	"provider_capability" "provider_capability" NOT NULL,
	"provider_request_id" text,
	"idempotency_key" text NOT NULL,
	"status" "research_job_status" DEFAULT 'PLANNED' NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"actual_cost" real,
	"result_count" integer DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"question_type" "research_question_type" NOT NULL,
	"question_text" text NOT NULL,
	"reason" text NOT NULL,
	"provider_capability" "provider_capability" NOT NULL,
	"priority" integer NOT NULL,
	"expected_information_gain" real NOT NULL,
	"estimated_cost" real NOT NULL,
	"status" "research_question_status" DEFAULT 'OPEN' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"last_result_summary" text,
	"next_refresh_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"attempt_key" text NOT NULL,
	"estimated_cost" real NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_budget_reservations_cost_nonnegative" CHECK ("research_budget_reservations"."estimated_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "research_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"monthly_budget" real,
	"daily_budget" real,
	"currency" text DEFAULT 'USD' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_budgets_daily_nonnegative" CHECK ("research_budgets"."daily_budget" is null or "research_budgets"."daily_budget" >= 0),
	CONSTRAINT "research_budgets_monthly_nonnegative" CHECK ("research_budgets"."monthly_budget" is null or "research_budgets"."monthly_budget" >= 0),
	CONSTRAINT "research_budgets_usd_only" CHECK ("research_budgets"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "research_request_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"question_id" uuid,
	"research_job_id" uuid,
	"provider_id" uuid,
	"provider_request_id" text,
	"research_question" text NOT NULL,
	"provider_capability" "provider_capability" NOT NULL,
	"status" "research_request_status" NOT NULL,
	"success" boolean NOT NULL,
	"latency_ms" integer,
	"result_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"actual_cost" real,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_request_costs_estimated_nonnegative" CHECK ("research_request_costs"."estimated_cost" >= 0),
	CONSTRAINT "research_request_costs_actual_nonnegative" CHECK ("research_request_costs"."actual_cost" is null or "research_request_costs"."actual_cost" >= 0),
	CONSTRAINT "research_request_costs_latency_nonnegative" CHECK ("research_request_costs"."latency_ms" is null or "research_request_costs"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_signal_packs" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"signal_pack_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"offering_key" text,
	"offering_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"business_context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_signal_packs_project_id_signal_pack_id_pk" PRIMARY KEY("project_id","signal_pack_id")
);
--> statement-breakpoint
CREATE TABLE "signal_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_pack_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'CUSTOM' NOT NULL,
	"applicable_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"polarity" "signal_polarity" DEFAULT 'POSITIVE' NOT NULL,
	"evidence_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fact_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_strength" real NOT NULL,
	"minimum_confidence" real NOT NULL,
	"lifetime_days" real NOT NULL,
	"decay_rule" "signal_decay_rule" DEFAULT 'LINEAR' NOT NULL,
	"need_impact" real DEFAULT 0 NOT NULL,
	"timing_impact" real DEFAULT 0 NOT NULL,
	"fit_impact" real DEFAULT 0 NOT NULL,
	"source_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"created_by" text,
	"version" text DEFAULT '1.0' NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_evidence" (
	"signal_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "signal_evidence_signal_id_evidence_id_pk" PRIMARY KEY("signal_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "signal_facts" (
	"signal_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "signal_facts_signal_id_fact_id_pk" PRIMARY KEY("signal_id","fact_id")
);
--> statement-breakpoint
CREATE TABLE "signal_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"applicable_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"signal_definition_id" uuid NOT NULL,
	"supporting_fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supporting_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_date" date NOT NULL,
	"original_strength" real NOT NULL,
	"current_strength" real NOT NULL,
	"confidence" real NOT NULL,
	"status" "signal_status" DEFAULT 'ACTIVE' NOT NULL,
	"rule_version" text NOT NULL,
	"category_snapshot" text DEFAULT 'CUSTOM' NOT NULL,
	"context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generation_method" text DEFAULT 'DETERMINISTIC' NOT NULL,
	"generator_version" text DEFAULT '1.0' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"need_impact_snapshot" real,
	"timing_impact_snapshot" real,
	"fit_impact_snapshot" real,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_support_required" CHECK (jsonb_array_length("signals"."supporting_fact_ids") > 0 AND jsonb_array_length("signals"."supporting_evidence_ids") > 0)
);
--> statement-breakpoint
CREATE TABLE "intelligence_pack_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"required_signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negative_signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minimum_independent_signals" integer DEFAULT 2 NOT NULL,
	"time_window_days" integer DEFAULT 30 NOT NULL,
	"default_strength" real DEFAULT 80 NOT NULL,
	"need_impact" real DEFAULT 0 NOT NULL,
	"timing_impact" real DEFAULT 0 NOT NULL,
	"review_status" text DEFAULT 'PROPOSED' NOT NULL,
	"hypothesis" boolean DEFAULT true NOT NULL,
	"activated_definition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_pack_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"signal_id" uuid,
	"question_text" text NOT NULL,
	"reason" text NOT NULL,
	"source_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"expected_information_gain" real DEFAULT 50 NOT NULL,
	"estimated_cost" real DEFAULT 1 NOT NULL,
	"review_status" text DEFAULT 'PROPOSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_pack_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"category" text NOT NULL,
	"polarity" text DEFAULT 'POSITIVE' NOT NULL,
	"need_impact" real NOT NULL,
	"timing_impact" real NOT NULL,
	"fit_impact" real NOT NULL,
	"likely_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lifetime_days" real NOT NULL,
	"suggested_strength" real NOT NULL,
	"minimum_confidence" real NOT NULL,
	"potential_false_positives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matching_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_status" text DEFAULT 'PROPOSED' NOT NULL,
	"hypothesis" boolean DEFAULT true NOT NULL,
	"activated_signal_definition_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_pack_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intelligence_pack_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"lifecycle_label" text DEFAULT 'HYPOTHESIS-LED' NOT NULL,
	"offering_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"business_context_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_business_twin_version_id" uuid,
	"source_icp_version_id" uuid,
	"generation_method" text DEFAULT 'AI_PROPOSAL' NOT NULL,
	"model_used" text,
	"prompt_version" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"offering_key" text NOT NULL,
	"source_business_twin_version_id" uuid,
	"source_icp_version_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_cluster_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"intelligence_pack_id" uuid,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"required_signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"negative_signal_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minimum_independent_signals" integer DEFAULT 2 NOT NULL,
	"time_window_days" integer DEFAULT 30 NOT NULL,
	"default_strength" real DEFAULT 80 NOT NULL,
	"need_impact" real DEFAULT 0 NOT NULL,
	"timing_impact" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_cluster_members" (
	"cluster_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"role" text NOT NULL,
	"event_key" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "signal_cluster_members_cluster_id_signal_id_pk" PRIMARY KEY("cluster_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE "signal_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"triggered_signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supporting_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"independence_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"temporal_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" text NOT NULL,
	"original_strength" real NOT NULL,
	"current_strength" real NOT NULL,
	"confidence" real NOT NULL,
	"need_impact" real NOT NULL,
	"timing_impact" real NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"rule_version" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"model_version_id" uuid NOT NULL,
	"score" real,
	"fit_score" real,
	"need_score" real,
	"timing_score" real,
	"relationship_score" real,
	"confidence_score" real,
	"state" "opportunity_assessment_state" NOT NULL,
	"assessment_status" "opportunity_assessment_status" NOT NULL,
	"explanation" text NOT NULL,
	"input_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"model_version_id" uuid NOT NULL,
	"score" real,
	"state" "opportunity_assessment_state" NOT NULL,
	"assessment_status" "opportunity_assessment_status" NOT NULL,
	"dimension_snapshot" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"previous_state" "opportunity_assessment_state",
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text DEFAULT 'Opportunity Model' NOT NULL,
	"weights" jsonb NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_score_components" (
	"history_id" uuid NOT NULL,
	"dimension" "opportunity_dimension" NOT NULL,
	"score" real,
	"status" text NOT NULL,
	"rule" text NOT NULL,
	"explanation" text NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cluster_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "opportunity_score_components_history_id_dimension_pk" PRIMARY KEY("history_id","dimension")
);
--> statement-breakpoint
CREATE TABLE "why_claims" (
	"explanation_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"claim_text" text NOT NULL,
	"claim_type" text NOT NULL,
	"material" boolean DEFAULT true NOT NULL,
	"traceability_status" "why_traceability_status" NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cluster_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "why_claims_explanation_id_ordinal_pk" PRIMARY KEY("explanation_id","ordinal"),
	CONSTRAINT "why_material_claims_require_trace" CHECK (
    NOT "why_claims"."material"
    OR (
      "why_claims"."traceability_status" = 'TRACED'
      AND jsonb_array_length("why_claims"."evidence_ids") > 0
      AND jsonb_array_length("why_claims"."source_urls") > 0
      AND (
        jsonb_array_length("why_claims"."signal_ids") > 0
        OR jsonb_array_length("why_claims"."cluster_ids") > 0
        OR jsonb_array_length("why_claims"."fact_ids") > 0
      )
    )
  )
);
--> statement-breakpoint
CREATE TABLE "why_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "why_explanation_status" NOT NULL,
	"text" text NOT NULL,
	"rule_version" text DEFAULT 'WHY_V1' NOT NULL,
	"generated_by" text DEFAULT 'DETERMINISTIC' NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_enrichment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"provider_id" uuid,
	"capability" "provider_capability" NOT NULL,
	"status" "contact_enrichment_status" NOT NULL,
	"contact_status" "contact_status" NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"actual_cost" real,
	"provider_request_id" text,
	"requested_explicitly" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"default_title" text,
	"default_function" text,
	"default_seniority" text,
	"profile_url" text,
	"visibility" "person_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"source" "person_source" DEFAULT 'EXTERNAL' NOT NULL,
	"owner_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_company_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "buying_role" NOT NULL,
	"role_label" text NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"evidence_supported" text DEFAULT 'UNKNOWN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_organization_id" uuid,
	"source_url" text,
	"provider" text NOT NULL,
	"claim" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"visibility" "person_visibility" DEFAULT 'PUBLIC' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_person_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "buying_role" DEFAULT 'OTHER' NOT NULL,
	"role_label" text DEFAULT 'Other' NOT NULL,
	"role_confidence" real DEFAULT 0 NOT NULL,
	"priority" "person_priority" DEFAULT 'LOW' NOT NULL,
	"source" "person_source" DEFAULT 'EXTERNAL' NOT NULL,
	"email" text,
	"email_status" "contact_status" DEFAULT 'UNKNOWN' NOT NULL,
	"phone" text,
	"phone_status" "contact_status" DEFAULT 'UNKNOWN' NOT NULL,
	"last_enriched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_discovery_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"opportunity_threshold" real DEFAULT 70 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer_discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"provider_id" uuid,
	"trigger" "buyer_discovery_trigger" NOT NULL,
	"status" "buyer_discovery_run_status" DEFAULT 'RUNNING' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_request_id" text,
	"estimated_cost" real DEFAULT 0 NOT NULL,
	"actual_cost" real,
	"result_count" integer DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"requested_explicitly" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"error_message" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_improvement_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "learning_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"project_id" uuid,
	"intelligence_pack_version_id" uuid,
	"proposal_type" "learning_proposal_type" NOT NULL,
	"target_key" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"proposed_change" jsonb NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"status" "learning_proposal_status" DEFAULT 'PROPOSED' NOT NULL,
	"dedupe_key" text NOT NULL,
	"source_policy_version" integer NOT NULL,
	"approved_learning_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text
);
--> statement-breakpoint
CREATE TABLE "learning_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "learning_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"project_id" uuid,
	"intelligence_pack_version_id" uuid,
	"dimension" "learning_metric_dimension" NOT NULL,
	"segment_key" text NOT NULL,
	"segment_label" text NOT NULL,
	"sample_size" integer NOT NULL,
	"observed_outcome_count" integer NOT NULL,
	"positive_outcome_count" integer NOT NULL,
	"neutral_outcome_count" integer NOT NULL,
	"weighted_outcome_score" real,
	"meeting_rate" real,
	"qualification_rate" real,
	"win_rate" real,
	"association_note" text NOT NULL,
	"recommendation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "learning_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"project_id" uuid,
	"intelligence_pack_version_id" uuid,
	"version" integer NOT NULL,
	"configuration" jsonb NOT NULL,
	"source_proposal_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "learning_scope" NOT NULL,
	"scope_key" text NOT NULL,
	"project_id" uuid,
	"intelligence_pack_version_id" uuid,
	"version" integer NOT NULL,
	"outcome_weights" jsonb NOT NULL,
	"minimum_observed_sample" integer DEFAULT 10 NOT NULL,
	"minimum_positive_outcomes" integer DEFAULT 3 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"business_twin_version_id" uuid,
	"business_twin_version" integer,
	"icp_version_id" uuid,
	"icp_version" integer,
	"intelligence_pack_version_id" uuid,
	"intelligence_pack_version" integer,
	"opportunity_model_version_id" uuid,
	"opportunity_model_version" integer,
	"fit" real,
	"need" real,
	"timing" real,
	"relationship" real,
	"confidence" real,
	"state" text NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"clusters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text NOT NULL,
	"recommended_action" text NOT NULL,
	"recommendation_rule_version" text NOT NULL,
	"input_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_key" text NOT NULL,
	"recommended_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_company_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"outcome_type" "recommendation_outcome_type" NOT NULL,
	"reason" "recommendation_outcome_reason",
	"note" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_adjudications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cohort_item_id" uuid NOT NULL,
	"adjudicator_id" text NOT NULL,
	"gold_labels" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid,
	"actor_id" text,
	"action" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_blind_gold_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cohort_item_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"role_fit" boolean NOT NULL,
	"who_fit" boolean NOT NULL,
	"buyer" boolean NOT NULL,
	"competitor" boolean NOT NULL,
	"dangerous" boolean DEFAULT false NOT NULL,
	"actionable_evidence" boolean NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"state" "market_readiness_campaign_state" DEFAULT 'PLANNED' NOT NULL,
	"discovery_mode" text DEFAULT 'AUTOMATIC_FRESH' NOT NULL,
	"target_count" integer DEFAULT 200 NOT NULL,
	"paid_cap_cents" integer DEFAULT 5000 NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"outcome_mode" text DEFAULT 'MANUAL' NOT NULL,
	"freeze_hash" text,
	"frozen_at" timestamp with time zone,
	"frozen_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_readiness_campaign_target_positive" CHECK ("market_readiness_campaigns"."target_count" > 0),
	CONSTRAINT "market_readiness_campaign_money_nonnegative" CHECK ("market_readiness_campaigns"."paid_cap_cents" >= 0 and "market_readiness_campaigns"."spent_cents" >= 0 and "market_readiness_campaigns"."reserved_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_readiness_cohort_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"company_id" uuid,
	"normalized_domain" text NOT NULL,
	"source" "market_readiness_cohort_source" NOT NULL,
	"stratum" text DEFAULT 'UNSPECIFIED' NOT NULL,
	"opaque_review_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"experiment_id" uuid NOT NULL,
	"cohort_item_id" uuid NOT NULL,
	"arm" text NOT NULL,
	"stratum" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"state" "market_readiness_experiment_state" DEFAULT 'DRAFT' NOT NULL,
	"seed" text NOT NULL,
	"treatment_name" text DEFAULT 'JYRA_INTELLIGENCE_V2' NOT NULL,
	"control_name" text DEFAULT 'CONTROL' NOT NULL,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_manual_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"experiment_assignment_id" uuid NOT NULL,
	"cohort_item_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"outcome" "market_readiness_outcome_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_outcome_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"row_count" integer NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_readiness_outcome_batch_rows_nonnegative" CHECK ("market_readiness_outcome_import_batches"."row_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_readiness_prediction_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cohort_item_id" uuid NOT NULL,
	"processing_attempt_id" uuid NOT NULL,
	"version" text DEFAULT 'V1' NOT NULL,
	"predictions" jsonb NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cohort_item_id" uuid,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "market_readiness_attempt_state" DEFAULT 'PENDING' NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_readiness_attempt_money_nonnegative" CHECK ("market_readiness_processing_attempts"."reserved_cents" >= 0 and "market_readiness_processing_attempts"."spent_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_readiness_rollout_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"state" "market_readiness_rollout_state" DEFAULT 'DRAFT' NOT NULL,
	"decision" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_readiness_salesperson_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cohort_item_id" uuid NOT NULL,
	"reviewer_id" text NOT NULL,
	"usable" boolean NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_twin_versions" ADD CONSTRAINT "business_twin_versions_business_twin_id_business_twins_id_fk" FOREIGN KEY ("business_twin_id") REFERENCES "public"."business_twins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_twin_versions" ADD CONSTRAINT "business_twin_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_twin_versions" ADD CONSTRAINT "business_twin_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_twins" ADD CONSTRAINT "business_twins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_twins" ADD CONSTRAINT "business_twins_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_twins" ADD CONSTRAINT "business_twins_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_criteria" ADD CONSTRAINT "icp_criteria_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_criteria" ADD CONSTRAINT "icp_criteria_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_icp_id_icps_id_fk" FOREIGN KEY ("icp_id") REFERENCES "public"."icps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_source_business_twin_version_id_business_twin_versions_id_fk" FOREIGN KEY ("source_business_twin_version_id") REFERENCES "public"."business_twin_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_versions" ADD CONSTRAINT "icp_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_companies" ADD CONSTRAINT "project_companies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_companies" ADD CONSTRAINT "project_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_provenance" ADD CONSTRAINT "company_provenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_provenance" ADD CONSTRAINT "company_provenance_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_provenance" ADD CONSTRAINT "company_provenance_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_discovery_runs" ADD CONSTRAINT "company_discovery_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_discovery_runs" ADD CONSTRAINT "company_discovery_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_discovery_runs" ADD CONSTRAINT "company_discovery_runs_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_discovery_runs" ADD CONSTRAINT "company_discovery_runs_business_twin_version_id_business_twin_versions_id_fk" FOREIGN KEY ("business_twin_version_id") REFERENCES "public"."business_twin_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_discovery_runs" ADD CONSTRAINT "company_discovery_runs_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_capabilities" ADD CONSTRAINT "provider_capabilities_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_evidence" ADD CONSTRAINT "company_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_evidence" ADD CONSTRAINT "company_evidence_created_by_organization_id_organizations_id_fk" FOREIGN KEY ("created_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_evidence" ADD CONSTRAINT "company_evidence_crawl_company_fk" FOREIGN KEY ("crawl_page_id","company_id") REFERENCES "public"."crawl_pages"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ADD CONSTRAINT "evidence_attribution_reviews_crawl_page_id_crawl_pages_id_fk" FOREIGN KEY ("crawl_page_id") REFERENCES "public"."crawl_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ADD CONSTRAINT "evidence_attribution_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ADD CONSTRAINT "evidence_attribution_reviews_reviewed_by_organization_id_organizations_id_fk" FOREIGN KEY ("reviewed_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ADD CONSTRAINT "evidence_attribution_reviews_duplicate_of_crawl_page_id_crawl_pages_id_fk" FOREIGN KEY ("duplicate_of_crawl_page_id") REFERENCES "public"."crawl_pages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ADD CONSTRAINT "evidence_attribution_review_crawl_company_fk" FOREIGN KEY ("crawl_page_id","company_id") REFERENCES "public"."crawl_pages"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_facts" ADD CONSTRAINT "company_facts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_facts" ADD CONSTRAINT "company_facts_evidence_company_fk" FOREIGN KEY ("evidence_id","company_id") REFERENCES "public"."company_evidence"("id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_fact_proposals" ADD CONSTRAINT "research_fact_proposals_research_job_id_research_jobs_id_fk" FOREIGN KEY ("research_job_id") REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_fact_proposals" ADD CONSTRAINT "research_fact_proposals_question_id_research_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."research_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_fact_proposals" ADD CONSTRAINT "research_fact_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_fact_proposals" ADD CONSTRAINT "research_fact_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_fact_proposals" ADD CONSTRAINT "research_fact_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_fact_proposals" ADD CONSTRAINT "research_fact_proposals_evidence_id_company_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."company_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_postings" ADD CONSTRAINT "research_job_postings_research_job_id_research_jobs_id_fk" FOREIGN KEY ("research_job_id") REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_postings" ADD CONSTRAINT "research_job_postings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_postings" ADD CONSTRAINT "research_job_postings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_postings" ADD CONSTRAINT "research_job_postings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_postings" ADD CONSTRAINT "research_job_postings_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_job_postings" ADD CONSTRAINT "research_job_postings_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."project_companies"("project_id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_question_id_research_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."research_questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."project_companies"("project_id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_questions" ADD CONSTRAINT "research_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_questions" ADD CONSTRAINT "research_questions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_questions" ADD CONSTRAINT "research_questions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_questions" ADD CONSTRAINT "research_questions_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."project_companies"("project_id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_budget_reservations" ADD CONSTRAINT "research_budget_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_budget_reservations" ADD CONSTRAINT "research_budget_reservations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_budget_reservations" ADD CONSTRAINT "research_budget_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_budgets" ADD CONSTRAINT "research_budgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_budgets" ADD CONSTRAINT "research_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_request_costs" ADD CONSTRAINT "research_request_costs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_request_costs" ADD CONSTRAINT "research_request_costs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_request_costs" ADD CONSTRAINT "research_request_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_request_costs" ADD CONSTRAINT "research_request_costs_question_id_research_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."research_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_request_costs" ADD CONSTRAINT "research_request_costs_research_job_id_research_jobs_id_fk" FOREIGN KEY ("research_job_id") REFERENCES "public"."research_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_request_costs" ADD CONSTRAINT "research_request_costs_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_signal_packs" ADD CONSTRAINT "project_signal_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_signal_packs" ADD CONSTRAINT "project_signal_packs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_signal_packs" ADD CONSTRAINT "project_signal_packs_signal_pack_id_signal_packs_id_fk" FOREIGN KEY ("signal_pack_id") REFERENCES "public"."signal_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_definitions" ADD CONSTRAINT "signal_definitions_signal_pack_id_signal_packs_id_fk" FOREIGN KEY ("signal_pack_id") REFERENCES "public"."signal_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_evidence_id_company_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."company_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_facts" ADD CONSTRAINT "signal_facts_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_facts" ADD CONSTRAINT "signal_facts_fact_id_company_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."company_facts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_signal_definition_id_signal_definitions_id_fk" FOREIGN KEY ("signal_definition_id") REFERENCES "public"."signal_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_project_company_fk" FOREIGN KEY ("project_id","company_id") REFERENCES "public"."project_companies"("project_id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_clusters" ADD CONSTRAINT "intelligence_pack_clusters_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_questions" ADD CONSTRAINT "intelligence_pack_questions_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_questions" ADD CONSTRAINT "intelligence_pack_questions_signal_id_intelligence_pack_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."intelligence_pack_signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_signals" ADD CONSTRAINT "intelligence_pack_signals_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_signals" ADD CONSTRAINT "intelligence_pack_signals_activated_signal_definition_id_signal_definitions_id_fk" FOREIGN KEY ("activated_signal_definition_id") REFERENCES "public"."signal_definitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_versions" ADD CONSTRAINT "intelligence_pack_versions_intelligence_pack_id_intelligence_packs_id_fk" FOREIGN KEY ("intelligence_pack_id") REFERENCES "public"."intelligence_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_versions" ADD CONSTRAINT "intelligence_pack_versions_source_business_twin_version_id_business_twin_versions_id_fk" FOREIGN KEY ("source_business_twin_version_id") REFERENCES "public"."business_twin_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_versions" ADD CONSTRAINT "intelligence_pack_versions_source_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("source_icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_pack_versions" ADD CONSTRAINT "intelligence_pack_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_packs" ADD CONSTRAINT "intelligence_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_packs" ADD CONSTRAINT "intelligence_packs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_packs" ADD CONSTRAINT "intelligence_packs_source_business_twin_version_id_business_twin_versions_id_fk" FOREIGN KEY ("source_business_twin_version_id") REFERENCES "public"."business_twin_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_packs" ADD CONSTRAINT "intelligence_packs_source_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("source_icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligence_packs" ADD CONSTRAINT "intelligence_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_cluster_definitions" ADD CONSTRAINT "signal_cluster_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_cluster_definitions" ADD CONSTRAINT "signal_cluster_definitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_cluster_definitions" ADD CONSTRAINT "signal_cluster_definitions_intelligence_pack_id_intelligence_packs_id_fk" FOREIGN KEY ("intelligence_pack_id") REFERENCES "public"."intelligence_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_cluster_members" ADD CONSTRAINT "signal_cluster_members_cluster_id_signal_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."signal_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_cluster_members" ADD CONSTRAINT "signal_cluster_members_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_clusters" ADD CONSTRAINT "signal_clusters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_clusters" ADD CONSTRAINT "signal_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_clusters" ADD CONSTRAINT "signal_clusters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_clusters" ADD CONSTRAINT "signal_clusters_definition_id_signal_cluster_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."signal_cluster_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_model_version_id_opportunity_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."opportunity_model_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_history" ADD CONSTRAINT "opportunity_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_history" ADD CONSTRAINT "opportunity_history_model_version_id_opportunity_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."opportunity_model_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_model_versions" ADD CONSTRAINT "opportunity_model_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_model_versions" ADD CONSTRAINT "opportunity_model_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_score_components" ADD CONSTRAINT "opportunity_score_components_history_id_opportunity_history_id_fk" FOREIGN KEY ("history_id") REFERENCES "public"."opportunity_history"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "why_claims" ADD CONSTRAINT "why_claims_explanation_id_why_explanations_id_fk" FOREIGN KEY ("explanation_id") REFERENCES "public"."why_explanations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "why_explanations" ADD CONSTRAINT "why_explanations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_enrichment_attempts" ADD CONSTRAINT "contact_enrichment_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_enrichment_attempts" ADD CONSTRAINT "contact_enrichment_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_enrichment_attempts" ADD CONSTRAINT "contact_enrichment_attempts_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_enrichment_attempts" ADD CONSTRAINT "contact_enrichment_attempts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_enrichment_attempts" ADD CONSTRAINT "contact_enrichment_attempts_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_company_roles" ADD CONSTRAINT "person_company_roles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_company_roles" ADD CONSTRAINT "person_company_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_evidence" ADD CONSTRAINT "person_evidence_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_evidence" ADD CONSTRAINT "person_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_evidence" ADD CONSTRAINT "person_evidence_created_by_organization_id_organizations_id_fk" FOREIGN KEY ("created_by_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_person_context" ADD CONSTRAINT "project_person_context_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_person_context" ADD CONSTRAINT "project_person_context_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_person_context" ADD CONSTRAINT "project_person_context_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_discovery_policies" ADD CONSTRAINT "buyer_discovery_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_discovery_policies" ADD CONSTRAINT "buyer_discovery_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_discovery_runs" ADD CONSTRAINT "buyer_discovery_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_discovery_runs" ADD CONSTRAINT "buyer_discovery_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_discovery_runs" ADD CONSTRAINT "buyer_discovery_runs_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_discovery_runs" ADD CONSTRAINT "buyer_discovery_runs_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_improvement_proposals" ADD CONSTRAINT "learning_improvement_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_improvement_proposals" ADD CONSTRAINT "learning_improvement_proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_improvement_proposals" ADD CONSTRAINT "learning_improvement_proposals_intelligence_pack_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("intelligence_pack_version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_improvement_proposals" ADD CONSTRAINT "learning_improvement_proposals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_metric_snapshots" ADD CONSTRAINT "learning_metric_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_metric_snapshots" ADD CONSTRAINT "learning_metric_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_metric_snapshots" ADD CONSTRAINT "learning_metric_snapshots_intelligence_pack_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("intelligence_pack_version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_model_versions" ADD CONSTRAINT "learning_model_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_model_versions" ADD CONSTRAINT "learning_model_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_model_versions" ADD CONSTRAINT "learning_model_versions_intelligence_pack_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("intelligence_pack_version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_model_versions" ADD CONSTRAINT "learning_model_versions_source_proposal_id_learning_improvement_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."learning_improvement_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_model_versions" ADD CONSTRAINT "learning_model_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_policy_versions" ADD CONSTRAINT "learning_policy_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_policy_versions" ADD CONSTRAINT "learning_policy_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_policy_versions" ADD CONSTRAINT "learning_policy_versions_intelligence_pack_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("intelligence_pack_version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_policy_versions" ADD CONSTRAINT "learning_policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_business_twin_version_id_business_twin_versions_id_fk" FOREIGN KEY ("business_twin_version_id") REFERENCES "public"."business_twin_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_icp_version_id_icp_versions_id_fk" FOREIGN KEY ("icp_version_id") REFERENCES "public"."icp_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_intelligence_pack_version_id_intelligence_pack_versions_id_fk" FOREIGN KEY ("intelligence_pack_version_id") REFERENCES "public"."intelligence_pack_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_ledger" ADD CONSTRAINT "recommendation_ledger_opportunity_model_version_id_opportunity_model_versions_id_fk" FOREIGN KEY ("opportunity_model_version_id") REFERENCES "public"."opportunity_model_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_recommendation_id_recommendation_ledger_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendation_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_project_company_id_project_companies_id_fk" FOREIGN KEY ("project_company_id") REFERENCES "public"."project_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_outcomes" ADD CONSTRAINT "recommendation_outcomes_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_adjudications" ADD CONSTRAINT "market_readiness_adjudications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_adjudications" ADD CONSTRAINT "market_readiness_adjudications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_adjudications" ADD CONSTRAINT "market_readiness_adjudications_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_adjudications" ADD CONSTRAINT "market_readiness_adjudications_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_audits" ADD CONSTRAINT "market_readiness_audits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_audits" ADD CONSTRAINT "market_readiness_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_audits" ADD CONSTRAINT "market_readiness_audits_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_blind_gold_reviews" ADD CONSTRAINT "market_readiness_blind_gold_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_blind_gold_reviews" ADD CONSTRAINT "market_readiness_blind_gold_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_blind_gold_reviews" ADD CONSTRAINT "market_readiness_blind_gold_reviews_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_blind_gold_reviews" ADD CONSTRAINT "market_readiness_blind_gold_reviews_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_campaigns" ADD CONSTRAINT "market_readiness_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_campaigns" ADD CONSTRAINT "market_readiness_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_cohort_items" ADD CONSTRAINT "market_readiness_cohort_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_cohort_items" ADD CONSTRAINT "market_readiness_cohort_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_cohort_items" ADD CONSTRAINT "market_readiness_cohort_items_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_cohort_items" ADD CONSTRAINT "market_readiness_cohort_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiment_assignments" ADD CONSTRAINT "market_readiness_experiment_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiment_assignments" ADD CONSTRAINT "market_readiness_experiment_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiment_assignments" ADD CONSTRAINT "market_readiness_experiment_assignments_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiment_assignments" ADD CONSTRAINT "market_readiness_experiment_assignments_experiment_id_market_readiness_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."market_readiness_experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiment_assignments" ADD CONSTRAINT "market_readiness_experiment_assignments_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiments" ADD CONSTRAINT "market_readiness_experiments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiments" ADD CONSTRAINT "market_readiness_experiments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_experiments" ADD CONSTRAINT "market_readiness_experiments_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_manual_outcomes" ADD CONSTRAINT "market_readiness_manual_outcomes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_manual_outcomes" ADD CONSTRAINT "market_readiness_manual_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_manual_outcomes" ADD CONSTRAINT "market_readiness_manual_outcomes_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_manual_outcomes" ADD CONSTRAINT "market_readiness_manual_outcomes_experiment_assignment_id_market_readiness_experiment_assignments_id_fk" FOREIGN KEY ("experiment_assignment_id") REFERENCES "public"."market_readiness_experiment_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_manual_outcomes" ADD CONSTRAINT "market_readiness_manual_outcomes_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_manual_outcomes" ADD CONSTRAINT "market_readiness_manual_outcomes_import_batch_id_market_readiness_outcome_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."market_readiness_outcome_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_outcome_import_batches" ADD CONSTRAINT "market_readiness_outcome_import_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_outcome_import_batches" ADD CONSTRAINT "market_readiness_outcome_import_batches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_outcome_import_batches" ADD CONSTRAINT "market_readiness_outcome_import_batches_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_prediction_snapshots" ADD CONSTRAINT "market_readiness_prediction_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_prediction_snapshots" ADD CONSTRAINT "market_readiness_prediction_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_prediction_snapshots" ADD CONSTRAINT "market_readiness_prediction_snapshots_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_prediction_snapshots" ADD CONSTRAINT "market_readiness_prediction_snapshots_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_prediction_snapshots" ADD CONSTRAINT "market_readiness_prediction_snapshots_processing_attempt_id_market_readiness_processing_attempts_id_fk" FOREIGN KEY ("processing_attempt_id") REFERENCES "public"."market_readiness_processing_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_processing_attempts" ADD CONSTRAINT "market_readiness_processing_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_processing_attempts" ADD CONSTRAINT "market_readiness_processing_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_processing_attempts" ADD CONSTRAINT "market_readiness_processing_attempts_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_processing_attempts" ADD CONSTRAINT "market_readiness_processing_attempts_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_rollout_decisions" ADD CONSTRAINT "market_readiness_rollout_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_rollout_decisions" ADD CONSTRAINT "market_readiness_rollout_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_rollout_decisions" ADD CONSTRAINT "market_readiness_rollout_decisions_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_salesperson_reviews" ADD CONSTRAINT "market_readiness_salesperson_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_salesperson_reviews" ADD CONSTRAINT "market_readiness_salesperson_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_salesperson_reviews" ADD CONSTRAINT "market_readiness_salesperson_reviews_campaign_id_market_readiness_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."market_readiness_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_readiness_salesperson_reviews" ADD CONSTRAINT "market_readiness_salesperson_reviews_cohort_item_id_market_readiness_cohort_items_id_fk" FOREIGN KEY ("cohort_item_id") REFERENCES "public"."market_readiness_cohort_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_created_by_user_id_idx" ON "organizations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_id_organization_unique" ON "projects" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_organization_name_unique" ON "projects" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "projects_organization_id_idx" ON "projects" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_twin_versions_twin_version_unique" ON "business_twin_versions" USING btree ("business_twin_id","version");--> statement-breakpoint
CREATE INDEX "business_twin_versions_project_id_idx" ON "business_twin_versions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "business_twin_versions_created_at_idx" ON "business_twin_versions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_twins_project_unique" ON "business_twins" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "business_twins_organization_id_idx" ON "business_twins" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "icp_criteria_version_id_idx" ON "icp_criteria" USING btree ("icp_version_id");--> statement-breakpoint
CREATE INDEX "icp_criteria_project_id_idx" ON "icp_criteria" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "icp_versions_icp_version_unique" ON "icp_versions" USING btree ("icp_id","version");--> statement-breakpoint
CREATE INDEX "icp_versions_project_id_idx" ON "icp_versions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "icps_project_unique" ON "icps" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "icps_organization_id_idx" ON "icps" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_domain_unique" ON "companies" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("canonical_name");--> statement-breakpoint
CREATE UNIQUE INDEX "company_aliases_domain_unique" ON "company_aliases" USING btree ("alias_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "company_aliases_company_name_unique" ON "company_aliases" USING btree ("company_id","alias_name");--> statement-breakpoint
CREATE INDEX "company_aliases_company_id_idx" ON "company_aliases" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_aliases_name_idx" ON "company_aliases" USING btree ("alias_name");--> statement-breakpoint
CREATE INDEX "project_companies_project_id_idx" ON "project_companies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_companies_company_id_idx" ON "project_companies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_provenance_project_company_idx" ON "company_provenance" USING btree ("project_id","company_id");--> statement-breakpoint
CREATE INDEX "company_provenance_source_type_idx" ON "company_provenance" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "company_provenance_organization_idx" ON "company_provenance" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "company_discovery_runs_project_created_idx" ON "company_discovery_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "company_discovery_runs_organization_idx" ON "company_discovery_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "company_discovery_runs_status_idx" ON "company_discovery_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "data_providers_name_unique" ON "data_providers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "data_providers_enabled_priority_idx" ON "data_providers" USING btree ("enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_capabilities_provider_capability_unique" ON "provider_capabilities" USING btree ("provider_id","capability");--> statement-breakpoint
CREATE INDEX "provider_capabilities_capability_idx" ON "provider_capabilities" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "provider_usage_provider_request_idx" ON "provider_usage" USING btree ("provider_id","request_id");--> statement-breakpoint
CREATE INDEX "provider_usage_capability_created_idx" ON "provider_usage" USING btree ("capability","created_at");--> statement-breakpoint
CREATE INDEX "provider_usage_provider_created_idx" ON "provider_usage" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_evidence_crawl_page_unique" ON "company_evidence" USING btree ("crawl_page_id");--> statement-breakpoint
CREATE INDEX "company_evidence_company_observed_idx" ON "company_evidence" USING btree ("company_id","observed_at");--> statement-breakpoint
CREATE INDEX "company_evidence_company_status_idx" ON "company_evidence" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_pages_company_url_hash_unique" ON "crawl_pages" USING btree ("company_id","source_url","normalized_content_hash");--> statement-breakpoint
CREATE INDEX "crawl_pages_company_observed_idx" ON "crawl_pages" USING btree ("company_id","observed_at");--> statement-breakpoint
CREATE INDEX "crawl_pages_company_hash_idx" ON "crawl_pages" USING btree ("company_id","normalized_content_hash");--> statement-breakpoint
CREATE INDEX "evidence_attribution_review_company_idx" ON "evidence_attribution_reviews" USING btree ("company_id","accepted_as_evidence");--> statement-breakpoint
CREATE INDEX "evidence_attribution_review_entity_idx" ON "evidence_attribution_reviews" USING btree ("entity_status");--> statement-breakpoint
CREATE UNIQUE INDEX "company_facts_observation_unique" ON "company_facts" USING btree ("evidence_id","fact_type","effective_date","supporting_excerpt");--> statement-breakpoint
CREATE INDEX "company_facts_company_date_idx" ON "company_facts" USING btree ("company_id","effective_date");--> statement-breakpoint
CREATE INDEX "company_facts_evidence_idx" ON "company_facts" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_fact_proposals_observation_unique" ON "research_fact_proposals" USING btree ("research_job_id","evidence_id","fact_type","effective_date","supporting_excerpt");--> statement-breakpoint
CREATE INDEX "research_fact_proposals_review_idx" ON "research_fact_proposals" USING btree ("project_id","company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_job_postings_observation_unique" ON "research_job_postings" USING btree ("research_job_id","source_url","content_hash");--> statement-breakpoint
CREATE INDEX "research_job_postings_company_observed_idx" ON "research_job_postings" USING btree ("company_id","observed_at");--> statement-breakpoint
CREATE INDEX "research_job_postings_external_idx" ON "research_job_postings" USING btree ("provider_id","external_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "research_jobs_idempotency_unique" ON "research_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "research_jobs_project_company_created_idx" ON "research_jobs" USING btree ("project_id","company_id","created_at");--> statement-breakpoint
CREATE INDEX "research_jobs_question_idx" ON "research_jobs" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "research_questions_project_company_status_idx" ON "research_questions" USING btree ("project_id","company_id","status");--> statement-breakpoint
CREATE INDEX "research_questions_due_idx" ON "research_questions" USING btree ("status","next_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_questions_open_type_unique" ON "research_questions" USING btree ("project_id","company_id","question_type","provider_capability","status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_budget_reservations_attempt_unique" ON "research_budget_reservations" USING btree ("attempt_key");--> statement-breakpoint
CREATE INDEX "research_budget_reservations_project_time_idx" ON "research_budget_reservations" USING btree ("project_id","reserved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_budgets_project_unique" ON "research_budgets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "research_budgets_org_idx" ON "research_budgets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "research_request_costs_project_recorded_idx" ON "research_request_costs" USING btree ("project_id","recorded_at");--> statement-breakpoint
CREATE INDEX "research_request_costs_company_idx" ON "research_request_costs" USING btree ("project_id","company_id");--> statement-breakpoint
CREATE INDEX "research_request_costs_provider_idx" ON "research_request_costs" USING btree ("provider_id","recorded_at");--> statement-breakpoint
CREATE INDEX "project_signal_packs_org_idx" ON "project_signal_packs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_definitions_pack_code_unique" ON "signal_definitions" USING btree ("signal_pack_id","code");--> statement-breakpoint
CREATE INDEX "signal_definitions_pack_idx" ON "signal_definitions" USING btree ("signal_pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_packs_slug_unique" ON "signal_packs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_observation_unique" ON "signals" USING btree ("project_id","company_id","signal_definition_id","effective_date","rule_version");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_id_company_unique" ON "signals" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "signals_project_company_status_idx" ON "signals" USING btree ("project_id","company_id","status");--> statement-breakpoint
CREATE INDEX "intelligence_pack_clusters_version_idx" ON "intelligence_pack_clusters" USING btree ("version_id","review_status");--> statement-breakpoint
CREATE INDEX "intelligence_pack_questions_version_idx" ON "intelligence_pack_questions" USING btree ("version_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_pack_signals_version_code_unique" ON "intelligence_pack_signals" USING btree ("version_id","code");--> statement-breakpoint
CREATE INDEX "intelligence_pack_signals_version_status_idx" ON "intelligence_pack_signals" USING btree ("version_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_pack_versions_pack_version_unique" ON "intelligence_pack_versions" USING btree ("intelligence_pack_id","version");--> statement-breakpoint
CREATE INDEX "intelligence_pack_versions_status_idx" ON "intelligence_pack_versions" USING btree ("intelligence_pack_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "intelligence_packs_project_offering_unique" ON "intelligence_packs" USING btree ("project_id","offering_key");--> statement-breakpoint
CREATE INDEX "intelligence_packs_org_idx" ON "intelligence_packs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "signal_cluster_definitions_project_idx" ON "signal_cluster_definitions" USING btree ("project_id","active");--> statement-breakpoint
CREATE INDEX "signal_cluster_definitions_pack_idx" ON "signal_cluster_definitions" USING btree ("intelligence_pack_id","version");--> statement-breakpoint
CREATE INDEX "signal_cluster_members_signal_idx" ON "signal_cluster_members" USING btree ("signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_clusters_observation_unique" ON "signal_clusters" USING btree ("project_id","company_id","definition_id","rule_version");--> statement-breakpoint
CREATE INDEX "signal_clusters_project_company_idx" ON "signal_clusters" USING btree ("project_id","company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_project_company_unique" ON "opportunities" USING btree ("project_id","project_company_id");--> statement-breakpoint
CREATE INDEX "opportunities_project_state_idx" ON "opportunities" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "opportunity_history_opportunity_date_idx" ON "opportunity_history" USING btree ("opportunity_id","assessed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_model_project_version_unique" ON "opportunity_model_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "opportunity_model_project_active_idx" ON "opportunity_model_versions" USING btree ("project_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "why_explanations_opportunity_version_unique" ON "why_explanations" USING btree ("opportunity_id","version");--> statement-breakpoint
CREATE INDEX "why_explanations_opportunity_current_idx" ON "why_explanations" USING btree ("opportunity_id","current");--> statement-breakpoint
CREATE INDEX "contact_enrichment_attempts_person_created_idx" ON "contact_enrichment_attempts" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_enrichment_attempts_project_company_idx" ON "contact_enrichment_attempts" USING btree ("project_id","project_company_id","created_at");--> statement-breakpoint
CREATE INDEX "people_normalized_name_idx" ON "people" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "people_public_profile_unique" ON "people" USING btree ("profile_url");--> statement-breakpoint
CREATE INDEX "people_owner_organization_idx" ON "people" USING btree ("owner_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_company_roles_person_company_role_unique" ON "person_company_roles" USING btree ("person_id","company_id","role");--> statement-breakpoint
CREATE INDEX "person_company_roles_company_idx" ON "person_company_roles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "person_evidence_person_company_idx" ON "person_evidence" USING btree ("person_id","company_id");--> statement-breakpoint
CREATE INDEX "person_evidence_visibility_idx" ON "person_evidence" USING btree ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "project_person_context_project_company_person_unique" ON "project_person_context" USING btree ("project_id","project_company_id","person_id");--> statement-breakpoint
CREATE INDEX "project_person_context_project_company_priority_idx" ON "project_person_context" USING btree ("project_id","project_company_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_discovery_policies_project_unique" ON "buyer_discovery_policies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "buyer_discovery_policies_organization_idx" ON "buyer_discovery_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_discovery_runs_idempotency_unique" ON "buyer_discovery_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "buyer_discovery_runs_project_company_created_idx" ON "buyer_discovery_runs" USING btree ("project_id","project_company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_proposal_dedupe_unique" ON "learning_improvement_proposals" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "learning_proposal_scope_status_idx" ON "learning_improvement_proposals" USING btree ("organization_id","scope_key","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_metric_snapshot_key_unique" ON "learning_metric_snapshots" USING btree ("snapshot_key");--> statement-breakpoint
CREATE INDEX "learning_metric_scope_dimension_idx" ON "learning_metric_snapshots" USING btree ("organization_id","scope_key","dimension","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_model_scope_version_unique" ON "learning_model_versions" USING btree ("organization_id","scope_key","version");--> statement-breakpoint
CREATE INDEX "learning_model_scope_created_idx" ON "learning_model_versions" USING btree ("organization_id","scope_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_policy_scope_version_unique" ON "learning_policy_versions" USING btree ("organization_id","scope_key","version");--> statement-breakpoint
CREATE INDEX "learning_policy_scope_latest_idx" ON "learning_policy_versions" USING btree ("organization_id","scope_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_ledger_snapshot_key_unique" ON "recommendation_ledger" USING btree ("snapshot_key");--> statement-breakpoint
CREATE INDEX "recommendation_ledger_project_company_date_idx" ON "recommendation_ledger" USING btree ("project_id","project_company_id","recommended_at");--> statement-breakpoint
CREATE INDEX "recommendation_ledger_organization_date_idx" ON "recommendation_ledger" USING btree ("organization_id","recommended_at");--> statement-breakpoint
CREATE INDEX "recommendation_outcomes_recommendation_date_idx" ON "recommendation_outcomes" USING btree ("recommendation_id","recorded_at");--> statement-breakpoint
CREATE INDEX "recommendation_outcomes_project_date_idx" ON "recommendation_outcomes" USING btree ("project_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_adjudication_item_unique" ON "market_readiness_adjudications" USING btree ("campaign_id","cohort_item_id");--> statement-breakpoint
CREATE INDEX "market_readiness_audit_campaign_time_idx" ON "market_readiness_audits" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_blind_review_unique" ON "market_readiness_blind_gold_reviews" USING btree ("campaign_id","cohort_item_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "market_readiness_blind_review_campaign_idx" ON "market_readiness_blind_gold_reviews" USING btree ("campaign_id","submitted_at");--> statement-breakpoint
CREATE INDEX "market_readiness_campaign_project_idx" ON "market_readiness_campaigns" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_cohort_campaign_domain_unique" ON "market_readiness_cohort_items" USING btree ("campaign_id","normalized_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_cohort_campaign_opaque_unique" ON "market_readiness_cohort_items" USING btree ("campaign_id","opaque_review_key");--> statement-breakpoint
CREATE INDEX "market_readiness_cohort_campaign_stratum_idx" ON "market_readiness_cohort_items" USING btree ("campaign_id","stratum");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_assignment_item_unique" ON "market_readiness_experiment_assignments" USING btree ("experiment_id","cohort_item_id");--> statement-breakpoint
CREATE INDEX "market_readiness_assignment_experiment_arm_idx" ON "market_readiness_experiment_assignments" USING btree ("experiment_id","arm");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_experiment_campaign_unique" ON "market_readiness_experiments" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_outcome_idempotency_unique" ON "market_readiness_manual_outcomes" USING btree ("campaign_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_outcome_assignment_unique" ON "market_readiness_manual_outcomes" USING btree ("experiment_assignment_id");--> statement-breakpoint
CREATE INDEX "market_readiness_outcome_campaign_item_idx" ON "market_readiness_manual_outcomes" USING btree ("campaign_id","cohort_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_outcome_batch_idempotency_unique" ON "market_readiness_outcome_import_batches" USING btree ("campaign_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_prediction_campaign_item_unique" ON "market_readiness_prediction_snapshots" USING btree ("campaign_id","cohort_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_attempt_idempotency_unique" ON "market_readiness_processing_attempts" USING btree ("campaign_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "market_readiness_attempt_lease_idx" ON "market_readiness_processing_attempts" USING btree ("campaign_id","state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "market_readiness_attempt_cohort_item_idx" ON "market_readiness_processing_attempts" USING btree ("cohort_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_rollout_campaign_unique" ON "market_readiness_rollout_decisions" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_readiness_sales_review_unique" ON "market_readiness_salesperson_reviews" USING btree ("campaign_id","cohort_item_id","reviewer_id");