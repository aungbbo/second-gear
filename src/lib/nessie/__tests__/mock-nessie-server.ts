import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-memory stand-in for the Nessie sandbox, for exercising the seed runner
 * and the live client end to end without touching the real service. It
 * mimics the observed behaviour: `?key=` auth that never 401s, `200 []` for
 * unknown ids on list routes, 404 for an unknown customer, and
 * `{ code: 201, objectCreated }` on POST.
 */

type Doc = Record<string, unknown> & { _id: string };

export interface MockNessieOptions {
  /** Respond 404 to every `/accounts/:id/loans` request. */
  loansUnsupported?: boolean;
  /** Store transaction/purchase/payment dates as "today", like a sandbox ignoring back-dates. */
  rewriteDates?: boolean;
  /** Fail the Nth POST (1-based) with this HTTP status and body. */
  failPost?: { nth: number; status: number; body: unknown };
  /** Drop the connection on the Nth POST (1-based) without responding. */
  dropPost?: number;
  /** Called after each POST is stored, with the running count. */
  onPost?: (count: number) => void;
}

export interface MockNessie {
  baseUrl: string;
  requests: { method: string; path: string; hasKey: boolean }[];
  customers: Doc[];
  accounts: (Doc & { customer_id: string })[];
  merchants: Doc[];
  records: Record<string, (Doc & { account_id: string })[]>;
  postCount: number;
  /** Every id the server minted — none may ever appear in runner output. */
  issuedIds: string[];
  close(): Promise<void>;
}

const RESOURCES = ["deposits", "withdrawals", "purchases", "bills", "loans"] as const;
const DATE_FIELDS = ["transaction_date", "purchase_date", "payment_date"];

export async function startMockNessie(options: MockNessieOptions = {}): Promise<MockNessie> {
  let counter = 0;
  const mintId = () => {
    // 24-hex, like Nessie's ObjectIds.
    const id = `5f${(++counter).toString(16).padStart(22, "0")}`;
    state.issuedIds.push(id);
    return id;
  };

  const state: MockNessie = {
    baseUrl: "",
    requests: [],
    customers: [],
    accounts: [],
    merchants: [],
    records: Object.fromEntries(RESOURCES.map((r) => [r, []])),
    postCount: 0,
    issuedIds: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const method = req.method ?? "GET";
    const parts = url.pathname.split("/").filter(Boolean);
    state.requests.push({ method, path: url.pathname, hasKey: url.searchParams.has("key") });

    if (method === "GET") {
      if (parts.length === 1 && parts[0] === "customers") return send(res, 200, state.customers);
      if (parts.length === 1 && parts[0] === "merchants") return send(res, 200, state.merchants);
      if (parts[0] === "customers" && parts.length === 2) {
        const customer = state.customers.find((c) => c._id === parts[1]);
        return customer ? send(res, 200, customer) : send(res, 404, "Customer not found");
      }
      if (parts[0] === "customers" && parts[2] === "accounts") {
        return send(res, 200, state.accounts.filter((a) => a.customer_id === parts[1]));
      }
      if (parts[0] === "accounts" && RESOURCES.includes(parts[2] as (typeof RESOURCES)[number])) {
        if (parts[2] === "loans" && options.loansUnsupported) return send(res, 404, { code: 404, message: "Not found" });
        return send(res, 200, state.records[parts[2]].filter((r) => r.account_id === parts[1]));
      }
      return send(res, 404, { code: 404, message: "Not found" });
    }

    if (method !== "POST") return send(res, 405, { code: 405, message: "Method not allowed" });

    const body = await readBody(req);
    const nth = state.postCount + 1;
    if (options.dropPost === nth) {
      req.socket.destroy();
      return;
    }
    if (options.failPost?.nth === nth) {
      state.postCount = nth;
      return send(res, options.failPost.status, options.failPost.body);
    }

    let created: Doc | null = null;
    if (parts.length === 1 && parts[0] === "merchants") {
      created = { ...body, _id: mintId() };
      state.merchants.push(created);
    } else if (parts.length === 1 && parts[0] === "customers") {
      created = { ...body, _id: mintId() };
      state.customers.push(created);
    } else if (parts[0] === "customers" && parts[2] === "accounts") {
      if (!state.customers.some((c) => c._id === parts[1])) return send(res, 404, { code: 404, message: "Invalid customer id" });
      const account = { ...body, _id: mintId(), customer_id: parts[1] };
      state.accounts.push(account);
      created = account;
    } else if (parts[0] === "accounts" && RESOURCES.includes(parts[2] as (typeof RESOURCES)[number])) {
      if (parts[2] === "loans" && options.loansUnsupported) return send(res, 404, { code: 404, message: "Not found" });
      if (!state.accounts.some((a) => a._id === parts[1])) return send(res, 404, { code: 404, message: "Invalid account id" });
      const record: Doc & { account_id: string } = { status: "pending", ...body, _id: mintId(), account_id: parts[1] };
      if (options.rewriteDates) {
        for (const field of DATE_FIELDS) if (field in record) record[field] = new Date().toISOString().slice(0, 10);
      }
      state.records[parts[2]].push(record);
      created = record;
    }

    if (!created) return send(res, 404, { code: 404, message: "Not found" });
    state.postCount = nth;
    options.onPost?.(nth);
    return send(res, 201, { code: 201, message: "Created", objectCreated: created });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  state.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}
