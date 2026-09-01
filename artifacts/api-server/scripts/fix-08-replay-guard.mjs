export function fix08ReplayEnvironmentAllowed(env) {
  return !env.JYRA_REALITY_TEST_NAME
    && !env.JYRA_REALITY_TARGET_COMPANIES
    && (!env.JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED || env.JYRA_REALITY_CONTACT_ENRICHMENT_ENABLED === "false")
    && (!env.JYRA_FIX_08_CONTACTS_ENABLED || env.JYRA_FIX_08_CONTACTS_ENABLED === "false");
}