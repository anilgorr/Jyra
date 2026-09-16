-- Move `entity_status` and `source_classification` from text to enums.
--
-- These columns held a fixed vocabulary that only the API enforced, and only
-- on READ. Postgres accepted any string, so a wrong value was not a failed
-- insert - it was a 500 on GET .../evidence for every company the writing code
-- had touched, discovered whenever someone finally opened one. A CSV import
-- wrote entity_status = 'MATCHED', which is not a status; 517 rows went in
-- clean and 516 company pages broke.
--
-- The bare ALTER ... USING ::enum below would fail on such a row with
-- `invalid input value for enum`, naming one offending value and no row count.
-- On a database that has drifted, that is a migration you cannot act on. The
-- guards run first and report every distinct bad value with how many rows hold
-- it, so the repair is a known UPDATE rather than an investigation.

DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(format('%L (%s rows)', entity_status, n), ', ' ORDER BY n DESC)
    INTO offenders
  FROM (
    SELECT entity_status, count(*) AS n
    FROM evidence_attribution_reviews
    WHERE entity_status NOT IN
      ('CONFIRMED_ENTITY', 'PROBABLE_ENTITY', 'AMBIGUOUS_ENTITY', 'WRONG_ENTITY')
    GROUP BY entity_status
  ) bad;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'evidence_attribution_reviews.entity_status holds values outside the vocabulary: %. Repair these rows, then re-run.', offenders;
  END IF;
END $$;--> statement-breakpoint

DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(format('%L (%s rows)', source_classification, n), ', ' ORDER BY n DESC)
    INTO offenders
  FROM (
    SELECT source_classification, count(*) AS n
    FROM evidence_attribution_reviews
    WHERE source_classification NOT IN
      ('OFFICIAL_WEBSITE', 'NEWS', 'JOB_LISTING', 'SOCIAL_COMPANY_PROFILE',
       'BUSINESS_DATABASE', 'PRESS_RELEASE', 'PARTNER_VENDOR', 'OTHER_WEB')
    GROUP BY source_classification
  ) bad;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'evidence_attribution_reviews.source_classification holds values outside the vocabulary: %. Repair these rows, then re-run.', offenders;
  END IF;
END $$;--> statement-breakpoint

CREATE TYPE "public"."evidence_entity_status" AS ENUM('CONFIRMED_ENTITY', 'PROBABLE_ENTITY', 'AMBIGUOUS_ENTITY', 'WRONG_ENTITY');--> statement-breakpoint
CREATE TYPE "public"."evidence_source_classification" AS ENUM('OFFICIAL_WEBSITE', 'NEWS', 'JOB_LISTING', 'SOCIAL_COMPANY_PROFILE', 'BUSINESS_DATABASE', 'PRESS_RELEASE', 'PARTNER_VENDOR', 'OTHER_WEB');--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ALTER COLUMN "source_classification" SET DATA TYPE "public"."evidence_source_classification" USING "source_classification"::"public"."evidence_source_classification";--> statement-breakpoint
ALTER TABLE "evidence_attribution_reviews" ALTER COLUMN "entity_status" SET DATA TYPE "public"."evidence_entity_status" USING "entity_status"::"public"."evidence_entity_status";
