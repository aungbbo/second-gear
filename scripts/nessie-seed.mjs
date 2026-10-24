#!/usr/bin/env node
// Development-only: seeds a demo persona into the Capital One Nessie sandbox.
// Never imported by the app. See docs/nessie-sandbox.md.
//
//   npm run nessie:seed                      dry run — no network, prints the plan
//   npm run nessie:seed -- --preflight       read-only GETs: duplicate + merchant checks
//   npm run nessie:seed -- --apply           creates a NEW customer and its data
//
// Safety: POSTs are impossible without --apply, there is no PUT/PATCH/DELETE
// (and never DELETE /data), POSTs are never retried, and the key, customer id,
// account ids, and merchant ids are never printed — full ids go only to the
// gitignored manifest.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { buildSeedDataset, DEFAULT_PERSONA, SEED_MARKER } from "./nessie-seed/dataset.mjs";

const require = createRequire(import.meta.url);
const MANIFEST_PATH = ".nessie-seed.local.json";
const DEFAULT_BASE_URL = "https://api.nessieisreal.com";
// Tests shorten the gap; the real sandbox gets 150 ms between POSTs.
const POST_GAP_MS = Number(process.env.NESSIE_SEED_POST_GAP_MS ?? 150);
const TIMEOUT_MS = 10000;

const EXIT = { ok: 0, failed: 1, refused: 2, canary: 3, usage: 64, interrupted: 130 };

class SeedError extends Error {
  constructor(message, exitCode = EXIT.failed) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ---------- args ----------

const USAGE = `Usage: npm run nessie:seed -- [--preflight | --apply] [--persona <id>] [--as-of YYYY-MM-DD] [--allow-duplicate]`;

function parseArgs(argv) {
  const opts = { mode: "dry-run", persona: DEFAULT_PERSONA, asOf: null, allowDuplicate: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--preflight") opts.mode = opts.mode === "apply" ? "apply" : "preflight";
    else if (arg === "--apply") opts.mode = "apply";
    else if (arg === "--allow-duplicate") opts.allowDuplicate = true;
    else if (arg === "--persona") opts.persona = argv[++i];
    else if (arg === "--as-of") opts.asOf = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(EXIT.ok);
    } else throw new SeedError(`Unknown argument "${arg}".\n${USAGE}`, EXIT.usage);
  }
  if (!opts.persona || !/^[a-z0-9-]{3,40}$/.test(opts.persona)) {
    throw new SeedError("--persona must be 3–40 chars of a-z, 0-9, or -.", EXIT.usage);
  }
  if (opts.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(opts.asOf)) throw new SeedError("--as-of must be YYYY-MM-DD.", EXIT.usage);
  if (opts.asOf && opts.mode === "apply") {
    throw new SeedError("--as-of is for dry runs only; --apply always seeds relative to today.", EXIT.usage);
  }
  return opts;
}

// ---------- redaction ----------

/** Same rules as NessieError's scrubDetail: no URLs, keys, or id-shaped tokens. */
function scrub(text) {
  return String(text)
    .replace(/\bhttps?:\/\/\S+/gi, "<url>")
    .replace(/([?&]key=)[^&\s)]*/gi, "$1***")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{32}\b/gi, "<redacted>")
    .replace(/\b[0-9a-f]{24}\b/gi, "<id>");
}

const describeEndpoint = (method, path) =>
  `${method} ${path.replace(/\/(customers|accounts|merchants)\/[^/]+/g, "/$1/:id")}`;

// ---------- http ----------

