import { Router, type IRouter } from "express";

const router: IRouter = Router();

/** When this process started. A restart resets it; a redeploy replaces it. */
const startedAt = new Date().toISOString();

/**
 * Which build is actually running.
 *
 * /healthz answers "is something alive", which is not the question that keeps
 * coming up. Twice in one day a change was pushed, a job was run against the
 * service, and the result was read as evidence about code that had not
 * finished deploying — a crawl still probing ten paths, a sweep still reading
 * nav stubs because the filter that skips them was not live yet. Both times
 * the only way to find out was to infer it backwards from the data.
 *
 * Render sets RENDER_GIT_COMMIT on every build, so the running process can
 * simply say what it is. One curl settles it, and a scheduled job can refuse
 * to run against a build older than the commit it expects.
 *
 * Mounted ahead of auth, like the liveness probe, so it answers during a
 * restart when auth is the least reliable thing about the service. It reports
 * the commit and nothing about configuration: which build is running is
 * operational, whether the service runs in development mode is a hint worth
 * not giving away.
 */
router.get("/build", (_req, res) => {
  res.json({
    commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
    branch: process.env.RENDER_GIT_BRANCH ?? null,
    startedAt,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

export default router;
