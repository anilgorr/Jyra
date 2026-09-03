import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getListOrganizationsQueryKey,
  getListProjectsQueryKey,
  getGetProjectQueryKey,
  useGetProject,
  useListOrganizations,
  useListProjects,
  type Organization,
  type Project,
} from "@workspace/api-client-react";

interface WorkspaceContextValue {
  organizations: Organization[];
  projects: Project[];
  activeOrganization: Organization | null;
  activeProject: Project | null;
  activeOrganizationId: string | null;
  activeProjectId: string | null;
  isLoading: boolean;
  /** True when organizations or projects failed to load. */
  isError: boolean;
  error: Error | null;
  /** Which lookup failed, for targeted copy. */
  errorSource: "organizations" | "projects" | null;
  refetch: () => Promise<unknown>;
  setActiveOrganizationId: (id: string) => void;
  setActiveProjectId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const ORGANIZATION_STORAGE_KEY = "digisignal.activeOrganizationId";
const PROJECT_STORAGE_KEY = "digisignal.activeProjectId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeOrganizationId, setOrganizationId] = useState<string | null>(
    () => window.localStorage.getItem(ORGANIZATION_STORAGE_KEY),
  );
  const [activeProjectId, setProjectId] = useState<string | null>(
    () => window.localStorage.getItem(PROJECT_STORAGE_KEY),
  );

  const {
    data: organizations = [],
    isLoading: organizationsLoading,
    isError: organizationsError,
    error: organizationsErrorValue,
    refetch: refetchOrganizations,
  } = useListOrganizations({
    query: {
      queryKey: getListOrganizationsQueryKey(),
      meta: { errorTitle: "Could not load your organizations" },
    },
  });

  useEffect(() => {
    // Never clear the stored selection because of a transient fetch failure.
    if (organizationsLoading || organizationsError) return;
    const nextOrganizationId = organizations.some(
      (organization) => organization.id === activeOrganizationId,
    )
      ? activeOrganizationId
      : organizations[0]?.id ?? null;

    if (nextOrganizationId !== activeOrganizationId) {
      setOrganizationId(nextOrganizationId);
      setProjectId(null);
      if (nextOrganizationId) {
        window.localStorage.setItem(
          ORGANIZATION_STORAGE_KEY,
          nextOrganizationId,
        );
      } else {
        window.localStorage.removeItem(ORGANIZATION_STORAGE_KEY);
      }
      window.localStorage.removeItem(PROJECT_STORAGE_KEY);
    }
  }, [activeOrganizationId, organizations, organizationsLoading, organizationsError]);

  const {
    data: projects = [],
    isLoading: projectsLoading,
    isError: projectsError,
    error: projectsErrorValue,
    refetch: refetchProjects,
  } = useListProjects(activeOrganizationId ?? "", {
    query: {
      enabled: Boolean(activeOrganizationId),
      queryKey: getListProjectsQueryKey(activeOrganizationId ?? ""),
      meta: { errorTitle: "Could not load your projects" },
    },
  });

  useEffect(() => {
    if (!activeOrganizationId || projectsLoading || projectsError) return;
    const nextProjectId = projects.some(
      (project) => project.id === activeProjectId,
    )
      ? activeProjectId
      : projects[0]?.id ?? null;

    if (nextProjectId !== activeProjectId) {
      setProjectId(nextProjectId);
      if (nextProjectId) {
        window.localStorage.setItem(PROJECT_STORAGE_KEY, nextProjectId);
      } else {
        window.localStorage.removeItem(PROJECT_STORAGE_KEY);
      }
    }
  }, [activeOrganizationId, activeProjectId, projects, projectsLoading, projectsError]);

  const { data: activeProject = null } = useGetProject(
    activeProjectId ?? "",
    {
      query: {
        enabled: Boolean(activeProjectId),
        queryKey: getGetProjectQueryKey(activeProjectId ?? ""),
      },
    },
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      organizations,
      projects,
      activeOrganization:
        organizations.find(
          (organization) => organization.id === activeOrganizationId,
        ) ?? null,
      activeProject,
      activeOrganizationId,
      activeProjectId,
      isLoading: organizationsLoading || projectsLoading,
      isError: organizationsError || projectsError,
      error: organizationsError
        ? (organizationsErrorValue as Error | null)
        : projectsError
          ? (projectsErrorValue as Error | null)
          : null,
      errorSource: organizationsError
        ? "organizations"
        : projectsError
          ? "projects"
          : null,
      refetch: () =>
        organizationsError
          ? refetchOrganizations()
          : projectsError
            ? refetchProjects()
            : Promise.resolve(),
      setActiveOrganizationId: (id) => {
        setOrganizationId(id);
        setProjectId(null);
        window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, id);
        window.localStorage.removeItem(PROJECT_STORAGE_KEY);
      },
      setActiveProjectId: (id) => {
        setProjectId(id);
        window.localStorage.setItem(PROJECT_STORAGE_KEY, id);
      },
    }),
    [
      activeOrganizationId,
      activeProject,
      activeProjectId,
      organizations,
      organizationsLoading,
      organizationsError,
      organizationsErrorValue,
      projects,
      projectsLoading,
      projectsError,
      projectsErrorValue,
      refetchOrganizations,
      refetchProjects,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}