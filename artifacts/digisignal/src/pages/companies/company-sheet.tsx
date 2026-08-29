import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useUpdateProjectCompany,
  getListProjectCompaniesQueryKey,
  type ProjectCompany,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Loader2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const updateSchema = z.object({
  status: z.enum(["candidate", "active", "archived"]),
  researchStatus: z.enum(["not_started", "in_progress", "complete"]),
  fitScore: z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined)),
  needScore: z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined)),
  timingScore: z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined)),
  relationshipScore: z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined)),
  confidenceScore: z.coerce.number().min(0).max(100).optional().or(z.literal("").transform(() => undefined)),
  opportunityState: z.enum(["none", "potential", "active", "won", "lost"]),
});

type UpdateFormValues = z.infer<typeof updateSchema>;

export function CompanySheet({
  projectCompany,
  onClose,
}: {
  projectCompany: ProjectCompany | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const projectId = projectCompany?.projectId ?? "";
  
  const form = useForm<UpdateFormValues>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      status: "candidate",
      researchStatus: "not_started",
      opportunityState: "none",
    },
  });

  const initializedForId = useRef<string | null>(null);

  useEffect(() => {
    if (projectCompany && initializedForId.current !== projectCompany.id) {
      initializedForId.current = projectCompany.id;
      form.reset({
        status: projectCompany.status,
        researchStatus: projectCompany.researchStatus,
        fitScore: projectCompany.fitScore ?? undefined,
        needScore: projectCompany.needScore ?? undefined,
        timingScore: projectCompany.timingScore ?? undefined,
        relationshipScore: projectCompany.relationshipScore ?? undefined,
        confidenceScore: projectCompany.confidenceScore ?? undefined,
        opportunityState: projectCompany.opportunityState ?? "none",
      });
    }
  }, [projectCompany, form]);

  const update = useUpdateProjectCompany({
    mutation: {
      onSuccess: (data) => {
        // Optimistically update the list cache to avoid full refetch cascading
        queryClient.setQueryData(
          getListProjectCompaniesQueryKey(projectId),
          (old: ProjectCompany[] | undefined) => {
            if (!old) return old;
            return old.map(item => item.id === data.id ? data : item);
          }
        );
        onClose();
      },
    }
  });

  const onSubmit = (data: UpdateFormValues) => {
    if (!projectCompany) return;
    
    update.mutate({
      projectId,
      projectCompanyId: projectCompany.id,
      data: {
        status: data.status,
        researchStatus: data.researchStatus,
        fitScore: data.fitScore ?? null,
        needScore: data.needScore ?? null,
        timingScore: data.timingScore ?? null,
        relationshipScore: data.relationshipScore ?? null,
        confidenceScore: data.confidenceScore ?? null,
        opportunityState: data.opportunityState === "none" ? null : data.opportunityState,
      },
    });
  };

  const c = projectCompany?.company;

  return (
    <Sheet open={!!projectCompany} onOpenChange={(val) => !val && onClose()}>
      <SheetContent className="overflow-y-auto w-[400px] sm:max-w-[500px]">
        {projectCompany && c && (
          <>
            <SheetHeader className="mb-6">
              <SheetTitle className="font-display text-2xl">{c.canonicalName}</SheetTitle>
              <SheetDescription className="flex items-center gap-2">
                {c.domain && <span>{c.domain}</span>}
                {c.industry && <Badge variant="secondary">{c.industry}</Badge>}
              </SheetDescription>
            </SheetHeader>

            <div className="mb-8 space-y-4 text-sm text-muted-foreground">
              {c.description && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p>{c.description}</p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-y-2">
                {c.country && <div><span className="font-medium text-foreground">Country:</span> {c.country}</div>}
                {c.employeeCount && <div><span className="font-medium text-foreground">Employees:</span> {c.employeeCount.toLocaleString()}</div>}
                {c.employeeRange && <div><span className="font-medium text-foreground">Range:</span> {c.employeeRange}</div>}
              </div>

              <div className="flex gap-3">
                {c.website && (
                  <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="flex items-center text-primary hover:underline">
                    <ExternalLink className="mr-1 h-3 w-3" /> Website
                  </a>
                )}
                {c.linkedinUrl && (
                  <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center text-primary hover:underline">
                    <ExternalLink className="mr-1 h-3 w-3" /> LinkedIn
                  </a>
                )}
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <div className="rounded-xl border p-4 space-y-4">
                  <h3 className="font-medium text-foreground">Project Context</h3>
                  
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="candidate">Candidate</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="archived">Archived</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="researchStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Research Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-research-status">
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="not_started">Not Started</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="complete">Complete</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="opportunityState"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opportunity</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-opportunity-state">
                              <SelectValue placeholder="Select state" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="potential">Potential</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="won">Won</SelectItem>
                            <SelectItem value="lost">Lost</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="rounded-xl border p-4 space-y-4">
                  <div>
                    <h3 className="font-medium text-foreground">Project Scores (0-100)</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Manual project values only. JYRA has not researched or computed these scores.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="fitScore" render={({ field }) => (
                      <FormItem><FormLabel>Fit Score</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-score-fit" /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="needScore" render={({ field }) => (
                      <FormItem><FormLabel>Need Score</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-score-need" /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="timingScore" render={({ field }) => (
                      <FormItem><FormLabel>Timing Score</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-score-timing" /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="confidenceScore" render={({ field }) => (
                      <FormItem><FormLabel>Confidence Score</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-score-confidence" /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="relationshipScore" render={({ field }) => (
                      <FormItem><FormLabel>Relationship Score</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-score-relationship" /></FormControl></FormItem>
                    )} />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button type="button" variant="ghost" onClick={onClose} className="mr-2">Cancel</Button>
                  <Button type="submit" disabled={update.isPending} data-testid="button-save-project-company">
                    {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                  </Button>
                </div>
              </form>
            </Form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
