/** Punctuation, suffixes and case removed so "Kissflow, Inc." matches "Kissflow". */
export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|pvt|private|plc|co|sa|bv|ag)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
