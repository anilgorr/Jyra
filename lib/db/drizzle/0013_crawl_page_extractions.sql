CREATE TABLE "crawl_page_extractions" (
	"crawl_page_id" uuid PRIMARY KEY NOT NULL,
	"extractor_version" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"facts_inserted" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DROP INDEX "crawl_pages_extraction_idx";--> statement-breakpoint
ALTER TABLE "crawl_page_extractions" ADD CONSTRAINT "crawl_page_extractions_crawl_page_id_crawl_pages_id_fk" FOREIGN KEY ("crawl_page_id") REFERENCES "public"."crawl_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_page_extractions_version_idx" ON "crawl_page_extractions" USING btree ("extractor_version");--> statement-breakpoint
ALTER TABLE "crawl_pages" DROP COLUMN "facts_extracted_at";--> statement-breakpoint
ALTER TABLE "crawl_pages" DROP COLUMN "facts_extractor_version";