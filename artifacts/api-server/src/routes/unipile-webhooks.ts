import express, { Router, type IRouter, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, outreachEventsTable } from "@workspace/db";
import { applyUnipileEvent, parseUnipileEvent, recordOutreachEvent } from "../lib/outreach/accounts";
import { unipileConfiguration, verifyUnipileSignature } from "../lib/outreach/unipile-client";

/**
 * Where Unipile posts. One endpoint for every event type; this phase acts
 * on the account ones and files the rest for the phases that read them.
 *
 * Three rules from Unipile's side shape this route. The signature is over
 * the raw bytes, so the router parses its own body with `express.raw` and
 * must be mounted before the app-wide JSON parser. A delivery must get a
 * 2xx within five seconds or it is retried (after 2s, then 12s), so the
 * event is filed first and answered 200 even if acting on it fails - the
 * failure is written on the event row, not sent back as a 500 that would
 * only earn the same event again. And a retry of an event already filed is
 * answered 200 and otherwise ignored, which is what the unique event id is
 * for.
 *
 * With no `UNIPILE_WEBHOOK_SECRET` configured the route does not exist
 * (404), so an unconfigured deployment accepts nothing.
 */
const router: IRouter = Router();
type AsyncHandler = (...args: Parameters<RequestHandler>) => Promise<void>;
const asyncRoute = (handler: AsyncHandler): RequestHandler => (req, res, next) => void handler(req, res, next).catch(next);

router.post("/", express.raw({ type: "*/*", limit: "2mb" }), asyncRoute(async (req, res) => {
  const configuration = unipileConfiguration();
  if (!configuration.webhookSecret) return void res.status(404).json({ error: "Not found" });
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : "");
  const verdict = verifyUnipileSignature({ header: req.get("unipile-signature"), rawBody, secret: configuration.webhookSecret });
  if (!verdict.ok) {
    req.log.warn({ reason: verdict.reason }, "UNIPILE_WEBHOOK_REJECTED");
    return void res.status(401).json({ error: "Invalid signature" });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody.toString("utf8")); } catch { return void res.status(400).json({ error: "Body was not JSON" }); }
  const event = parseUnipileEvent(body);
  if (!event) return void res.status(400).json({ error: "Not an event" });

  const filed = await recordOutreachEvent(event);
  if (!filed.fresh) return void res.status(200).json({ received: true, duplicate: true });
  res.status(200).json({ received: true });

  try {
    const outcome = await applyUnipileEvent(event);
    await db.update(outreachEventsTable).set({ processedAt: new Date(), error: outcome.handled ? null : outcome.note }).where(eq(outreachEventsTable.id, filed.id));
    req.log.info({ eventId: event.id, type: event.type, accountId: event.account_id, ...outcome }, "UNIPILE_EVENT");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(outreachEventsTable).set({ processedAt: new Date(), error: message.slice(0, 1000) }).where(eq(outreachEventsTable.id, filed.id)).catch(() => undefined);
    req.log.error({ eventId: event.id, type: event.type, err: error }, "UNIPILE_EVENT_FAILED");
  }
}));

export default router;
