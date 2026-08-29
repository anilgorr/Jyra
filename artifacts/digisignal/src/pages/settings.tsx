import { 
  useCreateOrganization, 
  useCreateProject,
  getListOrganizationsQueryKey,
  getListProjectsQueryKey,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, Folder, Plus, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { toast } from "sonner";
import { useWorkspace } from "@/context/workspace-context";

const orgSchema = z.object({
  name: z.string().min(2).max(120),
});

const projectSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
});

export default function Settings() {
  const queryClient = useQueryClient();
  const {
    organizations,
    projects,
    activeOrganizationId,
    activeProjectId,
    isLoading,
    setActiveOrganizationId,
    setActiveProjectId,
  } = useWorkspace();

  const createOrg = useCreateOrganization();
  const createProject = useCreateProject();

  const orgForm = useForm<z.infer<typeof orgSchema>>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: "" },
  });

  const projectForm = useForm<z.infer<typeof projectSchema>>({
    resolver: zodResolver(projectSchema),
    defaultValues: { name: "", description: "" },
  });

  const onOrgSubmit = (data: z.infer<typeof orgSchema>) => {
    createOrg.mutate({ data }, {
      onSuccess: (newOrg) => {
        toast("Organization created");
        queryClient.invalidateQueries({ queryKey: getListOrganizationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        orgForm.reset();
        setActiveOrganizationId(newOrg.id);
      }
    });
  };

  const onProjectSubmit = (data: z.infer<typeof projectSchema>) => {
    if (!activeOrganizationId) return;
    createProject.mutate({ organizationId: activeOrganizationId, data }, {
      onSuccess: (newProject) => {
        toast("Project created");
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey(activeOrganizationId) });
        projectForm.reset();
        setActiveProjectId(newProject.id);
      }
    });
  };

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 pb-12">
      <header>
        <h1 className="text-3xl font-display font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your organizations and projects.
        </p>
      </header>

      <Tabs defaultValue="projects" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
        </TabsList>
        
        <TabsContent value="projects" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Folder className="h-5 w-5 text-accent" />
                    Projects
                  </CardTitle>
                  <CardDescription>
                    Projects segment intelligence, settings, and business twins within an organization.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {isLoading ? (
                      Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
                    ) : projects && projects.length > 0 ? (
                      projects.map(project => (
                        <div key={project.id} className={`flex flex-col gap-1 rounded-lg border p-4 ${activeProjectId === project.id ? "border-sidebar-accent bg-sidebar-accent/5" : "border-border bg-background/50"}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-foreground">{project.name}</span>
                            <span className="text-xs px-2 py-1 bg-sidebar-accent/10 text-sidebar-accent rounded-full font-medium capitalize">
                              {project.status.replace("_", " ")}
                            </span>
                          </div>
                          {project.description && (
                            <span className="text-sm text-muted-foreground">{project.description}</span>
                          )}
                          <span className="text-xs text-muted-foreground mt-2">
                            Created {new Date(project.createdAt).toLocaleDateString()}
                          </span>
                          {activeProjectId !== project.id && (
                            <Button variant="ghost" size="sm" className="mt-2 self-start" onClick={() => setActiveProjectId(project.id)}>
                              Open project
                            </Button>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No projects found.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">New Project</CardTitle>
                  <CardDescription>Create a new project in your current organization.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...projectForm}>
                    <form onSubmit={projectForm.handleSubmit(onProjectSubmit)} className="space-y-4">
                      <FormField control={projectForm.control} name="name" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Name</FormLabel>
                          <FormControl><Input placeholder="Q4 Growth" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={projectForm.control} name="description" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description (Optional)</FormLabel>
                          <FormControl><Input placeholder="EMEA expansion..." {...field} value={field.value || ""} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="submit" className="w-full" disabled={!activeOrganizationId || createProject.isPending}>
                        {createProject.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                        Create Project
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="organizations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-sidebar-accent" />
                    Organizations
                  </CardTitle>
                  <CardDescription>
                    Your top-level workspaces.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {isLoading ? (
                      Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
                    ) : organizations && organizations.length > 0 ? (
                      organizations.map(org => (
                        <div key={org.id} className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${activeOrganizationId === org.id ? 'border-sidebar-accent bg-sidebar-accent/5' : 'border-border bg-background/50'}`}>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium text-foreground">{org.name}</span>
                            <span className="text-xs text-muted-foreground">
                              Created {new Date(org.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          {activeOrganizationId !== org.id && (
                            <Button variant="ghost" size="sm" onClick={() => setActiveOrganizationId(org.id)}>
                              Switch to this Org
                            </Button>
                          )}
                          {activeOrganizationId === org.id && (
                            <span className="text-xs font-medium text-sidebar-accent bg-sidebar-accent/10 px-2 py-1 rounded-full">Active</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No organizations found.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
            
            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">New Organization</CardTitle>
                  <CardDescription>Create a separate organization.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...orgForm}>
                    <form onSubmit={orgForm.handleSubmit(onOrgSubmit)} className="space-y-4">
                      <FormField control={orgForm.control} name="name" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Organization Name</FormLabel>
                          <FormControl><Input placeholder="Global Corp" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <Button type="submit" className="w-full" disabled={createOrg.isPending}>
                        {createOrg.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                        Create Organization
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
