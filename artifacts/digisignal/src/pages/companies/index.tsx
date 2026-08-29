import { useState } from "react";
import { 
  useListProjectCompanies,
  getListProjectCompaniesQueryKey,
  type ProjectCompany
} from "@workspace/api-client-react";
import { useWorkspace } from "@/context/workspace-context";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  DownloadCloud, 
  Loader2, 
  Plus, 
  Search, 
  Target 
} from "lucide-react";
import { Input } from "@/components/ui/input";

import { CompanyDialog } from "./company-dialog";
import { ImportDialog } from "./import-dialog";
import { CompanySheet } from "./company-sheet";

export default function CompaniesPage() {
  const { activeProjectId } = useWorkspace();
  const projectId = activeProjectId ?? "";
  
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<ProjectCompany | null>(null);

  const { data: companies = [], isLoading, isError } = useListProjectCompanies(
    projectId,
    { query: { enabled: !!projectId, queryKey: getListProjectCompaniesQueryKey(projectId) } }
  );

  if (!activeProjectId) {
    return <div className="p-8 text-center text-muted-foreground">Select a project first.</div>;
  }

  if (isLoading) {
    return <div className="flex justify-center p-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center">
        <h1 className="text-xl font-semibold">Companies unavailable</h1>
        <p className="mt-2 text-muted-foreground">Refresh the page to reconnect.</p>
      </div>
    );
  }

  const filteredCompanies = companies.filter((pc) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const c = pc.company;
    return (
      c.canonicalName.toLowerCase().includes(term) ||
      (c.domain && c.domain.toLowerCase().includes(term)) ||
      (c.industry && c.industry.toLowerCase().includes(term))
    );
  });

  const activeCount = companies.filter(c => c.status === "active").length;
  const inProgressCount = companies.filter(c => c.researchStatus === "in_progress").length;
  const oppCount = companies.filter(c => c.opportunityState !== "none" && c.opportunityState !== null).length;

  return (
    <div className="space-y-7 pb-12 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span>Opportunity intelligence</span>
          </div>
          <h1 className="font-display text-3xl font-bold">Companies</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Manage canonical company identity linked to this project. Review, import, and qualify candidates.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-csv">
            <DownloadCloud className="mr-2 h-4 w-4" />
            Import CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-add-company">
            <Plus className="mr-2 h-4 w-4" />
            Add company
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-none">
          <CardContent className="flex gap-4 p-5">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold font-display">{companies.length}</p>
              <p className="text-sm text-muted-foreground">Total companies tracking</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex gap-4 p-5">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
              <Loader2 className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-display">{inProgressCount}</p>
              <p className="text-sm text-muted-foreground">Research in progress</p>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardContent className="flex gap-4 p-5">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
              <Target className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold font-display">{oppCount}</p>
              <p className="text-sm text-muted-foreground">Identified opportunities</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="p-4 border-b flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              type="search" 
              placeholder="Search companies..." 
              className="pl-9 bg-background" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-companies"
            />
          </div>
        </div>
        
        {filteredCompanies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="font-medium text-lg">No companies found</h3>
            <p className="text-muted-foreground max-w-md mt-1 mb-6">
              {searchTerm 
                ? "Try adjusting your search criteria."
                : "Import a CSV or add a company manually to start qualifying accounts."}
            </p>
            {!searchTerm && (
              <Button onClick={() => setCreateOpen(true)} variant="outline">
                <Plus className="mr-2 h-4 w-4" /> Add your first company
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Research</TableHead>
                <TableHead>Fit Score</TableHead>
                <TableHead>Opportunity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCompanies.map((pc) => {
                const c = pc.company;
                return (
                  <TableRow 
                    key={pc.id} 
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setSelectedCompany(pc)}
                    data-testid={`row-company-${pc.id}`}
                  >
                    <TableCell>
                      <div className="font-medium">{c.canonicalName}</div>
                      <div className="text-xs text-muted-foreground">{c.domain || c.industry || "No domain"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        pc.status === 'active' ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" :
                        pc.status === 'archived' ? "bg-muted text-muted-foreground border-transparent" :
                        ""
                      }>
                        {pc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={
                        pc.researchStatus === 'complete' ? "bg-emerald-500/10 text-emerald-700" :
                        pc.researchStatus === 'in_progress' ? "bg-amber-500/10 text-amber-700" :
                        "bg-muted/50 text-muted-foreground"
                      }>
                        {pc.researchStatus.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {pc.fitScore !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${pc.fitScore >= 70 ? 'bg-emerald-500' : pc.fitScore >= 40 ? 'bg-amber-500' : 'bg-destructive'}`} 
                              style={{ width: `${pc.fitScore}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{pc.fitScore}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {pc.opportunityState && pc.opportunityState !== 'none' ? (
                        <Badge variant="outline" className="border-primary/20 text-primary">
                          {pc.opportunityState}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <CompanyDialog 
        projectId={projectId} 
        open={createOpen} 
        onOpenChange={setCreateOpen} 
      />
      
      <ImportDialog 
        projectId={projectId} 
        open={importOpen} 
        onOpenChange={setImportOpen} 
      />
      
      <CompanySheet 
        projectCompany={selectedCompany} 
        onClose={() => setSelectedCompany(null)} 
      />
    </div>
  );
}
