/**
 * What to tell a person when a request fails.
 *
 * The generated client throws an ApiError carrying the HTTP status and
 * whatever the server said. Raw, that reads as "HTTP 502 Bad Gateway:
 * <!DOCTYPE html>…" — an accurate sentence about nothing the reader can act
 * on. Analyze takes a minute of real work, so it collides with the deploy
 * restart window often enough that this matters: the honest answer there is
 * "it is restarting, try again", not a gateway error.
 *
 * Status is read structurally rather than by instanceof, so an error that
 * crossed a bundle boundary is still understood.
 */

const statusOf = (error: unknown): number | null => {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
};

const looksLikeHtml = (message: string): boolean => /<!doctype|<html|<\/?[a-z]+>/i.test(message);

export function describeApiError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const status = statusOf(error);
  if (status === 502 || status === 503 || status === 504) {
    return "The service is starting back up — this usually clears within a minute. Try again shortly.";
  }
  if (status === 401 || status === 403) return "Your session has expired. Sign in again and retry.";
  if (status === 429) return "Too many requests just now. Give it a moment and try again.";
  if (status === 504) return "That took too long to finish. Try again in a minute.";
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || looksLikeHtml(message)) return fallback;
  // Drop the "HTTP 400 Bad Request: " prefix; the reader wants the sentence after it.
  return message.replace(/^HTTP \d{3}[^:]*:\s*/, "");
}
