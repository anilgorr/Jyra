import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePreviewCompanyImport,
  useCommitCompanyImport,
  getListProjectCompaniesQueryKey,
  type CompanyImportRowResult,
  type CompanyImportCommitRow,
  type CompanyImportRow,
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
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from "lucide-react";
import { parseCSV } from "@/lib/csv";
import { Badge } from "@/components/ui/badge";

export function mapCsvRowToCompanyInput(row: Record<string, string>) {
  const value = (...keys: string[]) => keys.map((key) => row[key]).find(Boolean) || null;
  const canonicalName = value('company_name', 'canonical_name', 'company', 'account_name', 'name') || '';
  const domain = value('domain', 'company_domain');
  const website = value('website', 'company_url', 'url');
  const linkedinUrl = value('linkedin_url', 'linkedin_company_url');
  const country = row['country'] || null;
  const industry = row['industry'] || null;
  
  const employeeCount = value('employee_count', 'employees', 'headcount');
  
  const employeeRange = value('employee_range', 'company_size');
  const description = value('description', 'company_description');

  return {
    canonicalName: canonicalName || null,
    domain,
    website,
    linkedinUrl,
    country,
    industry,
    employeeCount,
    employeeRange,
    description,
  };
}

export function ImportDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [step, setStep] = useState<"upload" | "preview" | "complete">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [importRows, setImportRows] = useState<CompanyImportRow[]>([]);
  const [commitConflict, setCommitConflict] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, { action: 'create' | 'reuse', companyId?: string | null }>>({});

  const preview = usePreviewCompanyImport();
  const commit = useCommitCompanyImport({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectCompaniesQueryKey(projectId) });
        setStep("complete");
      },
      onError: () => {
        setCommitConflict(true);
        setResolutions({});
        if (importRows.length) {
          preview.mutate({
            projectId,
            data: { rows: importRows },
          });
          setStep("preview");
        }
      },
    },
  });

  const resetAndClose = () => {
    setStep("upload");
    setFile(null);
    setImportRows([]);
    setCommitConflict(false);
    setResolutions({});
    preview.reset();
    commit.reset();
    onOpenChange(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    
    const text = await selected.text();
    const rows = parseCSV(text);
    
    const importRows = rows.map((row, i) => ({
      rowId: `row-${i}`,
      company: mapCsvRowToCompanyInput(row),
    }));
    setImportRows(importRows);
    setCommitConflict(false);

    preview.mutate({
      projectId,
      data: { rows: importRows },
    });
    setStep("preview");
  };

  const handleCommit = () => {
    const previewData = preview.data;
    if (!previewData) return;

    const commitRows: CompanyImportCommitRow[] = previewData.rows
      .filter((r) => r.decision !== 'invalid' && r.decision !== 'already_linked')
      .map((r) => {
        const res = resolutions[r.rowId];
        return {
          rowId: r.rowId,
          company: r.input,
          ...(res ? { resolution: res } : {}),
        };
      });

    commit.mutate({
      projectId,
      data: { rows: commitRows },
    });
  };

  const previewData = preview.data;
  
  const unresolvedDuplicates = previewData?.rows.filter(
    r => r.decision === 'possible_duplicate' && !resolutions[r.rowId]
  ).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(val) => !val && resetAndClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Companies</DialogTitle>
          <DialogDescription>
            Preview normalization and identity matches before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <div className="mb-4 rounded-full bg-primary/10 p-4">
              <UploadCloud className="h-8 w-8 text-primary" />
            </div>
            <h3 className="mb-1 font-medium">Click or drag a CSV file</h3>
            <p className="mb-6 text-sm text-muted-foreground max-w-sm">
              Supported columns: company_name, domain, website, linkedin_url, country, industry, employee_count.
            </p>
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" data-testid="button-upload-csv">
              <FileUp className="mr-2 h-4 w-4" />
              Select File
            </Button>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
              data-testid="input-file-csv"
            />
          </div>
        )}

        {step === "preview" && preview.isPending && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 font-medium">Analyzing file...</p>
            <p className="mt-1 text-sm text-muted-foreground">Checking for exact matches and possible duplicates.</p>
          </div>
        )}

        {step === "preview" && previewData && (
          <div className="space-y-6">
            {commitConflict && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-800" data-testid="status-import-conflict">
                Company identity changed after preview. Matches were refreshed; review them before committing again.
              </div>
            )}
            <div className="flex items-center gap-4 rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-1 flex-col items-center gap-1 text-center">
                <span className="text-2xl font-bold">{previewData.total}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Total</span>
              </div>
              <div className="h-10 w-px bg-border"></div>
              <div className="flex flex-1 flex-col items-center gap-1 text-center">
                <span className="text-2xl font-bold text-emerald-600">{previewData.newCompanies + previewData.exactMatches}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Ready</span>
              </div>
              <div className="h-10 w-px bg-border"></div>
              <div className="flex flex-1 flex-col items-center gap-1 text-center">
                <span className="text-2xl font-bold text-amber-600">{previewData.possibleDuplicates}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Duplicates</span>
              </div>
              <div className="h-10 w-px bg-border"></div>
              <div className="flex flex-1 flex-col items-center gap-1 text-center">
                <span className="text-2xl font-bold text-destructive">{previewData.invalid}</span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Invalid</span>
              </div>
            </div>

            {previewData.possibleDuplicates > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  Review possible duplicates
                </h4>
                <div className="max-h-[300px] overflow-y-auto space-y-3 pr-2">
                  {previewData.rows.filter(r => r.decision === 'possible_duplicate').map(row => (
                    <div key={row.rowId} className="rounded-lg border p-4 text-sm" data-testid={`row-duplicate-${row.rowId}`}>
                      <div className="mb-3 flex items-start justify-between">
                        <div>
                          <p className="font-medium">{row.input.canonicalName || 'Unknown Company'}</p>
                          <p className="text-muted-foreground">{row.input.domain || 'No domain'}</p>
                        </div>
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700">Duplicate</Badge>
                      </div>
                      
                      <div className="space-y-2">
                        {row.possibleMatches.map(match => (
                          <div key={match.id} className="flex items-center justify-between rounded-md border bg-background p-2">
                            <div>
                              <p className="font-medium">{match.canonicalName}</p>
                              <p className="text-xs text-muted-foreground">{match.domain}</p>
                            </div>
                            <Button 
                              size="sm" 
                              variant={resolutions[row.rowId]?.companyId === match.id ? "default" : "outline"}
                              onClick={() => setResolutions(prev => ({
                                ...prev,
                                [row.rowId]: { action: 'reuse', companyId: match.id }
                              }))}
                              data-testid={`button-reuse-${match.id}`}
                            >
                              {resolutions[row.rowId]?.companyId === match.id ? "Selected" : "Use this match"}
                            </Button>
                          </div>
                        ))}
                        <div className="flex items-center justify-between rounded-md border bg-background p-2">
                          <div>
                            <p className="font-medium">Create separate record</p>
                            <p className="text-xs text-muted-foreground">Keep this distinct from existing matches</p>
                          </div>
                          <Button 
                            size="sm" 
                            variant={resolutions[row.rowId]?.action === 'create' ? "default" : "outline"}
                            onClick={() => setResolutions(prev => ({
                              ...prev,
                              [row.rowId]: { action: 'create' }
                            }))}
                            data-testid={`button-create-separate-${row.rowId}`}
                          >
                            {resolutions[row.rowId]?.action === 'create' ? "Selected" : "Create new"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {previewData.invalid > 0 && (
              <div className="space-y-3">
                <h4 className="font-medium flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  Invalid rows (will be skipped)
                </h4>
                <div className="max-h-[200px] overflow-y-auto space-y-2 pr-2">
                  {previewData.rows.filter(r => r.decision === 'invalid').map(row => (
                    <div key={row.rowId} className="flex items-center justify-between rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm">
                      <p className="font-medium">{row.input.canonicalName || 'Missing Name'}</p>
                      <p className="text-destructive">{row.errors.join(', ')}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === "complete" && commit.data && (
          <div className="space-y-5 py-4" data-testid="status-import-complete">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 rounded-full bg-emerald-500/10 p-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold">Import complete</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Canonical identities were created or reused only after review.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Created", commit.data.created],
                ["Reused", commit.data.reused],
                ["Linked", commit.data.linked],
                ["Skipped", commit.data.skipped],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-muted/30 p-3 text-center">
                  <p className="text-xl font-bold" data-testid={`text-import-${String(label).toLowerCase()}`}>{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={commit.isPending}>
            Cancel
          </Button>
          {step === "preview" && previewData && (
            <Button 
              onClick={handleCommit} 
              disabled={unresolvedDuplicates > 0 || commit.isPending || previewData.valid === 0 || previewData.rows.every((row) => row.decision === "already_linked" || row.decision === "invalid")}
              data-testid="button-commit-import"
            >
              {commit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {unresolvedDuplicates > 0 
                ? `Resolve ${unresolvedDuplicates} duplicates` 
                : "Confirm and Import"}
            </Button>
          )}
          {step === "complete" && (
            <Button onClick={resetAndClose} data-testid="button-close-import-results">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
