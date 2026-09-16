-- Two negative event types. Layoffs and hiring freezes share WORKFORCE_REDUCTION
-- (one story told twice); ACQUIRED is the company being bought, distinct from
-- ACQUISITION (the company buying someone). See lib/facts.ts.
ALTER TYPE "public"."fact_type" ADD VALUE 'WORKFORCE_REDUCTION';--> statement-breakpoint
ALTER TYPE "public"."fact_type" ADD VALUE 'ACQUIRED';