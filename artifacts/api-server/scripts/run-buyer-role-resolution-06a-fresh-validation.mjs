import { build } from "esbuild";
import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
if (process.env.NODE_ENV !== "development" || process.env.JYRA_06A_FRESH_VALIDATION !== "YES") throw new Error("Fresh 06A validation requires NODE_ENV=development and JYRA_06A_FRESH_VALIDATION=YES.");
if (process.env.JYRA_REALITY_TEST_NAME || process.env.JYRA_REALITY_TARGET_COMPANIES || process.env.JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED !== "false") throw new Error("06A fresh validation is not a Reality Test and requires contacts disabled.");
assertDevelopmentDatabase("06A fresh 20-company validation");
await build({ entryPoints: ["./scripts/buyer-role-resolution-06a-fresh-validation-entry.ts"], outfile: "/tmp/jyra-06a-fresh.cjs", bundle: true, format: "cjs", platform: "node" });
await import(`file:///tmp/jyra-06a-fresh.cjs?t=${Date.now()}`);