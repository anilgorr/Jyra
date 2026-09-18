ALTER TABLE "companies" ADD COLUMN "industry_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "country_iso2" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "employee_min" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "employee_max" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "normalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "normalization_version" text;