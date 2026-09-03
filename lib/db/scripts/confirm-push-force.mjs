import { assertDevelopmentDatabase } from "./assert-development.mjs";

// `drizzle-kit push --force` accepts every data-loss statement drizzle-kit
// proposes without a prompt. It must never run by accident, so it requires an
// explicit, single-use confirmation in addition to the development-database
// fingerprint check performed by drizzle.config.ts.
assertDevelopmentDatabase("Forced schema push");
if (process.env.JYRA_CONFIRM_DESTRUCTIVE_PUSH !== "I_ACCEPT_DATA_LOSS") {
  console.error(
    "Refusing `drizzle-kit push --force`: set JYRA_CONFIRM_DESTRUCTIVE_PUSH=I_ACCEPT_DATA_LOSS " +
    "to confirm that dropping development data is intended.",
  );
  process.exit(1);
}
