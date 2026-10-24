import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/pipeline/route";
import type { PipelineResult } from "@/lib/types";
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = await POST(
    new NextRequest("http://localhost/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ need: { ...NEED, maxMonthlyPayment } }),
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
      loansSupported: true,
      canary: { ok: true },
      counts: { deposits: 9, withdrawals: 3, bills: 5, purchases: 24, loans: 1 },
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

  it("completes without loans when the endpoint is unsupported and records it", async () => {
    await start({ loansUnsupported: true });
    const run = await runSeed(["--apply"]);
    expect(run.code).toBe(0);
    expect(run.output).toContain("loans endpoint not available");
    expect(server.postCount).toBe(FULL_SEED_POSTS - 1);
    expect(readManifest()).toMatchObject({ complete: true, readBackMatches: true, loansSupported: false });
  });
});
