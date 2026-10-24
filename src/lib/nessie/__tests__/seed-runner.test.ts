import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/pipeline/route";
import { issueConsentToken, SOFT_PULL_CONSENT_VERSION } from "@/lib/consent";
import { getAccountLoans, LOANS_UNAVAILABLE } from "@/lib/nessie/client";
import type { PipelineResult } from "@/lib/types";
import { buildSeedDataset } from "../../../../scripts/nessie-seed/dataset.mjs";
import { NEED, REAL_FORMAT_KEY, expectNoLeaks } from "./fixtures";
import { startMockNessie, type MockNessie, type MockNessieOptions } from "./mock-nessie-server";

/**
 * Runs scripts/nessie-seed.mjs for real, as a child process, against an
 * in-memory mock of Nessie on 127.0.0.1. Each run gets a scratch cwd (for the
 * manifest), a synthetic key, and no inherited NESSIE_* settings, so nothing
 * here can reach the real sandbox.
 */

vi.setConfig({ testTimeout: 60000 });

const SCRIPT = resolve(__dirname, "../../../../scripts/nessie-seed.mjs");
const MANIFEST = ".nessie-seed.local.json";
// 3 merchants + customer + 3 accounts + 9 deposits + 3 withdrawals + 5 bills + 24 purchases + 1 loan
const FULL_SEED_POSTS = 49;

let server: MockNessie;
let cwd: string;

async function start(options: MockNessieOptions = {}) {
  server = await startMockNessie(options);
  expect(server.baseUrl.startsWith("http://127.0.0.1:")).toBe(true);
  return server;
}

beforeEach(() => {
  vi.stubEnv("CONSENT_STORE", "memory");
  cwd = mkdtempSync(join(tmpdir(), "nessie-seed-test-"));
});

afterEach(async () => {
  await server?.close();
  rmSync(cwd, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

interface RunResult {
  code: number | null;
  output: string;
}

function runSeed(args: string[], { onSpawn }: { onSpawn?: (kill: () => void) => void } = {}): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        NESSIE_API_KEY: REAL_FORMAT_KEY,
        NESSIE_BASE_URL: server.baseUrl,
        NESSIE_SEED_POST_GAP_MS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk));
    onSpawn?.(() => child.kill("SIGINT"));
    child.on("close", (code: number | null) => resolvePromise({ code, output }));
  });
}

const readManifest = () => JSON.parse(readFileSync(join(cwd, MANIFEST), "utf8"));

/** Output must never carry the key, the mock host, or any id the server minted. */
function expectCleanOutput(run: RunResult) {
  expectNoLeaks(run.output, [REAL_FORMAT_KEY, server.baseUrl, "key=", ...server.issuedIds]);
}

function expectOnlyKeyedGetsAndPosts() {
  expect(server.requests.every((r) => r.method === "GET" || r.method === "POST")).toBe(true);
  expect(server.requests.every((r) => r.hasKey)).toBe(true);
}

async function pipeline(customerId: string, maxMonthlyPayment: number) {
  vi.stubEnv("NESSIE_MODE", "live");
  vi.stubEnv("NESSIE_API_KEY", REAL_FORMAT_KEY);
  vi.stubEnv("NESSIE_CUSTOMER_ID", customerId);
  vi.stubEnv("NESSIE_BASE_URL", server.baseUrl);
  vi.stubEnv("CRS_MODE", "mock");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { consentToken } = issueConsentToken({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION });
  const response = await POST(
    new NextRequest("http://localhost/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ need: { ...NEED, maxMonthlyPayment }, consentToken }),
    }),
  );
  return { status: response.status, body: (await response.json()) as PipelineResult };
}

