import { useGetProviderDiagnostics } from "@workspace/api-client-react";
import { Activity, DatabaseZap, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDate(value: Date | string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatSpend(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

export default function ProviderDiagnostics() {
  const { data, isLoading, isError } = useGetProviderDiagnostics();

  const totalRequests = data?.reduce((sum, item) => sum + item.requestCount, 0) ?? 0;
  const totalResults = data?.reduce((sum, item) => sum + item.results, 0) ?? 0;
  const totalSpend = data?.reduce((sum, item) => sum + item.spend, 0) ?? 0;

  return (
    <div className="flex flex-col gap-8 pb-12">
      <header>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Development only</Badge>
          <span className="text-xs text-muted-foreground">No provider secrets are shown</span>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold text-foreground">
          Provider diagnostics
        </h1>
        <p className="mt-1 text-muted-foreground">
          Operational health and usage for configured research capabilities.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Requests", value: totalRequests.toLocaleString(), icon: Activity },
          { label: "Results", value: totalResults.toLocaleString(), icon: DatabaseZap },
          { label: "Spend", value: formatSpend(totalSpend), icon: ShieldCheck },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{metric.label}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{metric.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configured providers</CardTitle>
          <CardDescription>
            Actor IDs and connection credentials remain server-side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Provider diagnostics are unavailable.
            </div>
          ) : !data?.length ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">No provider capabilities configured</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Apify is connected, but JYRA will not enable an Actor until a reliable
                Actor ID is saved in provider configuration.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Capability</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead>Last success</TableHead>
                  <TableHead>Last failure</TableHead>
                  <TableHead className="text-right">Success rate</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Results</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => (
                  <TableRow key={`${item.providerId}:${item.capability ?? "unconfigured"}`}>
                    <TableCell>
                      <div className="font-medium">{item.provider}</div>
                      <div className="text-xs text-muted-foreground">{item.providerType}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{item.credentialStatus}</Badge></TableCell>
                    <TableCell><Badge variant={item.health === "HEALTHY" ? "secondary" : "outline"}>{item.health}</Badge></TableCell>
                    <TableCell className="text-right">{item.priority}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.capability ?? "UNCONFIGURED"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.enabled ? "secondary" : "outline"}>
                        {item.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDate(item.lastSuccessAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDate(item.lastFailureAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {(item.successRate * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {Math.round(item.latencyMs).toLocaleString()} ms
                    </TableCell>
                    <TableCell className="text-right">{formatSpend(item.spend)}</TableCell>
                    <TableCell className="text-right">{item.results.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}