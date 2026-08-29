import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  usePreviewCompanyImport,
  useCommitCompanyImport,
  getListProjectCompaniesQueryKey,
  type CompanyImportCandidateInput,
  type CompanyImportRowResult,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Loader2 } from "lucide-react";

const companySchema = z.object({
  canonicalName: z.string().min(1, "Company name is required").max(300),
  domain: z.string().max(300).optional(),
  website: z.string().max(500).optional(),
  linkedinUrl: z.string().max(500).optional(),
  country: z.string().max(120).optional(),
  industry: z.string().max(200).optional(),
  employeeCount: z.coerce.number().min(0).optional().or(z.literal("").transform(() => undefined)),
  employeeRange: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
});

type CompanyFormValues = z.infer<typeof companySchema>;

export function CompanyDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [reviewRow, setReviewRow] = useState<CompanyImportRowResult | null>(null);
  const [pendingInput, setPendingInput] = useState<CompanyImportCandidateInput | null>(null);
  
  const form = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      canonicalName: "",
      domain: "",
      website: "",
      linkedinUrl: "",
      country: "",
      industry: "",
      employeeCount: undefined,
      employeeRange: "",
      description: "",
    },
  });

  const preview = usePreviewCompanyImport();
  const commit = useCommitCompanyImport({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectCompaniesQueryKey(projectId) });
        setReviewRow(null);
        setPendingInput(null);
        form.reset();
        onOpenChange(false);
      },
    },
  });

  const errorMessage = preview.isError || commit.isError
    ? "JYRA could not validate or save this company. Review the identity details and try again."
    : null;

  const onSubmit = (data: CompanyFormValues) => {
    const company: CompanyImportCandidateInput = {
      canonicalName: data.canonicalName,
      domain: data.domain || null,
      website: data.website || null,
      linkedinUrl: data.linkedinUrl || null,
      country: data.country || null,
      industry: data.industry || null,
      employeeCount: data.employeeCount ?? null,
      employeeRange: data.employeeRange || null,
      description: data.description || null,
    };
    setPendingInput(company);
    setReviewRow(null);
    preview.mutate(
      {
        projectId,
        data: { rows: [{ rowId: "manual", company }] },
      },
      {
        onSuccess: (result) => {
          const row = result.rows[0];
          if (!row || row.decision === "invalid") {
            setReviewRow(row ?? null);
            return;
          }
          if (row.decision === "possible_duplicate") {
            setReviewRow(row);
            return;
          }
          commitManual(company);
        },
      },
    );
  };

  const refreshManualReview = (company: CompanyImportCandidateInput) => {
    preview.mutate(
      {
        projectId,
        data: { rows: [{ rowId: "manual", company }] },
      },
      {
        onSuccess: (result) => {
          setReviewRow(result.rows[0] ?? null);
        },
      },
    );
  };

  const commitManual = (
    company: CompanyImportCandidateInput,
    resolution?: { action: "create" | "reuse"; companyId?: string | null },
  ) => {
    commit.mutate(
      {
        projectId,
        data: {
          rows: [{ rowId: "manual", company, ...(resolution ? { resolution } : {}) }],
        },
      },
      {
        onError: () => refreshManualReview(company),
      },
    );
  };

  const resolveDuplicate = (
    action: "create" | "reuse",
    companyId?: string,
  ) => {
    if (!pendingInput) return;
    commitManual(pendingInput, {
      action,
      companyId: companyId ?? null,
    });
  };

  const isPending = preview.isPending || commit.isPending;

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val) form.reset();
      if (!val) {
        setReviewRow(null);
        setPendingInput(null);
        preview.reset();
        commit.reset();
      }
      onOpenChange(val);
    }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Company</DialogTitle>
          <DialogDescription>
            Manually enter a company profile to track.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="canonicalName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Inc." {...field} data-testid="input-company-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="domain"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Domain</FormLabel>
                    <FormControl>
                      <Input placeholder="acme.com" {...field} data-testid="input-company-domain" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input placeholder="https://acme.com" {...field} data-testid="input-company-website" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="employeeRange"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee Range</FormLabel>
                    <FormControl>
                      <Input placeholder="200–500" {...field} data-testid="input-company-employee-range" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Industry</FormLabel>
                    <FormControl>
                      <Input placeholder="Technology" {...field} data-testid="input-company-industry" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input placeholder="United States" {...field} data-testid="input-company-country" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="employeeCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Employee Count</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="500" {...field} value={field.value ?? ""} data-testid="input-company-employees" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="linkedinUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>LinkedIn URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://linkedin.com/company/acme" {...field} data-testid="input-company-linkedin" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Brief description of what the company does..." 
                      className="min-h-[100px]" 
                      {...field} 
                      data-testid="input-company-desc"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {errorMessage && (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="status-company-create-error">
                {errorMessage}
              </p>
            )}

            {reviewRow?.decision === "invalid" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="status-company-invalid">
                {reviewRow.errors.join(", ")}
              </div>
            )}

            {reviewRow?.decision === "possible_duplicate" && (
              <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4" data-testid="status-company-duplicate-review">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  Review possible duplicate
                </div>
                <p className="text-xs text-muted-foreground">
                  JYRA will not merge uncertain identities automatically. Choose an existing company or create a separate canonical record.
                </p>
                {reviewRow.possibleMatches.map((match) => (
                  <div key={match.id} className="flex items-center justify-between rounded-md border bg-background p-2 text-sm">
                    <div>
                      <p className="font-medium">{match.canonicalName}</p>
                      <p className="text-xs text-muted-foreground">{match.domain || "No domain"}</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => resolveDuplicate("reuse", match.id)} disabled={isPending} data-testid={`button-manual-reuse-${match.id}`}>
                      Reuse
                    </Button>
                  </div>
                ))}
                <Button type="button" size="sm" onClick={() => resolveDuplicate("create")} disabled={isPending} data-testid="button-manual-create-separate">
                  Create separate record
                </Button>
              </div>
            )}

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || reviewRow?.decision === "possible_duplicate"} data-testid="button-save-company">
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Validate and Add
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
