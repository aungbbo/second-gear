"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PipelineResult } from "@/lib/types";

const STORAGE_KEY = "second-gear:last-result";

interface AppStateValue {
  result: PipelineResult | null;
  setResult: (result: PipelineResult | null) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

/**
 * Holds the most recent pipeline run so the Credit Profile and Banking tabs
 * can read it without re-running the search. Backed by sessionStorage so a
 * refresh doesn't lose it — client-only, never sent anywhere.
 */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [result, setResultState] = useState<PipelineResult | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      // One-time hydration from storage on mount, not a sync with external state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setResultState(JSON.parse(raw));
    } catch {
      // Ignore: private browsing, blocked storage, or corrupt data.
    } finally {
      setHydrated(true);
    }
  }, []);

  function setResult(next: PipelineResult | null) {
    setResultState(next);
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore: storage may be unavailable.
    }
  }

  // Avoid a flash of "no data" while sessionStorage is read on mount.
  if (!hydrated) return null;

  return <AppStateContext.Provider value={{ result, setResult }}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
