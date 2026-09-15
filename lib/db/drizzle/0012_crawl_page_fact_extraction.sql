ALTER TABLE "crawl_pages" ADD COLUMN "facts_extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD COLUMN "facts_extractor_version" text;--> statement-breakpoint
CREATE INDEX "crawl_pages_extraction_idx" ON "crawl_pages" USING btree ("facts_extracted_at");