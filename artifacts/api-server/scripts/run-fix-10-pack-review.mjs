import { assertDevelopmentDatabase } from "../../../lib/db/scripts/assert-development.mjs";
import { build } from "esbuild"; import { createRequire } from "node:module";
assertDevelopmentDatabase("Fix10 pack review");
const out="/tmp/jyra-fix10-pack-review.cjs"; await build({entryPoints:["./scripts/fix-10-pack-review-entry.ts"],outfile:out,bundle:true,format:"cjs",platform:"node",external:["pg-native"]});
const mod=createRequire(import.meta.url)(out);
if(process.env.JYRA_FIX_10_APPROVE_REVIEWED_PACK==="YES") await mod.activateReviewedFix10Pack(); else await mod.inspectFix10Pack();