function createClient({ baseUrl, apiKey, allowWrites }) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function send(method, path, body) {
    if (method !== "GET" && method !== "POST") throw new SeedError(`Refusing ${method}: only GET and POST exist here.`);
    if (method === "POST" && !allowWrites) throw new SeedError("Refusing POST: writes require --apply.");
    const endpoint = describeEndpoint(method, path);
    let response;
    try {
      response = await fetch(`${baseUrl}${path}?key=${encodeURIComponent(apiKey)}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === "TimeoutError" ? "timed out" : "network error";
      throw new SeedError(`${endpoint}: ${reason}`);
    }
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // keep json null; reported below if it matters
    }
    return { status: response.status, ok: response.ok, json, endpoint };
  }

  return {
    async get(path) {
      const res = await send("GET", path);
      if (!res.ok) throw new SeedError(`${res.endpoint}: HTTP ${res.status}`);
      return res.json;
    },
    /** One attempt only — a retried POST could create a duplicate. */
    async post(path, body) {
      await sleep(POST_GAP_MS);
      const res = await send("POST", path, body);
      const created = res.json?.objectCreated;
      if (res.status !== 201 || !created?._id) {
        const message = res.json?.message ? ` — ${scrub(res.json.message)}` : "";
        const culprit = Array.isArray(res.json?.culprit) ? ` [${res.json.culprit.map(scrub).join("; ")}]` : "";
        throw new SeedError(`${res.endpoint}: HTTP ${res.status}${message}${culprit}`);
      }
      return created;
    },
  };
}

// ---------- env ----------

function loadNessieEnv() {
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const apiKey = process.env.NESSIE_API_KEY?.trim();
  if (!apiKey) throw new SeedError("NESSIE_API_KEY is not set (.env.local).", EXIT.usage);
  const baseUrl = (process.env.NESSIE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

// ---------- summary (dry run) ----------

function summarize(dataset) {
  const sum = (records, field) => records.reduce((total, r) => total + r.body[field], 0);
  const dates = [
    ...dataset.deposits.map((r) => r.body.transaction_date),
    ...dataset.withdrawals.map((r) => r.body.transaction_date),
    ...dataset.purchases.map((r) => r.body.purchase_date),
    ...dataset.bills.filter((r) => r.body.payment_date).map((r) => r.body.payment_date),
  ].sort();
  const posts =
    1 + dataset.accounts.length + dataset.deposits.length + dataset.withdrawals.length +
    dataset.bills.length + dataset.purchases.length + dataset.loans.length;
  return [
    `persona            ${dataset.persona}  (asOf ${dataset.asOf})`,
    `customer           ${dataset.customer.first_name} ${dataset.customer.last_name}, ${dataset.customer.address.city} ${dataset.customer.address.state} ${dataset.customer.address.zip}`,
    `accounts           ${dataset.accounts.map((a) => `${a.body.type} ${a.body.balance}`).join(", ")}`,
    `deposits           ${dataset.deposits.length} records, total ${sum(dataset.deposits, "amount")}`,
    `withdrawals        ${dataset.withdrawals.length} records, total ${sum(dataset.withdrawals, "amount")}`,
    `bills              ${dataset.bills.length} records (${dataset.bills.filter((b) => b.body.status === "recurring").length} recurring), one-off total ${sum(dataset.bills.filter((b) => b.body.status !== "recurring"), "payment_amount")}`,
    `purchases          ${dataset.purchases.length} records, total ${sum(dataset.purchases, "amount")}`,
    `loans              ${dataset.loans.length} record(s), monthly ${sum(dataset.loans, "monthly_payment")}`,
    `date range         ${dates[0]} … ${dates.at(-1)}`,
    `POSTs on apply     ${posts} + up to ${dataset.merchantsNeeded.length} merchants`,
  ].join("\n");
}

function printPayloads(dataset) {
  const line = (label, path, body) => console.log(`  POST ${path.padEnd(34)} ${label.padEnd(10)} ${JSON.stringify(body)}`);
  for (const m of dataset.merchantsNeeded) line("merchant", "/merchants", m.body);
  line("customer", "/customers", dataset.customer);
  for (const a of dataset.accounts) line("account", "/customers/<customer>/accounts", a.body);
  for (const r of dataset.deposits) line("deposit", `/accounts/<${r.account}>/deposits`, r.body);
  for (const r of dataset.withdrawals) line("withdrawal", `/accounts/<${r.account}>/withdrawals`, r.body);
  for (const r of dataset.bills) line("bill", `/accounts/<${r.account}>/bills`, r.body);
  for (const r of dataset.purchases) line("purchase", `/accounts/<${r.account}>/purchases`, { merchant_id: `<${r.merchant}>`, ...r.body });
  for (const r of dataset.loans) line("loan", `/accounts/<${r.account}>/loans`, r.body);
}

// ---------- preflight (GET only) ----------

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    throw new SeedError(`${MANIFEST_PATH} exists but is not valid JSON — inspect it before seeding.`, EXIT.refused);
  }
}

async function preflight(client, dataset) {
  const customers = await client.get("/customers");
  if (!Array.isArray(customers)) throw new SeedError("GET /customers: expected an array");
  const duplicates = customers.filter((c) => typeof c?.last_name === "string" && c.last_name.includes(dataset.persona)).length;

  const merchants = await client.get("/merchants");
  if (!Array.isArray(merchants)) throw new SeedError("GET /merchants: expected an array");
  const existingMerchants = Object.fromEntries(
    dataset.merchantsNeeded.map((m) => [m.category, merchants.find((x) => x?.name === m.body.name)?._id ?? null]),
  );

  const manifest = readManifest();
  const manifestComplete = manifest?.persona === dataset.persona && manifest?.complete === true;

  return { duplicates, existingMerchants, manifestPresent: manifest !== null, manifestComplete };
}

function reportPreflight(result, dataset) {
  const toCreate = Object.values(result.existingMerchants).filter((id) => id === null).length;
  console.log(
    [
      `duplicate persona  ${result.duplicates > 0 ? `yes (${result.duplicates} customer(s) named for ${dataset.persona})` : "no"}`,
      `merchants          ${dataset.merchantsNeeded.length - toCreate} reusable, ${toCreate} to create`,
      `manifest           ${result.manifestPresent ? (result.manifestComplete ? "present, complete for this persona" : "present (incomplete or other persona)") : "none"}`,
    ].join("\n"),
  );
}

// ---------- apply ----------

const sameRecord = (a, b, fields) => fields.every((f) => a?.[f] === b?.[f]);
const notCancelled = (record) => !/cancel/i.test(record?.status ?? "");

async function apply(client, dataset, pre, manifest, save) {
  if (pre.duplicates > 0) {
    throw new SeedError(`Refusing: ${pre.duplicates} customer(s) already exist for ${dataset.persona}. Use --allow-duplicate to seed another.`, EXIT.refused);
  }
  if (pre.manifestComplete) {
    throw new SeedError(`Refusing: ${MANIFEST_PATH} already records a complete seed for ${dataset.persona}. Use --allow-duplicate to seed another.`, EXIT.refused);
  }

  const step = (label) => console.log(`  … ${label}`);

  // Merchants: reuse ours by exact name, create the rest.
  manifest.merchantIds = { ...pre.existingMerchants };
  for (const m of dataset.merchantsNeeded) {
    if (manifest.merchantIds[m.category]) continue;
    step(`merchant ${m.category}`);
    manifest.merchantIds[m.category] = (await client.post("/merchants", m.body))._id;
    save();
  }

  step("customer");
  manifest.customerId = (await client.post("/customers", dataset.customer))._id;
  save();

  manifest.accountIds = {};
  for (const a of dataset.accounts) {
    step(`account ${a.key}`);
    manifest.accountIds[a.key] = (await client.post(`/customers/${manifest.customerId}/accounts`, a.body))._id;
    save();
  }
  const accountPath = (key) => `/accounts/${manifest.accountIds[key]}`;

  // Canary: prove Nessie keeps a back-dated record exactly before 40+ more writes.
  const [canary, ...restDeposits] = dataset.deposits;
  step("canary deposit");
  await client.post(`${accountPath(canary.account)}/deposits`, canary.body);
  const stored = (await client.get(`${accountPath(canary.account)}/deposits`)) ?? [];
  const match = Array.isArray(stored) ? stored.find((d) => d?.description === canary.body.description) : null;
  const canaryFields = ["transaction_date", "amount", "description"];
  if (!match || !sameRecord(match, canary.body, canaryFields) || !notCancelled(match)) {
    const changed = match ? canaryFields.filter((f) => match[f] !== canary.body[f]) : ["<record not found>"];
    if (match && !notCancelled(match)) changed.push("status");
    manifest.canary = { ok: false, changed };
    throw new SeedError(`Canary failed: Nessie changed ${changed.join(", ")} on a back-dated deposit. Stopping.`, EXIT.canary);
  }
  manifest.canary = { ok: true };
  manifest.counts.deposits = 1;

  const postAll = async (label, records, resource, build = (r) => r.body) => {
    for (const r of records) {
      await client.post(`${accountPath(r.account)}/${resource}`, build(r));
      manifest.counts[label] = (manifest.counts[label] ?? 0) + 1;
    }
    save();
    step(`${label} ${manifest.counts[label] ?? 0}`);
  };
  await postAll("deposits", restDeposits, "deposits");
  await postAll("withdrawals", dataset.withdrawals, "withdrawals");
  await postAll("bills", dataset.bills, "bills");
  await postAll("purchases", dataset.purchases, "purchases", (r) => ({ merchant_id: manifest.merchantIds[r.merchant], ...r.body }));

  // Loans are a documented endpoint; a failed loan POST stops the run like any other,
  // because a persona missing its debt would overstate what it can afford.
  await postAll("loans", dataset.loans, "loans");

  manifest.readBack = await readBack(client, dataset, manifest);
  manifest.readBackMatches = manifest.readBack.mismatches.length === 0;
}

/** GETs everything back and compares to the dataset; reports field names only. */
async function readBack(client, dataset, manifest) {
  const checks = [
    ["deposits", "deposits", "description", ["transaction_date", "amount", "description"]],
    ["withdrawals", "withdrawals", "description", ["transaction_date", "amount", "description"]],
    ["bills", "bills", "nickname", ["payment_amount", "nickname", "status", "payment_date", "recurring_date"]],
    ["purchases", "purchases", "description", ["purchase_date", "amount", "description"]],
    ["loans", "loans", "description", ["monthly_payment", "status", "type", "amount", "credit_score", "description"]],
  ];
  const mismatches = [];
  const counts = {};
  for (const [label, resource, keyField, fields] of checks) {
    const live = (await client.get(`/accounts/${manifest.accountIds.checking}/${resource}`)) ?? [];
    const expected = dataset[label];
    counts[label] = Array.isArray(live) ? live.length : 0;
    if (counts[label] !== expected.length) mismatches.push(`${label}: count ${counts[label]} ≠ ${expected.length}`);
    for (const { body } of expected) {
      const found = Array.isArray(live) ? live.find((x) => x?.[keyField] === body[keyField]) : null;
      if (!found) {
        mismatches.push(`${label}: missing "${body[keyField]}"`);
        continue;
      }
      const changed = fields.filter((f) => f in body && found[f] !== body[f]);
      if (changed.length > 0) mismatches.push(`${label}: "${body[keyField]}" changed ${changed.join(", ")}`);
      if (!notCancelled(found)) mismatches.push(`${label}: "${body[keyField]}" is cancelled`);
    }
  }
  return { counts, mismatches };
}

function writeManifest(manifest) {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const dataset = buildSeedDataset({ asOf, personaId: opts.persona });

  console.log(`Nessie seed — ${opts.mode}\n`);
  console.log(summarize(dataset));

  if (opts.mode === "dry-run") {
    console.log(`\nPayloads (ids shown as <placeholders>; every label starts with "${SEED_MARKER}"):`);
    printPayloads(dataset);
    console.log("\nDry run: no network calls were made. Next: --preflight (read-only).");
    return;
  }

  const env = loadNessieEnv();
  const client = createClient({ ...env, allowWrites: opts.mode === "apply" });

  console.log("\nPreflight (GET only):");
  const pre = await preflight(client, dataset);
  reportPreflight(pre, dataset);
  if (opts.mode === "preflight") {
    console.log("\nPreflight only: nothing was written.");
    return;
  }

  if (opts.allowDuplicate) {
    pre.duplicates = 0;
    pre.manifestComplete = false;
  }
  const manifest = { persona: dataset.persona, asOf, customerId: null, accountIds: {}, merchantIds: {}, counts: {}, complete: false };
  // Write-ahead: persist ids as soon as they exist, so an interrupted run
  // still records what it created. Nothing is written before the first POST succeeds.
  const save = () => {
    if (manifest.customerId || Object.values(manifest.merchantIds).some(Boolean)) writeManifest(manifest);
  };
  const interrupt = (signal) => {
    save();
    console.error(`\n✗ Interrupted by ${signal}; partial seed recorded in ${MANIFEST_PATH} (complete: false).`);
    process.exit(EXIT.interrupted);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  console.log("\nApplying:");
  try {
    await apply(client, dataset, pre, manifest, save);
    manifest.complete = true;
  } finally {
    save();
  }
  console.log(
    [
      "",
      `customer created (id saved to ${MANIFEST_PATH})`,
      `counts             ${JSON.stringify(manifest.counts)}`,
      `read-back          ${manifest.readBackMatches ? "matches the dataset" : `${manifest.readBack.mismatches.length} mismatch(es):`}`,
      ...(manifest.readBackMatches ? [] : manifest.readBack.mismatches.map((m) => `  - ${scrub(m)}`)),
      `next               set NESSIE_CUSTOMER_ID in .env.local to the manifest's customerId, then restart npm run dev`,
    ].join("\n"),
  );
  if (!manifest.readBackMatches) process.exitCode = EXIT.failed;
}

main().catch((err) => {
  console.error(`\n✗ ${scrub(err?.message ?? err)}`);
  process.exit(err instanceof SeedError ? err.exitCode : EXIT.failed);
});
