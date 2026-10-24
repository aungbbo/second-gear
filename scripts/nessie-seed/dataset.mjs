// Demo persona for the Nessie sandbox. Pure data — no I/O, no ids, no keys.
// Shared by scripts/nessie-seed.mjs and the offline dataset tests; never
// imported by the app.

export const SEED_MARKER = "sg-seed:";
export const DEFAULT_PERSONA = "sg-demo-subprime-01";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `YYYY-MM-DD` for `asOf` minus `daysAgo` days (UTC).
 * @param {string} asOf `YYYY-MM-DD`
 * @param {number} daysAgo
 * @returns {string}
 */
export function isoDay(asOf, daysAgo) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!match) throw new Error(`asOf must be YYYY-MM-DD, got "${asOf}"`);
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(base - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/** @typedef {"checking" | "savings" | "card"} AccountKey */
/** @typedef {"grocery" | "gas" | "restaurant"} MerchantCategory */

const ADDRESS = { street_number: "1200", street_name: "Demo Ave", city: "Columbus", state: "OH", zip: "43215" };
const GEOCODE = { lat: 39.9612, lng: -82.9988 };

const MERCHANTS = /** @type {const} */ ([
  { category: "grocery", name: "Second Gear Demo Grocer" },
  { category: "gas", name: "Second Gear Demo Gas" },
  { category: "restaurant", name: "Second Gear Demo Diner" },
]);

const PURCHASE_STREAMS = /** @type {const} */ ([
  {
    merchant: "grocery",
    label: "Groceries",
    days: [2, 9, 16, 23, 30, 37, 44, 51, 58, 65, 72, 79],
    amounts: [82, 76, 94, 68, 101, 73, 88, 79, 112, 70, 85, 92],
  },
  { merchant: "gas", label: "Gas", days: [5, 19, 35, 49, 61, 75], amounts: [44, 41, 47, 45, 43, 50] },
  { merchant: "restaurant", label: "Diner", days: [6, 20, 36, 50, 66, 80], amounts: [32, 28, 41, 35, 38, 36] },
]);

/**
 * Builds every POST body for the demo persona, dated relative to `asOf`.
 * Records reference accounts by key and purchases reference merchants by
 * category; the runner swaps in real ids at apply time.
 *
 * Shape rules that keep the cash-flow analyzer honest:
 * - everything transacts on checking, so Nessie can't move the card balance
 *   that drives the card-minimum debt figure;
 * - rent and the loan are never also posted as withdrawals (no double count);
 * - nothing is deposited into savings (it would read as income);
 * - every record is 2–80 days old, inside the 90-day window.
 *
 * @param {{ asOf: string, personaId?: string }} options
 */
export function buildSeedDataset({ asOf, personaId = DEFAULT_PERSONA }) {
  const day = (/** @type {number} */ daysAgo) => isoDay(asOf, daysAgo);
  const tag = (/** @type {string} */ text) => `${SEED_MARKER} ${text}`;

  const deposits = [
    ...[3, 17, 33, 47, 63, 77].map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: { medium: "balance", transaction_date: day(d), amount: 1650, description: tag(`Payroll — Acme Logistics (${day(d)})`) },
    })),
    ...[10, 40, 70].map((d) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: { medium: "balance", transaction_date: day(d), amount: 150, description: tag(`Rideshare payout (${day(d)})`) },
    })),
  ];

  const withdrawals = [8, 38, 68].map((d) => ({
    account: /** @type {AccountKey} */ ("checking"),
    body: { medium: "balance", transaction_date: day(d), amount: 120, description: tag(`ATM cash (${day(d)})`) },
  }));

  const electric = /** @type {const} */ ([
    [12, 95],
    [42, 110],
    [72, 88],
  ]);
  const bills = [
    {
      account: /** @type {AccountKey} */ ("checking"),
      body: { status: "recurring", payee: "Columbus Property Mgmt", nickname: tag("Rent"), recurring_date: 1, payment_amount: 1250 },
    },
    {
      account: /** @type {AccountKey} */ ("checking"),
      body: { status: "recurring", payee: "Buckeye Fiber", nickname: tag("Internet"), recurring_date: 15, payment_amount: 60 },
    },
    ...electric.map(([d, amount]) => ({
      account: /** @type {AccountKey} */ ("checking"),
      body: {
        status: "completed",
        payee: "AEP Ohio",
        nickname: tag(`Electric (${day(d)})`),
        payment_date: day(d),
        payment_amount: amount,
      },
    })),
  ];

  const purchases = PURCHASE_STREAMS.flatMap((stream) =>
    stream.days.map((d, i) => ({
      account: /** @type {AccountKey} */ ("checking"),
      merchant: /** @type {MerchantCategory} */ (stream.merchant),
      body: {
        medium: "balance",
        purchase_date: day(d),
        amount: stream.amounts[i],
        description: tag(`${stream.label} (${day(d)})`),
      },
    })),
  );

  const loans = [
    {
      account: /** @type {AccountKey} */ ("checking"),
      body: {
        type: "small business",
        status: "approved",
        credit_score: 600,
        monthly_payment: 140,
        amount: 4200,
        description: tag("Equipment loan"),
      },
    },
  ];

  return {
    persona: personaId,
    asOf,
    customer: { first_name: "SecondGear", last_name: `Demo ${personaId}`, address: { ...ADDRESS } },
    accounts: [
      { key: /** @type {AccountKey} */ ("checking"), body: { type: "Checking", nickname: "Everyday Checking", rewards: 0, balance: 1850 } },
      { key: /** @type {AccountKey} */ ("savings"), body: { type: "Savings", nickname: "Rainy Day Savings", rewards: 0, balance: 2400 } },
      { key: /** @type {AccountKey} */ ("card"), body: { type: "Credit Card", nickname: "Starter Card", rewards: 0, balance: 1800 } },
    ],
    merchantsNeeded: MERCHANTS.map((m) => ({
      category: /** @type {MerchantCategory} */ (m.category),
      body: { name: m.name, category: m.category, address: { ...ADDRESS }, geocode: { ...GEOCODE } },
    })),
    deposits,
    withdrawals,
    bills,
    purchases,
    loans,
  };
}

/** @typedef {ReturnType<typeof buildSeedDataset>} SeedDataset */
