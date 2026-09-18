import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

/**
 * A checklist for the ICP dimensions whose values are a list of names.
 *
 * The value box used to be a comma-separated text field for every dimension.
 * That is how a Bangalore agency's test ICP ended up with a geography list of
 * "North America, United Kingdom, European Union, Australia & New Zealand,
 * Middle East & Asia-Pacific" and no India - and fifteen Indian companies
 * scored "not a fit" for being where the seller is. Ticking boxes makes the
 * omission visible; a free-text box hides it.
 *
 * Presets are a starting point, not a vocabulary: anything typed under "Add
 * your own" is kept, and a saved value that is not a preset shows up as a
 * ticked custom entry so editing never silently drops it.
 */
export const ICP_PRESETS: Record<string, readonly string[]> = {
  geography: [
    "India", "United States", "Canada", "United Kingdom", "European Union", "Germany", "France", "Netherlands",
    "Nordics", "Middle East", "UAE", "Saudi Arabia", "Singapore", "Southeast Asia", "Australia & New Zealand",
    "Japan", "Latin America", "Africa", "Global",
  ],
  industry: [
    "IT services", "SaaS / software", "Cybersecurity", "Fintech", "Edtech", "Healthtech", "E-commerce", "D2C / consumer brands",
    "Manufacturing", "Logistics", "Real estate", "Hospitality", "Professional services", "Marketing & advertising", "Media",
    "BFSI", "Pharma", "Automotive", "Energy", "Non-profit", "Government",
  ],
  business_model: ["B2B", "B2C", "B2B2C", "Marketplace", "SaaS subscription", "Services / agency", "Product company", "Enterprise", "SMB-focused"],
  technology: ["HubSpot", "Salesforce", "Marketo", "Pardot", "Zoho", "WordPress", "Shopify", "Webflow", "Google Analytics", "Intercom", "Zendesk", "AWS", "Azure", "Google Cloud"],
  buyer_maturity: ["Early-stage", "Growth-stage", "Scaling", "Established", "Enterprise"],
  compliance: ["ISO 27001", "SOC 2", "GDPR", "HIPAA", "PCI DSS", "DPDP (India)"],
};

export function hasChecklist(dimension: string, operator: string): boolean {
  return dimension in ICP_PRESETS && (operator === "IN" || operator === "NOT_IN");
}

/** Comma-separated text ↔ list, so the existing parseValue keeps working. */
export function splitValues(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}
const joinValues = (values: string[]) => values.join(", ");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function IcpChecklist({ dimension, value, onChange }: {
  dimension: string;
  /** The comma-separated value string the dialog already holds. */
  value: string;
  onChange: (next: string) => void;
}) {
  const presets = ICP_PRESETS[dimension] ?? [];
  const selected = splitValues(value);
  const custom = selected.filter((v) => !presets.some((p) => same(p, v)));
  const [draft, setDraft] = useState("");

  const isOn = (name: string) => selected.some((v) => same(v, name));
  const toggle = (name: string) => {
    const next = isOn(name) ? selected.filter((v) => !same(v, name)) : [...selected, name];
    onChange(joinValues(next));
  };
  const addCustom = () => {
    const name = draft.trim();
    if (!name) return;
    if (!isOn(name)) onChange(joinValues([...selected, name]));
    setDraft("");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {presets.map((name) => (
          <label key={name} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={isOn(name)} onCheckedChange={() => toggle(name)} aria-label={name} />
            <span>{name}</span>
          </label>
        ))}
      </div>
      {custom.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {custom.map((name) => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs">
              {name}
              <button type="button" aria-label={`Remove ${name}`} className="rounded-full hover:bg-background" onClick={() => toggle(name)}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          placeholder="Add your own — e.g. Bengaluru, Tier-2 cities, DACH"
          className="h-9"
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={addCustom} disabled={!draft.trim()}>
          <Plus className="mr-1 h-4 w-4" />Add
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {selected.length === 0 ? "Nothing selected yet." : `${selected.length} selected: ${joinValues(selected)}`}
      </p>
    </div>
  );
}
