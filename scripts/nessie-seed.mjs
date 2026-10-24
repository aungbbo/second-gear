#!/usr/bin/env node
// Development-only: seeds a demo persona into the Capital One Nessie sandbox.
// Never imported by the app. See docs/nessie-sandbox.md.
//
//   npm run nessie:seed                      dry run — no network, prints the plan
//   npm run nessie:seed -- --preflight       read-only GETs: duplicate + merchant checks
//   npm run nessie:seed -- --apply           creates a NEW customer and its data
//   npm run nessie:seed -- --resume          read-only: what a resume of the manifest's partial seed would post
//   npm run nessie:seed -- --apply --resume  posts only the records that partial seed is missing
//   ... --apply [--resume] --canary-only     posts at most one record of each shape, lists each back, stops
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

/** Ends a --canary-only run after the canary, leaving the manifest incomplete. */
class CanaryOnlyDone extends Error {}

class SeedError extends Error {
  constructor(message, exitCode = EXIT.failed) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ---------- args ----------

const USAGE = `Usage: npm run nessie:seed -- [--preflight | --apply] [--resume] [--canary-only] [--persona <id>] [--as-of YYYY-MM-DD] [--allow-duplicate]`;

function parseArgs(argv) {
  const opts = { mode: "dry-run", persona: DEFAULT_PERSONA, asOf: null, allowDuplicate: false, resume: false, canaryOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--preflight") opts.mode = opts.mode === "apply" ? "apply" : "preflight";
    else if (arg === "--apply") opts.mode = "apply";
    else if (arg === "--resume") opts.resume = true;
    else if (arg === "--canary-only") opts.canaryOnly = true;
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
  if (opts.canaryOnly && opts.mode !== "apply") throw new SeedError("--canary-only needs --apply (it writes the canaries).", EXIT.usage);
  if (opts.resume && (opts.allowDuplicate || opts.asOf)) {
    throw new SeedError("--resume continues the manifest's own seed; it takes neither --allow-duplicate nor --as-of.", EXIT.usage);
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

const MAX_BODY_CHARS = 300;
const clip = (text) => (text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text);

/**
 * "HTTP 400 — <message> [<culprit>]", falling back to the scrubbed raw body
 * when Nessie answers without a `message` (plain text, a bare string, or an
 * unexpected JSON shape). Always scrubbed and clipped.
 */
function describeFailure(res) {
  const parts = [`HTTP ${res.status}`];
  const json = res.json;
  const hasMessage = json && typeof json === "object" && typeof json.message === "string" && json.message;
  const hasCulprit = json && typeof json === "object" && Array.isArray(json.culprit) && json.culprit.length > 0;
  if (hasMessage) parts.push(clip(scrub(json.message)));
  if (hasCulprit) parts.push(`[${clip(json.culprit.map((c) => scrub(typeof c === "string" ? c : JSON.stringify(c))).join("; "))}]`);
  if (!hasMessage && !hasCulprit) {
    const raw = json !== null ? JSON.stringify(json) : (res.text ?? "").trim();
    parts.push(raw ? `body ${clip(scrub(raw))}` : "empty body");
  }
  return parts.join(" — ");
}

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
    return { status: response.status, ok: response.ok, json, text, endpoint };
  }

  return {
    async get(path) {
      const res = await send("GET", path);
      if (!res.ok) throw new SeedError(`${res.endpoint}: ${describeFailure(res)}`);
      return res.json;
    },
    /** One attempt only — a retried POST could create a duplicate. */
    async post(path, body) {
      await sleep(POST_GAP_MS);
      const res = await send("POST", path, body);
      const created = res.json?.objectCreated;
      if (res.status !== 201 || !created?._id) throw new SeedError(`${res.endpoint}: ${describeFailure(res)}`);
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

const notCancelled = (record) => !/cancel/i.test(record?.status ?? "");

async function apply(client, dataset, pre, manifest, save, { canaryOnly = false } = {}) {
  if (pre.duplicates > 0) {
    throw new SeedError(`Refusing: ${pre.duplicates} customer(s) already exist for ${dataset.persona}. Use --allow-duplicate to seed another.`, EXIT.refused);
  }
  if (pre.manifestComplete) {
    throw new SeedError(`Refusing: ${MANIFEST_PATH} already records a complete seed for ${dataset.persona}. Use --allow-duplicate to seed another.`, EXIT.refused);
  }
  if (pre.manifestPresent) {
    // Never overwrite a manifest: it holds the only copy of a seed's ids.
    throw new SeedError(
      `Refusing: ${MANIFEST_PATH} already exists. Resume it (--resume) or archive it first, e.g. mv ${MANIFEST_PATH} .nessie-seed.<persona>.broken.local.json`,
      EXIT.refused,
    );
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
  await seedTransactions(client, dataset, manifest, save, emptyExisting(), { canaryOnly });
}

// Stream label → [resource path, field that uniquely labels each seeded record].
const STREAMS = {
  deposits: ["deposits", "description"],
  withdrawals: ["withdrawals", "description"],
  bills: ["bills", "nickname"],
  purchases: ["purchases", "description"],
  loans: ["loans", "description"],
};
const emptyExisting = () => Object.fromEntries(Object.keys(STREAMS).map((label) => [label, new Map()]));

/** Counts the seeded records already on checking, keyed by their unique label. */
async function existingRecords(client, manifest) {
  const existing = emptyExisting();
  for (const [label, [resource, keyField]] of Object.entries(STREAMS)) {
    const live = (await client.get(`/accounts/${manifest.accountIds.checking}/${resource}`)) ?? [];
    if (!Array.isArray(live)) throw new SeedError(`GET /accounts/:id/${resource}: expected an array`);
    for (const record of live) {
      const key = record?.[keyField];
      if (typeof key === "string") existing[label].set(key, (existing[label].get(key) ?? 0) + 1);
    }
  }
  return existing;
}

// Fields that must round-trip exactly, per stream — used by the canaries and the read-back.
const VERIFY_FIELDS = {
  deposits: ["transaction_date", "amount", "description", "status", "medium"],
  withdrawals: ["transaction_date", "amount", "description", "status", "medium"],
  bills: ["status", "payee", "nickname", "payment_date", "recurring_date", "payment_amount"],
  purchases: ["purchase_date", "amount", "description", "status", "medium", "merchant_id"],
  loans: ["type", "status", "credit_score", "monthly_payment", "amount", "description"],
};

/**
 * Fields the sandbox computes rather than accepts. A recurring bill must come
 * back with an upcoming_payment_date that is a real date on its due day, after
 * the last payment — otherwise the bill list itself is at risk.
 */
function serverFieldProblems(label, found, body) {
  if (label !== "bills") return [];
  const upcoming = found?.upcoming_payment_date;
  if (typeof upcoming !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(upcoming)) return ["upcoming_payment_date missing or not a date"];
  const problems = [];
  if (Number(upcoming.slice(8, 10)) !== body.recurring_date) problems.push("upcoming_payment_date not on the due day");
  if (body.payment_date && upcoming.slice(0, 10) <= body.payment_date) problems.push("upcoming_payment_date not after payment_date");
  return problems;
}

/** The exact body POSTed for a dataset record (purchases gain their merchant id). */
const buildBody = (label, record, manifest) =>
  label === "purchases" ? { merchant_id: manifest.merchantIds[record.merchant], ...record.body } : record.body;

/**
 * One record of every shape the seed writes, posted and listed back before any
 * bulk write: the bills lesson is that POST can accept a record that later
 * breaks GET for the whole collection.
 */
function canaryRecords(dataset) {
  return [
    ["deposits", dataset.deposits[0]],
    ["withdrawals", dataset.withdrawals[0]],
    ["bills", dataset.bills.find((b) => b.body.status === "recurring")],
    ["purchases", dataset.purchases[0]],
    ["loans", dataset.loans[0]],
  ];
}

/**
 * Posts every dataset record not already in `existing`, canaries first.
 * Shared by --apply (nothing exists yet) and --apply --resume (skip what a
 * partial seed already wrote), so a resume can never double-post a record.
 * Every created id is recorded in manifest.recordIds, keyed by stream and label.
 */
async function seedTransactions(client, dataset, manifest, save, existing, { canaryOnly = false } = {}) {
  const step = (label) => console.log(`  … ${label}`);
  const accountPath = (key) => `/accounts/${manifest.accountIds[key]}`;
  const keyOf = (label, record) => record.body[STREAMS[label][1]];
  const has = (label, record) => (existing[label].get(keyOf(label, record)) ?? 0) > 0;
  manifest.recordIds ??= {};

  const post = async (label, record) => {
    const created = await client.post(`${accountPath(record.account)}/${STREAMS[label][0]}`, buildBody(label, record, manifest));
    manifest.counts[label] = (manifest.counts[label] ?? 0) + 1;
    (manifest.recordIds[label] ??= {})[keyOf(label, record)] = created._id;
    existing[label].set(keyOf(label, record), 1);
    save();
  };

  // Canaries: each shape must POST, list back without error, and match field for field.
  const verified = [];
  for (const [label, record] of canaryRecords(dataset)) {
    const shape = label === "bills" ? `bill (${record.body.status})` : label.slice(0, -1);
    if (has(label, record)) step(`canary ${shape} already present — verifying`);
    else {
      step(`canary ${shape}`);
      await post(label, record);
    }
    let listed;
    try {
      listed = await client.get(`${accountPath(record.account)}/${STREAMS[label][0]}`);
    } catch (err) {
      manifest.canary = { ok: false, resource: label, error: scrub(err?.message ?? err) };
      throw new SeedError(`Canary failed: listing ${label} after the canary failed — ${scrub(err?.message ?? err)}. Stopping.`, EXIT.canary);
    }
    const expected = buildBody(label, record, manifest);
    const match = Array.isArray(listed) ? listed.find((x) => x?.[STREAMS[label][1]] === keyOf(label, record)) : null;
    const fields = VERIFY_FIELDS[label].filter((f) => f in expected);
    const changed = match
      ? [...fields.filter((f) => match[f] !== expected[f]), ...serverFieldProblems(label, match, expected)]
      : ["<record not found>"];
    if (changed.length > 0) {
      manifest.canary = { ok: false, resource: label, changed };
      throw new SeedError(`Canary failed: Nessie changed ${changed.join(", ")} on a canary ${shape}. Stopping.`, EXIT.canary);
    }
    verified.push(shape);
  }
  manifest.canary = { ok: true, verified };
  save();
  if (canaryOnly) return;

  for (const label of Object.keys(STREAMS)) {
    let skipped = 0;
    let sent = 0;
    for (const record of dataset[label]) {
      if (has(label, record)) {
        skipped++;
        continue;
      }
      // Loans are a documented endpoint; a failed loan POST stops the run like any
      // other, because a persona missing its debt would overstate what it can afford.
      await post(label, record);
      sent++;
    }
    step(`${label} posted ${sent}${skipped ? `, already present ${skipped}` : ""}`);
  }

  manifest.readBack = await readBack(client, dataset, manifest);
  manifest.readBackMatches = manifest.readBack.mismatches.length === 0;
}

// ---------- resume ----------

/**
 * Verifies, read-only, that the manifest's partial seed is intact and ours:
 * same persona, incomplete, customer/accounts/merchants all present under this
 * key with the expected types, and no seeded record duplicated. Returns the
 * dataset rebuilt for the manifest's asOf plus what already exists.
 */
async function loadResumeState(client, persona) {
  const refuse = (message) => {
    throw new SeedError(`Refusing to resume: ${message}`, EXIT.refused);
  };
  const manifest = readManifest();
  if (!manifest) refuse(`no ${MANIFEST_PATH} to resume.`);
  if (manifest.complete) refuse("the manifest already records a complete seed.");
  if (manifest.persona !== persona) refuse(`the manifest is for persona "${manifest.persona}", not "${persona}".`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.asOf ?? "")) refuse("the manifest has no valid asOf date.");

  const dataset = buildSeedDataset({ asOf: manifest.asOf, personaId: manifest.persona });
  manifest.accountIds ??= {};
  manifest.merchantIds ??= {};
  manifest.counts ??= {};
  const missing = [
    !manifest.customerId && "customer",
    ...dataset.accounts.filter((a) => !manifest.accountIds[a.key]).map((a) => `account ${a.key}`),
    ...dataset.merchantsNeeded.filter((m) => !manifest.merchantIds[m.category]).map((m) => `merchant ${m.category}`),
  ].filter(Boolean);
  if (missing.length > 0) refuse(`the partial seed never created ${missing.join(", ")}; it can't be resumed in place.`);

  const getOrRefuse = async (path, what) => {
    try {
      return await client.get(path);
    } catch (err) {
      if (err instanceof SeedError && /: HTTP 404\b/.test(err.message)) refuse(`${what} from the manifest is not visible with this key.`);
      throw err;
    }
  };
  await getOrRefuse(`/customers/${manifest.customerId}`, "the customer");
  const accounts = await getOrRefuse(`/customers/${manifest.customerId}/accounts`, "the customer's accounts");
  if (!Array.isArray(accounts)) refuse("the customer's accounts did not come back as a list.");
  if (accounts.length !== dataset.accounts.length) refuse(`the customer has ${accounts.length} account(s), expected ${dataset.accounts.length}.`);
  for (const a of dataset.accounts) {
    const live = accounts.find((x) => x?._id === manifest.accountIds[a.key]);
    if (!live) refuse(`account ${a.key} from the manifest is not on the customer.`);
    if (live.type !== a.body.type) refuse(`account ${a.key} is type "${live.type}", expected "${a.body.type}".`);
  }
  const merchants = await client.get("/merchants");
  const merchantIds = new Set(Array.isArray(merchants) ? merchants.map((m) => m?._id) : []);
  for (const m of dataset.merchantsNeeded) {
    if (!merchantIds.has(manifest.merchantIds[m.category])) refuse(`merchant ${m.category} from the manifest no longer exists.`);
  }

  const existing = await existingRecords(client, manifest);
  const duplicates = Object.entries(existing).flatMap(([label, keys]) =>
    [...keys].filter(([, count]) => count > 1).map(([key, count]) => `${label} "${key}" ×${count}`),
  );
  const unknown = Object.entries(existing).flatMap(([label, keys]) => {
    const expected = new Set(dataset[label].map((r) => r.body[STREAMS[label][1]]));
    return [...keys.keys()].filter((key) => !expected.has(key)).map((key) => `${label} "${key}"`);
  });
  return { manifest, dataset, existing, duplicates, unknown };
}

function reportResume(state) {
  const lines = ["customer, 3 accounts, 3 merchants  verified"];
  for (const label of Object.keys(STREAMS)) {
    const total = state.dataset[label].length;
    const present = state.dataset[label].filter((r) => state.existing[label].has(r.body[STREAMS[label][1]])).length;
    lines.push(`${label.padEnd(18)} ${present}/${total} present, ${total - present} to post`);
  }
  if (state.duplicates.length) lines.push(`duplicates         ${state.duplicates.length}: ${state.duplicates.map(scrub).join("; ")}`);
  if (state.unknown.length) lines.push(`unrecognised       ${state.unknown.length}: ${state.unknown.map(scrub).join("; ")}`);
  console.log(lines.join("\n"));
}

/** GETs everything back and compares to the dataset; reports field names only. */
async function readBack(client, dataset, manifest) {
  const mismatches = [];
  const counts = {};
  for (const [label, [resource, keyField]] of Object.entries(STREAMS)) {
    const live = (await client.get(`/accounts/${manifest.accountIds.checking}/${resource}`)) ?? [];
    const expected = dataset[label];
    counts[label] = Array.isArray(live) ? live.length : 0;
    if (counts[label] !== expected.length) mismatches.push(`${label}: count ${counts[label]} ≠ ${expected.length}`);
    for (const record of expected) {
      const body = buildBody(label, record, manifest);
      const found = Array.isArray(live) ? live.find((x) => x?.[keyField] === body[keyField]) : null;
      if (!found) {
        mismatches.push(`${label}: missing "${body[keyField]}"`);
        continue;
      }
      const changed = [
        ...VERIFY_FIELDS[label].filter((f) => f in body && found[f] !== body[f]),
        ...serverFieldProblems(label, found, body),
      ];
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

function guardedRun(manifest, run) {
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
  return (async () => {
    try {
      await run(save);
      manifest.complete = true;
      delete manifest.lastError;
    } catch (err) {
      if (err instanceof CanaryOnlyDone) delete manifest.lastError;
      else manifest.lastError = scrub(err?.message ?? err);
      throw err;
    } finally {
      save();
    }
  })();
}

function reportResult(manifest, verb) {
  console.log(
    [
      "",
      `${verb} (ids in ${MANIFEST_PATH})`,
      `posted             ${JSON.stringify(manifest.counts)}`,
      `read-back          ${manifest.readBackMatches ? "matches the dataset" : `${manifest.readBack.mismatches.length} mismatch(es):`}`,
      ...(manifest.readBackMatches ? [] : manifest.readBack.mismatches.map((m) => `  - ${scrub(m)}`)),
      `next               set NESSIE_CUSTOMER_ID in .env.local to the manifest's customerId, then restart npm run dev`,
    ].join("\n"),
  );
  if (!manifest.readBackMatches) process.exitCode = EXIT.failed;
}

async function resumeMain(opts) {
  console.log(`Nessie seed — resume ${opts.mode === "apply" ? "(apply)" : "(preview, GET only)"}\n`);
  const client = createClient({ ...loadNessieEnv(), allowWrites: opts.mode === "apply" });
  const state = await loadResumeState(client, opts.persona);
  console.log(`persona            ${state.dataset.persona}  (asOf ${state.dataset.asOf}, from the manifest)`);
  reportResume(state);
  if (state.duplicates.length || state.unknown.length) {
    throw new SeedError("Refusing to resume: the partial seed holds duplicate or unrecognised records.", EXIT.refused);
  }
  if (opts.mode !== "apply") {
    console.log("\nResume preview: nothing was written. Next: --apply --resume (writes).");
    return;
  }
  const { manifest } = state;
  if (opts.canaryOnly) {
    console.log(`\nCanaries only (at most ${canaryRecords(state.dataset).length} POSTs):`);
    await runCanariesOnly(manifest, (save) =>
      seedTransactions(client, state.dataset, manifest, save, state.existing, { canaryOnly: true }),
    );
    return;
  }
  console.log("\nResuming:");
  await guardedRun(manifest, (save) => seedTransactions(client, state.dataset, manifest, save, state.existing));
  reportResult(manifest, "seed resumed and completed");
}

/** Runs a canary-only pass, leaving the manifest incomplete and resumable. */
async function runCanariesOnly(manifest, run) {
  await guardedRun(manifest, async (save) => {
    await run(save);
    throw new CanaryOnlyDone();
  }).catch((err) => {
    if (!(err instanceof CanaryOnlyDone)) throw err;
  });
  console.log(
    `\nCanaries stored and verified: ${manifest.canary.verified.join(", ")} — every field round-trips and each list reads back. Seed still incomplete; next: --apply --resume.`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.resume) return resumeMain(opts);
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
    // Allows another customer for the same persona; an existing manifest still blocks.
    pre.duplicates = 0;
    pre.manifestComplete = false;
  }
  const manifest = { persona: dataset.persona, asOf, customerId: null, accountIds: {}, merchantIds: {}, counts: {}, complete: false };
  if (opts.canaryOnly) {
    console.log("\nApplying (customer, accounts, missing merchants, then canaries only):");
    await runCanariesOnly(manifest, (save) => apply(client, dataset, pre, manifest, save, { canaryOnly: true }));
    return;
  }
  console.log("\nApplying:");
  await guardedRun(manifest, (save) => apply(client, dataset, pre, manifest, save));
  reportResult(manifest, "customer created");
}

main().catch((err) => {
  console.error(`\n✗ ${scrub(err?.message ?? err)}`);
  process.exit(err instanceof SeedError ? err.exitCode : EXIT.failed);
});
