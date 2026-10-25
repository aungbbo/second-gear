import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AppStateProvider } from "@/lib/app-state";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <AppHeader />
      <main className="flex-1">{children}</main>
    </AppStateProvider>
  );
}
