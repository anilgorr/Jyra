import { Settings2, Shield, Bell, Key, CreditCard } from "lucide-react";

export default function Settings() {
  return (
    <div className="flex flex-col gap-8 pb-12 animate-in fade-in duration-500 max-w-4xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-display font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-lg">
          Workspace setup and product boundaries.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="md:col-span-1">
          <nav className="flex flex-col space-y-1">
            <a href="#" className="bg-secondary text-secondary-foreground font-medium px-3 py-2 rounded-md flex items-center gap-2 text-sm">
              <Settings2 className="w-4 h-4" />
              General
            </a>
            <a href="#" className="text-muted-foreground hover:bg-muted/50 hover:text-foreground font-medium px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors">
              <Shield className="w-4 h-4" />
              Security
            </a>
            <a href="#" className="text-muted-foreground hover:bg-muted/50 hover:text-foreground font-medium px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors">
              <Key className="w-4 h-4" />
              API Keys
            </a>
            <a href="#" className="text-muted-foreground hover:bg-muted/50 hover:text-foreground font-medium px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors">
              <Bell className="w-4 h-4" />
              Notifications
            </a>
            <a href="#" className="text-muted-foreground hover:bg-muted/50 hover:text-foreground font-medium px-3 py-2 rounded-md flex items-center gap-2 text-sm transition-colors">
              <CreditCard className="w-4 h-4" />
              Billing
            </a>
          </nav>
        </div>

        <div className="md:col-span-3 space-y-8">
          <div className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Workspace Preferences</h2>
              <p className="text-sm text-muted-foreground">Manage your fundamental workspace properties.</p>
            </div>
            
            <div className="space-y-4 max-w-md">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Workspace Name</label>
                <input 
                  type="text" 
                  disabled
                  defaultValue="DigiSignal Executive" 
                  className="w-full flex h-10 w-full rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
                />
                <p className="text-[11px] text-muted-foreground">Cannot be changed during the foundation phase.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Timezone</label>
                <select 
                  disabled
                  className="w-full flex h-10 w-full rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground cursor-not-allowed appearance-none"
                >
                  <option>UTC (Coordinated Universal Time)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Feature Boundaries</h2>
              <p className="text-sm text-muted-foreground">Active constraints during foundation phase.</p>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-start justify-between p-4 border border-border rounded-lg bg-secondary/20">
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">Synthetic Data Generation</h3>
                  <p className="text-xs text-muted-foreground max-w-md">
                    Intentionally disabled. This workspace only renders authenticated, provider-backed market intelligence. No placeholder companies will be shown.
                  </p>
                </div>
                <div className="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs font-semibold uppercase tracking-wider">
                  Enforced
                </div>
              </div>

              <div className="flex items-start justify-between p-4 border border-border rounded-lg bg-secondary/20">
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">Provider Integrations</h3>
                  <p className="text-xs text-muted-foreground max-w-md">
                    External API connections (Crunchbase, Clearbit, etc.) are locked pending milestone completion.
                  </p>
                </div>
                <div className="px-2 py-1 rounded bg-secondary text-secondary-foreground text-xs font-semibold uppercase tracking-wider">
                  Locked
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}