describe("seed runner against a mock Nessie", () => {
  it("dry run and preflight never POST", async () => {
    await start();
    const dry = await runSeed([]);
    expect(dry.code).toBe(0);
    expect(server.requests).toHaveLength(0);

    const pre = await runSeed(["--preflight"]);
    expect(pre.code).toBe(0);
    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /customers", "GET /merchants"]);
    expect(pre.output).toContain("duplicate persona  no");
    expect(existsSync(join(cwd, MANIFEST))).toBe(false);
  });

  it("seeds the full persona, reads it back, and feeds a 200 pipeline with the planned affordability", async () => {
    await start();
    const run = await runSeed(["--apply"]);
    expect(run.code, run.output.split("\n").filter((l) => l.startsWith("✗")).join("\n")).toBe(0);
    expect(server.postCount).toBe(FULL_SEED_POSTS);
    expectOnlyKeyedGetsAndPosts();
    expectCleanOutput(run);

    const manifest = readManifest();
    expect(manifest).toMatchObject({
      complete: true,
      readBackMatches: true,
      canary: { ok: true },
      counts: { deposits: 9, withdrawals: 6, bills: 2, purchases: 24, loans: 1 },
    });
    expect(server.customers).toHaveLength(1);
    expect(server.accounts).toHaveLength(3);

    const at400 = await pipeline(manifest.customerId, 400);
    expect(at400.status).toBe(200);
    expect(at400.body.affordability).toMatchObject({
      avgMonthlyIncome: 3450,
      essentialExpenses: 1530,
      existingDebtPayments: 180,
      maxSustainablePayment: 400,
      recommendedPayment: 350,
      incomeVolatility: "low",
    });
    expect(at400.body.rankedCars.length).toBeGreaterThan(0);
    expect(at400.body.dealerPacket.maxApprovedPayment).toBe(350);

    const at600 = await pipeline(manifest.customerId, 600);
    expect(at600.body.affordability).toMatchObject({ maxSustainablePayment: 440, recommendedPayment: 385 });
  });

  it("refuses to re-seed the same persona, and --allow-duplicate makes a second customer", async () => {
    await start();
    expect((await runSeed(["--apply"])).code).toBe(0);
    const posts = server.postCount;

    const again = await runSeed(["--apply"]);
    expect(again.code).toBe(2);
    expect(again.output).toContain("--allow-duplicate");
    expect(server.postCount).toBe(posts);

    rmSync(join(cwd, MANIFEST));
    const noManifest = await runSeed(["--apply"]);
    expect(noManifest.code, "persona name alone blocks a re-seed").toBe(2);
    expect(server.postCount).toBe(posts);

    const dup = await runSeed(["--apply", "--allow-duplicate"]);
    expect(dup.code).toBe(0);
    expect(server.customers).toHaveLength(2);
    expect(server.merchants, "merchants are reused by name").toHaveLength(3);
  });

  it("refuses when the manifest already records a complete seed", async () => {
    await start();
    writeFileSync(join(cwd, MANIFEST), JSON.stringify({ persona: "sg-demo-subprime-01", complete: true }));
    const run = await runSeed(["--apply"]);
    expect(run.code).toBe(2);
    expect(server.postCount).toBe(0);
  });

  it("stops on a failed POST, scrubs the error, and records the partial seed", async () => {
    await start({
      failPost: {
        nth: 20,
        status: 400,
        body: { code: 400, message: `Invalid field https://nessie.example/x?key=${REAL_FORMAT_KEY}`, culprit: ["amount"] },
      },
    });
    const run = await runSeed(["--apply"]);
    expect(run.code).toBe(1);
    expect(run.output).toContain("HTTP 400");
    expect(run.output).toContain("[amount]");
    expectCleanOutput(run);
    expect(server.postCount).toBe(20);

    const manifest = readManifest();
    expect(manifest.complete).toBe(false);
    expect(typeof manifest.customerId).toBe("string");
    expect(Object.keys(manifest.accountIds)).toEqual(["checking", "savings", "card"]);

    const rerun = await runSeed(["--apply"]);
    expect(rerun.code, "a partial customer still blocks an accidental re-seed").toBe(2);
  });

  it("stops on a dropped connection without retrying the POST", async () => {
    await start({ dropPost: 30 });
    const run = await runSeed(["--apply"]);
    expect(run.code).toBe(1);
    expect(run.output).toContain("network error");
    expectCleanOutput(run);
    const posted = server.requests.filter((r) => r.method === "POST").length;
    expect(posted, "the dropped POST is not retried").toBe(30);
    expect(readManifest().complete).toBe(false);
  });

  it("records what it created when interrupted with SIGINT", async () => {
    let kill: () => void = () => {};
    await start({ onPost: (n) => n === 25 && kill() });
    const run = await runSeed(["--apply"], { onSpawn: (k) => (kill = k) });
    expect(run.code).toBe(130);
    expect(run.output).toContain("Interrupted by SIGINT");
    expectCleanOutput(run);
    const manifest = readManifest();
    expect(manifest.complete).toBe(false);
    expect(typeof manifest.customerId).toBe("string");
    expect(Object.keys(manifest.accountIds)).toHaveLength(3);
  });

  it("aborts at the canary when the sandbox rewrites back-dated records", async () => {
    await start({ rewriteDates: true });
    const run = await runSeed(["--apply"]);
    expect(run.code).toBe(3);
    expect(run.output).toContain("Canary failed");
    // merchants + customer + accounts + the single canary deposit — nothing more.
    expect(server.postCount).toBe(3 + 1 + 3 + 1);
    expect(readManifest()).toMatchObject({ complete: false, canary: { ok: false, changed: ["transaction_date"] } });
  });

  it("creates the loan with the documented schema and reads it back", async () => {
    await start();
    expect((await runSeed(["--apply"])).code).toBe(0);
    const manifest = readManifest();
    const { loans } = buildSeedDataset({ asOf: manifest.asOf });

    const loanPosts = server.requests.filter((r) => r.method === "POST" && r.path.endsWith("/loans"));
    expect(loanPosts.map((r) => r.path)).toEqual([`/accounts/${manifest.accountIds.checking}/loans`]);
    expect(server.records.loans).toHaveLength(1);
    expect(server.records.loans[0]).toMatchObject({ ...loans[0].body, account_id: manifest.accountIds.checking });

    const cfg = { mode: "live" as const, apiKey: REAL_FORMAT_KEY, customerId: manifest.customerId, baseUrl: server.baseUrl };
    const fetched = await getAccountLoans(cfg, manifest.accountIds.checking);
    expect(fetched.records).toHaveLength(1);
    expect(fetched.records[0]).toMatchObject({ monthly_payment: 140, status: "approved", type: "small business" });
  });

  it("counts the seeded loan exactly once, even if the sandbox holds a duplicate copy", async () => {
    await start();
    expect((await runSeed(["--apply"])).code).toBe(0);
    const manifest = readManifest();
    server.records.loans.push({ ...server.records.loans[0], _id: "5f0000000000000000000999" });

    const { status, body } = await pipeline(manifest.customerId, 600);
    expect(status).toBe(200);
    // 140 loan + 36 card minimum = 176 → 180, not 320.
    expect(body.affordability.existingDebtPayments).toBe(180);
    expect(body.affordability).toMatchObject({ maxSustainablePayment: 440, recommendedPayment: 385 });
  });

  it("stops the seed when the loans endpoint fails, and the pipeline refuses to assume zero debt", async () => {
    await start({ loansNotFound: true });
    const run = await runSeed(["--apply"]);
    expect(run.code).toBe(1);
    expect(run.output).toContain("POST /accounts/:id/loans: HTTP 404");
    expectCleanOutput(run);
    // Caught by the loan canary: 7 setup + deposit, withdrawal, bill, purchase canaries — no bulk writes.
    expect(server.postCount).toBe(7 + 4);
    const manifest = readManifest();
    expect(manifest.complete).toBe(false);
    expect(manifest.counts.loans).toBeUndefined();

    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await pipeline(manifest.customerId, 600);
    expect(status).toBe(502);
    expect(body).toEqual({ error: LOANS_UNAVAILABLE });
  });

  describe("HTTP 400 diagnostics", () => {
    // The real sandbox rejected the canary deposit with a 400 whose body had no `message`.
    const CANARY_POST = 3 + 1 + 3 + 1;

    it.each([
      ["plain text", { body: `Bad Request: transaction_date for https://x.test/a?key=${REAL_FORMAT_KEY}`, raw: true }, "body Bad Request: transaction_date for <url>"],
      ["JSON without message", { body: { code: 400, error: "invalid date" } }, 'body {"code":400,"error":"invalid date"}'],
      ["JSON string", { body: "Invalid medium" }, 'body "Invalid medium"'],
      ["empty", { body: "", raw: true }, "empty body"],
    ])("reports a 400 with a %s body, scrubbed", async (_label, reply, expected) => {
      await start({ failPost: { nth: CANARY_POST, status: 400, ...reply } });
      const run = await runSeed(["--apply"]);
      expect(run.code).toBe(1);
      expect(run.output).toContain(`POST /accounts/:id/deposits: HTTP 400 — ${expected}`);
      expectCleanOutput(run);
      expect(server.postCount, "nothing is posted after the failure").toBe(CANARY_POST);
      const manifest = readManifest();
      expect(manifest.complete).toBe(false);
      expect(manifest.lastError).toContain("HTTP 400");
      expectNoLeaks(JSON.stringify(manifest.lastError), [REAL_FORMAT_KEY, "key="]);
    });

    it("clips very long error bodies", async () => {
      await start({ failPost: { nth: CANARY_POST, status: 400, body: "x".repeat(2000), raw: true } });
      const run = await runSeed(["--apply"]);
      const line = run.output.split("\n").find((l) => l.includes("HTTP 400")) ?? "";
      expect(line.length).toBeLessThan(400);
      expect(line.endsWith("…")).toBe(true);
    });
  });

  describe("--resume", () => {
    async function partialSeedAtCanary() {
      await start({ failPost: { nth: 3 + 1 + 3 + 1, status: 400, body: "rejected", raw: true } });
      expect((await runSeed(["--apply"])).code).toBe(1);
      return server.postCount;
    }

    it("previews read-only, then completes the partial seed without a new customer or duplicates", async () => {
      const postsBefore = await partialSeedAtCanary();

      const preview = await runSeed(["--resume"]);
      expect(preview.code).toBe(0);
      expect(preview.output).toContain("deposits           0/9 present, 9 to post");
      expect(preview.output).toContain("Resume preview: nothing was written");
      expect(server.postCount).toBe(postsBefore);
      expectCleanOutput(preview);

      const resumed = await runSeed(["--apply", "--resume"]);
      expect(resumed.code, resumed.output.split("\n").filter((l) => l.startsWith("✗")).join("\n")).toBe(0);
      expectCleanOutput(resumed);
      expectOnlyKeyedGetsAndPosts();
      expect(server.customers).toHaveLength(1);
      expect(server.accounts).toHaveLength(3);
      expect(server.merchants).toHaveLength(3);
      expect(server.records.deposits).toHaveLength(9);
      expect(server.records.purchases).toHaveLength(24);
      expect(server.records.loans).toHaveLength(1);
      const manifest = readManifest();
      expect(manifest).toMatchObject({ complete: true, readBackMatches: true, canary: { ok: true } });
      expect(manifest.lastError).toBeUndefined();

      const { status, body } = await pipeline(manifest.customerId, 400);
      expect(status).toBe(200);
      expect(body.affordability).toMatchObject({ maxSustainablePayment: 400, recommendedPayment: 350, existingDebtPayments: 180 });
    });

    it("skips records an interrupted run already wrote", async () => {
      let kill: () => void = () => {};
      await start({ onPost: (n) => n === 30 && kill() });
      expect((await runSeed(["--apply"], { onSpawn: (k) => (kill = k) })).code).toBe(130);
      const already = server.records.deposits.length + server.records.withdrawals.length + server.records.bills.length + server.records.purchases.length;

      const resumed = await runSeed(["--apply", "--resume"]);
      expect(resumed.code).toBe(0);
      expect(resumed.output).toContain("already present");
      expect(server.records.deposits).toHaveLength(9);
      expect(server.records.withdrawals).toHaveLength(6);
      expect(server.records.bills).toHaveLength(2);
      expect(server.records.purchases).toHaveLength(24);
      expect(server.records.loans).toHaveLength(1);
      expect(server.postCount).toBe(FULL_SEED_POSTS);
      expect(already).toBeGreaterThan(0);
    });

    it("refuses when the manifest is complete, missing, or for another persona", async () => {
      await start();
      expect((await runSeed(["--resume"])).code, "no manifest").toBe(2);
      expect((await runSeed(["--apply"])).code).toBe(0);
      const done = await runSeed(["--apply", "--resume"]);
      expect(done.code, "complete manifest").toBe(2);
      expect(done.output).toContain("already records a complete seed");
      const other = await runSeed(["--resume", "--persona", "sg-demo-other"]);
      expect(other.code, "other persona").toBe(2);
    });

    it("refuses when the manifest's customer isn't visible with this key", async () => {
      await partialSeedAtCanary();
      const manifest = readManifest();
      await server.close();
      await start(); // a fresh sandbox: the manifest's ids don't exist here
      const run = await runSeed(["--apply", "--resume"]);
      expect(run.code).toBe(2);
      expect(run.output).toContain("not visible with this key");
      expect(server.postCount).toBe(0);
      expectNoLeaks(run.output, [manifest.customerId, ...Object.values(manifest.accountIds as Record<string, string>)]);
    });

    it("refuses when the partial seed already holds a duplicate record", async () => {
      await partialSeedAtCanary();
      const { accountIds } = readManifest();
      const body = buildSeedDataset({ asOf: readManifest().asOf }).deposits[1].body;
      for (const id of ["5f00000000000000000000aa", "5f00000000000000000000ab"]) {
        server.records.deposits.push({ ...body, _id: id, account_id: accountIds.checking, status: "pending" });
      }
      const posts = server.postCount;
      const run = await runSeed(["--apply", "--resume"]);
      expect(run.code).toBe(2);
      expect(run.output).toContain("duplicate");
      expect(server.postCount).toBe(posts);
    });

    it("--canary-only posts one record of each shape, lists each back, and leaves the seed resumable", async () => {
      const postsBefore = await partialSeedAtCanary();
      const canaryRun = await runSeed(["--apply", "--resume", "--canary-only"]);
      expect(canaryRun.code, canaryRun.output.split("\n").filter((l) => l.startsWith("✗")).join("\n")).toBe(0);
      expect(canaryRun.output).toContain(
        "Canaries stored and verified: deposit, withdrawal, bill (recurring), purchase, loan",
      );
      expectCleanOutput(canaryRun);
      expect(server.postCount - postsBefore, "one POST per canary shape").toBe(5);
      const { asOf } = readManifest();
      const dataset = buildSeedDataset({ asOf });
      expect(server.records.deposits.map((d) => d.description)).toEqual([dataset.deposits[0].body.description]);
      expect(server.records.bills.map((b) => b.status)).toEqual(["recurring"]);
      expect(readManifest()).toMatchObject({ complete: false, canary: { ok: true } });
      expect(readManifest().lastError).toBeUndefined();
      expect(Object.values(readManifest().recordIds).flatMap((ids) => Object.values(ids as object))).toHaveLength(5);

      const again = await runSeed(["--apply", "--resume", "--canary-only"]);
      expect(again.code).toBe(0);
      expect(again.output).toContain("canary deposit already present");
      expect(server.postCount - postsBefore, "a second canary-only run posts nothing").toBe(5);

      const resumed = await runSeed(["--apply", "--resume"]);
      expect(resumed.code).toBe(0);
      expect(server.records.deposits).toHaveLength(9);
      expect(readManifest()).toMatchObject({ complete: true, readBackMatches: true });
    });

    it("--canary-only stops at a failing canary with exactly one POST", async () => {
      // Replays the incident (canary rejected), then a resume where the sandbox rewrites dates.
      await start({ failPost: { nth: 3 + 1 + 3 + 1, status: 400, body: "rejected", raw: true }, rewriteDates: true });
      expect((await runSeed(["--apply"])).code).toBe(1);
      const postsBefore = server.postCount;

      const run = await runSeed(["--apply", "--resume", "--canary-only"]);
      expect(run.code).toBe(3);
      expect(run.output).toContain("Canary failed");
      expect(server.postCount - postsBefore).toBe(1);
      expect(readManifest()).toMatchObject({ complete: false, canary: { ok: false, changed: ["transaction_date"] } });
    });

    it("rejects --canary-only without --apply", async () => {
      await start();
      expect((await runSeed(["--canary-only"])).code).toBe(64);
      expect((await runSeed(["--resume", "--canary-only"])).code).toBe(64);
      expect(server.postCount).toBe(0);
    });

    it("--apply --canary-only on a fresh persona writes setup + 5 canaries, then --apply --resume finishes", async () => {
      await start();
      const canaries = await runSeed(["--apply", "--canary-only"]);
      expect(canaries.code, canaries.output.split("\n").filter((l) => l.startsWith("✗")).join("\n")).toBe(0);
      expect(canaries.output).toContain("Canaries stored and verified");
      expect(server.postCount).toBe(3 + 1 + 3 + 5);
      expect(readManifest()).toMatchObject({ complete: false, canary: { ok: true } });

      const rest = await runSeed(["--apply", "--resume"]);
      expect(rest.code).toBe(0);
      expect(server.postCount).toBe(FULL_SEED_POSTS);
      expect(server.customers).toHaveLength(1);
      expect(readManifest()).toMatchObject({ complete: true, readBackMatches: true });
      const { status, body } = await pipeline(readManifest().customerId, 400);
      expect(status).toBe(200);
      expect(body.affordability).toMatchObject({ maxSustainablePayment: 400, recommendedPayment: 350 });
    });

    it("rejects --allow-duplicate with --resume", async () => {
      await start();
      expect((await runSeed(["--resume", "--allow-duplicate"])).code).toBe(64);
    });
  });

  describe("required transaction status", () => {
    const postTo = async (path: string, body: object) => {
      const res = await fetch(`${server.baseUrl}${path}?key=test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };

    async function mockWithAccount() {
      await start();
      const customer = await postTo("/customers", { first_name: "T", last_name: "T" });
      const account = await postTo(`/customers/${customer.body.objectCreated._id}/accounts`, { type: "Checking", nickname: "c", rewards: 0, balance: 1 });
      return `/accounts/${account.body.objectCreated._id}`;
    }

    it("the mock rejects a deposit without status exactly like the live sandbox", async () => {
      const account = await mockWithAccount();
      const missing = await postTo(`${account}/deposits`, { medium: "balance", transaction_date: "2026-10-21", amount: 1, description: "x" });
      expect(missing.status).toBe(400);
      expect(missing.body).toBe("1 validation error for DepositCreate\nstatus\n  field required (type=value_error.missing)");
    });

    it.each([
      ["deposits", { medium: "balance", transaction_date: "2026-10-21", amount: 1, description: "x" }],
      ["withdrawals", { medium: "balance", transaction_date: "2026-10-21", amount: 1, description: "x" }],
      ["purchases", { medium: "balance", purchase_date: "2026-10-21", amount: 1, description: "x", merchant_id: "m" }],
    ])("the mock rejects an invalid %s status and accepts \"completed\"", async (resource, body) => {
      const account = await mockWithAccount();
      const invalid = await postTo(`${account}/${resource}`, { ...body, status: "done" });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toContain("value is not a valid enumeration member");
      const valid = await postTo(`${account}/${resource}`, { ...body, status: "completed" });
      expect(valid.status).toBe(201);
    });

    it("every transaction payload the runner would send carries status \"completed\"", async () => {
      await start();
      const dry = await runSeed([]);
      const lines = dry.output.split("\n").filter((l) => / (deposit|withdrawal|purchase) +\{/.test(l));
      expect(lines).toHaveLength(9 + 6 + 24);
      for (const line of lines) expect(line).toContain('"status":"completed"');
    });

    it("the full seed passes the mock's status validation and read-back checks status", async () => {
      await start();
      const run = await runSeed(["--apply"]);
      expect(run.code).toBe(0);
      for (const resource of ["deposits", "withdrawals", "purchases"]) {
        expect(server.records[resource].every((r) => r.status === "completed")).toBe(true);
      }
      expect(readManifest()).toMatchObject({ complete: true, readBackMatches: true });
    });

    it("stops at the canary when the sandbox stores a different status", async () => {
      await start({ rewriteStatus: "executed" });
      const run = await runSeed(["--apply"]);
      expect(run.code).toBe(3);
      expect(server.postCount).toBe(3 + 1 + 3 + 1);
      expect(readManifest()).toMatchObject({ complete: false, canary: { ok: false, changed: ["status"] } });
    });

    it("resumes the real incident's partial seed: a 400 on a status-less canary, then a clean canary-only retry", async () => {
      // Partial seed exactly as the sandbox left it: merchants, customer, accounts, no transactions.
      await start({
        failPost: {
          nth: 3 + 1 + 3 + 1,
          status: 400,
          body: "1 validation error for DepositCreate\nstatus\n  field required (type=value_error.missing)",
        },
      });
      const first = await runSeed(["--apply"]);
      expect(first.code).toBe(1);
      expect(first.output).toContain("DepositCreate");
      const posts = server.postCount;

      const retry = await runSeed(["--apply", "--resume", "--canary-only"]);
      expect(retry.code).toBe(0);
      expect(server.postCount - posts).toBe(5);
      expect(server.records.deposits).toHaveLength(1);
      expect(server.records.deposits[0]).toMatchObject({ status: "completed", amount: 1650 });
      expect(readManifest()).toMatchObject({ complete: false, canary: { ok: true } });
    });
  });

  describe("bill schema, per-type canaries, record ids, manifest safety", () => {
    const post = async (path: string, body: object) =>
      (await fetch(`${server.baseUrl}${path}?key=test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json())) as { objectCreated: { _id: string } };

    it("the mock reproduces the sandbox: POST accepts a bill that then breaks GET /bills", async () => {
      await start();
      const customer = await post("/customers", { first_name: "T", last_name: "T" });
      const account = await post(`/customers/${customer.objectCreated._id}/accounts`, { type: "Checking", nickname: "c", rewards: 0, balance: 1 });
      const bills = `/accounts/${account.objectCreated._id}/bills`;
      await post(bills, { status: "completed", payee: "P", nickname: "n", payment_date: "2026-10-12", payment_amount: 95 });
      const res = await fetch(`${server.baseUrl}${bills}?key=test`);
      expect(res.status).toBe(400);
      expect(await res.json()).toBe(
        "2 validation errors for Bill\nrecurring_date\n  field required (type=value_error.missing)\nupcoming_payment_date\n  field required (type=value_error.missing)",
      );
    });

    it("the full seed's bills list back cleanly and the pipeline counts them once", async () => {
      await start();
      expect((await runSeed(["--apply"])).code).toBe(0);
      const manifest = readManifest();
      const res = await fetch(`${server.baseUrl}/accounts/${manifest.accountIds.checking}/bills?key=test`);
      expect(res.status).toBe(200);
      expect((await res.json()) as unknown[]).toHaveLength(2);
      const { status, body } = await pipeline(manifest.customerId, 600);
      expect(status).toBe(200);
      // Rent 1250 + internet 60 recurring, ATM 120 + electric ACH (95+110+88)/3 as withdrawals → 1530, as before.
      expect(body.affordability).toMatchObject({ essentialExpenses: 1530, maxSustainablePayment: 440, recommendedPayment: 385 });
    });

    it("stops at the bill canary when the bill list won't read back, before any bulk write", async () => {
      await start({ extraBillListFields: ["autopay"] });
      const run = await runSeed(["--apply"]);
      expect(run.code).toBe(3);
      expect(run.output).toContain("Canary failed: listing bills");
      expect(run.output).toContain("validation error for Bill");
      expectCleanOutput(run);
      // 7 setup + deposit + withdrawal canaries + the first bill canary; nothing else.
      expect(server.postCount).toBe(7 + 3);
      expect(server.records.purchases).toHaveLength(0);
      expect(server.records.loans).toHaveLength(0);
      const manifest = readManifest();
      expect(manifest).toMatchObject({ complete: false, canary: { ok: false, resource: "bills" } });
      expect(Object.keys(manifest.recordIds).sort()).toEqual(["bills", "deposits", "withdrawals"]);
    });

    it("records the id of every created record in the manifest", async () => {
      await start();
      expect((await runSeed(["--apply"])).code).toBe(0);
      const { recordIds } = readManifest() as { recordIds: Record<string, Record<string, string>> };
      expect(Object.fromEntries(Object.entries(recordIds).map(([k, v]) => [k, Object.keys(v).length]))).toEqual({
        deposits: 9,
        withdrawals: 6,
        bills: 2,
        purchases: 24,
        loans: 1,
      });
      const ids = Object.values(recordIds).flatMap((v) => Object.values(v));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => server.issuedIds.includes(id))).toBe(true);
    });

    it("never overwrites an existing manifest, even an incomplete one for another persona", async () => {
      await start();
      const original = JSON.stringify({ persona: "sg-demo-subprime-01", complete: false, customerId: "keep-me" });
      writeFileSync(join(cwd, MANIFEST), original);
      for (const args of [["--apply"], ["--apply", "--allow-duplicate"]]) {
        const run = await runSeed(args);
        expect(run.code).toBe(2);
        expect(run.output).toContain("archive it first");
      }
      expect(server.postCount).toBe(0);
      expect(readFileSync(join(cwd, MANIFEST), "utf8")).toBe(original);
    });

    it("seeds the new default persona sg-demo-subprime-02", async () => {
      await start();
      expect((await runSeed(["--apply"])).code).toBe(0);
      expect(readManifest().persona).toBe("sg-demo-subprime-02");
      expect(server.customers[0].last_name).toBe("Demo sg-demo-subprime-02");
    });
  });

  describe("option B: recurring bills only, electric as ACH withdrawals", () => {
    const BILL_EXTRA_FIELD_400 = "1 validation error for BillCreate\nupcoming_payment_date\n  extra fields not permitted (type=value_error.extra)";

    it("the mock rejects upcoming_payment_date on BillCreate and computes it for recurring bills", async () => {
      await start();
      const post = (path: string, body: object) =>
        fetch(`${server.baseUrl}${path}?key=test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const customer = (await (await post("/customers", { first_name: "T", last_name: "T" })).json()).objectCreated._id;
      const account = (await (await post(`/customers/${customer}/accounts`, { type: "Checking", nickname: "c", rewards: 0, balance: 1 })).json()).objectCreated._id;
      const bill = { status: "recurring", payee: "P", nickname: "n", payment_date: "2026-10-01", recurring_date: 1, payment_amount: 10 };

      const rejected = await post(`/accounts/${account}/bills`, { ...bill, upcoming_payment_date: "2026-11-01" });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toBe(BILL_EXTRA_FIELD_400);

      const accepted = await post(`/accounts/${account}/bills`, bill);
      expect(accepted.status).toBe(201);
      const listed = (await (await fetch(`${server.baseUrl}/accounts/${account}/bills?key=test`)).json()) as { upcoming_payment_date: string }[];
      expect(listed).toHaveLength(1);
      expect(listed[0].upcoming_payment_date).toMatch(/^\d{4}-\d{2}-01$/);
    });

    it("stops at the bill canary when the computed upcoming_payment_date is off its due day", async () => {
      await start({ upcomingOffByOne: true });
      const run = await runSeed(["--apply"]);
      expect(run.code).toBe(3);
      expect(run.output).toContain("upcoming_payment_date not on the due day");
      expect(server.postCount).toBe(7 + 3);
      expect(readManifest()).toMatchObject({ complete: false, canary: { ok: false, resource: "bills" } });
    });

    it("recovers the real sg-demo-subprime-02 state: 2 canaries in, bill rejected, then canaries and bulk via resume", async () => {
      // Phase 1 as it happened: setup + deposit + withdrawal canaries, then BillCreate 400 on the bill canary.
      // (The empty mock also creates the 3 merchants the real sandbox reused.)
      await start({ failPost: { nth: 3 + 4 + 2 + 1, status: 400, body: BILL_EXTRA_FIELD_400 } });
      const phase1 = await runSeed(["--apply", "--canary-only"]);
      expect(phase1.code).toBe(1);
      expect(phase1.output).toContain("extra fields not permitted");
      const afterPhase1 = server.postCount;
      expect(afterPhase1, "the mock counts the rejected POST too").toBe(10);
      expect(readManifest()).toMatchObject({ complete: false, counts: { deposits: 1, withdrawals: 1 } });

      const preview = await runSeed(["--resume"]);
      expect(preview.code).toBe(0);
      expect(preview.output).toContain("deposits           1/9 present, 8 to post");
      expect(preview.output).toContain("withdrawals        1/6 present, 5 to post");
      expect(preview.output).toContain("bills              0/2 present, 2 to post");
      expect(server.postCount).toBe(afterPhase1);

      const canaries = await runSeed(["--apply", "--resume", "--canary-only"]);
      expect(canaries.code, canaries.output.split("\n").filter((l) => l.startsWith("✗")).join("\n")).toBe(0);
      expect(canaries.output).toContain("canary deposit already present");
      expect(canaries.output).toContain("canary withdrawal already present");
      expect(server.postCount - afterPhase1, "bill, purchase, loan canaries only").toBe(3);
      expectCleanOutput(canaries);

      const phase2 = await runSeed(["--apply", "--resume"]);
      expect(phase2.code).toBe(0);
      expect(server.postCount - afterPhase1 - 3, "the remaining bulk records").toBe(37);
      expect(server.customers).toHaveLength(1);
      expect(server.merchants).toHaveLength(3);
      expect(Object.fromEntries(Object.entries(server.records).map(([k, v]) => [k, v.length]))).toEqual({
        deposits: 9,
        withdrawals: 6,
        purchases: 24,
        bills: 2,
        loans: 1,
      });
      const manifest = readManifest();
      expect(manifest).toMatchObject({ complete: true, readBackMatches: true });

      const at400 = await pipeline(manifest.customerId, 400);
      expect(at400.status).toBe(200);
      expect(at400.body.affordability).toMatchObject({
        avgMonthlyIncome: 3450,
        essentialExpenses: 1530,
        existingDebtPayments: 180,
        maxSustainablePayment: 400,
        recommendedPayment: 350,
      });
      const at600 = await pipeline(manifest.customerId, 600);
      expect(at600.body.affordability).toMatchObject({ maxSustainablePayment: 440, recommendedPayment: 385 });
      expect(at600.body.rankedCars.length).toBeGreaterThan(0);
    });
  });
});
