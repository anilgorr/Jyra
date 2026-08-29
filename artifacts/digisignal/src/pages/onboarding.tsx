import { useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useGetCurrentUser, 
  useCompleteOnboarding, 
  getGetCurrentUserQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

const onboardingSchema = z.object({
  organizationName: z.string().min(2, "Organization name must be at least 2 characters").max(120),
  projectName: z.string().min(2, "Project name must be at least 2 characters").max(120),
});

type OnboardingValues = z.infer<typeof onboardingSchema>;

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser();
  const completeOnboarding = useCompleteOnboarding();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

  useEffect(() => {
    // If user already has an organization, they don't need onboarding
    if (user && user.organizationCount > 0) {
      setLocation("/today");
    }
  }, [user, setLocation]);

  const form = useForm<OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      organizationName: "",
      projectName: "",
    },
  });

  const onSubmit = (data: OnboardingValues) => {
    completeOnboarding.mutate({ data }, {
      onSuccess: () => {
        // Invalidate user so the organization count updates
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setLocation("/today");
      },
    });
  };

  if (isUserLoading || (user && user.organizationCount > 0)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-[var(--elevate-2)]">
        <CardHeader className="text-center space-y-2 pb-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <img src={logoUrl} alt="JYRA" className="h-6 w-6 brightness-0 invert" />
          </div>
          <CardTitle className="text-3xl">Welcome to JYRA</CardTitle>
          <CardDescription className="text-base">
            Let's set up your foundation workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="organizationName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Corp" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Project Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Q3 Go-to-Market" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full" 
                disabled={completeOnboarding.isPending}
                variant="coral"
              >
                {completeOnboarding.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Workspace
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
