import type {
  RealDataImportMapping,
  RealDataImportMappingTargetField,
} from "@workspace/api-client-react";

export type CsvDocument = {
  headers: string[];
  rows: Array<{ rowId: string; values: Record<string, string> }>;
  errors: string[];
};

const aliases: Record<string, RealDataImportMappingTargetField> = {
  company: "company_name",
  company_name: "company_name",
  account: "company_name",
  account_name: "company_name",
  organization: "company_name",
  organisation: "company_name",
  domain: "company_domain",
  company_domain: "company_domain",
  website: "company_website",
  company_website: "company_website",
  company_url: "company_website",
  company_linkedin: "company_linkedin_url",
  company_linkedin_url: "company_linkedin_url",
  linkedin_company_url: "company_linkedin_url",
  clinkedin: "company_linkedin_url",
  company_country: "company_country",
  hq_country: "company_country",
  ccountry: "company_country",
  company_state: "company_state",
  hq_state: "company_state",
  cstate: "company_state",
  company_city: "company_city",
  hq_city: "company_city",
  ccity: "company_city",
  industry: "company_industry",
  company_industry: "company_industry",
  employee_count: "company_employee_count",
  employees: "company_employee_count",
  headcount: "company_employee_count",
  companysize: "company_employee_range",
  company_size: "company_employee_range",
  employee_range: "company_employee_range",
  revenue: "company_revenue",
  company_revenue: "company_revenue",
  funding: "company_funding",
  total_funding: "company_funding",
  description: "company_description",
  company_description: "company_description",
  first_name: "person_first_name",
  firstname: "person_first_name",
  last_name: "person_last_name",
  lastname: "person_last_name",
  full_name: "person_full_name",
  contact_name: "person_full_name",
  person_name: "person_full_name",
  title: "person_title",
  job_title: "person_title",
  department: "person_department",
  function: "person_department",
  seniority: "person_seniority",
  management_level: "person_seniority",
  person_linkedin_url: "person_linkedin_url",
  linkedin_url: "person_linkedin_url",
  contact_linkedin: "person_linkedin_url",
  email: "person_email",
  email_address: "person_email",
  phone: "person_phone",
  phone_number: "person_phone",
  country: "person_country",
  state: "person_state",
  city: "person_city",
  technologies: "technology",
  technology: "technology",
  tech_stack: "technology",
  keywords: "keywords",
  keyword: "keywords",
};

export const importTargetLabels: Array<{
  value: RealDataImportMappingTargetField;
  label: string;
}> = [
  ["company_name", "Company name"],
  ["company_domain", "Company domain"],
  ["company_website", "Company website"],
  ["company_linkedin_url", "Company LinkedIn"],
  ["company_country", "Company country"],
  ["company_state", "Company state"],
  ["company_city", "Company city"],
  ["company_industry", "Industry"],
  ["company_employee_count", "Employee count"],
  ["company_employee_range", "Employee range"],
  ["company_revenue", "Revenue"],
  ["company_funding", "Funding"],
  ["company_description", "Company description"],
  ["person_first_name", "Contact first name"],
  ["person_last_name", "Contact last name"],
  ["person_full_name", "Contact full name"],
  ["person_title", "Contact title"],
  ["person_department", "Contact department"],
  ["person_seniority", "Contact seniority"],
  ["person_linkedin_url", "Contact LinkedIn"],
  ["person_email", "Contact email"],
  ["person_phone", "Contact phone"],
  ["person_country", "Contact country"],
  ["person_state", "Contact state"],
  ["person_city", "Contact city"],
  ["technology", "Technologies"],
  ["keywords", "Keywords"],
  ["custom_field", "Store as custom field"],
  ["evidence_candidate", "Treat as evidence candidate"],
  ["ignore", "Ignore"],
].map(([value, label]) => ({
  value: value as RealDataImportMappingTargetField,
  label,
}));

export function normalizeCsvHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCSVDocument(text: string): CsvDocument {
  const matrix: string[][] = [];
  const errors: string[] = [];
  let line: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      line.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      line.push(cell);
      if (line.some((value) => value.trim())) matrix.push(line);
      line = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (inQuotes) errors.push("The CSV contains an unclosed quoted value.");
  if (cell || line.length) {
    line.push(cell);
    if (line.some((value) => value.trim())) matrix.push(line);
  }
  if (!matrix.length) return { headers: [], rows: [], errors: ["The CSV is empty."] };
  const rawHeaders = matrix[0];
  const headers: string[] = [];
  const used = new Set<string>();
  rawHeaders.forEach((header, index) => {
    const base = normalizeCsvHeader(header) || `column_${index + 1}`;
    let unique = base;
    let suffix = 2;
    while (used.has(unique)) unique = `${base}_${suffix++}`;
    used.add(unique);
    headers.push(unique);
  });
  const rows = matrix.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      errors.push(
        `Row ${index + 2} has ${values.length} values; expected ${headers.length}. Missing cells were left blank.`,
      );
    }
    return {
      rowId: `row-${index + 1}`,
      values: Object.fromEntries(
        headers.map((header, columnIndex) => [header, values[columnIndex]?.trim() ?? ""]),
      ),
    };
  });
  return { headers, rows, errors };
}

export function suggestImportMappings(headers: string[]): RealDataImportMapping[] {
  return headers.map((header) => {
    const targetField = aliases[header] ?? "custom_field";
    if (targetField === "custom_field") {
      return {
        sourceHeader: header,
        targetField,
        action: "CUSTOM_FIELD",
      };
    }
    return {
      sourceHeader: header,
      targetField,
      action: "MAP",
    };
  });
}

export function mappingForTarget(
  sourceHeader: string,
  targetField: RealDataImportMappingTargetField,
): RealDataImportMapping {
  if (targetField === "custom_field") {
    return { sourceHeader, targetField, action: "CUSTOM_FIELD" };
  }
  if (targetField === "evidence_candidate") {
    return { sourceHeader, targetField, action: "EVIDENCE_CANDIDATE" };
  }
  if (targetField === "ignore") {
    return { sourceHeader, targetField, action: "IGNORE" };
  }
  return { sourceHeader, targetField, action: "MAP" };
}

export function parseCSV(text: string): Record<string, string>[] {
  return parseCSVDocument(text).rows.map((row) => row.values);
}