import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
if (process.env.NODE_ENV !== "development") throw new Error("06A replay is development-only.");
assertDevelopmentDatabase("06A offline buyer-role replay");
await build({ entryPoints: ["./scripts/buyer-role-resolution-06a-replay-entry.ts"], outfile: "/tmp/jyra-06a-replay.cjs", bundle: true, format: "cjs", platform: "node" });
await import(`file:///tmp/jyra-06a-replay.cjs?t=${Date.now()}`);