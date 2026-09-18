import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for a machine caller. No user, no session, no Clerk.
 *
 * The token lives in JYRA_WATCH_LOOP_TOKEN. With it unset the endpoint does
 * not exist — a 404, not a 401, so an unconfigured deployment gives nothing
 * away. Comparison is constant-time and length-guarded.
 *
 * It lives in lib rather than beside the route because it is pure and the
 * hermetic suites test it: importing it from a route file dragged the whole
 * Express and logger graph into a bundle that is meant to have neither.
 */
export function watchLoopTokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected || expected.length < 32) return false;
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
