import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePreviewRealDataImport,
  useCommitRealDataImport,
  getListProjectCompaniesQueryKey,
  type RealDataImportMapping,
  type RealDataImportMappingTargetField,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  FileUp,
  Info,
  Loader2,
  UploadCloud,
} from "lucide-react";
import {
  parseCSVDocument,
  suggestImportMappings,
  mappingForTarget,
  importTargetLabels,
} from "@/lib/csv";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

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

  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "complete">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Array<{ rowId: string; values: Record<string, string> }>>([]);
  const [mappings, setMappings] = useState<RealDataImportMapping[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const preview = usePreviewRealDataImport();
  const commit = useCommitRealDataImport({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectCompaniesQueryKey(projectId) });
        setStep("complete");
      },
    },
  });

  const resetAndClose = () => {
    setStep("upload");
    setFile(null);
    setRows([]);
    setMappings([]);
    setParseErrors([]);
    setUploadError(null);
    preview.reset();
    commit.reset();
    onOpenChange(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setUploadError(null);

    if (!selected.name.toLowerCase().endsWith(".csv")) {
      setUploadError("Please upload a CSV file.");
      return;
    }

    const text = await selected.text();
    const parsed = parseCSVDocument(text);

    if (parsed.rows.length > 1000) {
      setUploadError("The CSV contains more than 1000 rows. Please split your file and try again.");
      return;
    }

    if (parsed.rows.length === 0) {
      setUploadError("The CSV is empty or could not be parsed.");
      return;
    }

    setFile(selected);
    setRows(parsed.rows);
    setParseErrors(parsed.errors);
    setMappings(suggestImportMappings(parsed.headers));
    setStep("mapping");
  };

  const handlePreview = () => {
    preview.mutate(
      {
        projectId,
        data: {
          fileName: file?.name || "upload.csv",
          mappings,
          rows,
        },
      },
      {
        onSuccess: () => setStep("preview"),
      }
    );
  };

  const handleCommit = () => {
    commit.mutate({
      projectId,
      data: {
        fileName: file?.name || "upload.csv",
        mappings,
        rows,
        confirm: true,
      },
    });
  };

  const hasCompanyName = mappings.some((m) => m.targetField === "company_name");

  const previewData = preview.data;

  // Derived arrays for preview tabs
  const reviewNeededRows =
    previewData?.rows.filter(
      (r) =>
        r.companyStatus === "NEEDS_REVIEW" ||
        r.duplicateStatus === "POSSIBLE_DUPLICATE"
    ) || [];

  const invalidRows =
    previewData?.rows.filter((r) => r.companyStatus === "INVALID" || r.errors.length > 0) || [];

  const missingDomainRows =
    previewData?.rows.filter((r) => !r.normalizedDomain && r.companyStatus !== "INVALID") || [];

  const contactRows =
    previewData?.rows.filter((r) => r.personName || r.contactStatus !== "MISSING") || [];

  const hasReviewRows = reviewNeededRows.length > 0;
  const hasNoValidRows = previewData?.summary.validRows === 0;

  return (
    <Dialog open={open} onOpenChange={(val) => !val && resetAndClose()}>
      <DialogContent className="max-w-4xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Data</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload a CSV to map and import accounts or contacts."}
            {step === "mapping" && "Map your CSV columns to the appropriate fields."}
            {step === "preview" && "Review what will be imported before saving."}
            {step === "complete" && "Import completed successfully."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0 py-4">
          {step === "upload" && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center h-full">
              <div className="mb-4 rounded-full bg-primary/10 p-4">
                <UploadCloud className="h-8 w-8 text-primary" />
              </div>
              <h3 className="mb-1 font-medium text-lg">Click or drag a CSV file</h3>
              <p className="mb-6 text-sm text-muted-foreground max-w-sm">
                Maximum 1000 rows. You can map your custom columns in the next step.
              </p>
              {uploadError && (
                <div className="mb-6 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive font-medium">
                  {uploadError}
                </div>
              )}
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                data-testid="button-upload-csv"
              >
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

          {step === "mapping" && (
            <div className="space-y-4 flex flex-col h-full">
              {parseErrors.length > 0 && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive shrink-0">
                  <h4 className="font-semibold flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" /> CSV Parse Warnings
                  </h4>
                  <ul className="list-disc pl-5 mt-2 space-y-1">
                    {parseErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-md border flex-1 overflow-auto min-h-0">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                    <TableRow>
                      <TableHead className="w-1/2">CSV Column</TableHead>
                      <TableHead className="w-1/2">Map To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((mapping, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{mapping.sourceHeader}</TableCell>
                        <TableCell>
                          <Select
                            value={mapping.targetField}
                            onValueChange={(val) => {
                              const newMappings = [...mappings];
                              newMappings[idx] = mappingForTarget(
                                mapping.sourceHeader,
                                 val as RealDataImportMappingTargetField
                              );
                              setMappings(newMappings);
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {importTargetLabels.map((label) => (
                                <SelectItem key={label.value} value={label.value}>
                                  {label.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {step === "preview" && preview.isPending && (
            <div className="flex flex-col items-center justify-center py-16 text-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="mt-4 font-medium">Analyzing file...</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Checking for exact matches, duplicates, and contact resolution.
              </p>
            </div>
          )}

          {step === "preview" && previewData && (
            <div className="flex flex-col h-full space-y-4">
              <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-blue-800 flex items-start gap-3 shrink-0">
                <Info className="h-5 w-5 shrink-0 text-blue-600" />
                <p>
                  No enrichment or research runs will be triggered by this import. Data is saved
                  exactly as mapped to the existing database.
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
                <div className="rounded-lg border bg-muted/30 p-4 text-center">
                  <p className="text-3xl font-bold">{previewData.summary.rowsDetected}</p>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    Rows
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 text-center">
                  <p className="text-3xl font-bold text-emerald-600">
                     {previewData.summary.validRows}
                  </p>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    Ready
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 text-center">
                  <p className="text-3xl font-bold">{previewData.summary.companiesDetected}</p>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    Companies
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 text-center">
                  <p className="text-3xl font-bold">{previewData.summary.contactsDetected}</p>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">
                    Contacts
                  </p>
                </div>
              </div>

              <div className="flex-1 min-h-0 border rounded-md flex flex-col">
                <Tabs
                  defaultValue={reviewNeededRows.length > 0 ? "review" : "invalid"}
                  className="flex flex-col h-full"
                >
                  <div className="border-b px-2 py-2 shrink-0">
                    <TabsList className="w-full flex justify-start overflow-x-auto bg-transparent">
                      <TabsTrigger
                        value="review"
                        className="data-[state=active]:bg-muted"
                      >
                        Review Needed ({reviewNeededRows.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="invalid"
                        className="data-[state=active]:bg-muted"
                      >
                        Invalid ({invalidRows.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="domains"
                        className="data-[state=active]:bg-muted"
                      >
                        Missing Domains ({missingDomainRows.length})
                      </TabsTrigger>
                      <TabsTrigger
                        value="contacts"
                        className="data-[state=active]:bg-muted"
                      >
                        Contacts ({previewData.summary.contactsDetected})
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden relative">
                    <TabsContent value="review" className="h-full m-0 data-[state=active]:block">
                      <ScrollArea className="h-full px-4 py-4">
                        {reviewNeededRows.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-emerald-500 opacity-50" />
                            <p>No rows require review.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {reviewNeededRows.map((row) => (
                              <div
                                key={row.rowId}
                                className="pb-4 border-b last:border-0 last:pb-0"
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <div>
                                    <p className="font-medium">
                                      {row.companyName || "Unknown Company"}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {row.normalizedDomain || "No domain"}
                                    </p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    {row.companyStatus === "NEEDS_REVIEW" && (
                                      <Badge
                                        variant="outline"
                                        className="bg-amber-500/10 text-amber-700 border-amber-500/20"
                                      >
                                        Needs Review
                                      </Badge>
                                    )}
                                    {row.duplicateStatus === "POSSIBLE_DUPLICATE" && (
                                      <Badge
                                        variant="outline"
                                        className="bg-amber-500/10 text-amber-700 border-amber-500/20"
                                      >
                                        Possible Duplicate
                                      </Badge>
                                    )}
                                    {row.matchedCompanyName && (
                                      <span className="text-xs text-muted-foreground mt-1">
                                        Matches: {row.matchedCompanyName}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {row.warnings.length > 0 && (
                                  <div className="text-sm text-amber-600 bg-amber-500/5 p-2 rounded border border-amber-500/10">
                                    {row.warnings.join(", ")}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="invalid" className="h-full m-0 data-[state=active]:block">
                      <ScrollArea className="h-full px-4 py-4">
                        {invalidRows.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-emerald-500 opacity-50" />
                            <p>No invalid rows found.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {invalidRows.map((row) => (
                              <div
                                key={row.rowId}
                                className="pb-4 border-b last:border-0 last:pb-0"
                              >
                                <p className="font-medium">
                                  {row.companyName || `Row ${row.rowId}`}
                                </p>
                                <ul className="list-disc pl-5 mt-2 text-sm text-destructive space-y-1">
                                  {row.errors.map((err, i) => (
                                    <li key={i}>{err}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="domains" className="h-full m-0 data-[state=active]:block">
                      <ScrollArea className="h-full px-4 py-4">
                        {missingDomainRows.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 mx-auto mb-3 text-emerald-500 opacity-50" />
                            <p>All extracted companies have domains.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {missingDomainRows.map((row) => (
                              <div
                                key={row.rowId}
                                className="pb-4 border-b last:border-0 last:pb-0"
                              >
                                <p className="font-medium">
                                  {row.companyName || `Row ${row.rowId}`}
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                   Domain could not be determined. The company can still be imported,
                                   but identity resolution will remain unresolved.
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="contacts" className="h-full m-0 data-[state=active]:block">
                      <ScrollArea className="h-full px-4 py-4">
                        {contactRows.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground">
                            <p>No contacts detected in this import.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {contactRows.map((row) => (
                              <div
                                key={row.rowId}
                                className="pb-4 border-b last:border-0 last:pb-0"
                              >
                                <div className="flex items-start justify-between">
                                  <div>
                                    <span className="font-medium text-sm block">
                                      {row.personName || "Unnamed Contact"}
                                    </span>
                                    <span className="text-xs text-muted-foreground block mt-1">
                                      {row.companyName || "Unknown Company"}{" "}
                                      {row.normalizedDomain ? `(${row.normalizedDomain})` : ""}
                                    </span>
                                  </div>
                                  <Badge
                                    variant={
                                      row.contactStatus === "READY" ? "default" : "secondary"
                                    }
                                  >
                                    {row.contactStatus}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            </div>
          )}

          {step === "complete" && commit.data && (
            <div className="flex flex-col h-full py-4 overflow-auto">
              <div className="flex flex-col items-center text-center mb-8 shrink-0">
                <div className="mb-4 rounded-full bg-emerald-500/10 p-4">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                </div>
                <h3 className="text-2xl font-bold">Import Complete</h3>
                <p className="mt-2 text-muted-foreground max-w-md">
                  Your data has been successfully imported and mapped. No further enrichment has
                  been triggered automatically.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {[
                  ["Processed", commit.data.rowsProcessed],
                  ["Created", commit.data.canonicalCompaniesCreated],
                  ["Matched", commit.data.existingCompaniesMatched],
                  ["Merged", commit.data.duplicatesMerged],
                  ["Need Review", commit.data.companiesNeedingReview],
                  ["Domains Resolved", commit.data.domainsResolved],
                  ["Domains Unresolved", commit.data.domainsUnresolved],
                  ["Contacts Created", commit.data.contactsCreated],
                  ["Contacts Matched", commit.data.contactsMatched],
                  ["Evidence", commit.data.evidenceCandidatesCreated],
                  ["Custom Fields", commit.data.customFieldsCreated],
                  ["Rejected", commit.data.rowsRejected],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border bg-card p-4 flex flex-col justify-between">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
                      {label}
                    </p>
                    <p className="text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-4 border-t">
          {step !== "complete" && (
            <Button variant="ghost" onClick={resetAndClose} disabled={commit.isPending}>
              Cancel
            </Button>
          )}

          {step === "mapping" && (
            <div className="flex items-center gap-4">
              {!hasCompanyName && (
                <span className="text-sm text-amber-600 font-medium">
                  Company name mapping is required.
                </span>
              )}
              <Button onClick={handlePreview} disabled={!hasCompanyName || preview.isPending}>
                {preview.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Preview Import
              </Button>
            </div>
          )}

          {step === "preview" && previewData && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setStep("mapping")}
                disabled={commit.isPending}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Back to Mapping
              </Button>
              <Button
                onClick={handleCommit}
                disabled={commit.isPending || hasReviewRows || hasNoValidRows}
                className={hasReviewRows ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
              >
                {commit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {hasReviewRows ? "Clean CSV to Continue" : "Confirm and Import"}
              </Button>
            </div>
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
