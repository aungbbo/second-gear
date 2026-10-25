/**
 * Tracks the order live-mode deposits, withdrawals and transfers were
 * created in THIS app, keyed by their Nessie `_id`. The sandbox lists each
 * resource sorted by `_id` — unrelated to creation time — and gives no
 * timestamp finer than the day (verified 2026-10-25), so without this a
 * record's position in "Recent activity" is effectively random and, worse,
 * only correct in the one response immediately after posting: a later page
 * refresh issues its own independent GET with no memory of what was just
 * created. Kept on globalThis so it survives page refreshes for the
 * lifetime of the server process, same pattern as mock-store.ts; resets on
 * process restart, and only covers records created through this app —
 * seeded/historical data still falls back to day-level date ordering.
 */

interface WriteOrderState {
  rank: Map<string, number>;
  nextSeq: number;
}

const state = globalThis as typeof globalThis & { __secondGearLiveWriteOrder?: WriteOrderState };

function store(): WriteOrderState {
  return (state.__secondGearLiveWriteOrder ??= { rank: new Map(), nextSeq: 0 });
}

/** Call once, right after a successful create, with the id Nessie returned. */
export function recordCreated(id: string | null): void {
  if (!id) return;
  const s = store();
  s.rank.set(id, s.nextSeq++);
}

/** Higher = created more recently. `undefined` means "not created by this app" (seeded/historical). */
export function creationRank(id: string): number | undefined {
  return store().rank.get(id);
}

export function __resetLiveWriteOrderForTests(): void {
  state.__secondGearLiveWriteOrder = undefined;
}
