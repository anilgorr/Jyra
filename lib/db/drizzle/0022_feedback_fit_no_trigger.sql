-- A third verdict. The first feedback round showed the thumb conflated
-- "this company fits" with "I would reach out this week"; FIT_NO_TRIGGER
-- separates them. Precision@10 counts only RELEVANT. See schema/signal-feedback.ts.
ALTER TYPE "public"."signal_feedback_verdict" ADD VALUE 'FIT_NO_TRIGGER';