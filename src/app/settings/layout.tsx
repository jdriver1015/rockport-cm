import { SettingsNav } from "@/components/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">Settings</h1>
        <p className="text-sm text-muted-foreground">Portfolio-wide configuration</p>
      </div>
      <SettingsNav />
      {children}
    </div>
  );
}
