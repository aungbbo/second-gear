/**
 * CRS CalHacks sandbox personas the app may pull. A request that doesn't match
 * a persona reaches a real bureau vendor and is billable, so only allowlisted,
 * fake sandbox identities are ever sent — and never from browser input.
 *
 * These are the persona's published sandbox inputs (from the CRS CalHacks MCP
 * package's test data). The SSN is deliberately not in source: it is read from
 * CRS_PERSONA_SSN on the server.
 *
 * P05 is independent of the Nessie demo persona (sg-demo-subprime-02): the two
 * are separately simulated sandbox identities, not the same person.
 */
export interface SandboxPersona {
  id: string;
  firstName: string;
  lastName: string;
  address: { addressLine1: string; city: string; state: string; postalCode: string };
  /** Score the CRS sandbox documents for this persona, used only by tests and runbooks. */
  expectedScore: number;
}

export const SANDBOX_PERSONAS: Record<string, SandboxPersona> = {
  P05: {
    id: "P05",
    firstName: "RICKY",
    lastName: "DALTON",
    address: { addressLine1: "7031 SUNSET RIDGE RD", city: "ORLANDO", state: "FL", postalCode: "32819" },
    expectedScore: 540,
  },
};
