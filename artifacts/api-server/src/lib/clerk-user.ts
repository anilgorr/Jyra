import { clerkClient } from "@clerk/express";

/**
 * The two facts about a Clerk user that authorisation decisions rest on: the
 * primary verified email, and the backend-writable public metadata. Both are
 * read from the Clerk backend API, never from the session token, because the
 * token's custom claims can be templated from data the client controls.
 *
 * Cached for five minutes per user. Every authenticated request would
 * otherwise cost a Clerk API round trip, and the access-grant check runs on
 * all of them. Five minutes is long enough to keep the API off Clerk's rate
 * limit and short enough that suspending someone takes effect before they
 * have finished their coffee. A suspension is enforced against the database
 * on every request anyway; only the email lookup is cached.
 */
export type ClerkUserFacts = {
  primaryEmail: string | null;
  publicMetadata: unknown;
};

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { facts: ClerkUserFacts; expiresAt: number }>();

export async function clerkUserFacts(userId: string, now = Date.now()): Promise<ClerkUserFacts> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.facts;

  const user = await clerkClient.users.getUser(userId);
  const primary = user.emailAddresses.find((address) => address.id === user.primaryEmailAddressId);
  const facts: ClerkUserFacts = {
    /* Only a VERIFIED primary address counts. An unverified one is a string
     * the account holder typed, and anyone can type an admin's email. */
    primaryEmail: primary && primary.verification?.status === "verified" ? primary.emailAddress : null,
    publicMetadata: user.publicMetadata,
  };
  cache.set(userId, { facts, expiresAt: now + TTL_MS });
  return facts;
}

/** For tests and for an admin action that must see a change immediately. */
export function forgetClerkUser(userId: string): void {
  cache.delete(userId);
}
