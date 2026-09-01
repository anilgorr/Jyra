import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
import { fix08ReplayEnvironmentAllowed } from "./fix-08-replay-guard.mjs";
if (process.env.NODE_ENV !== "development" || process.env.JYRA_FIX_08_REPLAY !== "YES") throw new Error("Fix08 replay requires NODE_ENV=development and JYRA_FIX_08_REPLAY=YES.");
if (!fix08ReplayEnvironmentAllowed(process.env)) throw new Error("Fix08 replay forbids Reality Test name/target variables and requires contacts disabled.");
assertDevelopmentDatabase("Fix08 bounded 18-company replay");
await build({ entryPoints: ["./scripts/fix-08-replay-entry.ts"], outfile: "/tmp/jyra-fix-08-replay.cjs", bundle: true, format: "cjs", platform: "node" });
await import("/tmp/jyra-fix-08-replay.cjs");